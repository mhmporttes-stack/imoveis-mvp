// Apresentação dos dados do imóvel no site público (card, busca e ficha).
// Só FORMATA o que já está no cadastro — nunca inventa quarto, região, metragem ou preço.
import { normalizePropertyFeatures, normalizePropertyFeature } from "../../lib/property-features.js";
import { normalizeRegionValue } from "../../lib/property-filter-options.js";

function plain(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Nomes que só repetem o tipo do imóvel ("Casa", "Chácara"...): no card eles não ajudam a escolher.
const GENERIC_NAMES = {
  casa: "Casa",
  "casa terrea": "Casa térrea",
  sobrado: "Sobrado",
  apartamento: "Apartamento",
  apto: "Apartamento",
  ap: "Apartamento",
  terreno: "Terreno",
  lote: "Lote",
  chacara: "Chácara",
  sitio: "Sítio",
  kitnet: "Kitnet",
  imovel: "Imóvel",
  "casa em condominio": "Casa em condomínio"
};

const REGION_NAMES = { norte: "Zona Norte", sul: "Zona Sul", leste: "Zona Leste", oeste: "Zona Oeste", centro: "Centro" };

export function propertyZone(property = {}) {
  return REGION_NAMES[normalizeRegionValue(property.region)] || "";
}

export function propertyBedroomCount(property = {}) {
  const own = String(property.bedrooms || "").trim();
  if (/^\d+$/.test(own)) return Number(own);
  const features = Array.isArray(property.features) ? normalizePropertyFeatures(property.features) : [];
  for (const feature of features) {
    const match = /^(\d+)\s*(quartos?|dormit[oó]rios?)\b/i.exec(feature.text.trim());
    if (match) return Number(match[1]);
  }
  return null;
}

export function isGenericPropertyName(name = "") {
  return Boolean(GENERIC_NAMES[plain(name)]);
}

// "Casa" → "Casa 3 quartos · Zona Norte" (só com o que o cadastro tem). Nome próprio fica como está.
export function propertyDisplayTitle(property = {}) {
  const name = String(property.name || "").trim();
  const base = GENERIC_NAMES[plain(name)];
  if (!base) return name || "Imóvel";
  const bedrooms = propertyBedroomCount(property);
  const head = bedrooms ? `${base} ${bedrooms} ${bedrooms === 1 ? "quarto" : "quartos"}` : base;
  const zone = propertyZone(property);
  return zone ? `${head} · ${zone}` : head;
}

// Linha de localização: endereço/bairro do cadastro, ou a zona. Sem nada cadastrado, não aparece.
export function propertyPlaceLine(property = {}) {
  const location = String(property.location || "").trim();
  const zone = propertyZone(property);
  const titleHasZone = isGenericPropertyName(property.name) && zone;
  if (location && plain(location) !== "marilia") return location;
  if (titleHasZone) return "";
  return zone ? `${zone} · Marília/SP` : "";
}

// "77.50" → "77,5 m²" · "52 a 78 m2" → "52 a 78 m²" · "40,96 m² até 42,25 m²" fica igual.
export function formatAreaText(value = "") {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text.replace(/(\d+)\.(\d{1,2})(?!\d)/g, (_, whole, decimals) => {
    const trimmed = decimals.replace(/0+$/, "");
    return trimmed ? `${whole},${trimmed}` : whole;
  });
  text = text.replace(/\bm2\b/gi, "m²").replace(/\bmetros?\s*quadrados?\b/gi, "m²");
  return /m²/.test(text) ? text : `${text} m²`;
}

export function hasPublicPrice(property = {}) {
  return Boolean(String(property.price || "").trim());
}

// Situação para o filtro "Prontos" × "Na planta/em obras" — lida do status do cadastro.
export function propertyStage(property = {}) {
  const status = plain(property.status);
  if (!status) return "";
  if (status.includes("pronto")) return "pronto";
  if (/obra|lanca|planta|pre-?lanc/.test(status)) return "planta";
  return "";
}

// Diferenciais do cadastro, na ordem em que o dono cadastrou; tira o que já está no título.
export function propertyHighlights(property = {}, limit = 3) {
  const explicit = Array.isArray(property.features) ? normalizePropertyFeatures(property.features) : [];
  const fallback = explicit.length
    ? []
    : [
        /^\d+$/.test(String(property.bedrooms || "").trim()) ? normalizePropertyFeature(`${property.bedrooms} quartos`) : null,
        property.area ? normalizePropertyFeature(formatAreaText(property.area)) : null
      ].filter(Boolean);
  const title = plain(propertyDisplayTitle(property));
  const status = plain(property.status);
  const seen = new Set();
  return [...explicit, ...fallback]
    .filter((feature) => {
      const key = plain(feature.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      if (title.includes(key)) return false;
      if (status && key === status) return false;
      return true;
    })
    .slice(0, limit);
}
