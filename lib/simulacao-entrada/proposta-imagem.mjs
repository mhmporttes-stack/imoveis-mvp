/**
 * Carrega a FOTO PRINCIPAL cadastrada do empreendimento para o PDF "Proposta de Valores".
 *
 * Regras:
 *  - usa só imagem REAL cadastrada (`photos`), na ordem do cadastro — a primeira é a principal
 *    (a mesma que o site mostra como capa, `coverImage`); tenta as 3 primeiras até achar uma utilizável;
 *  - só JPEG ou PNG (o pdf-lib não embute WebP); qualquer outra coisa é ignorada;
 *  - só baixa de hosts confiáveis (o próprio site e o Supabase Storage do projeto), com limite de
 *    tamanho e de tempo — nunca de um endereço arbitrário digitado no cadastro;
 *  - qualquer falha devolve `null` e o PDF segue sem foto (layout alternativo).
 */

const MAX_BYTES = 4_000_000;
const TIMEOUT_MS = 4000;

const isJpg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

export function photoSource(photo) {
  if (typeof photo === "string") return photo.trim();
  return String(photo?.data || photo?.url || photo?.src || photo?.publicUrl || "").trim();
}

function trustedHosts(origin) {
  const hosts = new Set();
  for (const value of [origin, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL, "https://www.matheusmachadoimoveis.com.br"]) {
    try { if (value) hosts.add(new URL(value).host); } catch { /* ignora valor inválido */ }
  }
  return hosts;
}

async function fetchBytes(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length"));
    if (declared && declared > MAX_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= MAX_BYTES ? bytes : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Bytes de uma fonte de foto (data URI, caminho do próprio site ou URL de host confiável). */
export async function loadPhotoBytes(source, { origin = "" } = {}) {
  if (!source) return null;
  let bytes = null;
  if (source.startsWith("data:")) {
    const match = /^data:image\/(?:jpeg|jpg|png);base64,([A-Za-z0-9+/=\s]+)$/i.exec(source);
    bytes = match ? Buffer.from(match[1].replace(/\s+/g, ""), "base64") : null;
    if (bytes && bytes.length > MAX_BYTES) bytes = null;
  } else if (source.startsWith("/") && origin) {
    bytes = await fetchBytes(new URL(source, origin).toString());
  } else {
    let url = null;
    try { url = new URL(source); } catch { url = null; }
    if (url && url.protocol === "https:" && trustedHosts(origin).has(url.host)) bytes = await fetchBytes(url.toString());
  }
  return bytes && (isJpg(bytes) || isPng(bytes)) ? bytes : null;
}

/** Primeira foto utilizável do empreendimento (ou `null`). */
export async function carregarImagemPrincipal(property, { origin = "" } = {}) {
  const photos = Array.isArray(property?.photos) ? property.photos.slice(0, 3) : [];
  for (const photo of photos) {
    const bytes = await loadPhotoBytes(photoSource(photo), { origin });
    if (bytes) return bytes;
  }
  return null;
}
