import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";

export const PROPERTY_MEDIA_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "property-media";
export const TESTIMONIAL_MEDIA_BUCKET = process.env.SUPABASE_TESTIMONIALS_BUCKET || "testimonials";

let bucketReady = false;
let testimonialBucketReady = false;

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

export async function deleteTestimonialMediaPaths(paths = []) {
  const supabase = getSupabaseAdminClient();
  if (!supabase || !paths.length) return;

  await supabase.storage.from(TESTIMONIAL_MEDIA_BUCKET).remove(paths);
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
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
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
