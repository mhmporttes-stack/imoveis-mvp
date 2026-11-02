// Rastreamento de clique em anúncio (Google Ads): UTM + gclid/gbraid/wbraid. Regras puras + cola fina do navegador.
// - Capturado da URL na chegada e guardado em cookie de 1ª parte por 90 dias (janela do gclid), para sobreviver à navegação
//   entre páginas antes do cadastro. Clique novo (URL com algum desses parâmetros) substitui o guardado.
// - Gravado junto do cadastro (`attribution` do POST); a ORIGEM ("Google Ads — Aplicativos") é decidida no servidor
//   (lib/lead-origin.js) a partir desses valores — o cliente nunca manda rótulo nem tag.
// - Nenhum dado pessoal entra aqui (só parâmetros de URL de anúncio).

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
export const CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid"];
export const AD_ATTRIBUTION_COOKIE = "mm_ad_attr";
export const AD_ATTRIBUTION_MAX_AGE_DAYS = 90;

const CLICK_ID_PATTERN = /^[\w.-]{10,200}$/;

// Identificador de clique válido ou "" (usado no navegador e no servidor — mesma regra).
export function cleanClickId(value) {
  const text = String(value ?? "").trim();
  return CLICK_ID_PATTERN.test(text) ? text : "";
}

function cleanUtm(value) {
  return String(value ?? "").replace(/[<>]/g, "").trim().slice(0, 200);
}

// Lê só os parâmetros de anúncio de uma URLSearchParams-like (`get`). Chaves ausentes ficam de fora.
export function pickAdAttribution(searchParams) {
  const result = {};
  if (!searchParams || typeof searchParams.get !== "function") return result;
  for (const key of UTM_KEYS) {
    const value = cleanUtm(searchParams.get(key));
    if (value) result[key] = value;
  }
  for (const key of CLICK_ID_KEYS) {
    const value = cleanClickId(searchParams.get(key));
    if (value) result[key] = value;
  }
  return result;
}

export function hasAdAttribution(attribution) {
  return Boolean(attribution) && Object.keys(attribution).length > 0;
}

// Escolhe o que vale para o cadastro: a URL de agora (se trouxe algum parâmetro) ou o último clique guardado.
// Sempre devolve as 5 UTM (vazias quando não há), como o formulário sempre mandou; click ids só quando existem.
export function resolveAdAttribution(urlParams, stored) {
  const fromUrl = pickAdAttribution(urlParams);
  const chosen = hasAdAttribution(fromUrl) ? fromUrl : sanitizeStored(stored);
  const result = Object.fromEntries(UTM_KEYS.map((key) => [key, chosen[key] || ""]));
  for (const key of CLICK_ID_KEYS) if (chosen[key]) result[key] = chosen[key];
  return result;
}

function sanitizeStored(stored) {
  if (!stored || typeof stored !== "object") return {};
  const result = {};
  for (const key of UTM_KEYS) {
    const value = cleanUtm(stored[key]);
    if (value) result[key] = value;
  }
  for (const key of CLICK_ID_KEYS) {
    const value = cleanClickId(stored[key]);
    if (value) result[key] = value;
  }
  return result;
}

export function serializeAdAttributionCookie(attribution, { secure = false, now = Date.now() } = {}) {
  const value = encodeURIComponent(JSON.stringify({ ...sanitizeStored(attribution), savedAt: now }));
  const maxAge = AD_ATTRIBUTION_MAX_AGE_DAYS * 24 * 60 * 60;
  return `${AD_ATTRIBUTION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function parseAdAttributionCookie(cookieHeader, now = Date.now()) {
  const match = String(cookieHeader || "").split(/;\s*/).find((part) => part.startsWith(`${AD_ATTRIBUTION_COOKIE}=`));
  if (!match) return {};
  try {
    const parsed = JSON.parse(decodeURIComponent(match.slice(AD_ATTRIBUTION_COOKIE.length + 1)));
    const savedAt = Number(parsed?.savedAt) || 0;
    if (!savedAt || now - savedAt > AD_ATTRIBUTION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return {};
    return sanitizeStored(parsed);
  } catch {
    return {};
  }
}

// ---- Navegador ----

export function readStoredAdAttribution() {
  if (typeof document === "undefined") return {};
  return parseAdAttributionCookie(document.cookie);
}

// Chamado em toda página pública: só grava quando a URL trouxe parâmetro de anúncio (não apaga o clique guardado).
export function persistAdAttribution(searchParams) {
  if (typeof document === "undefined") return;
  const fromUrl = pickAdAttribution(searchParams);
  if (!hasAdAttribution(fromUrl)) return;
  try {
    document.cookie = serializeAdAttributionCookie(fromUrl, { secure: window.location.protocol === "https:" });
  } catch {
    // cookies bloqueados: o cadastro ainda leva os parâmetros da URL atual.
  }
}

// Valor para o `attribution` do POST de cadastro (URL de agora, senão o clique guardado).
export function currentAdAttribution(searchParams) {
  return resolveAdAttribution(searchParams, readStoredAdAttribution());
}
