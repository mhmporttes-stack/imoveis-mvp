import { normalizePropertyFeature, normalizePropertyFeatures } from "./property-features";
import { regionLabel } from "./property-filter-options";
import { OFFICIAL_WHATSAPP_DIGITS } from "./official-whatsapp.mjs";

// WhatsApp do site = o número OFICIAL conectado ao CRM (dono, 2026-10-15). Fonte única: lib/official-whatsapp.mjs.
export const WHATSAPP_PHONE = OFFICIAL_WHATSAPP_DIGITS;

export function whatsappMessageLink(message = "") {
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${WHATSAPP_PHONE}${text}`;
}

export function propertyCity(location = "") {
  return location.split(",")[0]?.trim() || "Marília";
}

export function propertyRegion(property = {}) {
  const region = property.region?.trim();
  if (region) return regionLabel(region);

  const locationParts = (property.location || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (locationParts.length > 1) return locationParts[1];
  return locationParts[0] || "Região a confirmar";
}

export function typeLabel(type = "") {
  const labels = {
    casa: "Casa",
    apartamento: "Apartamento",
    terreno: "Terreno",
    chacara: "Chácara",
    "casa-condominio": "Casa em condomínio",
    loteamento: "Loteamento",
    condominio: "Condomínio"
  };
  return labels[type] || "Imóvel";
}

export function statusLabel(property = {}) {
  if (property.status?.trim()) return property.status.trim();

  const text = [property.terms, property.discounts, property.delivery, property.salesText].join(" ").toLowerCase();
  if (text.includes("obra")) return "Em obras";
  if (text.includes("pré") || text.includes("pre")) return "Pré-lançamento";
  if (text.includes("lançamento") || text.includes("lancamento")) return "Lançamento";
  if (text.includes("pronto")) return "Pronto para morar";
  return "Venda";
}

export function propertyPrice(property = {}) {
  const price = property.price?.trim();
  return price || "Consulte condições";
}

export function propertyCardFeatures(property = {}, limit = 4) {
  const explicitFeatures = Array.isArray(property.features)
    ? normalizePropertyFeatures(property.features)
    : [];

  const fallbackFeatures = [
    normalizePropertyFeature(normalizeBedrooms(property.bedrooms)),
    normalizePropertyFeature(normalizeArea(property.area)),
    property.installmentEntry ? normalizePropertyFeature("Entrada facilitada") : null,
    hasFinancingText(property) ? normalizePropertyFeature("Aceita financiamento") : null,
    property.type === "loteamento" ? normalizePropertyFeature("Pronto para construir") : null
  ].filter(Boolean);

  const seen = new Set();
  return [...explicitFeatures, ...fallbackFeatures].filter((feature) => {
    const key = feature.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

export function coverImage(property) {
  const firstPhoto = Array.isArray(property.photos) ? property.photos[0] : null;
  if (typeof firstPhoto === "string" && firstPhoto.trim()) return firstPhoto.trim();
  return (
    firstPhoto?.data ||
    firstPhoto?.url ||
    firstPhoto?.src ||
    firstPhoto?.publicUrl ||
    property.imageUrl ||
    "/assets/hero-marilia.png"
  );
}

export function whatsappLink(property, message) {
  const text = encodeURIComponent(message || propertyWhatsappMessage(property, "info"));
  return `https://wa.me/${WHATSAPP_PHONE}?text=${text}`;
}

// Mensagens prontas da ficha (dono, 2026-10-15): tipo + quartos + bairro/região + código, só com o que existe
// no cadastro. Ex.: "Olá! Quero agendar uma visita na casa de 3 quartos no Jardim X (COD4353)."
const PROPERTY_MESSAGE_INTENTS = {
  visit: ["Olá! Quero agendar uma visita", { f: "na", m: "no" }],
  info: ["Olá! Quero saber mais sobre", { f: "a", m: "o" }],
  catalog: ["Olá! Quero receber o catálogo", { f: "da", m: "do" }],
  price: ["Olá! Quero saber o valor", { f: "da", m: "do" }]
};

export function propertyWhatsappMessage(property = {}, intent = "info") {
  const [opening, articles] = PROPERTY_MESSAGE_INTENTS[intent] || PROPERTY_MESSAGE_INTENTS.info;
  const subject = propertyMessageSubject(property);
  return `${opening} ${subject.feminine ? articles.f : articles.m} ${subject.text}.`;
}

// "casa de 3 quartos no Jardim X (COD4353)" — base da mensagem e do título de SEO da ficha.
export function propertyMessageSubject(property = {}) {
  const type = PROPERTY_TYPE_NOUNS[property.type] || { noun: "imóvel", feminine: false };
  const rooms = ["terreno", "loteamento"].includes(property.type) ? "" : bedroomsText(property.bedrooms);
  const place = propertyPlacePhrase(property);
  const code = String(property.code || "").trim();
  const name = String(property.name || "").trim();
  const identifier = code ? `COD${code.replace(/^cod[\s:-]*/i, "")}` : isGenericPropertyName(name) ? "" : name;
  const text = [type.noun, rooms ? `de ${rooms}` : "", place, identifier ? `(${identifier})` : ""].filter(Boolean).join(" ");
  return { text, feminine: type.feminine };
}

// Bairro tirado do campo "Localização" (formatos reais: "Cavalari · Marília/SP", "Av. X, 610 - Jardim Y - Marília",
// "Condomínio Terra Nova"); sem bairro reconhecível, usa a zona cadastrada ("na região Norte"); sem nada, vazio.
export function propertyNeighborhood(location = "") {
  const parts = String(location || "").split(/\s+[-·–]\s+|[,|·]/).map((part) => part.trim()).filter(Boolean);
  return parts.find((part) => !/\d/.test(part)
    && !/^(r\.|rua|av\.?|avenida|al\.|alameda|rod\.|rodovia|estrada|travessa|tv\.)\s/i.test(part)
    && !/^(mar[ií]lia(\s*\/?\s*sp)?|sp|s[aã]o paulo|brasil)$/i.test(part)) || "";
}

function propertyPlacePhrase(property = {}) {
  const neighborhood = propertyNeighborhood(property.location);
  if (neighborhood) {
    const feminine = /^(vila|ch[aá]cara|chácaras|zona|fazenda|est[aâ]ncia|col[oô]nia|cidade|quinta|granja)\b/i.test(neighborhood);
    return `${feminine ? "na" : "no"} ${neighborhood}`;
  }
  const region = property.region ? regionLabel(property.region) : "";
  return region ? `na região ${region}` : "";
}

const PROPERTY_TYPE_NOUNS = {
  casa: { noun: "casa", feminine: true },
  apartamento: { noun: "apartamento", feminine: false },
  terreno: { noun: "terreno", feminine: false },
  chacara: { noun: "chácara", feminine: true },
  "casa-condominio": { noun: "casa em condomínio", feminine: true },
  loteamento: { noun: "loteamento", feminine: false },
  condominio: { noun: "condomínio", feminine: false }
};

export function isGenericPropertyName(name = "") {
  const value = String(name || "").trim().toLowerCase();
  if (!value) return true;
  return ["imóvel", "imovel", ...Object.values(PROPERTY_TYPE_NOUNS).map((item) => item.noun), "chacara", "condominio", "casa em condominio"].includes(value);
}

function bedroomsText(value = "") {
  const text = normalizeBedrooms(String(value || ""));
  return text === "1 quartos" ? "1 quarto" : text;
}

export function buildGoogleMapsUrl(property = {}) {
  const query = [property.location, property.name].filter(Boolean).join(" - ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function normalizeBedrooms(value = "") {
  const text = value.trim();
  if (!text) return "";
  if (/^\d+$/.test(text)) return `${text} quartos`;
  return text.toLowerCase().includes("quarto") ? text : `${text} quartos`;
}

function normalizeArea(value = "") {
  const text = value.trim();
  if (!text) return "";
  if (/^\d+$/.test(text)) return `${text} m²`;
  return /m2|m²|metro/i.test(text) ? text : `${text} m²`;
}

function hasFinancingText(property = {}) {
  return [property.terms, property.discounts, property.salesText]
    .join(" ")
    .toLowerCase()
    .includes("financi");
}
