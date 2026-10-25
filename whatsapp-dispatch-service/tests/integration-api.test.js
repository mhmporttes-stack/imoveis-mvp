// API HTTP real (Express) + Postgres real + Redis real. Provedor: MOCK da Graph API (tests/helpers/mock-graph.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { resetInfra, testContext, testConfig, TOKENS, addCrmRegistration } from "./helpers/setup.js";
import { createCampaign } from "./helpers/fixtures.js";
import { createMockGraphFetch } from "./helpers/mock-graph.js";

let ctx, server, base;
const mock = createMockGraphFetch({ phones: { "111111": { display: "+55 11 99000-0001" } } });

before(async () => {
  await resetInfra();
  ctx = testContext({ fetchImpl: mock.fetchImpl });
  await createCampaign(ctx);
  server = createApp(ctx).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.close();
  await ctx?.close();
});

const call = (method, path, { token = TOKENS.crm, body, headers = {} } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

test("/health sempre 200; /ready 200 com banco+migrações+Redis", async () => {
  assert.equal((await call("GET", "/health", { token: null })).status, 200);
  const ready = await call("GET", "/ready", { token: null });
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.body.checks, { database: true, migrations: true, redis: true });
});

test("autenticação e papéis", async () => {
  assert.equal((await call("GET", "/v1/stats", { token: null })).status, 401);
  assert.equal((await call("GET", "/v1/stats", { token: "x".repeat(40) })).status, 401);
  assert.equal((await call("GET", "/v1/stats", { token: TOKENS.viewer })).status, 200);
  assert.equal((await call("POST", "/v1/leads", { token: TOKENS.viewer, body: {} })).status, 403);
  const inst = await call("POST", "/v1/instances", { token: TOKENS.crm, body: { name: "x" } });
  assert.equal(inst.status, 403);
});

test("cadastro de lead: 202 persistido, idempotente e validado", async () => {
  const crmId = await addCrmRegistration(ctx, { national: "11990000101" });
  const payload = { crm_lead_id: crmId, phone: "(11) 99000-0101", campaign_code: "retorno-simulacao", consent_reference: `simulation_registrations:${crmId}` };
  const first = await call("POST", "/v1/leads", { body: payload });
  assert.equal(first.status, 202);
  assert.equal(first.body.created, true);
  assert.equal(first.body.job.status, "requested");
  const { rows } = await ctx.db.query("select status, phone_e164 from wa_dispatch.outbound_messages where id = $1", [first.body.job.id]);
  assert.equal(rows[0].phone_e164, "+5511990000101");

  const again = await call("POST", "/v1/leads", { body: payload });
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false);
  assert.equal(again.body.job.id, first.body.job.id);
  const count = await ctx.db.query("select count(*)::int as n from wa_dispatch.outbound_messages");
  assert.equal(count.rows[0].n, 1);

  const sameKeyOtherPhone = await call("POST", "/v1/leads", { body: { ...payload, phone: "11990000102", idempotency_key: `${crmId}:retorno-simulacao` } });
  assert.equal(sameKeyOtherPhone.status, 409);

  assert.equal((await call("POST", "/v1/leads", { body: { ...payload, phone: "1132654321" } })).status, 400);
  assert.equal((await call("POST", "/v1/leads", { body: { ...payload, campaign_code: "nao-existe" } })).status, 400);
  assert.equal((await call("POST", "/v1/leads", { body: { ...payload, renda: 5000 } })).status, 400);

  const job = await call("GET", `/v1/jobs/${first.body.job.id}`);
  assert.equal(job.status, 200);
  assert.equal(job.body.events[0].event_type, "requested");
});

test("instâncias: cadastro pela API, sem credencial fica 'not_configured' e não conecta", async () => {
  const created = await call("POST", "/v1/instances", { token: TOKENS.admin, body: {
    name: "Numero sem token", phone: "11990000001", provider: "meta_cloud_api",
    provider_config: { phone_number_id: "111111" }, credential_ref: "WA_TOKEN_INEXISTENTE"
  } });
  assert.equal(created.status, 201);
  assert.equal(created.body.instance.connection_state, "not_configured");
  const verify = await call("POST", `/v1/instances/${created.body.instance.id}/verify`, { token: TOKENS.admin });
  assert.equal(verify.body.connected, false);
  assert.equal(verify.body.state, "not_configured");
  assert.equal(mock.calls.length, 0, "sem credencial nenhuma chamada ao provedor");
  const activate = await call("POST", `/v1/instances/${created.body.instance.id}/activate`, { token: TOKENS.admin, body: {} });
  assert.equal(activate.status, 409);
});

test("webhook: verificação GET e assinatura obrigatória", async () => {
  const ok = await fetch(`${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token-de-teste&hub.challenge=4242`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "4242");
  const bad = await fetch(`${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=4242`);
  assert.equal(bad.status, 403);
  const unsigned = await fetch(`${base}/webhooks/meta`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(unsigned.status, 401);
});

test("CORS restritivo", async () => {
  const r = await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } });
  assert.equal(r.status, 403);
});

test("webhook falha fechado sem WA_APP_SECRET", async () => {
  const c2 = testContext({ config: testConfig({ WA_APP_SECRET: "" }), withQueue: false });
  const s2 = createApp(c2).listen(0);
  const r = await fetch(`http://127.0.0.1:${s2.address().port}/webhooks/meta`, { method: "POST", body: "{}" });
  assert.equal(r.status, 503);
  s2.close();
  await c2.close();
});

test("limite de requisições por token", async () => {
  const c3 = testContext({ config: testConfig({ RATE_LIMIT_PER_MINUTE: "2" }), withQueue: false });
  const s3 = createApp(c3).listen(0);
  const url = `http://127.0.0.1:${s3.address().port}/v1/campaigns`;
  const statuses = [];
  for (let i = 0; i < 3; i += 1) statuses.push((await fetch(url, { headers: { authorization: `Bearer ${TOKENS.viewer}` } })).status);
  s3.close();
  await c3.close();
  assert.deepEqual(statuses, [200, 200, 429]);
});
