// Conversa com o CRM. Só duas rotas: pegar o próximo anúncio aprovado e devolver o resultado.
// A chave pessoal vai no header Authorization: Bearer (gerada na tela Cadastros › Marketplace do CRM).

export const DEFAULT_CRM_URL = "https://www.matheusmachadoimoveis.com.br";

export function normalizeBaseUrl(value) {
  const raw = String(value || "").trim() || DEFAULT_CRM_URL;
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("A URL do CRM precisa começar com https://");
  return url.origin;
}

// X-Extension-Version (1.9.3): o CRM guarda a versão que está rodando no PC junto do sinal da extensão (MKT-2g).
function headers(key, version = "") {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(version ? { "X-Extension-Version": String(version) } : {}) };
}

// Devolve { listing } | { listing: null, reason }. Nunca lança por resposta "normal" do CRM.
export async function fetchNextListing({ baseUrl, key, version }, fetchImpl = fetch) {
  if (!key) return { listing: null, reason: "sem_configuracao" };
  let response;
  try {
    response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/api/marketplace/queue/next`, { method: "GET", headers: headers(key, version), cache: "no-store" });
  } catch {
    return { listing: null, reason: "erro_crm" };
  }
  if (response.status === 401) return { listing: null, reason: "chave_invalida" };
  if (!response.ok) return { listing: null, reason: "erro_crm" };
  const data = await response.json().catch(() => ({}));
  return data.listing ? { listing: data.listing } : { listing: null, reason: data.reason || "fila_vazia", waitUntil: data.wait_until || null };
}

export async function postResult({ baseUrl, key, version }, listingId, body, fetchImpl = fetch) {
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/api/marketplace/queue/${encodeURIComponent(listingId)}/result`, {
    method: "POST",
    headers: headers(key, version),
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `CRM respondeu ${response.status}`);
  return data;
}

// Só baixa fotos de https do próprio CRM/armazenamento informado pelo CRM. Devolve [{ name, type, base64 }].
export async function downloadPhotos(urls = [], fetchImpl = fetch) {
  const files = [];
  for (const [index, url] of urls.entries()) {
    const { type, base64 } = await downloadAsBase64(url, `a foto ${index + 1}`, fetchImpl);
    const imageType = type.startsWith("image/") ? type : "image/jpeg";
    const extension = imageType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    files.push({ name: `foto-${index + 1}.${extension}`, type: imageType, base64 });
  }
  return files;
}

// 1.9.5: arquivo (foto/PDF) de uma resposta do Chat do Marketplace. Só https; nome e tipo vêm do CRM.
export async function downloadAttachment(attachment = {}, fetchImpl = fetch) {
  const { type, base64 } = await downloadAsBase64(attachment.url, "o arquivo da resposta", fetchImpl);
  const mime = String(attachment.mime || type || "application/octet-stream");
  return { name: String(attachment.name || (mime.startsWith("image/") ? "foto.jpg" : "arquivo.pdf")).slice(0, 120), type: mime, base64 };
}

async function downloadAsBase64(url, label, fetchImpl) {
  if (!/^https:\/\//i.test(String(url || ""))) throw new Error(`${label[0].toUpperCase()}${label.slice(1)} não é https.`);
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Não foi possível baixar ${label} (${response.status}).`);
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type: blob.type || "", base64: btoa(binary) };
}

// --- Chat do Marketplace (MKT-2) ---------------------------------------------------------------------------------
async function callCrm({ baseUrl, key, version }, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}${path}`, { ...options, headers: headers(key, version), cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `CRM respondeu ${response.status}`), { status: response.status });
  return data;
}

// Envia as conversas lidas (só Marketplace). Devolve { settings, created, newMessages, ... }.
// round (1.9.8): estado da rodada ({ ok, stage, error }, lib/round-status.js) — o CRM grava junto do sinal (MKT-2g).
export function postChatSync(config, conversations, fetchImpl = fetch, round = null) {
  return callCrm(config, "/api/marketplace/chat/sync", { method: "POST", body: JSON.stringify(round ? { conversations, round } : { conversations }) }, fetchImpl);
}

// Esqueleto anonimizado da página (calibração dos seletores; sem nomes nem mensagens).
export function postDiagnostic(config, kind, payload, fetchImpl = fetch) {
  return callCrm(config, "/api/marketplace/diagnostic", { method: "POST", body: JSON.stringify({ kind, payload }) }, fetchImpl);
}

export function fetchNextOutbound(config, fetchImpl = fetch) {
  return callCrm(config, "/api/marketplace/chat/outbox/next", { method: "GET" }, fetchImpl);
}

export function postOutboundResult(config, messageId, body, fetchImpl = fetch) {
  return callCrm(config, `/api/marketplace/chat/outbox/${encodeURIComponent(messageId)}/result`, { method: "POST", body: JSON.stringify(body) }, fetchImpl);
}
