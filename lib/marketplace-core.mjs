// Núcleo puro do Publicador do Facebook Marketplace (MKT-1, dono, 2026-10-20). Sem banco nem rede — testado em
// tests/marketplace-core.test.mjs. Regras:
// - só entra na fila o anúncio APROVADO pelo dono (approved_at); editar o conteúdo tira a aprovação;
// - a extensão do Chrome pega 1 por vez (claimed), no máximo 3 publicações por dia (São Paulo) e com intervalo
//   mínimo entre pegadas; no máximo 2 tentativas por anúncio; claim sem retorno vira "failed" (nunca volta sozinho
//   para a fila: o anúncio pode ter sido publicado e uma 2ª tentativa duplicaria);
// - a extensão recebe só os campos do anúncio — nunca dado de cliente nem outro dado do CRM.

export const MARKETPLACE_STATUSES = ["pending", "claimed", "published", "failed", "cancelled"];
export const MARKETPLACE_OFFER_TYPES = ["sale", "rent"];
export const MARKETPLACE_PROPERTY_TYPES = ["house", "apartment", "townhouse", "land"];
export const MARKETPLACE_MAX_ATTEMPTS = 2;
export const MARKETPLACE_DAILY_LIMIT = 3;
export const MARKETPLACE_MIN_GAP_MS = 45 * 60 * 1000; // a extensão espera 1 h ± jitter; o servidor segura 45 min
export const MARKETPLACE_STALE_CLAIM_MS = 2 * 60 * 60 * 1000;
export const MARKETPLACE_MAX_PHOTOS = 20;
export const MARKETPLACE_TOKEN_PREFIX = "mkp_";
export const MARKETPLACE_SETTINGS_ID = "marketplace_publisher";

export const STATUS_LABELS = {
  pending: "Aguardando",
  claimed: "Publicando",
  published: "Publicado",
  failed: "Falhou",
  cancelled: "Cancelado"
};

// Tipo do imóvel no CRM (lib/property-mapper.js PROPERTY_TYPES) → tipo do Marketplace.
const CRM_TYPE_TO_MARKETPLACE = {
  casa: "house",
  apartamento: "apartment",
  condominio: "townhouse",
  "casa-condominio": "townhouse",
  terreno: "land",
  loteamento: "land",
  chacara: "house"
};

export class MarketplaceInputError extends Error {}

function cleanText(value, max) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function optionalInt(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 20) throw new MarketplaceInputError(`${label} inválido.`);
  return number;
}

export function parsePrice(value) {
  if (typeof value === "number") return value;
  const raw = String(value ?? "").replace(/[^\d,.-]/g, "");
  if (!raw) return NaN;
  // "350.000,00" / "350000" / "350000.5"
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/\.(?=\d{3}(\D|$))/g, "");
  return Number(normalized);
}

export function isAllowedPhotoUrl(url, allowedHosts = []) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:") return false;
    if (!allowedHosts.length) return true;
    return allowedHosts.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// Valida e normaliza o que vem da tela. Erros em pt-BR para mostrar ao dono.
export function normalizeListingInput(input = {}, { allowedHosts = [] } = {}) {
  const title = cleanText(input.title, 100);
  if (title.length < 5) throw new MarketplaceInputError("Informe um título (mínimo 5 caracteres).");
  const price = parsePrice(input.price);
  if (!Number.isFinite(price) || price <= 0) throw new MarketplaceInputError("Informe um preço válido.");
  const offerType = MARKETPLACE_OFFER_TYPES.includes(input.offerType) ? input.offerType : null;
  if (!offerType) throw new MarketplaceInputError("Escolha venda ou aluguel.");
  const propertyType = MARKETPLACE_PROPERTY_TYPES.includes(input.propertyType) ? input.propertyType : null;
  if (!propertyType) throw new MarketplaceInputError("Escolha o tipo do imóvel.");
  const area = input.areaM2 === "" || input.areaM2 === null || input.areaM2 === undefined ? null : Number(String(input.areaM2).replace(",", "."));
  if (area !== null && (!Number.isFinite(area) || area <= 0)) throw new MarketplaceInputError("Área inválida.");
  const photoUrls = [...new Set((Array.isArray(input.photoUrls) ? input.photoUrls : []).map((url) => String(url || "").trim()).filter(Boolean))];
  const invalid = photoUrls.filter((url) => !isAllowedPhotoUrl(url, allowedHosts));
  if (invalid.length) throw new MarketplaceInputError("Há foto fora do armazenamento do CRM (só links https do CRM são aceitos).");
  if (!photoUrls.length) throw new MarketplaceInputError("Inclua pelo menos 1 foto.");
  if (photoUrls.length > MARKETPLACE_MAX_PHOTOS) throw new MarketplaceInputError(`No máximo ${MARKETPLACE_MAX_PHOTOS} fotos.`);
  const propertyId = cleanText(input.propertyId, 80) || null;

  return {
    property_id: propertyId,
    title,
    price: Math.round(price * 100) / 100,
    description: cleanText(input.description, 5000),
    offer_type: offerType,
    property_type: propertyType,
    bedrooms: optionalInt(input.bedrooms, "Quartos"),
    bathrooms: optionalInt(input.bathrooms, "Banheiros"),
    area_m2: area,
    iptu: optionalMoney(input.iptu, "IPTU"),
    condo_fee: optionalMoney(input.condoFee, "Condomínio"),
    parking_spaces: optionalInt(input.parkingSpaces, "Vagas de estacionamento"),
    city: cleanText(input.city, 80) || "Marília",
    state: (cleanText(input.state, 2) || "SP").toUpperCase(),
    neighborhood: cleanText(input.neighborhood, 80),
    photo_urls: photoUrls
  };
}

function optionalMoney(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const number = parsePrice(value);
  if (!Number.isFinite(number) || number < 0) throw new MarketplaceInputError(`${label} inválido.`);
  return Math.round(number * 100) / 100;
}

export function photoSource(photo) {
  if (typeof photo === "string") return photo.trim();
  return String(photo?.url || photo?.src || photo?.publicUrl || photo?.data || "").trim();
}

const DATA_URL = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i;

// De onde vem cada foto do cadastro: "keep" (já é link https do CRM), "data" (embutida em base64), "fetch" (link
// de fora ou caminho interno: o servidor baixa e copia para o armazenamento) ou "invalid".
export function classifyPhotoSource(raw, { allowedHosts = [], siteBaseUrl = "" } = {}) {
  const value = String(raw || "").trim();
  if (!value) return { kind: "invalid" };
  const data = value.match(DATA_URL);
  if (data) return { kind: "data", contentType: data[1].toLowerCase().replace("jpg", "jpeg"), base64: data[2].replace(/\s/g, "") };
  if (value.startsWith("data:")) return { kind: "invalid" };
  if (isAllowedPhotoUrl(value, allowedHosts)) return { kind: "keep", url: value };
  try {
    const url = new URL(value, siteBaseUrl || undefined);
    if (url.protocol === "https:") return { kind: "fetch", url: url.toString() };
  } catch {
    // caminho sem base: inválido
  }
  return { kind: "invalid" };
}

// Nome estável da cópia no armazenamento (mesma foto = mesmo arquivo; não duplica).
export function marketplacePhotoPath(hashHex, contentType) {
  const extension = { "image/png": "png", "image/webp": "webp" }[contentType] || "jpg";
  return `marketplace/${hashHex}.${extension}`;
}

// Rascunho a partir de um imóvel/empreendimento do CRM (rowToProperty). Fotos embutidas (data:) ou de fora do
// armazenamento ficam de fora e são contadas em `skippedPhotos`.
// `importedPhotoUrls` (opcional): fotos já copiadas para o armazenamento pelo servidor (base64/links externos).
export function buildDraftFromProperty(property, { simulationLink = "", allowedHosts = [], importedPhotoUrls = null } = {}) {
  const urls = (Array.isArray(property?.photos) ? property.photos : []).map(photoSource).filter(Boolean);
  const photoUrls = (importedPhotoUrls || urls.filter((url) => isAllowedPhotoUrl(url, allowedHosts))).slice(0, MARKETPLACE_MAX_PHOTOS);
  const price = parsePrice(property?.price);
  const bedrooms = Number.parseInt(String(property?.bedrooms ?? "").replace(/\D/g, ""), 10);
  const area = Number(String(property?.area ?? "").replace(/[^\d,.]/g, "").replace(",", "."));
  const parts = [
    cleanText(property?.salesText, 3000),
    property?.features?.length ? `Diferenciais: ${property.features.join(", ")}.` : "",
    property?.terms ? `Condições: ${cleanText(property.terms, 500)}` : "",
    simulationLink ? `Faça sua simulação de financiamento grátis: ${simulationLink}` : "",
    "Matheus Machado Corretor de Imóveis"
  ].filter(Boolean);

  return {
    propertyId: property?.id || "",
    title: cleanText(property?.name, 100),
    price: Number.isFinite(price) && price > 0 ? price : "",
    description: parts.join("\n\n"),
    offerType: "sale",
    propertyType: CRM_TYPE_TO_MARKETPLACE[property?.type] || "house",
    bedrooms: Number.isFinite(bedrooms) && bedrooms <= 20 ? bedrooms : "",
    bathrooms: "",
    areaM2: Number.isFinite(area) && area > 0 ? area : "",
    iptu: "",
    condoFee: "",
    parkingSpaces: "",
    city: "Marília",
    state: "SP",
    neighborhood: cleanText(property?.region || property?.location, 80),
    photoUrls,
    totalPhotos: urls.length,
    skippedPhotos: Math.max(0, Math.min(urls.length, MARKETPLACE_MAX_PHOTOS) - photoUrls.length)
  };
}

// Campos que, se mudarem, exigem nova aprovação (o "sim" do dono vale para o conteúdo aprovado).
const CONTENT_FIELDS = ["title", "price", "description", "offer_type", "property_type", "bedrooms", "bathrooms", "area_m2", "iptu", "condo_fee", "parking_spaces", "city", "state", "neighborhood", "photo_urls", "property_id"];

export function contentChanged(current, next) {
  return CONTENT_FIELDS.some((field) => JSON.stringify(current?.[field] ?? null) !== JSON.stringify(next?.[field] ?? null));
}

export function canEdit(listing) {
  return ["pending", "failed"].includes(listing?.status);
}

// Ações da tela: approve | unapprove | cancel. Devolve o patch a gravar ou lança erro legível.
export function planAdminAction(listing, action, { userId, now = new Date() } = {}) {
  const iso = now.toISOString();
  if (action === "approve") {
    if (!["pending", "failed"].includes(listing?.status)) throw new MarketplaceInputError("Só dá para aprovar anúncio aguardando ou que falhou.");
    return { status: "pending", approved_by: userId || null, approved_at: iso, attempts: 0, error: null, claimed_at: null };
  }
  if (action === "unapprove") {
    if (listing?.status !== "pending") throw new MarketplaceInputError("Só dá para tirar a aprovação de anúncio aguardando.");
    return { approved_by: null, approved_at: null };
  }
  if (action === "cancel") {
    if (!["pending", "failed"].includes(listing?.status)) throw new MarketplaceInputError("Anúncio publicando ou publicado não pode ser cancelado aqui.");
    return { status: "cancelled", approved_by: null, approved_at: null };
  }
  throw new MarketplaceInputError("Ação inválida.");
}

// Limites do servidor (defesa além da agenda da extensão). `publishedToday` = publicados desde 00:00 de São Paulo;
// `lastClaimAt` = última pegada (qualquer anúncio).
export function evaluateQueueGate({ now = new Date(), publishedToday = 0, lastClaimAt = null, hasActiveClaim = false } = {}) {
  if (hasActiveClaim) return { allowed: false, reason: "publicacao_em_andamento" };
  if (publishedToday >= MARKETPLACE_DAILY_LIMIT) return { allowed: false, reason: "limite_diario" };
  const last = lastClaimAt ? new Date(lastClaimAt).getTime() : 0;
  if (last && now.getTime() - last < MARKETPLACE_MIN_GAP_MS) return { allowed: false, reason: "intervalo_minimo" };
  return { allowed: true, reason: null };
}

export function isEligibleForClaim(listing) {
  return listing?.status === "pending" && Boolean(listing?.approved_at) && Number(listing?.attempts || 0) < MARKETPLACE_MAX_ATTEMPTS;
}

export function isStaleClaim(listing, now = new Date()) {
  return listing?.status === "claimed" && listing?.claimed_at && now.getTime() - new Date(listing.claimed_at).getTime() > MARKETPLACE_STALE_CLAIM_MS;
}

export function staleClaimPatch(now = new Date()) {
  return {
    status: "failed",
    error: "A extensão não deu retorno em 2 h. Confira no Facebook se o anúncio saiu antes de aprovar de novo.",
    updated_at: now.toISOString()
  };
}

export function claimPatch(listing, now = new Date()) {
  return { status: "claimed", claimed_at: now.toISOString(), attempts: Number(listing?.attempts || 0) + 1, error: null, updated_at: now.toISOString() };
}

// O que a extensão recebe. Nada além disso.
export function toExtensionPayload(listing) {
  return {
    id: listing.id,
    title: listing.title,
    price: Number(listing.price),
    description: listing.description || "",
    offerType: listing.offer_type,
    propertyType: listing.property_type,
    bedrooms: listing.bedrooms ?? null,
    bathrooms: listing.bathrooms ?? null,
    areaM2: listing.area_m2 === null || listing.area_m2 === undefined ? null : Number(listing.area_m2),
    iptu: listing.iptu === null || listing.iptu === undefined ? null : Number(listing.iptu),
    condoFee: listing.condo_fee === null || listing.condo_fee === undefined ? null : Number(listing.condo_fee),
    parkingSpaces: listing.parking_spaces ?? null,
    city: listing.city,
    state: listing.state,
    neighborhood: listing.neighborhood || "",
    photoUrls: Array.isArray(listing.photo_urls) ? listing.photo_urls : [],
    attempt: Number(listing.attempts || 0)
  };
}

export function isMarketplaceUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.protocol === "https:" && /(^|\.)facebook\.com$/i.test(parsed.hostname) && parsed.pathname.includes("/marketplace/");
  } catch {
    return false;
  }
}

// Resultado enviado pela extensão: { status: "published", url } ou { status: "failed", error, retry }.
// retry=true só quando a falha aconteceu ANTES de clicar em Publicar (nada saiu no Facebook).
export function planResult(listing, body = {}, now = new Date()) {
  if (listing?.status !== "claimed") throw new MarketplaceInputError("Este anúncio não está em publicação.");
  const iso = now.toISOString();
  if (body.status === "published") {
    const url = String(body.url || "").trim();
    return {
      status: "published",
      published_at: iso,
      marketplace_url: isMarketplaceUrl(url) ? url.slice(0, 500) : null,
      error: isMarketplaceUrl(url) ? null : "Publicado, mas a extensão não conseguiu capturar o link do anúncio.",
      updated_at: iso
    };
  }
  if (body.status === "failed") {
    const error = cleanText(body.error, 1000) || "Falha sem descrição.";
    const canRetry = body.retry === true && Number(listing.attempts || 0) < MARKETPLACE_MAX_ATTEMPTS;
    return { status: canRetry ? "pending" : "failed", error, updated_at: iso };
  }
  throw new MarketplaceInputError("Resultado inválido.");
}

export function readBearerToken(header) {
  const value = String(header || "");
  if (!value.startsWith("Bearer ")) return "";
  const token = value.slice(7).trim();
  return token.startsWith(MARKETPLACE_TOKEN_PREFIX) && token.length <= 200 ? token : "";
}
