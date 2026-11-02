import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  SMS_SKIP_REASON,
  WA_CHECK_MAX_PER_ROUND,
  WA_CHECK_SPACING_MAX_MS,
  WA_CHECK_SPACING_MIN_MS,
  buildSmsMetrics,
  pickWaCheckSession,
  planSmsBatch,
  resolveWaCache,
  smsSkipReason,
  waCheckIsFresh,
  waCheckSpacingMs
} from "../lib/sms-batch-core.mjs";
import { WA_UNAVAILABLE, createWaCheckContext, ensureWhatsapp, waCheckSummary } from "../lib/sms-batch-wa-check.mjs";

// Checagem de WhatsApp do Lote de SMS (dono, 2026-11-02): só consulta; quem não tem conta sai do lote (sem rede nestes testes).
const candidate = (n, overrides = {}) => ({
  id: `c${n}`, name: `Contato ${n}`, phone: `+55149999900${String(n).padStart(2, "0")}`, status: "available",
  assignedUserId: null, ownerUserId: null, lastBrokerId: null, lastAttemptAt: null, registrationId: null,
  reserved: false, hasRound: false, hasManualAttempt: false, isClientPhone: false, hasConversation: false, smsSent: false, isInternalPhone: false,
  ...overrides
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("smsSkipReason: só hasWhatsapp === false tira do lote; true e sem checagem entram (falha aberta)", () => {
  assert.equal(smsSkipReason(candidate(1, { hasWhatsapp: false })), SMS_SKIP_REASON.NO_WHATSAPP);
  assert.equal(smsSkipReason(candidate(1, { hasWhatsapp: true })), null);
  assert.equal(smsSkipReason(candidate(1)), null);
  assert.equal(smsSkipReason(candidate(1, { hasWhatsapp: undefined })), null);
  assert.equal(SMS_SKIP_REASON.NO_WHATSAPP, "sem_whatsapp");
});

test("smsSkipReason: os outros motivos continuam valendo antes do WhatsApp (uma régua só)", () => {
  assert.equal(smsSkipReason(candidate(1, { hasWhatsapp: false, isClientPhone: true })), SMS_SKIP_REASON.IS_CLIENT);
  assert.equal(smsSkipReason(candidate(1, { hasWhatsapp: false, smsSent: true })), SMS_SKIP_REASON.SMS_SENT);
  assert.equal(smsSkipReason(candidate(1, { hasWhatsapp: false, status: "do_not_contact" })), SMS_SKIP_REASON.NOT_AVAILABLE);
});

test("planSmsBatch: sem WhatsApp sai e a vaga é preenchida pelo próximo contato", () => {
  const list = [candidate(1, { hasWhatsapp: false }), candidate(2, { hasWhatsapp: true }), candidate(3), candidate(4, { hasWhatsapp: false }), candidate(5, { hasWhatsapp: true })];
  const plan = planSmsBatch(list, { limit: 3, sentToday: 0 });
  assert.deepEqual(plan.items.map((item) => item.id), ["c2", "c3", "c5"]);
  assert.equal(plan.skipped[SMS_SKIP_REASON.NO_WHATSAPP], 2);
});

test("cache: vale 30 dias; vencido ou nunca checado = precisa consultar", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  assert.equal(waCheckIsFresh("2026-10-10T12:00:00Z", now), true);
  assert.equal(waCheckIsFresh("2026-10-03T12:00:00Z", now), true); // 30 dias exatos
  assert.equal(waCheckIsFresh("2026-10-02T11:59:00Z", now), false); // mais de 30 dias
  assert.equal(waCheckIsFresh("", now), false);
  assert.equal(waCheckIsFresh("2026-11-05T00:00:00Z", now), false); // data no futuro não vale
  const rows = [{ phone_normalized: "+5514999998888", has_whatsapp: false, checked_at: "2026-10-20T10:00:00Z" }];
  assert.equal(resolveWaCache(rows, "+5514999998888", now), false);
  assert.equal(resolveWaCache(rows, "(14) 99999-8888", now), false); // outra forma do mesmo número
  assert.equal(resolveWaCache(rows, "+5514988887777", now), undefined);
  assert.equal(resolveWaCache([{ ...rows[0], checked_at: "2026-09-01T10:00:00Z" }], "+5514999998888", now), undefined);
  // várias linhas do mesmo número (formas diferentes): vale a mais recente
  const twice = [
    { phone_normalized: "+5514999998888", has_whatsapp: false, checked_at: "2026-10-10T10:00:00Z" },
    { phone_normalized: "5514999998888", has_whatsapp: true, checked_at: "2026-10-25T10:00:00Z" }
  ];
  assert.equal(resolveWaCache(twice, "+5514999998888", now), true);
});

test("espaçamento entre consultas fica entre 1 e 2 segundos", () => {
  assert.equal(waCheckSpacingMs(0), WA_CHECK_SPACING_MIN_MS);
  assert.ok(waCheckSpacingMs(0.5) > WA_CHECK_SPACING_MIN_MS && waCheckSpacingMs(0.5) < WA_CHECK_SPACING_MAX_MS);
  assert.ok(waCheckSpacingMs(1) <= WA_CHECK_SPACING_MAX_MS);
  assert.equal(WA_CHECK_MAX_PER_ROUND, 100);
  for (let i = 0; i < 50; i += 1) {
    const ms = waCheckSpacingMs();
    assert.ok(ms >= 1000 && ms <= 2000);
  }
});

test("sessão da checagem: a do dono primeiro; só conectada; nenhuma = null", () => {
  const rows = (status, slot = 1) => [{ slot, status }];
  assert.deepEqual(pickWaCheckSession([{ userId: "a", isOwner: false, rows: rows("connected") }, { userId: "dono", isOwner: true, rows: rows("connected") }]), { userId: "dono", slot: 1 });
  assert.deepEqual(pickWaCheckSession([{ userId: "dono", isOwner: true, rows: rows("disconnected") }, { userId: "a", isOwner: false, rows: rows("connected", 2) }]), { userId: "a", slot: 2 });
  assert.equal(pickWaCheckSession([{ userId: "dono", isOwner: true, rows: rows("error") }]), null);
  assert.equal(pickWaCheckSession([]), null);
});

// Contexto de teste: relógio falso, espera registrada, sem rede.
function harness({ answers = {}, session = { userId: "dono", slot: 1 }, saveError = null, checkError = null, start = 1_000_000 } = {}) {
  const log = { checks: [], saves: [], sleeps: [] };
  let clock = start;
  const deps = {
    now: () => clock,
    sleep: async (ms) => { log.sleeps.push(ms); clock += ms; },
    random: () => 0,
    check: async (_session, phone) => {
      if (checkError) throw checkError;
      log.checks.push(phone);
      clock += 300;
      return phone in answers ? answers[phone] : true;
    },
    save: async (phone, value) => {
      if (saveError) throw saveError;
      log.saves.push([phone, value]);
    }
  };
  return { ctx: createWaCheckContext({ session, deps }), log, advance: (ms) => { clock += ms; } };
}

test("ensureWhatsapp: consulta, guarda e espaça as consultas (a 1ª sem espera)", async () => {
  const { ctx, log } = harness({ answers: { "+5514999990002": false } });
  const items = [candidate(1), candidate(2), candidate(3)];
  for (const item of items) await ensureWhatsapp(ctx, item);
  assert.deepEqual(items.map((item) => item.hasWhatsapp), [true, false, true]);
  assert.equal(log.checks.length, 3);
  assert.deepEqual(log.sleeps, [1000, 1000]);
  assert.deepEqual(log.saves.map(([, value]) => value), [true, false, true]);
  assert.equal(waCheckSummary(ctx).state, "ok");
  assert.equal(smsSkipReason(items[1]), SMS_SKIP_REASON.NO_WHATSAPP);
});

test("ensureWhatsapp: contato já checado (cache) não é consultado de novo", async () => {
  const { ctx, log } = harness();
  const item = candidate(1, { hasWhatsapp: true });
  await ensureWhatsapp(ctx, item);
  assert.equal(log.checks.length, 0);
});

test("ensureWhatsapp: teto de 100 consultas por rodada; o resto fica pendente (não entra agora)", async () => {
  const { ctx, log } = harness();
  ctx.deadline = Number.MAX_SAFE_INTEGER;
  const items = Array.from({ length: 105 }, (_, i) => candidate(i + 1, { phone: `+55149${String(900000000 + i)}` }));
  for (const item of items) await ensureWhatsapp(ctx, item);
  assert.equal(log.checks.length, 100);
  assert.equal(items.slice(100).every((item) => item.waPending && item.hasWhatsapp === undefined), true);
  assert.equal(waCheckSummary(ctx).state, "limit");
});

test("ensureWhatsapp: tempo da rodada esgotado deixa pendente e a tela continua depois", async () => {
  const { ctx, log } = harness();
  ctx.deadline = ctx.deps.now() + 2500; // cabem poucas consultas com 1–2 s de espaço
  const items = Array.from({ length: 10 }, (_, i) => candidate(i + 1));
  for (const item of items) await ensureWhatsapp(ctx, item);
  assert.ok(log.checks.length >= 1 && log.checks.length < 10);
  assert.ok(items.some((item) => item.waPending));
  const summary = waCheckSummary(ctx);
  assert.equal(summary.state, "checking");
  assert.equal(summary.pending, true);
  assert.ok(summary.checked > 0);
});

test("falha aberta: serviço com erro não bloqueia ninguém e para de consultar", async () => {
  const { ctx, log } = harness({ checkError: new Error("serviço fora do ar") });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const items = [candidate(1), candidate(2)];
    for (const item of items) await ensureWhatsapp(ctx, item);
    assert.deepEqual(items.map((item) => item.hasWhatsapp), [undefined, undefined]);
    assert.equal(items.every((item) => smsSkipReason(item) === null), true);
    assert.equal(waCheckSummary(ctx).state, "unavailable");
    assert.equal(waCheckSummary(ctx).reason, WA_UNAVAILABLE.SERVICE);
    assert.equal(log.checks.length, 0);
  } finally {
    console.warn = warn;
  }
});

test("falha aberta: sem sessão conectada nada é consultado e a lista sai como antes", async () => {
  const { ctx, log } = harness({ session: null });
  const item = candidate(1);
  await ensureWhatsapp(ctx, item);
  assert.equal(log.checks.length, 0);
  assert.equal(item.hasWhatsapp, undefined);
  assert.equal(smsSkipReason(item), null);
  assert.equal(waCheckSummary(ctx).reason, WA_UNAVAILABLE.NO_SESSION);
});

test("falha aberta: tabela ausente usa a resposta agora, avisa e para de consultar", async () => {
  const { ctx, log } = harness({ saveError: Object.assign(new Error("relation does not exist"), { code: "42P01" }) });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const first = candidate(1);
    const second = candidate(2);
    await ensureWhatsapp(ctx, first);
    await ensureWhatsapp(ctx, second);
    assert.equal(first.hasWhatsapp, true);
    assert.equal(second.hasWhatsapp, undefined);
    assert.equal(log.checks.length, 1);
    assert.equal(waCheckSummary(ctx).reason, WA_UNAVAILABLE.NO_TABLE);
  } finally {
    console.warn = warn;
  }
});

test("falha aberta: duas respostas vazias seguidas = serviço instável, para de consultar", async () => {
  const { ctx, log } = harness({ answers: { "+5514999990001": null, "+5514999990002": null } });
  const items = [candidate(1), candidate(2), candidate(3)];
  for (const item of items) await ensureWhatsapp(ctx, item);
  assert.equal(log.checks.length, 2);
  assert.equal(items.every((item) => item.hasWhatsapp === undefined && smsSkipReason(item) === null), true);
  assert.equal(waCheckSummary(ctx).reason, WA_UNAVAILABLE.NO_ANSWER);
});

test("Enviados: a contagem vem só de envios gravados, então quem ficou sem WhatsApp nunca entra", () => {
  const sends = [{ created_at: "2026-11-02T13:00:00Z" }, { created_at: "2026-11-02T14:00:00Z" }];
  const metrics = buildSmsMetrics({ sends, sends2: [], views: [], signups: [] }, { days: 1, now: new Date("2026-11-02T15:00:00Z") });
  assert.equal(metrics.total.sent, 2);
  // a checagem não grava nada em sms_batch_sends nem altera contato/cliente
  const wiring = read("lib/sms-batch-whatsapp.js");
  assert.doesNotMatch(wiring, /sms_batch_sends|simulation_registrations|prospecting_history/);
  assert.doesNotMatch(wiring, /\.(update|delete|insert)\(/);
  assert.match(wiring, /sms_batch_wa_checks/);
});

test("segurança: a checagem só CONSULTA — nenhum envio de WhatsApp, nem opção de enviar por WhatsApp na tela", () => {
  const wiring = read("lib/sms-batch-whatsapp.js");
  const orchestration = read("lib/sms-batch-wa-check.mjs");
  const screen = read("components/SmsBatchWorkspace.jsx");
  for (const source of [wiring, orchestration]) {
    assert.doesNotMatch(source, /sendIndividualMessage|sendIndividual|sendWhatsapp|\/send\b/i);
  }
  assert.match(wiring, /checkIndividualNumber/);
  assert.doesNotMatch(screen, /wa\.me|api\.whatsapp|whatsapp:\/\/|Enviar (por|pelo) WhatsApp/i);
  assert.match(screen, /sms:|Enviar SMS/);
  // o serviço já tem a rota de consulta (nada novo a republicar)
  assert.match(read("whatsapp-individual-service/src/server.js"), /\/sessions\/:userId\/check-number/);
});

test("lista do lote: a elegibilidade continua só em smsSkipReason e a aba 'Sem WhatsApp' é só leitura", () => {
  const batch = read("lib/sms-batch.js");
  assert.match(batch, /ensureWhatsapp\(wa, item\)/);
  assert.match(batch, /hasWhatsapp: resolveWaCache/);
  assert.match(batch, /noWhatsapp: brokerId \? null : await listNoWhatsapp/);
  const screen = read("components/SmsBatchWorkspace.jsx");
  const tab = screen.slice(screen.indexOf('tab === "nowa"'), screen.indexOf('tab === "results"'));
  assert.ok(tab.length > 0);
  assert.doesNotMatch(tab, /<a |Button|onClick|call\(/); // só leitura: sem links, botões nem chamadas
});

test("migration: tabela do cache idempotente, RLS ligado e sem policy pública", () => {
  const name = "supabase/migrations/20261102190000_sms_batch_wa_checks.sql";
  assert.ok(existsSync(new URL(`../${name}`, import.meta.url)));
  const sql = read(name);
  assert.match(sql, /create table if not exists public\.sms_batch_wa_checks/);
  assert.match(sql, /phone_normalized text primary key/);
  assert.match(sql, /has_whatsapp boolean not null/);
  assert.match(sql, /checked_at timestamptz not null default now\(\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.sms_batch_wa_checks from anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /drop\s+(table|column)/i);
});
