// Ciclo de vida da instância e onboarding do perfil (Postgres real; provedor = MOCK da Graph API).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { resetInfra, testContext, ALWAYS_OPEN } from "./helpers/setup.js";
import { createMockGraphFetch } from "./helpers/mock-graph.js";
import { createInstance, verifyConnection, changeOperational, healthCheckAll } from "../src/services/instances.js";
import { processOnboardings, startOnboardingIfNeeded, runOnboarding } from "../src/services/onboarding.js";
import { createCrmIndividualAdapter } from "../src/whatsapp/crm-individual.js";
import { loadConfig } from "../src/config/index.js";

let ctx, mock;
const phones = { "333333": { display: "+55 11 99000-0003", verifiedName: "Matheus Machado Corretor de Imóveis" }, "444444": { display: "5511990000004", status: "PENDING" }, "555555": { display: "5511990000099" } };

before(async () => {
  await resetInfra();
  mock = createMockGraphFetch({ phones });
  ctx = testContext({ fetchImpl: mock.fetchImpl });
});
after(async () => { await ctx?.close(); });

const base = (over) => ({
  provider: "meta_cloud_api", credential_ref: "WA_TOKEN_TESTE", daily_limit: 30, min_interval_seconds: 60,
  send_window: ALWAYS_OPEN, timezone: "America/Sao_Paulo", rotation_order: 0, profile_config: {}, ...over
});

test("conectado só depois da resposta real; número diferente ou status não CONNECTED não conecta", async () => {
  const ok = await createInstance(ctx, base({ name: "Inst 3", phone: "11990000003", provider_config: { phone_number_id: "333333" } }), "t");
  assert.equal(ok.connection_state, "registered");
  assert.equal(ok.enabled, false);
  await assert.rejects(changeOperational(ctx, ok.id, "enable", {}, "t").then(() => changeOperational(ctx, ok.id, "activate", {}, "t")), /conexão confirmada/);
  const v = await verifyConnection(ctx, ok.id, "t");
  assert.equal(v.connected, true);

  const pending = await createInstance(ctx, base({ name: "Inst 4", phone: "11990000004", provider_config: { phone_number_id: "444444" } }), "t");
  const v4 = await verifyConnection(ctx, pending.id, "t");
  assert.equal(v4.connected, false);
  assert.equal(v4.reason, "provider_status_PENDING");

  const mismatch = await createInstance(ctx, base({ name: "Inst 5", phone: "11990000005", provider_config: { phone_number_id: "555555" } }), "t");
  const v5 = await verifyConnection(ctx, mismatch.id, "t");
  assert.equal(v5.state, "error");
  assert.equal(v5.reason, "phone_mismatch");

  await assert.rejects(createInstance(ctx, base({ name: "Inst 3", phone: "11990000006", provider_config: { phone_number_id: "333333" } }), "t"), /Já existe/);
  await assert.rejects(createInstance(ctx, base({ name: "Sem id", phone: "11990000007", provider_config: {} }), "t"), /incompleto/);
});

test("onboarding: aplica cada campo, confirma lendo de volta, foto por upload resumível; nome comercial = limitação registrada", async () => {
  // Usa a instância já conectada ("Inst 3") e define o perfil desejado.
  const { rows } = await ctx.db.query("select id from wa_dispatch.whatsapp_instances where name = 'Inst 3'");
  const id = rows[0].id;
  await ctx.db.query("update wa_dispatch.whatsapp_instances set profile_config = $2, profile_state = 'not_started' where id = $1", [id, JSON.stringify({
    display_name: "Nome Novo Que A API Nao Muda", about: "Financiamento Minha Casa Minha Vida", description: "Atendimento de imóveis",
    address: "Marília - SP", email: "contato@example.com", instagram_url: "https://instagram.com/exemplo", vertical: "PROF_SERVICES",
    photo_url: "https://images.mock.invalid/foto.jpg"
  })]);
  await ctx.db.query("update wa_dispatch.onboarding_runs set status = 'failed' where instance_id = $1 and status = 'running'", [id]);
  const run = await startOnboardingIfNeeded(ctx, id, { force: true });
  const done = await runOnboarding(ctx, run.id);
  assert.equal(done.status, "completed_with_limitations");
  const byKey = Object.fromEntries(done.steps.map((s) => [s.key, s]));
  for (const k of ["about", "description", "address", "email", "vertical", "websites", "photo_url"]) assert.equal(byKey[k].state, "confirmed", k);
  assert.equal(byKey.display_name.state, "unsupported");
  assert.match(byKey.display_name.limitation, /WhatsApp Manager/);
  assert.deepEqual(mock.state.profile.websites, ["https://instagram.com/exemplo"]);
  const uploads = mock.calls.filter((c) => c.path.endsWith("/uploads"));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].query.file_type, "image/jpeg");
  const inst3 = (await ctx.db.query("select profile_state from wa_dispatch.whatsapp_instances where id = $1", [id])).rows[0];
  assert.equal(inst3.profile_state, "completed_with_limitations");

  // Nome comercial igual ao verified_name → etapa confirmada → onboarding completo.
  await ctx.db.query("update wa_dispatch.whatsapp_instances set profile_config = jsonb_set(profile_config, '{display_name}', '\"Matheus Machado Corretor de Imóveis\"') where id = $1", [id]);
  const posts = () => mock.calls.filter((c) => c.method === "POST" && c.path.endsWith("whatsapp_business_profile")).length;
  const run2 = await startOnboardingIfNeeded(ctx, id, { force: true });
  const done2 = await runOnboarding(ctx, run2.id);
  assert.equal(done2.status, "completed");
  assert.ok(posts() > 0);
});

test("retentativa segura: etapa confirmada não é refeita", async () => {
  const { rows } = await ctx.db.query("select id from wa_dispatch.whatsapp_instances where name = 'Inst 3'");
  const id = rows[0].id;
  const run = await startOnboardingIfNeeded(ctx, id, { force: true });
  const steps = run.steps.map((s) => (s.key === "about" ? s : { ...s, state: "confirmed" }));
  await ctx.db.query("update wa_dispatch.onboarding_runs set steps = $2 where id = $1", [run.id, JSON.stringify(steps)]);
  const before = mock.calls.filter((c) => c.method === "POST" && c.path.endsWith("whatsapp_business_profile")).length;
  const done = await runOnboarding(ctx, run.id);
  const after = mock.calls.filter((c) => c.method === "POST" && c.path.endsWith("whatsapp_business_profile")).length;
  assert.equal(after - before, 1, "só a etapa pendente foi enviada");
  assert.equal(done.status, "completed");
});

test("ativar exige perfil concluído; pausa/suspensão exigem regras; health check marca desconexão e reconecta", async () => {
  const { rows } = await ctx.db.query("select id from wa_dispatch.whatsapp_instances where name = 'Inst 3'");
  const id = rows[0].id;
  await changeOperational(ctx, id, "enable", {}, "t");
  const active = await changeOperational(ctx, id, "activate", {}, "t");
  assert.equal(active.operational_state, "active");
  await assert.rejects(changeOperational(ctx, id, "suspend", {}, "t"), /exige motivo/);
  const s = await changeOperational(ctx, id, "suspend", { reason: "teste de suspensão" }, "t");
  assert.equal(s.operational_state, "suspended");
  await assert.rejects(changeOperational(ctx, id, "resume", {}, "t"), /exige motivo/);
  assert.equal((await changeOperational(ctx, id, "resume", { reason: "verificado pelo dono" }, "t")).operational_state, "active");

  phones["333333"].status = "DISCONNECTED";
  await healthCheckAll(ctx);
  assert.equal((await ctx.db.query("select connection_state from wa_dispatch.whatsapp_instances where id = $1", [id])).rows[0].connection_state, "disconnected");
  phones["333333"].status = "CONNECTED";
  await healthCheckAll(ctx);
  const back = (await ctx.db.query("select connection_state, last_connected_at from wa_dispatch.whatsapp_instances where id = $1", [id])).rows[0];
  assert.equal(back.connection_state, "connected");
  assert.ok(back.last_connected_at);
  await processOnboardings(ctx);
});

test("adaptador crm-individual usa só as rotas existentes do whatsapp-individual-service (MOCK HTTP)", async () => {
  const seen = [];
  const fakeService = async (url, init) => {
    seen.push({ url: String(url), method: init.method, secret: init.headers["X-Service-Secret"], body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith("/status")) return new Response(JSON.stringify({ status: "connected", phoneNumber: "5511990000008" }), { status: 200 });
    if (String(url).endsWith("/send")) return new Response(JSON.stringify({ waMessageId: "ABC", remoteJid: "x" }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const config = loadConfig({ WHATSAPP_INDIVIDUAL_SERVICE_URL: "https://individual.mock.invalid", WHATSAPP_INDIVIDUAL_SERVICE_SECRET: "s" });
  const adapter = createCrmIndividualAdapter({ config, fetchImpl: fakeService });
  const instance = { phone_e164: "+5511990000008", provider_config: { crm_user_id: "11111111-1111-4111-8111-111111111111" } };
  assert.equal((await adapter.checkConnection(instance)).connected, true);
  const sent = await adapter.sendMessage(instance, { to: "+5511987654321", campaign: { message_type: "text", text_body: "Olá" } });
  assert.equal(sent.providerMessageId, "crm_individual:ABC");
  assert.deepEqual(seen.map((s) => `${s.method} ${new URL(s.url).pathname}`), [
    "GET /sessions/11111111-1111-4111-8111-111111111111/status", "POST /sessions/11111111-1111-4111-8111-111111111111/send"
  ]);
  assert.equal(seen[1].body.to, "5511987654321");
  assert.ok(seen.every((s) => s.secret === "s"));
  await assert.rejects(adapter.sendMessage(instance, { to: "+5511987654321", campaign: { message_type: "template" } }), /não envia templates/);
  await assert.rejects(adapter.getProfile(instance), /não é suportada/);
  assert.equal(adapter.supports("getMessageStatus"), false);
});
