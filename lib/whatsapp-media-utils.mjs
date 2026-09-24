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
