// Utilitários PUROS da mídia recebida pelo WhatsApp (sem banco/rede) — testados em
// tests/whatsapp-media-utils.test.mjs.

export const MAX_INBOUND_MEDIA_BYTES = 16 * 1024 * 1024; // limite do WhatsApp para áudio/vídeo

// "audio/ogg; codecs=opus" -> "audio/ogg"
export function baseMime(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

const AUDIO_EXTENSIONS = {
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/x-wav": "wav"
};

export function audioExtensionForMime(mime) {
  return AUDIO_EXTENSIONS[baseMime(mime)] || "bin";
}

// Content-Type entregue ao navegador: preserva "codecs=opus" nos áudios de voz do WhatsApp.
export function audioContentType(mime) {
  const base = baseMime(mime);
  if (!base.startsWith("audio/")) return "application/octet-stream";
  if (base === "audio/ogg" || base === "audio/opus") return "audio/ogg; codecs=opus";
  return base;
}

// Cabeçalho HTTP Range ("bytes=0-", "bytes=100-199", "bytes=-500") -> {start,end} inclusivo;
// null quando não há Range; "invalid" quando fora do arquivo. Necessário para o navegador
// avançar/voltar a barra do áudio.
export function parseByteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || size <= 0) return "invalid";
  let start = match[1] === "" ? NaN : Number(match[1]);
  let end = match[2] === "" ? NaN : Number(match[2]);
  if (Number.isNaN(start) && Number.isNaN(end)) return "invalid";
  if (Number.isNaN(start)) {
    // últimos N bytes
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (Number.isNaN(end) || end >= size) {
    end = size - 1;
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

// ID de mídia do webhook (mensagem de áudio recebida): message.audio.id
export function inboundAudioMediaId(message) {
  const id = message?.audio?.id;
  return typeof id === "string" && id.trim() ? id.trim() : "";
}

// ---------------------------------------------------------------------------
// Outras mídias recebidas: imagem, documento, vídeo e figurinha (o áudio segue acima).
// ---------------------------------------------------------------------------

// Tipos de mensagem recebida que o CRM baixa da Meta e guarda no storage privado.
export const INBOUND_MEDIA_TYPES = ["audio", "image", "document", "video", "sticker"];

const MEDIA_EXTENSIONS = {
  ...AUDIO_EXTENSIONS,
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "text/plain": "txt",
  "text/csv": "csv"
};

export function mediaExtensionForMime(mime) {
  return MEDIA_EXTENSIONS[baseMime(mime)] || "bin";
}

// Dados da mídia de uma mensagem recebida (payload do webhook): { id, mime, filename, caption }.
// `id` vazio = mensagem sem mídia baixável.
export function inboundMediaInfo(payload, type) {
  const media = payload?.[type];
  const id = typeof media?.id === "string" ? media.id.trim() : "";
  return {
    id,
    mime: String(media?.mime_type || ""),
    filename: typeof media?.filename === "string" ? media.filename : "",
    caption: typeof media?.caption === "string" ? media.caption : ""
  };
}

// Nome seguro para download (sem caminho/controle), com a extensão certa.
export function safeDownloadName(filename, fallbackBase, mime) {
  const cleaned = String(filename || "").replace(/[\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120);
  if (cleaned) return cleaned;
  return `${fallbackBase || "arquivo"}.${mediaExtensionForMime(mime)}`;
}
