// Conversa com o CRM. Só duas rotas: pegar o próximo anúncio aprovado e devolver o resultado.
// A chave pessoal vai no header Authorization: Bearer (gerada na tela Cadastros › Marketplace do CRM).

export const DEFAULT_CRM_URL = "https://www.matheusmachadoimoveis.com.br";

export function normalizeBaseUrl(value) {
  const raw = String(value || "").trim() || DEFAULT_CRM_URL;
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("A URL do CRM precisa começar com https://");
  return url.origin;
}

function headers(key) {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// Devolve { listing } | { listing: null, reason }. Nunca lança por resposta "normal" do CRM.
export async function fetchNextListing({ baseUrl, key }, fetchImpl = fetch) {
  if (!key) return { listing: null, reason: "sem_configuracao" };
  let response;
  try {
    response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/api/marketplace/queue/next`, { method: "GET", headers: headers(key), cache: "no-store" });
  } catch {
    return { listing: null, reason: "erro_crm" };
  }
  if (response.status === 401) return { listing: null, reason: "chave_invalida" };
  if (!response.ok) return { listing: null, reason: "erro_crm" };
  const data = await response.json().catch(() => ({}));
  return data.listing ? { listing: data.listing } : { listing: null, reason: data.reason || "fila_vazia" };
}

export async function postResult({ baseUrl, key }, listingId, body, fetchImpl = fetch) {
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/api/marketplace/queue/${encodeURIComponent(listingId)}/result`, {
    method: "POST",
    headers: headers(key),
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
    if (!/^https:\/\//i.test(String(url))) throw new Error(`Foto ${index + 1} não é https.`);
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Não foi possível baixar a foto ${index + 1} (${response.status}).`);
    const blob = await response.blob();
    const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const extension = type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
    files.push({ name: `foto-${index + 1}.${extension}`, type, base64: btoa(binary) });
  }
  return files;
}
