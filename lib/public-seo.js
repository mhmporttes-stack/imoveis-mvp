// SEO do site público (dono, 2026-10-15): título/descrição/imagem da ficha e dados estruturados (JSON-LD).
// Só usa dado público — o imóvel chega de lib/public-properties.js já sem notas internas e sem preço quando
// publicado "sem valores" (hidePrice). Nada de nota/avaliações nem número de famílias (o dono não informou).
import { coverImage, isGenericPropertyName, propertyMessageSubject, typeLabel } from "./format";
import { parsePriceValue } from "./property-filter-options";
import { OFFICIAL_WHATSAPP_DIGITS } from "./official-whatsapp.mjs";
import { CANONICAL_SITE_URL } from "./site-url.mjs";

export const SITE_URL = CANONICAL_SITE_URL;
export const BUSINESS_NAME = "Matheus Machado Corretor de Imóveis";
export const BUSINESS_CRECI = "323106-F";
const AGENT_ID = `${SITE_URL}/#imobiliaria`;
const DESCRIPTION_LIMIT = 160;

export const HOME_DESCRIPTION =
  "Seu primeiro imóvel em Marília com Minha Casa Minha Vida e financiamento Caixa: casas e apartamentos, simulação gratuita e atendimento do corretor Matheus Machado, CRECI 323106-F.";

export function realEstateAgentJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    "@id": AGENT_ID,
    name: BUSINESS_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/assets/matheus-machado-symbol.png`,
    image: `${SITE_URL}/assets/og-matheus-machado-v2.png`,
    description: HOME_DESCRIPTION,
    telephone: `+${OFFICIAL_WHATSAPP_DIGITS}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: "Av. Ipiranga, 147",
      addressLocality: "Marília",
      addressRegion: "SP",
      addressCountry: "BR"
    },
    areaServed: { "@type": "City", name: "Marília" },
    identifier: { "@type": "PropertyValue", propertyID: "CRECI", value: BUSINESS_CRECI }
  };
}

function capitalize(text = "") {
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

export function propertyUrl(property = {}) {
  return `${SITE_URL}/empreendimentos/${encodeURIComponent(property.id)}`;
}

// "<nome ou tipo + quartos + bairro/região>, Marília | Matheus Machado"
export function propertySeoTitle(property = {}) {
  const subject = propertyMessageSubject({ ...property, code: "", name: "" }).text;
  const name = String(property.name || "").trim();
  const head = isGenericPropertyName(name) ? capitalize(subject) : `${name} · ${capitalize(subject)}`;
  return `${head}, Marília | Matheus Machado`;
}

export function propertySeoDescription(property = {}) {
  let text = String(property.salesText || "").replace(/\s+/g, " ").trim();
  // Publicado sem valores: o texto de venda digitado pode citar valor — a frase com "R$" sai da descrição.
  if (property.hidePrice) text = text.split(/(?<=[.!?])\s+/).filter((sentence) => !/R\$\s*\d/i.test(sentence)).join(" ");
  if (!text) {
    text = `${capitalize(propertyMessageSubject({ ...property, code: "", name: "" }).text)} em Marília/SP. Atendimento ${BUSINESS_NAME}, CRECI ${BUSINESS_CRECI}.`;
  }
  if (text.length <= DESCRIPTION_LIMIT) return text;
  const cut = text.slice(0, DESCRIPTION_LIMIT - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 80 ? cut.lastIndexOf(" ") : cut.length).replace(/[\s,;:.–-]+$/, "")}…`;
}

// Foto do imóvel para o compartilhamento. Foto em base64 (data:) ou a imagem genérica de reserva não servem
// para o WhatsApp/Facebook — sem foto pública, fica a imagem padrão da marca (app/layout.jsx).
export function propertyShareImage(property = {}) {
  const image = String(coverImage(property) || "");
  if (!image || image.startsWith("data:") || image === "/assets/hero-marilia.png") return "";
  return image.startsWith("/") ? `${SITE_URL}${image}` : image;
}

export function propertyMetadata(property) {
  const title = propertySeoTitle(property);
  const description = propertySeoDescription(property);
  const url = propertyUrl(property);
  const image = propertyShareImage(property);
  const images = image ? [{ url: image, alt: property.name || title }] : [{ url: `${SITE_URL}/assets/og-matheus-machado-v2.png`, width: 1200, height: 630, alt: BUSINESS_NAME }];
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, title, description, siteName: BUSINESS_NAME, locale: "pt_BR", images },
    twitter: { card: "summary_large_image", title, description, images: images.map((item) => item.url) }
  };
}

const SCHEMA_TYPES = {
  casa: "House",
  "casa-condominio": "House",
  chacara: "House",
  apartamento: "Apartment",
  condominio: "ApartmentComplex",
  terreno: "Place",
  loteamento: "Place"
};

// Ficha: anúncio (RealEstateListing) + a residência + a oferta, cada campo só quando existe no cadastro.
export function propertyJsonLd(property = {}) {
  const url = propertyUrl(property);
  const image = propertyShareImage(property);
  const residence = {
    "@type": SCHEMA_TYPES[property.type] || "Accommodation",
    name: property.name || typeLabel(property.type),
    address: { "@type": "PostalAddress", addressLocality: "Marília", addressRegion: "SP", addressCountry: "BR" }
  };
  if (/^\d+$/.test(String(property.bedrooms || "").trim()) && !["terreno", "loteamento"].includes(property.type)) {
    residence.numberOfRooms = Number(String(property.bedrooms).trim());
  }
  const area = String(property.area || "").trim().match(/^(\d+(?:[.,]\d+)?)\s*(m2|m²)?$/i);
  if (area) residence.floorSize = { "@type": "QuantitativeValue", value: Number(area[1].replace(",", ".")), unitCode: "MTK" };

  const listing = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    url,
    name: propertySeoTitle(property).replace(/, Marília \| Matheus Machado$/, ""),
    description: propertySeoDescription(property),
    ...(image ? { image } : {}),
    about: residence,
    provider: { "@id": AGENT_ID, "@type": "RealEstateAgent", name: BUSINESS_NAME }
  };

  // Só preço escrito como valor ("R$ 389.000"); texto livre ("R$ 250 mil", "consulte") não vira número.
  const priceText = String(property.price || "").trim();
  const price = !property.hidePrice && /^R\$\s*\d{1,3}(\.\d{3})+(,\d{2})?$/i.test(priceText) ? parsePriceValue(priceText) : null;
  if (price) {
    // O site mostra "A partir de <preço>": vai como preço mínimo, não como preço fechado.
    listing.offers = {
      "@type": "Offer",
      url,
      priceCurrency: "BRL",
      priceSpecification: { "@type": "PriceSpecification", minPrice: price, priceCurrency: "BRL" },
      offeredBy: { "@id": AGENT_ID }
    };
  }
  return listing;
}

// JSON dentro de <script>: "<" escapado para nenhum texto do cadastro fechar a tag.
export function jsonLdHtml(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
