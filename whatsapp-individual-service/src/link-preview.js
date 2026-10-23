// Prévia de link (cartão com título, descrição e imagem) nas mensagens com URL enviadas pelo WhatsApp do corretor
// (pedido do dono, 2026-10-23: "tem que ser esperado carregar o link para ter aquela apresentação, porque se simplesmente
// enviar direto, não vai aquela pré-visualização"). O Baileys 6.7.24 só gera a prévia com o pacote opcional
// `link-preview-js`, que não está instalado — por isso tudo saía sem cartão. Aqui: lê a página (og:title, og:description,
// og:image), baixa a imagem e devolve o `linkPreview` que o Baileys põe na mensagem; tudo com prazo. Falhou = a mensagem
// sai sem prévia (nunca deixa de enviar). Partes puras testadas em tests/whatsapp-link-preview.test.mjs.

export const LINK_PREVIEW_TIMEOUT_MS = 9_000;
export const LINK_PREVIEW_MAX_HTML_BYTES = 512 * 1024;
export const LINK_PREVIEW_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// O Next.js só põe as metatags no <head> (em vez de transmiti-las depois) para robôs conhecidos — o do WhatsApp é um deles.
export const LINK_PREVIEW_USER_AGENT = "WhatsApp/2.24.20.80 A";

// Primeira URL http(s) do texto, sem pontuação final.
export function firstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return "";
  return match[0].replace(/[.,;:!?)\]}*_~]+$/, "");
}

const decodeEntities = (value) => String(value || "")
  .replace(/&quot;/g, "\"").replace(/&#39;|&#x27;/gi, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&amp;/g, "&")
  .trim();

function metaContent(html, names) {
  for (const tag of String(html || "").match(/<meta\b[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!key || !names.includes(key.toLowerCase())) continue;
    const content = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (content) return decodeEntities(content);
  }
  return "";
}

// og:title/og:description/og:image (com reservas: <title>, description, twitter:image). Imagem sempre absoluta.
export function parseOpenGraph(html, pageUrl) {
  const title = metaContent(html, ["og:title", "twitter:title"]) || decodeEntities((String(html || "").match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
  const description = metaContent(html, ["og:description", "twitter:description", "description"]);
  let image = metaContent(html, ["og:image:secure_url", "og:image", "twitter:image"]);
  if (image) {
    try { image = new URL(image, pageUrl).toString(); } catch { image = ""; }
  }
  return { title: title.slice(0, 300), description: description.slice(0, 500), image: /^https?:\/\//i.test(image) ? image : "" };
}

async function readLimited(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) return Buffer.from(await response.arrayBuffer()).subarray(0, maxBytes);
  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    total += value.length;
  }
  try { await reader.cancel(); } catch { /* já terminou */ }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

// -> { preview: urlInfo|null, reason } . urlInfo no formato do Baileys (getUrlInfo): 'canonical-url', 'matched-text',
// title, description, jpegThumbnail, highQualityThumbnail. makeThumbnail(buffer) -> { jpegThumbnail?, highQualityThumbnail? }.
export async function buildLinkPreview({ text, fetchImpl = fetch, makeThumbnail = null, timeoutMs = LINK_PREVIEW_TIMEOUT_MS, now = Date.now } = {}) {
  const url = firstUrl(text);
  if (!url) return { preview: null, reason: "sem_link" };
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());
  const headers = { "User-Agent": LINK_PREVIEW_USER_AGENT, Accept: "text/html,application/xhtml+xml" };
  let page;
  try {
    const response = await fetchImpl(url, { headers, redirect: "follow", signal: AbortSignal.timeout(remaining()) });
    if (!response.ok) return { preview: null, reason: `pagina_${response.status}` };
    page = parseOpenGraph((await readLimited(response, LINK_PREVIEW_MAX_HTML_BYTES)).toString("utf8"), response.url || url);
  } catch (error) {
    return { preview: null, reason: error?.name === "TimeoutError" || error?.name === "AbortError" ? "pagina_prazo" : "pagina_erro" };
  }
  if (!page.title) return { preview: null, reason: "sem_titulo" };
  const preview = { "canonical-url": url, "matched-text": url, title: page.title, description: page.description || undefined };
  let reason = "ok";
  if (page.image && makeThumbnail) {
    try {
      const response = await fetchImpl(page.image, { headers: { "User-Agent": LINK_PREVIEW_USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(remaining()) });
      if (!response.ok) throw new Error(`imagem_${response.status}`);
      const buffer = await readLimited(response, LINK_PREVIEW_MAX_IMAGE_BYTES);
      const thumb = await withDeadline(makeThumbnail(buffer), remaining());
      if (thumb?.jpegThumbnail) preview.jpegThumbnail = thumb.jpegThumbnail;
      if (thumb?.highQualityThumbnail) preview.highQualityThumbnail = thumb.highQualityThumbnail;
      if (!preview.jpegThumbnail && !preview.highQualityThumbnail) reason = "sem_miniatura";
    } catch (error) {
      reason = String(error?.message || "").startsWith("imagem_") ? error.message.slice(0, 20) : "imagem_erro";
    }
  } else if (!page.image) {
    reason = "sem_imagem";
  }
  return { preview, reason };
}

function withDeadline(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("imagem_prazo")), ms); })
  ]);
}
