import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CRM_URL, downloadPhotos, fetchNextListing, normalizeBaseUrl, postResult } from "../lib/crm-api.js";

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  impl.calls = calls;
  return impl;
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("URL do CRM: padrão, https obrigatório", () => {
  assert.equal(normalizeBaseUrl(""), DEFAULT_CRM_URL);
  assert.equal(normalizeBaseUrl("www.matheusmachadoimoveis.com.br/admin"), DEFAULT_CRM_URL);
  assert.throws(() => normalizeBaseUrl("http://exemplo.com"), /https/);
});

test("fila: manda a chave no Bearer e devolve o anúncio", async () => {
  const fetchImpl = fakeFetch(() => json(200, { listing: { id: "1", title: "Casa" } }));
  const result = await fetchNextListing({ baseUrl: DEFAULT_CRM_URL, key: "mkp_x" }, fetchImpl);
  assert.equal(result.listing.id, "1");
  assert.equal(fetchImpl.calls[0].url, `${DEFAULT_CRM_URL}/api/marketplace/queue/next`);
  assert.equal(fetchImpl.calls[0].options.headers.Authorization, "Bearer mkp_x");
});

test("fila: sem chave, chave recusada, CRM fora, fila vazia", async () => {
  assert.equal((await fetchNextListing({ key: "" }, fakeFetch(() => json(200, {})))).reason, "sem_configuracao");
  assert.equal((await fetchNextListing({ key: "mkp_x" }, fakeFetch(() => json(401, {})))).reason, "chave_invalida");
  assert.equal((await fetchNextListing({ key: "mkp_x" }, fakeFetch(() => json(500, {})))).reason, "erro_crm");
  assert.equal((await fetchNextListing({ key: "mkp_x" }, fakeFetch(() => { throw new Error("offline"); }))).reason, "erro_crm");
  assert.equal((await fetchNextListing({ key: "mkp_x" }, fakeFetch(() => json(200, { listing: null, reason: "limite_diario" })))).reason, "limite_diario");
});

test("resultado: POST no id com o corpo; erro do CRM vira exceção", async () => {
  const ok = fakeFetch(() => json(200, { ok: true }));
  await postResult({ baseUrl: DEFAULT_CRM_URL, key: "mkp_x" }, "abc", { status: "published", url: "u" }, ok);
  assert.equal(ok.calls[0].url, `${DEFAULT_CRM_URL}/api/marketplace/queue/abc/result`);
  assert.deepEqual(JSON.parse(ok.calls[0].options.body), { status: "published", url: "u" });
  await assert.rejects(postResult({ key: "mkp_x" }, "abc", {}, fakeFetch(() => json(409, { error: "Este anúncio não está em publicação." }))), /não está em publicação/);
});

test("fotos: só https, converte para base64", async () => {
  const fetchImpl = fakeFetch(() => ({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) }));
  const files = await downloadPhotos(["https://abc.supabase.co/a.png"], fetchImpl);
  assert.deepEqual(files, [{ name: "foto-1.png", type: "image/png", base64: "AQID" }]);
  await assert.rejects(downloadPhotos(["http://x/a.png"], fetchImpl), /https/);
  await assert.rejects(downloadPhotos(["https://x/a.png"], fakeFetch(() => ({ ok: false, status: 404 }))), /404/);
});

test("fila bloqueada pelo CRM devolve motivo e até quando", async () => {
  const result = await fetchNextListing({ key: "mkp_x" }, fakeFetch(() => json(200, { listing: null, reason: "intervalo_seguranca", wait_until: "2026-10-20T13:02:00.000Z" })));
  assert.equal(result.reason, "intervalo_seguranca");
  assert.equal(result.waitUntil, "2026-10-20T13:02:00.000Z");
});
