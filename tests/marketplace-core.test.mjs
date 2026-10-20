import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MARKETPLACE_DAILY_LIMIT,
  MARKETPLACE_MAX_ATTEMPTS,
  MarketplaceInputError,
  buildDraftFromProperty,
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
const valid = { title: "Casa 2 quartos no Jardim", price: "250.000,00", offerType: "sale", propertyType: "house", photoUrls: [PHOTO] };
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

test("limites do servidor: diário, intervalo e publicação em andamento", () => {
  assert.equal(evaluateQueueGate({ now }).allowed, true);
  assert.equal(evaluateQueueGate({ now, publishedToday: MARKETPLACE_DAILY_LIMIT }).reason, "limite_diario");
  assert.equal(evaluateQueueGate({ now, lastClaimAt: new Date(now.getTime() - 10 * 60000).toISOString() }).reason, "intervalo_minimo");
  assert.equal(evaluateQueueGate({ now, lastClaimAt: new Date(now.getTime() - 60 * 60000).toISOString() }).allowed, true);
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
  assert.deepEqual(Object.keys(payload).sort(), ["areaM2", "attempt", "bathrooms", "bedrooms", "city", "description", "id", "neighborhood", "offerType", "photoUrls", "price", "propertyType", "state", "title"]);
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
