import { normalizePropertyFeature, normalizePropertyFeatures } from "./property-features";
import { regionLabel } from "./property-filter-options";

export const WHATSAPP_PHONE = "5514998407380";

export function whatsappMessageLink(message = "") {
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${WHATSAPP_PHONE}${text}`;
}

export function propertyCity(location = "") {
  return location.split(",")[0]?.trim() || "Marília";
}

export function propertyNeighborhood(location = "") {
  return location.split(",")[1]?.trim() || "";
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
  const text = encodeURIComponent(message || `Olá! Quero saber mais sobre ${property.name}.`);
  return `https://wa.me/${WHATSAPP_PHONE}?text=${text}`;
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
