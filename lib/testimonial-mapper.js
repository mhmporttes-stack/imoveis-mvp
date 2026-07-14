import { randomUUID } from "node:crypto";

export const TESTIMONIAL_MEDIA_TYPES = ["none", "image", "video_upload", "video_url"];

export function rowToTestimonial(row) {
  return {
    id: row.id,
    clientName: row.client_name || "",
    clientDescription: row.client_description || "",
    testimonialText: row.testimonial_text || "",
    mediaType: normalizeMediaType(row.media_type),
    imageUrl: row.image_url || "",
    imageStoragePath: row.image_storage_path || "",
    videoUrl: row.video_url || "",
    videoStoragePath: row.video_storage_path || "",
    videoThumbnailUrl: row.video_thumbnail_url || "",
    videoThumbnailStoragePath: row.video_thumbnail_storage_path || "",
    displayOrder: row.display_order ?? 0,
    isPublished: booleanValue(row.is_published, true),
    authorizationConfirmed: booleanValue(row.authorization_confirmed, false),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function toTestimonialRecord(testimonial, now = new Date().toISOString()) {
  const mediaType = normalizeMediaType(testimonial.mediaType);

  return {
    id: testimonial.id || randomUUID(),
    client_name: text(testimonial.clientName) || "Cliente",
    client_description: text(testimonial.clientDescription),
    testimonial_text: text(testimonial.testimonialText),
    media_type: mediaType,
    image_url: mediaType === "image" ? text(testimonial.imageUrl) : "",
    image_storage_path: mediaType === "image" ? text(testimonial.imageStoragePath) : "",
    video_url: mediaType === "video_upload" || mediaType === "video_url" ? text(testimonial.videoUrl) : "",
    video_storage_path: mediaType === "video_upload" ? text(testimonial.videoStoragePath) : "",
    video_thumbnail_url: mediaType === "video_upload" || mediaType === "video_url" ? text(testimonial.videoThumbnailUrl) : "",
    video_thumbnail_storage_path: mediaType === "video_upload" || mediaType === "video_url" ? text(testimonial.videoThumbnailStoragePath) : "",
    display_order: Number.isFinite(Number(testimonial.displayOrder)) ? Number(testimonial.displayOrder) : 0,
    is_published: testimonial.isPublished === false ? false : true,
    authorization_confirmed: testimonial.authorizationConfirmed === true,
    created_at: testimonial.createdAt || now,
    updated_at: now
  };
}

export function validateTestimonial(testimonial = {}) {
  const errors = [];
  const mediaType = normalizeMediaType(testimonial.mediaType);

  if (!text(testimonial.clientName)) {
    errors.push("Informe o nome do cliente.");
  }

  if (!text(testimonial.testimonialText)) {
    errors.push("Informe o texto do depoimento.");
  }

  if (mediaType === "image" && !text(testimonial.imageUrl)) {
    errors.push("Envie uma imagem ou escolha o tipo de mídia sem mídia.");
  }

  if (mediaType === "video_upload" && !text(testimonial.videoUrl)) {
    errors.push("Envie um vídeo ou altere o tipo de mídia.");
  }

  if (mediaType === "video_url" && !isValidHttpUrl(testimonial.videoUrl)) {
    errors.push("Informe um link de vídeo válido.");
  }

  return errors;
}

function normalizeMediaType(value = "none") {
  return TESTIMONIAL_MEDIA_TYPES.includes(value) ? value : "none";
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1;
}

function isValidHttpUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
