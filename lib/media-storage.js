import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";

export const PROPERTY_MEDIA_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "property-media";

let bucketReady = false;

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

function extensionFromType(type = "") {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
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
