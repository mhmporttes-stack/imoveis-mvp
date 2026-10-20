import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MARKETPLACE_DAILY_LIMIT,
  MARKETPLACE_MAX_ATTEMPTS,
  MarketplaceInputError,
  buildDraftFromProperty,
  sanitizeNeighborhood,
  buildListingDescription,
  deriveRoomDetails,
  facebookSummary,
  classifyPhotoSource,
  marketplacePhotoPath,
  claimPatch,
  contentChanged,
  evaluateQueueGate,
  isEligibleForClaim,
  isMarketplaceUrl,
  isStaleClaim,
  normalizeListingInput,
  parsePrice,
  planAdminAction,
  planResult,
  readBearerToken,
  toExtensionPayload
} from "../lib/marketplace-core.mjs";

const HOSTS = ["abc.supabase.co", "www.matheusmachadoimoveis.com.br"];
const PHOTO = "https://abc.supabase.co/storage/v1/object/public/properties/1.jpg";
const valid = { title: "Casa 2 quartos no Jardim", price: "250.000,00", offerType: "sale", propertyType: "house", bathrooms: 1, photoUrls: [PHOTO] };
const now = new Date("2026-10-20T15:00:00Z");

test("preço brasileiro e numérico", () => {
  assert.equal(parsePrice("R$ 250.000,00"), 250000);
  assert.equal(parsePrice("250000"), 250000);
  assert.equal(parsePrice("1.250.000"), 1250000);
  assert.equal(parsePrice(199900.5), 199900.5);
});

test("normaliza o anúncio e exige foto do CRM", () => {
  const record = normalizeListingInput(valid, { allowedHosts: HOSTS });
  assert.equal(record.price, 250000);
  assert.equal(record.city, "Marília");
  assert.equal(record.state, "SP");
  assert.deepEqual(record.photo_urls, [PHOTO]);
  assert.equal(record.iptu, null);
  const details = normalizeListingInput({ ...valid, iptu: "1.200,50", condoFee: "350", parkingSpaces: "2" }, { allowedHosts: HOSTS });
  assert.equal(details.iptu, 1200.5);
  assert.equal(details.condo_fee, 350);
  assert.equal(details.parking_spaces, 2);
  assert.throws(() => normalizeListingInput({ ...valid, parkingSpaces: "-1" }, { allowedHosts: HOSTS }), /Vagas/);
  assert.throws(() => normalizeListingInput({ ...valid, iptu: "abc" }, { allowedHosts: HOSTS }), /IPTU/);
  assert.throws(() => normalizeListingInput({ ...valid, photoUrls: [] }, { allowedHosts: HOSTS }), MarketplaceInputError);
  assert.throws(() => normalizeListingInput({ ...valid, photoUrls: ["https://evil.com/x.jpg"] }, { allowedHosts: HOSTS }), /fora do armazenamento/);
  assert.throws(() => normalizeListingInput({ ...valid, photoUrls: ["http://abc.supabase.co/x.jpg"] }, { allowedHosts: HOSTS }), /fora do armazenamento/);
  assert.throws(() => normalizeListingInput({ ...valid, price: "0" }, { allowedHosts: HOSTS }), /preço/);
  assert.throws(() => normalizeListingInput({ ...valid, offerType: "troca" }, { allowedHosts: HOSTS }), /venda ou aluguel/);
});

test("rascunho do imóvel: fotos públicas, link da simulação, tipo mapeado", () => {
  const draft = buildDraftFromProperty(
    { id: "p1", name: "Residencial Sol", price: "R$ 230.000", type: "apartamento", bedrooms: "2 quartos", area: "48,5 m²", region: "Centro", salesText: "Ótimo", features: ["Piscina"], photos: [PHOTO, { data: "data:image/png;base64,AAA" }, "https://outro.com/a.jpg"] },
    { simulationLink: "https://www.matheusmachadoimoveis.com.br/s/mhm", allowedHosts: HOSTS }
  );
  assert.equal(draft.propertyType, "apartment");
  assert.equal(draft.price, 230000);
  assert.equal(draft.bedrooms, 2);
  assert.equal(draft.areaM2, 48.5);
  assert.deepEqual(draft.photoUrls, [PHOTO]);
  assert.equal(draft.skippedPhotos, 2);
  assert.match(draft.description, /\/s\/mhm/);
  assert.match(draft.description, /Matheus Machado Corretor de Imóveis/);
  assert.doesNotMatch(draft.description, /Matheus Machado Imóveis/);
});

test("editar o conteúdo tira a aprovação; ações respeitam o estado", () => {
  const current = { ...normalizeListingInput(valid, { allowedHosts: HOSTS }) };
  assert.equal(contentChanged(current, { ...current }), false);
  assert.equal(contentChanged(current, { ...current, price: 1 }), true);
  assert.equal(contentChanged(current, { ...current, parking_spaces: 1 }), true);
  const approve = planAdminAction({ status: "failed" }, "approve", { userId: "u1", now });
  assert.equal(approve.status, "pending");
  assert.equal(approve.attempts, 0);
  assert.equal(approve.approved_by, "u1");
  assert.throws(() => planAdminAction({ status: "claimed" }, "cancel"), MarketplaceInputError);
  assert.throws(() => planAdminAction({ status: "published" }, "approve"), MarketplaceInputError);
  assert.equal(planAdminAction({ status: "pending" }, "cancel").status, "cancelled");
});

test("só anúncio aprovado e com tentativas sobrando entra na fila", () => {
  assert.equal(isEligibleForClaim({ status: "pending", approved_at: null, attempts: 0 }), false);
  assert.equal(isEligibleForClaim({ status: "pending", approved_at: now.toISOString(), attempts: 0 }), true);
  assert.equal(isEligibleForClaim({ status: "pending", approved_at: now.toISOString(), attempts: MARKETPLACE_MAX_ATTEMPTS }), false);
  assert.equal(isEligibleForClaim({ status: "cancelled", approved_at: now.toISOString(), attempts: 0 }), false);
  assert.equal(claimPatch({ attempts: 1 }, now).attempts, 2);
});

test("limites do servidor (dono, 2026-10-20): sem intervalo de tempo; 1 por vez e 3 por dia", () => {
  assert.deepEqual(evaluateQueueGate({ now }), { allowed: true, reason: null, waitUntil: null });
  // Publicação ou falha há 1 minuto não segura mais a fila.
  assert.equal(evaluateQueueGate({ now, lastPublishedAt: now.toISOString(), lastClaimAt: now.toISOString(), publishedToday: 1 }).allowed, true);
  assert.equal(evaluateQueueGate({ now, publishedToday: MARKETPLACE_DAILY_LIMIT }).reason, "limite_diario");
  assert.equal(evaluateQueueGate({ now, hasActiveClaim: true }).reason, "publicacao_em_andamento");
});

test("claim sem retorno há mais de 2 h é considerado vencido", () => {
  assert.equal(isStaleClaim({ status: "claimed", claimed_at: new Date(now.getTime() - 3 * 3600000).toISOString() }, now), true);
  assert.equal(isStaleClaim({ status: "claimed", claimed_at: new Date(now.getTime() - 30 * 60000).toISOString() }, now), false);
});

test("resultado: publicado com link, falha com ou sem nova tentativa", () => {
  const claimed = { status: "claimed", attempts: 1 };
  const ok = planResult(claimed, { status: "published", url: "https://www.facebook.com/marketplace/item/123/" }, now);
  assert.equal(ok.status, "published");
  assert.equal(ok.marketplace_url, "https://www.facebook.com/marketplace/item/123/");
  const noUrl = planResult(claimed, { status: "published", url: "https://evil.com/marketplace/x" }, now);
  assert.equal(noUrl.marketplace_url, null);
  assert.match(noUrl.error, /não conseguiu capturar/);
  assert.equal(planResult(claimed, { status: "failed", error: "botão sumiu", retry: true }, now).status, "pending");
  assert.equal(planResult({ status: "claimed", attempts: 2 }, { status: "failed", retry: true }, now).status, "failed");
  assert.equal(planResult(claimed, { status: "failed", error: "x" }, now).status, "failed");
  assert.throws(() => planResult({ status: "pending" }, { status: "published" }, now), MarketplaceInputError);
  assert.throws(() => planResult(claimed, { status: "outro" }, now), MarketplaceInputError);
});

test("link do Marketplace só do facebook.com", () => {
  assert.equal(isMarketplaceUrl("https://www.facebook.com/marketplace/item/1"), true);
  assert.equal(isMarketplaceUrl("https://facebook.com.evil.com/marketplace/item/1"), false);
  assert.equal(isMarketplaceUrl("http://www.facebook.com/marketplace/item/1"), false);
});

test("chave: só Bearer mkp_", () => {
  assert.equal(readBearerToken("Bearer mkp_abc"), "mkp_abc");
  assert.equal(readBearerToken("Bearer alx_abc"), "");
  assert.equal(readBearerToken("mkp_abc"), "");
  assert.equal(readBearerToken(undefined), "");
});

test("a extensão recebe só os campos do anúncio", () => {
  const payload = toExtensionPayload({ id: "1", title: "T", price: "1000.00", offer_type: "sale", property_type: "house", city: "Marília", state: "SP", photo_urls: [PHOTO], attempts: 1, approved_by: "u1", created_by: "u1", error: "x" });
  assert.deepEqual(Object.keys(payload).sort(), ["areaM2", "attempt", "bathrooms", "bedrooms", "city", "condoFee", "description", "id", "iptu", "neighborhood", "offerType", "parkingSpaces", "photoUrls", "price", "propertyType", "state", "title"]);
  assert.equal(payload.iptu, null);
  assert.equal(payload.price, 1000);
});

test("rotas: admin só com requireGeneralAdmin; fila só com a chave e limite", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  for (const path of ["app/api/admin/marketplace/route.js", "app/api/admin/marketplace/[id]/route.js", "app/api/admin/marketplace/token/route.js", "app/api/admin/marketplace/draft/route.js"]) {
    const source = read(path);
    const handlers = source.match(/export async function (GET|POST|PATCH|DELETE)/g) || [];
    assert.ok(handlers.length > 0, path);
    assert.equal((source.match(/await requireGeneralAdminApi\(request\)/g) || []).length, handlers.length, path);
  }
  assert.match(read("app/admin/marketplace/page.jsx"), /await requireGeneralAdminPage\(\)/);
  for (const path of ["app/api/marketplace/queue/next/route.js", "app/api/marketplace/queue/[id]/result/route.js"]) {
    const source = read(path);
    assert.match(source, /checkPublicRateLimit/);
    assert.match(source, /verifyPublisherToken/);
    assert.ok(source.indexOf("verifyPublisherToken(token)") < source.indexOf("try {"), `${path}: chave antes de tocar na fila`);
  }
});

test("fotos do cadastro: do CRM ficam, base64 e links de fora são copiados, resto é inválido", () => {
  const opts = { allowedHosts: HOSTS, siteBaseUrl: "https://www.matheusmachadoimoveis.com.br" };
  assert.deepEqual(classifyPhotoSource(PHOTO, opts), { kind: "keep", url: PHOTO });
  const data = classifyPhotoSource("data:image/jpg;base64,AAEC\nAw==", opts);
  assert.equal(data.kind, "data");
  assert.equal(data.contentType, "image/jpeg");
  assert.equal(data.base64, "AAECAw==");
  assert.deepEqual(classifyPhotoSource("https://cdn.exemplo.com/a.jpg", opts), { kind: "fetch", url: "https://cdn.exemplo.com/a.jpg" });
  assert.deepEqual(classifyPhotoSource("/uploads/casa.jpg", opts), { kind: "fetch", url: "https://www.matheusmachadoimoveis.com.br/uploads/casa.jpg" });
  assert.equal(classifyPhotoSource("http://inseguro.com/a.jpg", opts).kind, "invalid");
  assert.equal(classifyPhotoSource("data:image/gif;base64,AAA", opts).kind, "invalid");
  assert.equal(classifyPhotoSource("", opts).kind, "invalid");
});

test("cópia no armazenamento tem nome estável pelo conteúdo (não duplica)", () => {
  assert.equal(marketplacePhotoPath("abc", "image/jpeg"), "marketplace/abc.jpg");
  assert.equal(marketplacePhotoPath("abc", "image/png"), "marketplace/abc.png");
  assert.equal(marketplacePhotoPath("abc", "image/webp"), "marketplace/abc.webp");
});

test("rascunho usa as fotos importadas pelo servidor; imóvel sem foto é sinalizado", () => {
  const property = { id: "p", name: "Casa", photos: [{ data: "data:image/png;base64,AAA" }, PHOTO] };
  const draft = buildDraftFromProperty(property, { allowedHosts: HOSTS, importedPhotoUrls: ["https://abc.supabase.co/x/marketplace/1.png", PHOTO] });
  assert.equal(draft.photoUrls.length, 2);
  assert.equal(draft.totalPhotos, 2);
  assert.equal(draft.skippedPhotos, 0);
  const empty = buildDraftFromProperty({ id: "q", name: "Sem foto", photos: [] }, { importedPhotoUrls: [] });
  assert.equal(empty.totalPhotos, 0);
  assert.deepEqual(empty.photoUrls, []);
});

test("bairro sem cidade/UF/separadores (caso real 'Terra Verde · Marília/SP')", () => {
  assert.equal(sanitizeNeighborhood("Terra Verde · Marília/SP"), "Terra Verde");
  assert.equal(sanitizeNeighborhood("Jardim Cavallari, Marília - SP"), "Jardim Cavallari");
  assert.equal(sanitizeNeighborhood("Marília/SP"), "");
  assert.equal(sanitizeNeighborhood("Parque São Jorge"), "Parque São Jorge");
  assert.equal(normalizeListingInput({ ...valid, neighborhood: "Terra Verde · Marília/SP" }, { allowedHosts: HOSTS }).neighborhood, "Terra Verde");
  assert.equal(buildDraftFromProperty({ name: "Casa", region: "Terra Verde · Marília/SP", photos: [] }, { importedPhotoUrls: [] }).neighborhood, "Terra Verde");
});

test("banheiros obrigatório (mínimo 1) e SEM padrão: sem dado seguro o rascunho vem vazio (dono, 2026-10-20)", () => {
  assert.throws(() => normalizeListingInput({ ...valid, bathrooms: "" }, { allowedHosts: HOSTS }), /banheiros/);
  assert.throws(() => normalizeListingInput({ ...valid, bathrooms: 0 }, { allowedHosts: HOSTS }), /banheiros/);
  assert.equal(buildDraftFromProperty({ name: "Casa", photos: [] }, { importedPhotoUrls: [] }).bathrooms, "");
  // Só suítes, sem saber dos banheiros sociais: não chuta.
  assert.equal(buildDraftFromProperty({ name: "Casa", features: ["3 suítes"], photos: [] }, { importedPhotoUrls: [] }).bathrooms, "");
});

test("marcar como publicado manualmente: exige link do Marketplace e tira da fila", () => {
  const url = "https://www.facebook.com/marketplace/item/123456/";
  for (const status of ["pending", "claimed", "failed"]) {
    const patch = planAdminAction({ status }, "mark_published", { url, now });
    assert.equal(patch.status, "published");
    assert.equal(patch.marketplace_url, url);
    assert.equal(isEligibleForClaim({ ...patch, approved_at: now.toISOString(), attempts: 0 }), false);
  }
  assert.throws(() => planAdminAction({ status: "pending" }, "mark_published", { url: "" }), /link/);
  assert.throws(() => planAdminAction({ status: "pending" }, "mark_published", { url: "https://evil.com/marketplace/item/1" }), /link/);
  assert.throws(() => planAdminAction({ status: "published" }, "mark_published", { url }), MarketplaceInputError);
  assert.throws(() => planAdminAction({ status: "cancelled" }, "mark_published", { url }), MarketplaceInputError);
});

// Caso real do 1º anúncio (2026-10-20): saiu "1 banheiro" e "Diferenciais: [object Object]".
const REAL_HOUSE = {
  id: "p1",
  name: "Casa com piscina e 3 suítes",
  type: "casa",
  region: "Terra Verde · Marília/SP",
  bedrooms: "3",
  area: "250",
  price: "870000",
  salesText: "Casa pronta para morar #luxo #marilia",
  features: [{ text: "3 suítes", icon: "bed" }, { text: "Banheiro de apoio", icon: "bath" }, { text: "Lavabo", icon: "bath" }, { text: "Piscina aquecida", icon: "pool" }, { text: "Suíte master com closet", icon: "bed" }, { text: "2 vagas de garagem", icon: "car" }],
  photos: []
};
const LINK = "https://www.matheusmachadoimoveis.com.br/s/mhm";

test("caso real: 3 suítes + apoio + lavabo → 4 banheiros no campo; lavabo só na descrição", () => {
  assert.deepEqual(deriveRoomDetails(REAL_HOUSE), { suites: 3, social: 1, lavabo: true, bathrooms: 4, parkingSpaces: 2 });
  const draft = buildDraftFromProperty(REAL_HOUSE, { simulationLink: LINK, importedPhotoUrls: [] });
  assert.equal(draft.bathrooms, 4);
  assert.equal(draft.bedrooms, 3);
  assert.equal(draft.parkingSpaces, 2);
  assert.match(draft.description, /3 suítes \+ 1 banheiro de apoio \(4 banheiros\)/);
  assert.match(draft.description, /Lavabo/);
  assert.match(draft.description, /2 vagas de garagem/);
  assert.match(draft.description, /Suíte master com closet/);
  assert.match(draft.description, /Piscina aquecida/);
  assert.equal(facebookSummary({ ...draft, offerType: "sale", propertyType: draft.propertyType }), "À venda · Casa · 3 quartos · 4 banheiros · R$ 870.000 · Marília");
});

test("total explícito de banheiros vale; quartos pega o 1º número", () => {
  assert.equal(deriveRoomDetails({ features: ["4 banheiros", "1 suíte"] }).bathrooms, 4);
  assert.equal(deriveRoomDetails({ bedrooms: "2 quartos sendo 1 suíte", features: ["1 banheiro social"] }).bathrooms, 2);
  assert.equal(buildDraftFromProperty({ name: "Casa", bedrooms: "3 quartos, 1 suíte", photos: [] }, { importedPhotoUrls: [] }).bedrooms, 3);
  assert.match(facebookSummary({ offer_type: "sale", property_type: "house", bedrooms: 2, price: 1 }), /banheiros: FALTA/);
});

test("descrição no estilo da legenda: nunca '[object Object]' nem '#', com CTA e assinatura", () => {
  const text = buildListingDescription(REAL_HOUSE, { simulationLink: LINK });
  assert.doesNotMatch(text, /\[object Object\]/);
  assert.doesNotMatch(text, /#/);
  assert.match(text, /^🏡 Casa com piscina e 3 suítes à venda em Marília\/SP/);
  assert.match(text, /📍 Terra Verde\n/);
  assert.match(text, /💰 R\$ 870\.000/);
  assert.ok(text.includes(LINK));
  assert.match(text, /Matheus Machado Corretor de Imóveis/);
  assert.doesNotMatch(text, /Matheus Machado Imóveis/);
  // Diferenciais como texto, objeto { label } ou string.
  const mixed = buildListingDescription({ name: "Casa", features: ["Quintal", { label: "Churrasqueira" }, { name: "Portão eletrônico" }, { icon: "x" }] });
  assert.match(mixed, /🌳 Quintal\n🍖 Churrasqueira\n✅ Portão eletrônico/);
  assert.doesNotMatch(mixed, /object|#/);
});
