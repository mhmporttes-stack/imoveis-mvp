// Origem "Click to WhatsApp" (anúncio patrocinado) — PURO, testado em tests/whatsapp-referral.test.mjs.
//
// A Meta entrega em messages[].referral (primeira mensagem de quem clicou no anúncio) campos como:
// source_url, source_id (ID do anúncio), source_type ("ad" | "post"), headline, body, media_type,
// image_url/video_url/thumbnail_url e ctwa_clid. Nada é obrigatório: qualquer campo pode faltar.

export const SPONSORED_LABEL = "WhatsApp — Anúncio patrocinado";
export const SPONSORED_KIND = "whatsapp_ad";

function clean(value, max = 500) {
  const text = String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim();
  return text ? text.slice(0, max) : "";
}

// Só ANÚNCIO patrocinado (source_type "ad"). "post" (CTA de publicação) não entra automaticamente
// na roleta. Sem source_type mas com identificadores de anúncio (ctwa_clid/source_id) = anúncio.
export function isSponsoredAdReferral(referral) {
  if (!referral || typeof referral !== "object") return false;
  const type = clean(referral.source_type, 20).toLowerCase();
  if (type) return type === "ad";
  return Boolean(clean(referral.ctwa_clid) || clean(referral.source_id));
}

// Campos do referral que vale guardar na origem do cliente (sem mídia/thumbnail).
export function sanitizeReferral(referral) {
  const source = referral && typeof referral === "object" ? referral : {};
  const result = {
    source_id: clean(source.source_id, 80),
    source_type: clean(source.source_type, 20).toLowerCase(),
    source_url: clean(source.source_url, 500),
    headline: clean(source.headline, 200),
    body: clean(source.body, 300),
    media_type: clean(source.media_type, 20),
    ctwa_clid: clean(source.ctwa_clid, 300)
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value));
}

// Metadados gravados em client_origins.source_metadata (lidos pelo trigger no INSERT do cliente).
export function buildSponsoredOriginMetadata(referral, names = {}, extra = {}) {
  const meta = { channel: "whatsapp", entry: "click_to_whatsapp", referral: sanitizeReferral(referral) };
  for (const [key, value] of Object.entries(names || {})) {
    if (value) meta[key] = String(value);
  }
  return { ...meta, ...extra };
}
