// Fluxo completo com Postgres + Redis + BullMQ reais. Provedor = MOCK da Graph API (nenhuma mensagem real).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { resetInfra, testContext, testConfig, addCrmRegistration } from "./helpers/setup.js";
import { createCampaign, createReadyInstance, phoneN } from "./helpers/fixtures.js";
import { createMockGraphFetch } from "./helpers/mock-graph.js";
import * as dispatch from "../src/services/dispatch.js";
import * as suppression from "../src/services/suppression.js";
import { startSendWorker } from "../src/workers/send-worker.js";
import { handleMetaWebhook } from "../src/services/webhook-processing.js";
import { reserveDailySlot } from "../src/repositories/instances.js";
import { hubSignature } from "../src/utils/crypto.js";
import { SEND_QUEUE } from "../src/queue/index.js";

let mock, ctx, instA, instB;

async function waitFor(fn, { timeout = 8000, step = 50 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("tempo esgotado esperando condição");
    await new Promise((r) => setTimeout(r, step));
  }
}
const statusOf = async (id) => (await ctx.db.query("select * from wa_dispatch.outbound_messages where id = $1", [id])).rows[0];

async function newLead(i, { status = "pending", campaign = "retorno-simulacao" } = {}) {
  const crmId = await addCrmRegistration(ctx, { national: phoneN(i), status });
  const r = await dispatch.createLead(ctx, { crm_lead_id: crmId, phone: phoneN(i), campaign_code: campaign, consent_reference: `simulation_registrations:${crmId}` }, "teste");
  return r.message.id;
}

before(async () => {
  await resetInfra();
  mock = createMockGraphFetch({ phones: { "111111": { display: "5511990000001" }, "222222": { display: "5511990000002" } } });
  ctx = testContext({ fetchImpl: mock.fetchImpl });
  await createCampaign(ctx);
  instA = await createReadyInstance(ctx, { name: "Numero A", phone: "11990000001", pnid: "111111", rotation: 0 });
  instB = await createReadyInstance(ctx, { name: "Numero B", phone: "11990000002", pnid: "222222", rotation: 1 });
});
after(async () => { await ctx?.close(); });
beforeEach(async () => {
  // Cada teste começa sem trabalhos pendentes de outro teste.
  await ctx.db.query("update wa_dispatch.outbound_messages set status = 'cancelled', instance_id = null where status in ('requested','scheduled','queued')");
  await ctx.db.query("delete from wa_dispatch.instance_daily_usage");
  await ctx.db.query("update wa_dispatch.whatsapp_instances set last_assigned_at = null, daily_limit = 100, min_interval_seconds = 0, operational_state = 'active', suspension_reason = null");
  await ctx.queue.queue.obliterate({ force: true });
});

test("fluxo: autoriza pela fonte do CRM, reserva instância, worker envia, webhook confirma entrega/leitura", async () => {
  const id = await newLead(10);
  assert.equal(await dispatch.authorizeRequested(ctx), 1);
  assert.equal((await statusOf(id)).status, "scheduled");
  const consent = await ctx.db.query("select state, origin, verifier, evidence_ref from wa_dispatch.consent_records order by created_at desc limit 1");
  assert.deepEqual({ ...consent.rows[0] }, { state: "granted", origin: "formulario_simulacao", verifier: "crm-db", evidence_ref: consent.rows[0].evidence_ref });
  assert.match(consent.rows[0].evidence_ref, /^simulation_registrations:/);
  assert.equal(await dispatch.assignInstances(ctx), 1);
  const worker = startSendWorker(ctx, { redisUrl: ctx.config.REDIS_URL, prefix: ctx.config.QUEUE_PREFIX, concurrency: 2 });
  const accepted = await waitFor(async () => { const m = await statusOf(id); return m.status === "accepted" ? m : null; });
  await worker.close();
  assert.match(accepted.provider_message_id, /^wamid\.MOCK/);
  const sent = mock.sendCalls().at(-1);
  assert.equal(sent.body.biz_opaque_callback_data, id);
  assert.equal(sent.body.type, "template");

  const delivered = webhookBody([{ id: accepted.provider_message_id, status: "delivered", timestamp: "1761400000", recipient_id: "55" + phoneN(10) }]);
  assert.equal((await postWebhook(delivered)).status, 200);
  assert.equal((await statusOf(id)).status, "delivered");
  const read = webhookBody([{ id: accepted.provider_message_id, status: "read", timestamp: "1761400100", recipient_id: "55" + phoneN(10) }]);
  await postWebhook(read);
  assert.equal((await statusOf(id)).status, "read");
  // Replay do mesmo corpo: ignorado, contadores não dobram.
  const replay = await postWebhook(delivered);
  assert.equal(replay.body.duplicate, true);
  assert.equal((await statusOf(id)).status, "read", "evento antigo não rebaixa o estado");
  const inst = (await ctx.db.query("select total_delivered, total_read, total_accepted from wa_dispatch.whatsapp_instances where id = $1", [accepted.instance_id])).rows[0];
  assert.deepEqual([Number(inst.total_delivered), Number(inst.total_read)], [1, 1]);
  // Assinatura inválida: 401 e nada muda.
  const forged = await handleMetaWebhook(ctx, Buffer.from(JSON.stringify(webhookBody([{ id: accepted.provider_message_id, status: "failed", timestamp: "1761400200" }]))), "sha256=" + "0".repeat(64));
  assert.equal(forged.status, 401);
  assert.equal((await statusOf(id)).status, "read");
  // Resposta do cliente marca 'replied'.
  await postWebhook(incomingBody("55" + phoneN(10), "Oi, tenho interesse"));
  assert.equal((await statusOf(id)).status, "replied");
});

test("idempotência na fila: o mesmo trabalho entregue duas vezes envia uma vez só", async () => {
  const id = await newLead(11);
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  const before = mock.sendCalls().length;
  const [a, b] = await Promise.all([dispatch.processMessage(ctx, id, "w1"), dispatch.processMessage(ctx, id, "w2")]);
  assert.deepEqual([a.status, b.status].sort(), ["accepted", "skipped"]);
  assert.equal(mock.sendCalls().length - before, 1);
  // Reenfileirar (recuperação) não reenvia o que já saiu.
  await dispatch.requeueQueued(ctx);
  assert.equal(await dispatch.processMessage(ctx, id, "w3").then((r) => r.status), "skipped");
});

test("persistência: trabalho enfileirado sobrevive ao reinício do worker e do processo", async () => {
  const id = await newLead(12);
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  assert.equal((await statusOf(id)).status, "queued");
  // "Reinício": fecha o contexto inteiro (sem worker rodando) e sobe um novo.
  const sendsBefore = mock.sendCalls().length;
  const ctx2 = testContext({ fetchImpl: mock.fetchImpl });
  const jobs = await ctx2.queue.queue.getJobCounts("waiting");
  assert.ok(jobs.waiting >= 1, "o trabalho continua no Redis");
  const worker = startSendWorker(ctx2, { redisUrl: ctx2.config.REDIS_URL, prefix: ctx2.config.QUEUE_PREFIX, concurrency: 1 });
  await waitFor(async () => (await statusOf(id)).status === "accepted");
  await worker.close();
  await ctx2.close();
  assert.equal(mock.sendCalls().length - sendsBefore, 1);
});

test("worker caiu no meio do envio: vira 'resultado desconhecido', nunca reenvio; webhook resolve pelo callback", async () => {
  const id = await newLead(13);
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  await ctx.db.query("update wa_dispatch.outbound_messages set status = 'sending', attempts = 1, sending_lock_expires_at = now() - interval '1 second' where id = $1", [id]);
  assert.equal(await dispatch.recoverStaleSending(ctx), 1);
  assert.equal((await statusOf(id)).status, "unknown_pending_verification");
  const sendsBefore = mock.sendCalls().length;
  await dispatch.requeueQueued(ctx);
  await dispatch.assignInstances(ctx);
  assert.equal(mock.sendCalls().length, sendsBefore, "nada é reenviado");
  await postWebhook(webhookBody([{ id: "wamid.REAL1", status: "sent", timestamp: "1761400300", recipient_id: "55" + phoneN(13), biz_opaque_callback_data: id }]));
  const m = await statusOf(id);
  assert.equal(m.status, "accepted");
  assert.equal(m.provider_message_id, "wamid.REAL1");
});

test("consentimento revogado e não contato do CRM bloqueiam e entram na lista de supressão", async () => {
  const dnc = await newLead(14, { status: "do_not_contact" });
  await dispatch.authorizeRequested(ctx);
  const m = await statusOf(dnc);
  assert.equal(m.status, "cancelled");
  const lead = (await ctx.db.query("select status, rejection_reason from wa_dispatch.leads where id = $1", [m.lead_id])).rows[0];
  assert.equal(lead.status, "rejected");
  assert.match(lead.rejection_reason, /consentimento_revoked:nao_contactar_no_crm/);
  assert.equal((await suppression.getSuppressionStatus(ctx, phoneN(14))).suppressed, true);

  // Revogação pela API depois de enfileirado: cancela e o worker não envia.
  const id = await newLead(15);
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  const r = await suppression.revokeConsent(ctx, { phone: phoneN(15), purpose: "retorno_simulacao", reason: "cliente pediu" }, "teste");
  assert.equal(r.cancelled, 1);
  const sendsBefore = mock.sendCalls().length;
  assert.equal((await dispatch.processMessage(ctx, id)).status, "skipped");
  assert.equal(mock.sendCalls().length, sendsBefore);
  // Novo lead do mesmo telefone/finalidade: recusado pela revogação local.
  const crm2 = await addCrmRegistration(ctx, { national: phoneN(15) });
  const again = await dispatch.createLead(ctx, { crm_lead_id: crm2, phone: phoneN(15), campaign_code: "retorno-simulacao", consent_reference: "x" }, "teste");
  await dispatch.authorizeRequested(ctx);
  assert.equal((await statusOf(again.message.id)).cancel_reason, "consentimento_revogado");
});

test("consentimento: fonte confiável recusa telefone diferente, equipe, finalidade sem base e CRM indisponível", async () => {
  const wrong = await addCrmRegistration(ctx, { national: phoneN(30) });
  assert.equal((await ctx.consent.verify({ crmLeadId: wrong, phoneE164: "+55" + phoneN(31), purpose: "retorno_simulacao" })).reason, "telefone_diferente_do_cadastro");
  await ctx.db.query("insert into crm_fixture.admin_users (phone, status) values ($1, 'active')", ["(11) 9" + phoneN(32).slice(3)]);
  const team = await addCrmRegistration(ctx, { national: phoneN(32) });
  assert.equal((await ctx.consent.verify({ crmLeadId: team, phoneE164: "+55" + phoneN(32), purpose: "retorno_simulacao" })).reason, "telefone_da_equipe");
  const ok = await addCrmRegistration(ctx, { national: phoneN(33) });
  const marketing = await ctx.consent.verify({ crmLeadId: ok, phoneE164: "+55" + phoneN(33), purpose: "marketing_lancamento" });
  assert.equal(marketing.state, "denied");
  assert.equal((await ctx.consent.verify({ crmLeadId: "nao-e-uuid", phoneE164: "+55" + phoneN(33), purpose: "retorno_simulacao" })).state, "unverifiable");
  const broken = testContext({ config: testConfig({ CRM_DB_SCHEMA: "schema_que_nao_existe" }), withQueue: false });
  const r = await broken.consent.verify({ crmLeadId: ok, phoneE164: "+55" + phoneN(33), purpose: "retorno_simulacao" });
  await broken.close();
  assert.equal(r.state, "unverifiable");
  const http = testContext({ config: testConfig({ CONSENT_VERIFIER: "crm-http" }), withQueue: false });
  const h = await http.consent.verify({ crmLeadId: ok, phoneE164: "+55" + phoneN(33), purpose: "retorno_simulacao" });
  await http.close();
  assert.equal(h.state, "unverifiable");
  assert.match(h.reason, /não configurados/);
});

test("lista de não contato: prioridade, cancela pendentes, protegida contra remoção", async () => {
  const id = await newLead(16);
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  assert.equal((await statusOf(id)).status, "queued");
  const added = await suppression.addSuppression(ctx, { phone: phoneN(16), reason: "pediu para sair", source: "crm" }, "teste");
  assert.equal(added.cancelled, 1);
  assert.equal((await statusOf(id)).status, "cancelled");
  const usage = (await ctx.db.query("select coalesce(sum(reserved),0)::int as r from wa_dispatch.instance_daily_usage")).rows[0].r;
  assert.equal(usage, 0, "reserva diária devolvida");
  await assert.rejects(ctx.db.query("delete from wa_dispatch.suppression_list"), /não pode ser apagada/);
  await assert.rejects(ctx.db.query("truncate wa_dispatch.suppression_list cascade"), /não pode ser apagada/);
  await assert.rejects(suppression.deactivateSuppression(ctx, { phone: phoneN(16), reason: "engano confirmado pelo dono", confirm: "sim" }, "teste"), /Confirmação ausente/);
  const off = await suppression.deactivateSuppression(ctx, { phone: phoneN(16), reason: "engano confirmado pelo dono", confirm: `REMOVER +55${phoneN(16)}` }, "admin");
  assert.equal(off.active, false);
  // Lead novo com telefone na lista é recusado já na entrada.
  await suppression.addSuppression(ctx, { phone: phoneN(17), reason: "x pedido", source: "crm" }, "teste");
  const crm = await addCrmRegistration(ctx, { national: phoneN(17) });
  const r = await dispatch.createLead(ctx, { crm_lead_id: crm, phone: phoneN(17), campaign_code: "retorno-simulacao", consent_reference: "x" }, "teste");
  assert.equal(r.lead.status, "rejected");
  // Cliente responde "SAIR" no WhatsApp: entra na lista.
  await postWebhook(incomingBody("55" + phoneN(18), "sair"));
  assert.equal((await suppression.getSuppressionStatus(ctx, phoneN(18))).suppressed, true);
});

test("limite diário: reserva atômica com 25 chamadas concorrentes em conexões distintas", async () => {
  const pools = Array.from({ length: 5 }, () => new pg.Pool({ connectionString: ctx.config.DATABASE_URL, max: 5 }));
  const date = "2026-10-26";
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => reserveDailySlot(pools[i % 5], instA.id, date, 7)));
  await Promise.all(pools.map((p) => p.end()));
  assert.equal(results.filter(Boolean).length, 7);
  const row = (await ctx.db.query("select reserved from wa_dispatch.instance_daily_usage where instance_id = $1 and usage_date = $2", [instA.id, date])).rows[0];
  assert.equal(row.reserved, 7);
});

test("limite diário com agendadores concorrentes: nunca passa da cota e não força envio", async () => {
  await ctx.db.query("update wa_dispatch.whatsapp_instances set daily_limit = 2");
  const ids = [];
  for (let i = 40; i < 50; i += 1) ids.push(await newLead(i));
  await dispatch.authorizeRequested(ctx);
  const ctxs = [ctx, testContext({ fetchImpl: mock.fetchImpl }), testContext({ fetchImpl: mock.fetchImpl })];
  await Promise.all(ctxs.map((c) => dispatch.assignInstances(c)));
  await Promise.all(ctxs.map((c) => dispatch.assignInstances(c)));
  await Promise.all(ctxs.slice(1).map((c) => c.close()));
  const rows = (await ctx.db.query("select status, instance_id from wa_dispatch.outbound_messages where id = any($1::uuid[])", [ids])).rows;
  assert.equal(rows.filter((r) => r.status === "queued").length, 4, "2 instâncias × cota 2");
  assert.equal(rows.filter((r) => r.status === "scheduled").length, 6, "o resto espera o próximo dia");
});

test("distribuição circular entre instâncias elegíveis; desabilitada/pausada não recebe", async () => {
  const ids = [];
  for (let i = 60; i < 66; i += 1) ids.push(await newLead(i));
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  const rows = (await ctx.db.query("select instance_id from wa_dispatch.outbound_messages where id = any($1::uuid[])", [ids])).rows;
  const perInstance = rows.reduce((acc, r) => ({ ...acc, [r.instance_id]: (acc[r.instance_id] || 0) + 1 }), {});
  assert.deepEqual(Object.values(perInstance).sort(), [3, 3]);

  await ctx.db.query("update wa_dispatch.outbound_messages set status = 'cancelled' where id = any($1::uuid[])", [ids]);
  await ctx.db.query("update wa_dispatch.whatsapp_instances set operational_state = 'paused' where id = $1", [instB.id]);
  const more = [];
  for (let i = 66; i < 69; i += 1) more.push(await newLead(i));
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  const rows2 = (await ctx.db.query("select distinct instance_id from wa_dispatch.outbound_messages where id = any($1::uuid[])", [more])).rows;
  assert.deepEqual(rows2.map((r) => r.instance_id), [instA.id]);
});

test("falhas do provedor: temporária→backoff, permanente→falha, desconhecida→verificação, credencial→suspende", async () => {
  // Temporária (130429 throughput)
  const t = await newLead(70);
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  mock.planSend({ type: "graph_error", status: 400, code: 130429 });
  const r1 = await dispatch.processMessage(ctx, t);
  assert.equal(r1.status, "scheduled");
  const mt = await statusOf(t);
  assert.equal(mt.attempts, 1);
  assert.equal(mt.instance_id, null);
  assert.ok(new Date(mt.next_attempt_at) > new Date(), "próxima tentativa no futuro (backoff)");
  // Recusa de conexão antes do envio também é temporária.
  await ctx.db.query("update wa_dispatch.outbound_messages set next_attempt_at = now() where id = $1", [t]);
  await dispatch.assignInstances(ctx);
  mock.planSend({ type: "refused" });
  assert.equal((await dispatch.processMessage(ctx, t)).status, "scheduled");

  // Permanente (131026 não entregável)
  const p = await newLead(71);
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  mock.planSend({ type: "graph_error", status: 400, code: 131026 });
  assert.equal((await dispatch.processMessage(ctx, p)).status, "failed");
  assert.equal((await statusOf(p)).last_error_code, "131026");

  // Desconhecida (tempo esgotado) → verificação; sem confirmação na janela → revisão humana; nunca reenviada.
  const u = await newLead(72);
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  mock.planSend({ type: "timeout" });
  assert.equal((await dispatch.processMessage(ctx, u)).status, "unknown_pending_verification");
  const sends = mock.sendCalls().length;
  const strict = testContext({ config: testConfig({ UNKNOWN_VERIFICATION_WINDOW_MS: "0" }), fetchImpl: mock.fetchImpl, withQueue: false });
  await dispatch.verifyUnknown(strict);
  await strict.close();
  assert.equal((await statusOf(u)).status, "unknown_needs_review");
  await dispatch.assignInstances(ctx);
  assert.equal(mock.sendCalls().length, sends, "resultado desconhecido não é reenviado");
  // 500 sem corpo da Graph também é desconhecido.
  const u2 = await newLead(73);
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  mock.planSend({ type: "http_500_empty" });
  assert.equal((await dispatch.processMessage(ctx, u2)).status, "unknown_pending_verification");

  // Credencial inválida (190): instância suspensa, mensagem volta ao agendamento.
  const a = await newLead(74);
  await dispatch.authorizeRequested(ctx);
  await dispatch.assignInstances(ctx);
  const assignedTo = (await statusOf(a)).instance_id;
  mock.planSend({ type: "graph_error", status: 401, code: 190 });
  assert.equal((await dispatch.processMessage(ctx, a)).status, "scheduled");
  const inst = (await ctx.db.query("select operational_state, suspension_reason from wa_dispatch.whatsapp_instances where id = $1", [assignedTo])).rows[0];
  assert.equal(inst.operational_state, "suspended");
  assert.match(inst.suspension_reason, /^auth/);
});

test("Redis indisponível: /ready falso, lead aceito e persistido; recuperação reenfileira sem perda", async () => {
  const down = testContext({ config: testConfig({ REDIS_URL: "redis://127.0.0.1:1/0" }), fetchImpl: mock.fetchImpl });
  const { createApp } = await import("../src/app.js");
  const server = createApp(down).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const ready = await fetch(`${base}/ready`).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal(ready.status, 503);
  assert.equal(ready.body.checks.redis, false);
  assert.equal(ready.body.checks.database, true);
  const crm = await addCrmRegistration(down, { national: phoneN(80) });
  const res = await fetch(`${base}/v1/leads`, {
    method: "POST", headers: { authorization: `Bearer ${down.config.CRM_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ crm_lead_id: crm, phone: phoneN(80), campaign_code: "retorno-simulacao", consent_reference: "x" })
  });
  assert.equal(res.status, 202);
  const { job } = await res.json();
  await dispatch.authorizeRequested(down);
  await dispatch.assignInstances(down); // enfileirar falha; continua 'queued' no Postgres
  assert.equal((await statusOf(job.id)).status, "queued");
  server.close();
  await down.close();
  // Redis volta: o agendador reenfileira e o worker envia.
  assert.ok(await dispatch.requeueQueued(ctx) >= 1);
  const worker = startSendWorker(ctx, { redisUrl: ctx.config.REDIS_URL, prefix: ctx.config.QUEUE_PREFIX, concurrency: 1 });
  await waitFor(async () => (await statusOf(job.id)).status === "accepted");
  await worker.close();
});

test("métricas operacionais", async () => {
  const { collectStats } = await import("../src/services/stats.js");
  const s = await collectStats(ctx);
  assert.ok(s.instances.length === 2);
  assert.ok(s.last_24h.accepted >= 1);
  assert.ok(s.last_24h.unknown_results >= 1);
  assert.ok(typeof s.pending === "number");
  assert.ok(s.queue && typeof s.queue.waiting === "number");
});

function webhookBody(statuses) {
  return { object: "whatsapp_business_account", entry: [{ id: "900000001", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "111111" }, statuses } }] }] };
}
function incomingBody(from, text) {
  return { object: "whatsapp_business_account", entry: [{ id: "900000001", changes: [{ field: "messages", value: { metadata: { phone_number_id: "111111" }, messages: [{ from, id: `wamid.IN${Date.now()}${Math.random()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] } }] }] };
}
async function postWebhook(body) {
  const raw = Buffer.from(JSON.stringify(body));
  return handleMetaWebhook(ctx, raw, hubSignature(raw, ctx.config.WA_APP_SECRET));
}
void SEND_QUEUE;
