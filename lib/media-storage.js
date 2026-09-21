import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";

export const PROPERTY_MEDIA_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "property-media";
export const TESTIMONIAL_MEDIA_BUCKET = process.env.SUPABASE_TESTIMONIALS_BUCKET || "testimonials";
export const PROPERTY_DOCS_BUCKET = process.env.SUPABASE_PROPERTY_DOCS_BUCKET || "property-documents";
export const BROKER_AVATAR_BUCKET = process.env.SUPABASE_BROKER_AVATARS_BUCKET || "broker-avatars";
// Primeiro bucket PRIVADO do projeto (todos os outros são públicos) — os
// documentos aqui têm dados pessoais do cliente (RG, CPF, renda...), então
// nunca ficam numa URL pública permanente. Toda leitura passa por
// getClientDocumentSignedUrl (URL assinada, expira).
export const CLIENT_DOCS_BUCKET = process.env.SUPABASE_CLIENT_DOCS_BUCKET || "client-documents";

let bucketReady = false;
let testimonialBucketReady = false;
let propertyDocsBucketReady = false;
let brokerAvatarBucketReady = false;
let clientDocsBucketReady = false;

export async function uploadPropertyImage(file, propertyId = "drafts") {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase Storage nao configurado.");
  }

  await ensurePropertyMediaBucket(supabase);

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > 1_500_000) {
    throw new Error("A imagem continua muito grande. Tente uma foto menor.");
  }

  const extension = extensionFromType(file.type) || extensionFromName(file.name) || "jpg";
  const fileName = safeFileName(file.name, extension);
  const path = `${safePathPart(propertyId)}/${Date.now()}-${randomUUID()}-${fileName}`;

  const { error } = await supabase.storage
    .from(PROPERTY_MEDIA_BUCKET)
    .upload(path, buffer, {
      cacheControl: "31536000",
      contentType: file.type || "image/jpeg",
      upsert: false
    });

  if (error) {
    throw new Error(error.message || "Nao foi possivel enviar a imagem para o Supabase Storage.");
  }

  const { data } = supabase.storage.from(PROPERTY_MEDIA_BUCKET).getPublicUrl(path);
  return {
    name: file.name,
    data: data.publicUrl,
    storagePath: path
  };
}

export async function uploadTestimonialMedia(file, kind = "images", testimonialId = "drafts") {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase Storage nao configurado.");
  }

  const folder = normalizeTestimonialFolder(kind);
  await ensureTestimonialMediaBucket(supabase);

  const buffer = Buffer.from(await file.arrayBuffer());
  const isVideo = folder === "videos";
  const maxSize = isVideo ? 50_000_000 : 2_500_000;

  if (buffer.length > maxSize) {
    throw new Error(isVideo ? "O video esta muito grande. Envie um arquivo de ate 50 MB." : "A imagem esta muito grande. Tente uma foto menor.");
  }

  const allowed = isVideo ? allowedVideoTypes() : allowedImageTypes();
  if (!allowed.includes(file.type)) {
    throw new Error(isVideo ? "Formato de video nao permitido. Use MP4, WEBM ou MOV." : "Formato de imagem nao permitido. Use JPG, PNG ou WEBP.");
  }

  const extension = extensionFromType(file.type) || extensionFromName(file.name) || (isVideo ? "mp4" : "jpg");
  const fileName = safeFileName(file.name, extension);
  const path = `${folder}/${safePathPart(testimonialId)}/${Date.now()}-${randomUUID()}-${fileName}`;

  const { error } = await supabase.storage
    .from(TESTIMONIAL_MEDIA_BUCKET)
    .upload(path, buffer, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false
    });

  if (error) {
    throw new Error(error.message || "Nao foi possivel enviar o arquivo para o Supabase Storage.");
  }

  const { data } = supabase.storage.from(TESTIMONIAL_MEDIA_BUCKET).getPublicUrl(path);
  return {
    name: file.name,
    url: data.publicUrl,
    storagePath: path
  };
}

/**
 * PDFs/catalogos vao direto para o Storage (nunca embutidos como base64 no
 * payload de salvar o empreendimento) — payloads grandes causavam erro 413
 * (Payload Too Large) no limite de corpo de requisicao da Vercel.
 */
export async function uploadPropertyDocument(file, propertyId = "drafts") {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase Storage nao configurado.");
  }

  await ensurePropertyDocsBucket(supabase);

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > 50_000_000) {
    throw new Error("O arquivo continua muito grande. Envie um PDF de ate 50 MB.");
  }

  if (file.type && file.type !== "application/pdf") {
    throw new Error("Envie um arquivo PDF.");
  }

  const fileName = safeFileName(file.name, "pdf");
  const path = `${safePathPart(propertyId)}/${Date.now()}-${randomUUID()}-${fileName}`;

  const { error } = await supabase.storage
    .from(PROPERTY_DOCS_BUCKET)
    .upload(path, buffer, {
      cacheControl: "31536000",
      contentType: "application/pdf",
      upsert: false
    });

  if (error) {
    throw new Error(error.message || "Nao foi possivel enviar o PDF para o Supabase Storage.");
  }

  const { data } = supabase.storage.from(PROPERTY_DOCS_BUCKET).getPublicUrl(path);
  return {
    name: file.name,
    data: data.publicUrl,
    storagePath: path
  };
}

/**
 * O upload acima (uploadPropertyDocument) faz o arquivo passar pela função
 * serverless da Vercel — na prática ela recusa o corpo da requisição bem
 * antes do limite de 20 MB do bucket (erro de plataforma, "FUNCTION_PAYLOAD_
 * TOO_LARGE"), então qualquer book/catálogo real (poucos MB já bastam)
 * falhava. Gera uma URL assinada para o navegador enviar o arquivo direto
 * ao Supabase Storage — o corpo da requisição nunca passa pela Vercel. A
 * permissão continua sendo verificada aqui (quem chama isso já passou por
 * requireBrokerManagementApi), o token é de uso único e vale só para este
 * caminho específico.
 */
export async function createPropertyDocumentUploadTarget(propertyId, fileName, fileSize) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase Storage nao configurado.");

  await ensurePropertyDocsBucket(supabase);

  if (Number(fileSize) > 50_000_000) {
    throw new Error("Arquivo acima do tamanho permitido (50 MB).");
  }

  const safeName = safeFileName(fileName, "pdf");
  const path = `${safePathPart(propertyId)}/${Date.now()}-${randomUUID()}-${safeName}`;

  const { data, error } = await supabase.storage.from(PROPERTY_DOCS_BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(error.message || "Não foi possível preparar o envio do arquivo.");

  const { data: publicData } = supabase.storage.from(PROPERTY_DOCS_BUCKET).getPublicUrl(path);
  return { path, token: data.token, name: fileName, publicUrl: publicData.publicUrl };
}

export async function deletePropertyDocumentByUrl(url) {
  const supabase = getSupabaseAdminClient();
  const marker = `/object/public/${PROPERTY_DOCS_BUCKET}/`;
  const index = String(url || "").indexOf(marker);
  if (!supabase || index === -1) return;
  const path = decodeURIComponent(url.slice(index + marker.length));
  await supabase.storage.from(PROPERTY_DOCS_BUCKET).remove([path]);
}

export async function deleteTestimonialMediaPaths(paths = []) {
  const supabase = getSupabaseAdminClient();
  if (!supabase || !paths.length) return;

  await supabase.storage.from(TESTIMONIAL_MEDIA_BUCKET).remove(paths);
}

// Foto de perfil do corretor/administrador — mesmo padrão de upload das
// demais mídias (bucket dedicado, público, limite de tamanho e tipos
// restritos), usada na Meta Diária gerencial e disponível para reuso futuro
// em qualquer outra tela do painel.
export async function uploadBrokerAvatar(file, brokerId) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase Storage nao configurado.");
  }

  await ensureBrokerAvatarBucket(supabase);

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > 3_000_000) {
    throw new Error("A foto continua muito grande. Tente uma imagem de até 3 MB.");
  }

  const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    throw new Error("Formato não permitido. Use JPG, PNG ou WEBP.");
  }

  const extension = extensionFromType(file.type) || extensionFromName(file.name) || "jpg";
  const path = `${safePathPart(brokerId)}/${Date.now()}-${randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from(BROKER_AVATAR_BUCKET)
    .upload(path, buffer, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false
    });

  if (error) {
    throw new Error(error.message || "Não foi possível enviar a foto para o Supabase Storage.");
  }

  const { data } = supabase.storage.from(BROKER_AVATAR_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, storagePath: path };
}

export async function deleteBrokerAvatarByUrl(url) {
  const supabase = getSupabaseAdminClient();
  const path = extractBrokerAvatarStoragePath(url);
  if (!supabase || !path) return;

  await supabase.storage.from(BROKER_AVATAR_BUCKET).remove([path]);
}

function extractBrokerAvatarStoragePath(url = "") {
  const marker = `/object/public/${BROKER_AVATAR_BUCKET}/`;
  const index = String(url || "").indexOf(marker);
  return index === -1 ? "" : url.slice(index + marker.length);
}

const CLIENT_DOC_MIME_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif", "image/webp"];
const CLIENT_DOC_MAX_SIZE = 20_000_000;

// Documentos de cliente (item 2/21 do pedido: privados, nunca URL pública) —
// mesmo padrão de "signed upload direto do navegador" já usado para PDFs de
// empreendimento (createPropertyDocumentUploadTarget), necessário aqui
// também: um lote pode ter vários arquivos de alguns MB cada, e o corpo da
// requisição nunca deve passar pela função serverless da Vercel.
export async function createClientDocumentUploadTarget(clientId, fileName, fileSize, mimeType) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase Storage não configurado.");

  await ensureClientDocsBucket(supabase);

  if (Number(fileSize) > CLIENT_DOC_MAX_SIZE) {
    throw new Error("Arquivo acima do tamanho permitido (20 MB).");
  }
  if (mimeType && !CLIENT_DOC_MIME_TYPES.includes(mimeType)) {
    throw new Error("Formato não permitido. Envie PDF, JPG, PNG, WEBP ou HEIC.");
  }

  const extension = extensionFromType(mimeType) || extensionFromName(fileName) || "pdf";
  const safeName = safeFileName(fileName, extension);
  const path = `${safePathPart(clientId)}/${Date.now()}-${randomUUID()}-${safeName}`;

  const { data, error } = await supabase.storage.from(CLIENT_DOCS_BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(error.message || "Não foi possível preparar o envio do arquivo.");

  return { path, token: data.token, name: fileName };
}

// URL de leitura temporária (item 21: nunca link público permanente para
// documento pessoal) — usada tanto pela IA (baixa o arquivo no servidor,
// nunca precisa de URL) quanto pela tela (corretor/gestor abrindo um
// documento específico pra conferir uma pendência).
export async function getClientDocumentSignedUrl(path, expiresInSeconds = 600) {
  const supabase = getSupabaseAdminClient();
  if (!supabase || !path) return "";
  const { data, error } = await supabase.storage.from(CLIENT_DOCS_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(error.message || "Não foi possível gerar o link do documento.");
  return data.signedUrl;
}

// Baixa os bytes do arquivo diretamente (service role — bucket privado) para
// a análise por IA, sem precisar de URL nenhuma.
export async function downloadClientDocumentBuffer(path) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase Storage não configurado.");
  const { data, error } = await supabase.storage.from(CLIENT_DOCS_BUCKET).download(path);
  if (error) throw new Error(error.message || "Não foi possível baixar o documento.");
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteClientDocumentPaths(paths = []) {
  const supabase = getSupabaseAdminClient();
  if (!supabase || !paths.length) return;
  await supabase.storage.from(CLIENT_DOCS_BUCKET).remove(paths);
}

async function ensureClientDocsBucket(supabase) {
  if (clientDocsBucketReady) return;

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(listError.message || "Não foi possível verificar os buckets do Supabase Storage.");

  const exists = buckets?.some((bucket) => bucket.name === CLIENT_DOCS_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(CLIENT_DOCS_BUCKET, {
      public: false,
      fileSizeLimit: CLIENT_DOC_MAX_SIZE,
      allowedMimeTypes: CLIENT_DOC_MIME_TYPES
    });
    if (error && !String(error.message || "").toLowerCase().includes("already exists")) {
      throw new Error(error.message || "Não foi possível criar o bucket de documentos do cliente.");
    }
  }

  clientDocsBucketReady = true;
}

async function ensurePropertyMediaBucket(supabase) {
  if (bucketReady) return;

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(listError.message || "Nao foi possivel verificar os buckets do Supabase Storage.");
  }

  const exists = buckets?.some((bucket) => bucket.name === PROPERTY_MEDIA_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(PROPERTY_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: 1_500_000,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"]
    });

    if (error && !String(error.message || "").toLowerCase().includes("already exists")) {
      throw new Error(error.message || "Nao foi possivel criar o bucket de imagens.");
    }
  }

  bucketReady = true;
}

async function ensurePropertyDocsBucket(supabase) {
  if (propertyDocsBucketReady) return;

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(listError.message || "Nao foi possivel verificar os buckets do Supabase Storage.");
  }

  const exists = buckets?.some((bucket) => bucket.name === PROPERTY_DOCS_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(PROPERTY_DOCS_BUCKET, {
      public: true,
      fileSizeLimit: 50_000_000,
      allowedMimeTypes: ["application/pdf"]
    });

    if (error && !String(error.message || "").toLowerCase().includes("already exists")) {
      throw new Error(error.message || "Nao foi possivel criar o bucket de documentos.");
    }
  }

  propertyDocsBucketReady = true;
}

async function ensureBrokerAvatarBucket(supabase) {
  if (brokerAvatarBucketReady) return;

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(listError.message || "Nao foi possivel verificar os buckets do Supabase Storage.");
  }

  const exists = buckets?.some((bucket) => bucket.name === BROKER_AVATAR_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BROKER_AVATAR_BUCKET, {
      public: true,
      fileSizeLimit: 3_000_000,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"]
    });

    if (error && !String(error.message || "").toLowerCase().includes("already exists")) {
      throw new Error(error.message || "Nao foi possivel criar o bucket de fotos de perfil.");
    }
  }

  brokerAvatarBucketReady = true;
}

async function ensureTestimonialMediaBucket(supabase) {
  if (testimonialBucketReady) return;

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(listError.message || "Nao foi possivel verificar os buckets do Supabase Storage.");
  }

  const exists = buckets?.some((bucket) => bucket.name === TESTIMONIAL_MEDIA_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(TESTIMONIAL_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: 50_000_000,
      allowedMimeTypes: [...allowedImageTypes(), ...allowedVideoTypes()]
    });

    if (error && !String(error.message || "").toLowerCase().includes("already exists")) {
      throw new Error(error.message || "Nao foi possivel criar o bucket de depoimentos.");
    }
  }

  testimonialBucketReady = true;
}

function extensionFromType(type = "") {
  if (type === "image/jpeg" || type === "image/jpg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic") return "heic";
  if (type === "image/heif") return "heif";
  if (type === "application/pdf") return "pdf";
  if (type === "video/mp4") return "mp4";
  if (type === "video/webm") return "webm";
  if (type === "video/quicktime") return "mov";
  return "";
}

function extensionFromName(name = "") {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function safeFileName(name = "", extension = "jpg") {
  const baseName = name
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `${baseName || "imagem"}.${extension}`;
}

function safePathPart(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "drafts";
}

function normalizeTestimonialFolder(kind = "images") {
  if (kind === "video" || kind === "videos") return "videos";
  if (kind === "thumbnail" || kind === "thumbnails") return "thumbnails";
  return "images";
}

function allowedImageTypes() {
  return ["image/jpeg", "image/png", "image/webp"];
}

function allowedVideoTypes() {
  return ["video/mp4", "video/webm", "video/quicktime"];
}
