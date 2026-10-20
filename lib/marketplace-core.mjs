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

function plain(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Bairro limpo: "Terra Verde · Marília/SP" → "Terra Verde". Tira cidade, UF e separadores (o bairro vai só na
// descrição; a localização do Facebook é sempre a cidade).
export function sanitizeNeighborhood(value, { city = "Marília", state = "SP" } = {}) {
  const drop = new Set([plain(city), plain(state), plain(`${city} ${state}`), plain(`${city}/${state}`), plain(`${city}-${state}`)]);
  const parts = String(value || "")
    .split(/\s*[·•|—–,/]\s*|\s+-\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !drop.has(plain(part)));
  return cleanText(parts.join(" "), 80);
}

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
    bathrooms: requiredBathrooms(input.bathrooms),
    area_m2: area,
    iptu: optionalMoney(input.iptu, "IPTU"),
    condo_fee: optionalMoney(input.condoFee, "Condomínio"),
    parking_spaces: optionalInt(input.parkingSpaces, "Vagas de estacionamento"),
    city: cleanText(input.city, 80) || "Marília",
    state: (cleanText(input.state, 2) || "SP").toUpperCase(),
    neighborhood: sanitizeNeighborhood(input.neighborhood, { city: cleanText(input.city, 80) || "Marília", state: cleanText(input.state, 2) || "SP" }),
    photo_urls: photoUrls
  };
}

// O Facebook só deixa avançar com banheiros preenchido.
function requiredBathrooms(value) {
  const number = optionalInt(value, "Banheiros");
  if (number === null || number < 1) throw new MarketplaceInputError("Informe o número de banheiros (mínimo 1).");
  return number;
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
  const bedrooms = firstNumber(property?.bedrooms);
  const area = Number(String(String(property?.area ?? "").match(/\d+(?:[.,]\d+)?/)?.[0] || "").replace(",", "."));
  const rooms = deriveRoomDetails(property);
  return {
    propertyId: property?.id || "",
    title: cleanText(property?.name, 100),
    price: Number.isFinite(price) && price > 0 ? price : "",
    description: buildListingDescription(property, { simulationLink }),
    offerType: "sale",
    propertyType: CRM_TYPE_TO_MARKETPLACE[property?.type] || "house",
    bedrooms: Number.isFinite(bedrooms) && bedrooms <= 20 ? bedrooms : "",
    // Sem número seguro de banheiros: fica VAZIO e o dono preenche (regra do dono, 2026-10-20: nada de padrão).
    bathrooms: rooms.bathrooms ?? "",
    areaM2: Number.isFinite(area) && area > 0 ? area : "",
    iptu: "",
    condoFee: "",
    parkingSpaces: rooms.parkingSpaces ?? "",
    city: "Marília",
    state: "SP",
    neighborhood: sanitizeNeighborhood(property?.region || property?.location),
    photoUrls,
    totalPhotos: urls.length,
    skippedPhotos: Math.max(0, Math.min(urls.length, MARKETPLACE_MAX_PHOTOS) - photoUrls.length)
  };
}

// --- Detalhes estruturados lidos do cadastro (dono, 2026-10-20: anúncio detalhado e correto conforme o imóvel) ------
// O cadastro de imóveis não tem colunas de suítes/banheiros/vagas: vêm de "quartos", dos diferenciais e do nome.
// banheiros (Facebook) = total explícito ("4 banheiros") OU suítes + banheiros sociais/de apoio. Lavabo NÃO entra no
// número (vai na descrição). Sem dado suficiente → null (o dono preenche).
const NUMBER_WORDS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };

function firstNumber(value) {
  const match = plain(value).match(/\d+/);
  const number = match ? Number(match[0]) : NaN;
  return Number.isFinite(number) && number >= 0 && number <= 20 ? number : "";
}

function countBefore(text, noun) {
  const match = text.match(new RegExp(`(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+${noun}`));
  if (!match) return null;
  return /^\d+$/.test(match[1]) ? Number(match[1]) : NUMBER_WORDS[match[1]];
}

export function deriveRoomDetails(property = {}) {
  const sources = [property.name, property.bedrooms, ...(Array.isArray(property.features) ? property.features.map(featureText) : [])].map(plain).filter(Boolean);
  const all = sources.join(" | ");
  const suites = countBefore(all, "suites?");
  const totalExplicit = countBefore(all, "banheiros?(?!\\s*(?:social|sociais|de apoio|de servico|apoio))");
  let social = countBefore(all, "banheiros?\\s*(?:social|sociais|de apoio|apoio|de servico)");
  if (social === null && /banheiro\s*(social|de apoio|apoio|de servico)/.test(all)) social = 1;
  const lavabo = /lavabo/.test(all);
  const parking = countBefore(all, "vagas?");
  let bathrooms = null;
  if (totalExplicit !== null && totalExplicit > 0) bathrooms = totalExplicit;
  else if (suites !== null && social !== null) bathrooms = suites + social;
  return { suites, social, lavabo, bathrooms: bathrooms && bathrooms <= 20 ? bathrooms : null, parkingSpaces: parking !== null && parking <= 20 ? parking : null };
}

// Moeda com espaço comum (o Intl usa espaço não separável, que vira caractere estranho em alguns lugares).
function formatBrl(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value).replace(/\u00a0/g, " ");
}

// Resumo para conferência antes de aprovar: "À venda · Casa · 3 quartos · 4 banheiros · R$ 870.000 · Marília".
const SUMMARY_TYPES = { house: "Casa", apartment: "Apartamento", townhouse: "Casa em condomínio / sobrado", land: "Terreno" };
export function facebookSummary(listing = {}) {
  const offer = (listing.offer_type || listing.offerType) === "rent" ? "Aluguel" : "À venda";
  const type = SUMMARY_TYPES[listing.property_type || listing.propertyType] || "—";
  const bedrooms = listing.bedrooms;
  const bathrooms = listing.bathrooms;
  const price = parsePrice(listing.price);
  return [
    offer,
    type,
    bedrooms === null || bedrooms === undefined || bedrooms === "" ? "quartos: FALTA" : `${bedrooms} ${Number(bedrooms) === 1 ? "quarto" : "quartos"}`,
    bathrooms === null || bathrooms === undefined || bathrooms === "" ? "banheiros: FALTA" : `${bathrooms} ${Number(bathrooms) === 1 ? "banheiro" : "banheiros"}`,
    Number.isFinite(price) && price > 0 ? formatBrl(price) : "preço: FALTA",
    listing.city || "Marília"
  ].join(" · ");
}

// --- Descrição no estilo da legenda do Instagram do dono, SEM hashtags (dono, 2026-10-20) --------------------------
// Gancho curto + emojis como marcadores + blocos curtos + CTA com o link da simulação + assinatura. Só usa campos do
// cadastro (nunca inventa fato). Diferenciais podem vir como objeto { text, icon } (normalizePropertyFeatures).

const TYPE_HOOK = { casa: "Casa", apartamento: "Apartamento", condominio: "Casa em condomínio", "casa-condominio": "Casa em condomínio", terreno: "Terreno", loteamento: "Lote", chacara: "Chácara" };
const FEATURE_EMOJIS = [
  [/piscina/i, "🏊"],
  [/su[ií]te|banheir|lavabo/i, "🛁"],
  [/garag|vaga/i, "🚗"],
  [/churrasq|gourmet|espa[cç]o gourmet/i, "🍖"],
  [/quint|jardim|[aá]rea verde/i, "🌳"],
  [/academia|fitness/i, "🏋️"],
  [/playground|brinquedo/i, "🛝"],
  [/portaria|seguran|c[aâ]mera|monitor/i, "🔒"],
  [/cozinha/i, "🍽️"],
  [/sala/i, "🛋️"]
];

export function stripHashtags(text) {
  return String(text || "")
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1")
    .replace(/#/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function featureText(feature) {
  if (typeof feature === "string") return feature.trim();
  return String(feature?.text || feature?.label || feature?.name || "").trim();
}

function withUnit(value, unit) {
  const text = cleanText(value, 60);
  if (!text) return "";
  return /^\d+([.,]\d+)?$/.test(text) ? `${text} ${unit}` : text;
}

// Diferencial que é só a contagem de cômodo ("3 suítes", "Lavabo", "2 vagas de garagem"); "Suíte master com closet" fica.
const ROOM_ONLY_FEATURE = /^(\d+|um|uma|dois|duas|tres|quatro)?\s*(suites?|banheiros?(\s+(social|sociais|de apoio|apoio|de servico))?|lavabos?|vagas?(\s+de\s+garagem)?)$/;

function roomsLine(rooms) {
  const parts = [];
  if (rooms.suites) parts.push(`${rooms.suites} ${rooms.suites === 1 ? "suíte" : "suítes"}`);
  if (rooms.social) parts.push(`${rooms.social} ${rooms.social === 1 ? "banheiro" : "banheiros"} de apoio`);
  if (parts.length) return `🛁 ${parts.join(" + ")}${rooms.bathrooms ? ` (${rooms.bathrooms} banheiros)` : ""}`;
  return rooms.bathrooms ? `🛁 ${rooms.bathrooms} ${rooms.bathrooms === 1 ? "banheiro" : "banheiros"}` : "";
}

export function buildListingDescription(property = {}, { simulationLink = "" } = {}) {
  const field = (value, max = 500) => stripHashtags(cleanText(value, max));
  const typeName = TYPE_HOOK[property.type] || (property.isDevelopment ? "Imóvel" : "Imóvel");
  const name = field(property.name, 100);
  const hook = `🏡 ${name || typeName} à venda em Marília/SP`;

  const price = parsePrice(property.price);
  const rooms = deriveRoomDetails(property);
  const highlights = [
    sanitizeNeighborhood(property.region || property.location) ? `📍 ${sanitizeNeighborhood(property.region || property.location)}` : "",
    property.bedrooms ? `🛏️ ${withUnit(field(property.bedrooms, 60), "quartos")}` : "",
    roomsLine(rooms),
    rooms.lavabo ? "🚻 Lavabo" : "",
    rooms.parkingSpaces ? `🚗 ${rooms.parkingSpaces} ${rooms.parkingSpaces === 1 ? "vaga" : "vagas"} de garagem` : "",
    property.area ? `📐 ${withUnit(field(property.area, 60), "m²")}` : "",
    !property.hidePrice && Number.isFinite(price) && price > 0 ? `💰 ${formatBrl(price)}` : "",
    property.installmentEntry ? `💳 Entrada: ${field(property.installmentEntry, 200)}` : "",
    property.delivery ? `🔑 Entrega: ${field(property.delivery, 120)}` : "",
    property.isDevelopment && property.builder ? `🏗️ ${field(property.builder, 120)}` : ""
  ].filter(Boolean);

  // Suítes, banheiros, lavabo e vagas já saem nos destaques acima: não repetem nos diferenciais.
  const features = (Array.isArray(property.features) ? property.features : []).map(featureText).map(stripHashtags).filter(Boolean)
    .filter((text) => !ROOM_ONLY_FEATURE.test(plain(text)))
    .slice(0, 12);
  const featureLines = features.map((text) => `${FEATURE_EMOJIS.find(([pattern]) => pattern.test(text))?.[1] || "✅"} ${text}`);

  const blocks = [
    hook,
    highlights.join("\n"),
    field(property.salesText, 2000),
    featureLines.length ? `✨ Diferenciais:\n${featureLines.join("\n")}` : "",
    property.terms ? `📝 Condições: ${field(property.terms, 500)}` : "",
    property.discounts ? `🏷️ ${field(property.discounts, 300)}` : "",
    simulationLink ? `👉 Faça sua simulação de financiamento grátis e veja como fica a sua parcela:\n${simulationLink}` : "",
    "Me chama aqui que eu te ajudo em todo o processo. 💬",
    "Matheus Machado Corretor de Imóveis · Marília/SP · CRECI 323106-F"
  ].filter(Boolean);
  return stripHashtags(blocks.join("\n\n")).slice(0, 5000);
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
export function planAdminAction(listing, action, options = {}) {
  const { userId, now = new Date() } = options;
  const iso = now.toISOString();
  if (action === "approve") {
    if (!["pending", "failed"].includes(listing?.status)) throw new MarketplaceInputError("Só dá para aprovar anúncio aguardando ou que falhou.");
    return { status: "pending", approved_by: userId || null, approved_at: iso, attempts: 0, error: null, claimed_at: null };
  }
  if (action === "unapprove") {
    if (listing?.status !== "pending") throw new MarketplaceInputError("Só dá para tirar a aprovação de anúncio aguardando.");
    return { approved_by: null, approved_at: null };
  }
  if (action === "mark_published") {
    if (!["pending", "claimed", "failed"].includes(listing?.status)) throw new MarketplaceInputError("Este anúncio já está publicado ou cancelado.");
    const url = String(options.url || "").trim();
    if (!isMarketplaceUrl(url)) throw new MarketplaceInputError("Cole o link do anúncio no Facebook (https://www.facebook.com/marketplace/item/...).");
    return { status: "published", published_at: iso, marketplace_url: url.slice(0, 500), error: null };
  }
  if (action === "cancel") {
    if (!["pending", "failed"].includes(listing?.status)) throw new MarketplaceInputError("Anúncio publicando ou publicado não pode ser cancelado aqui.");
    return { status: "cancelled", approved_by: null, approved_at: null };
  }
  throw new MarketplaceInputError("Ação inválida.");
}

// Limites do servidor. Decisão do dono (2026-10-20): SEM intervalo de tempo no servidor — só 1 anúncio por vez
// (claim ativo), 3 publicações bem-sucedidas por dia (São Paulo) e 2 tentativas por anúncio (isEligibleForClaim).
// `waitUntil` fica no contrato (sempre null hoje) para a extensão mostrar horário se um bloqueio por tempo voltar.
export function evaluateQueueGate({ publishedToday = 0, hasActiveClaim = false } = {}) {
  if (hasActiveClaim) return { allowed: false, reason: "publicacao_em_andamento", waitUntil: null };
  if (publishedToday >= MARKETPLACE_DAILY_LIMIT) return { allowed: false, reason: "limite_diario", waitUntil: null };
  return { allowed: true, reason: null, waitUntil: null };
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
