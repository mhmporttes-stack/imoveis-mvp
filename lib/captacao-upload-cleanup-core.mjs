// Puro (sem banco, sem "server-only") — regras da limpeza de fotos órfãs do
// upload público de captação (lib/captacao-upload-cleanup.js). Testado em
// tests/captacao-upload-cleanup-core.test.mjs.

const FOLDER_MARKER = "captacoes/";

// Converte o que estiver salvo numa foto (storagePath "captacoes/..." ou URL
// pública ".../property-media/captacoes/...?...") no caminho do arquivo
// dentro do bucket. Qualquer outra coisa (outra pasta, texto vazio): "".
export function extractCaptacaoUploadPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let path = text;
  if (/^https?:\/\//i.test(text)) {
    try {
      path = decodeURIComponent(new URL(text).pathname);
    } catch {
      return "";
    }
    const index = path.indexOf(`/${FOLDER_MARKER}`);
    if (index === -1) return "";
    path = path.slice(index + 1);
  }
  path = path.replace(/^\/+/, "");
  if (!path.startsWith(FOLDER_MARKER) || path.length <= FOLDER_MARKER.length) return "";
  return path;
}

// Todos os caminhos `captacoes/...` citados num valor salvo de fotos, em
// QUALQUER formato (array de objetos, array de URLs, texto JSON de linhas
// antigas, URL solta). Varre o texto inteiro em vez de depender do formato —
// errar para "em uso" nunca apaga foto; errar para "órfã" apagaria.
export function extractCaptacaoUploadPathsFromValue(value) {
  if (value === null || value === undefined) return [];
  let text = typeof value === "string" ? value : JSON.stringify(value);
  try {
    text = decodeURIComponent(text);
  } catch {
    // Texto com % solto: segue sem decodificar.
  }
  const found = new Set();
  for (const match of text.matchAll(/captacoes\/[^"'?#\s\\,\]\)]+/g)) {
    const path = extractCaptacaoUploadPath(match[0]);
    if (path) found.add(path);
  }
  return [...found];
}

function createdAtMs(object) {
  const fromMeta = new Date(object?.createdAt || "").getTime();
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
  // Reserva: o nome gerado pelo upload começa com Date.now() ("1727...-uuid-...").
  const match = String(object?.path || "").match(/^captacoes\/(\d{13})-/);
  return match ? Number(match[1]) : NaN;
}

// objects: [{ path, createdAt }]; referenced: Set de caminhos em uso.
// Devolve os caminhos que podem ser apagados: dentro de captacoes/, não
// referenciados, com idade conhecida >= minAgeMs, até `limit` (mais antigos
// primeiro). Idade desconhecida nunca é apagada.
// Só arquivos com o nome EXATO gerado por uploadPropertyImage(file, "captacoes")
// (lib/media-storage.js): "captacoes/<Date.now() 13 dígitos>-<uuid>-<nome
// saneado>.<jpg|png|webp>". Qualquer outro arquivo da pasta nunca é apagado.
export const GENERATED_UPLOAD_NAME = /^captacoes\/\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-z0-9_-]*\.(jpg|jpeg|png|webp)$/;

export function selectOrphanCaptacaoUploads(objects, referenced, { now, minAgeMs, limit }) {
  const inUse = referenced instanceof Set ? referenced : new Set(referenced || []);
  return (objects || [])
    .filter((object) => GENERATED_UPLOAD_NAME.test(String(object?.path || "")))
    .filter((object) => !inUse.has(object.path))
    .map((object) => ({ path: object.path, at: createdAtMs(object) }))
    .filter((object) => Number.isFinite(object.at) && now - object.at >= minAgeMs)
    .sort((a, b) => a.at - b.at)
    .slice(0, Math.max(0, limit))
    .map((object) => object.path);
}
