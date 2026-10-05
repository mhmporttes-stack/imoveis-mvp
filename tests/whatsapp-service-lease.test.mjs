import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  ACTION, DEFAULT_CONFIG, KIND, classifyDisconnect, computeBackoffDelay, createReconnectController, isPairedCreds
} from "../whatsapp-individual-service/src/reconnect-policy.js";
import { createCloseHandler } from "../whatsapp-individual-service/src/session-lifecycle.js";
import { createKeyedMutex } from "../whatsapp-individual-service/src/session-mutex.js";
import { LEASE_MODE, LEASE_STATE, createLeaseManager } from "../whatsapp-individual-service/src/lease.js";
import { createShutdown } from "../whatsapp-individual-service/src/shutdown.js";
import { createResumeRunner, resumeSettleMs } from "../whatsapp-individual-service/src/resume.js";
import { createReconciler, planReconcile } from "../whatsapp-individual-service/src/reconcile.js";
import { createServiceRuntime } from "../whatsapp-individual-service/src/runtime.js";
import { createTelemetry } from "../whatsapp-individual-service/src/telemetry.js";
import {
  isLeaseUnavailableError, normalizeLeaseResult, parseLeaseRequest
} from "../lib/whatsapp-service-lease-core.mjs";
import { sanitizeTelemetryEvent } from "../lib/whatsapp-session-telemetry-core.mjs";
import { classifySessionAttention, describeAttention } from "../lib/whatsapp-session-attention-core.mjs";

// Fase estabilização das sessões do WhatsApp individual: lease (dono único), política por código,
// mutex por sessão, retomada escalonada, reconciliação, encerramento gracioso. Tudo com dublês:
// sem Baileys, sem rede, sem banco e SEM enviar mensagem.

const USER = "11111111-2222-3333-4444-555555555555";
const silent = { log() {}, warn() {}, error() {} };
const src = (file) => readFileSync(new URL(`../whatsapp-individual-service/src/${file}`, import.meta.url), "utf8");

// ---------- Fake do banco do lease (espelha a semântica das funções SQL da migration) ----------
function makeLeaseStore(clock) {
  let row = null;
  const iso = (ms) => new Date(ms).toISOString();
  return {
    get row() { return row; },
    acquire({ bootId, deployId, ttlSeconds = 60 }) {
      const t = clock.t;
      const expires = t + ttlSeconds * 1000;
      if (!row) {
        row = { owner_boot_id: bootId, owner_deploy_id: deployId, acquired_at: t, expires_at: expires, released_at: null };
        return { acquired: true, took_over: false, previous_released: false, first: true, expires_at: iso(expires) };
      }
      if (row.owner_boot_id === bootId || row.released_at !== null || row.expires_at <= t) {
        const prev = { ...row };
        row = { owner_boot_id: bootId, owner_deploy_id: deployId, acquired_at: prev.owner_boot_id === bootId && prev.released_at === null ? prev.acquired_at : t, expires_at: expires, released_at: null };
        return { acquired: true, took_over: prev.owner_boot_id !== bootId, previous_released: prev.owner_boot_id !== bootId && prev.released_at !== null, first: false, expires_at: iso(expires) };
      }
      return { acquired: false, holder_boot_id: row.owner_boot_id, holder_deploy_id: row.owner_deploy_id, expires_at: iso(row.expires_at), retry_after_ms: Math.max(0, row.expires_at - t) };
    },
    renew({ bootId, ttlSeconds = 60 }) {
      if (row && row.owner_boot_id === bootId && row.released_at === null) { row.expires_at = clock.t + ttlSeconds * 1000; return { renewed: true, expires_at: iso(row.expires_at) }; }
      return { renewed: false };
    },
    release({ bootId }) {
      if (row && row.owner_boot_id === bootId && row.released_at === null) { row.released_at = clock.t; row.expires_at = clock.t; return { released: true }; }
      return { released: false };
    },
    holderNow() {
      if (!row || row.released_at !== null || row.expires_at <= clock.t) return null;
      return row.owner_boot_id;
    }
  };
}

// API do serviço sobre o fake (mesma normalização da rota do CRM).
function apiFor(store, bootId, { deployId = `dep-${bootId}`, down = () => null } = {}) {
  const wrap = (action, fn) => async (extra = {}) => {
    const outage = down();
    if (outage) return { unavailable: true, reason: outage };
    return { ok: true, ...normalizeLeaseResult(action, fn({ bootId, deployId, ...extra })) };
  };
  return { acquire: wrap("acquire", store.acquire), renew: wrap("renew", store.renew), release: wrap("release", store.release) };
}

function leaseHarness({ store, clock, bootId, down, onSleep, extra = {} }) {
  const events = [];
  const manager = createLeaseManager({
    api: apiFor(store, bootId, { down }),
    now: () => clock.t,
    random: () => 0.5,
    sleep: async (ms) => { clock.t += ms; if (onSleep) await onSleep(ms); await Promise.resolve(); },
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {},
    record: (type, fields) => events.push({ type, ...fields }),
    log: silent,
    ...extra
  });
  return { manager, events };
}

test("lease: primeiro dono adquire na hora (sem espera) e registra a aquisição", async () => {
  const clock = { t: 1_000_000 };
  const store = makeLeaseStore(clock);
  const { manager, events } = leaseHarness({ store, clock, bootId: "A" });
  const info = await manager.start();
  assert.equal(info.mode, LEASE_MODE.LEASED);
  assert.equal(info.first, true);
  assert.equal(manager.isHolder(), true);
  assert.equal(store.holderNow(), "A");
  assert.deepEqual(events.map((e) => e.type), ["lease_acquired"]);
  assert.equal(events[0].reason, "first_owner");
});

test("lease: o serviço NOVO espera o antigo liberar (SIGTERM) e assume em passagem limpa", async () => {
  const clock = { t: 1_000_000 };
  const store = makeLeaseStore(clock);
  const a = leaseHarness({ store, clock, bootId: "A" });
  await a.manager.start();
  let released = false;
  const b = leaseHarness({
    store, clock, bootId: "B",
    onSleep: async () => {
      // O antigo recebe SIGTERM 6 s depois e libera o lease.
      if (!released && clock.t >= 1_006_000) { released = true; await a.manager.release("shutdown"); }
    }
  });
  const info = await b.manager.start();
  assert.equal(info.mode, LEASE_MODE.LEASED);
  assert.equal(info.previousReleased, true, "passagem limpa: o antigo liberou");
  assert.equal(store.holderNow(), "B");
  assert.ok(b.events.some((e) => e.type === "lease_waiting" && e.reason === "holder_active"), "esperou e registrou");
  assert.ok(info.waitedMs >= 6000);
  assert.ok(a.events.some((e) => e.type === "lease_released"));
});

test("lease: se o antigo morrer sem liberar, o novo só assume DEPOIS de o lease expirar", async () => {
  const clock = { t: 1_000_000 };
  const store = makeLeaseStore(clock);
  const a = leaseHarness({ store, clock, bootId: "A" });
  await a.manager.start(); // expira em +60 s; ninguém renova (processo morreu)
  const b = leaseHarness({ store, clock, bootId: "B" });
  const info = await b.manager.start();
  assert.equal(info.mode, LEASE_MODE.LEASED);
  assert.equal(info.tookOver, true);
  assert.equal(info.previousReleased, false);
  assert.ok(clock.t >= 1_060_000, "nunca antes do vencimento");
  assert.equal(info.how, "expired_takeover");
});

test("lease: dois processos simulados NUNCA detêm o mesmo lease ao mesmo tempo", async () => {
  const clock = { t: 5_000_000 };
  const store = makeLeaseStore(clock);
  const apiA = apiFor(store, "A");
  const apiB = apiFor(store, "B");
  const results = await Promise.all([apiA.acquire({ ttlSeconds: 60 }), apiB.acquire({ ttlSeconds: 60 })]);
  assert.equal(results.filter((r) => r.acquired).length, 1);
  const winner = results[0].acquired ? "A" : "B";
  assert.equal(store.holderNow(), winner);
  // o perdedor não renova nem libera o lease do outro
  const loser = winner === "A" ? apiB : apiA;
  assert.equal((await loser.renew({ ttlSeconds: 60 })).renewed, false);
  assert.equal((await loser.release()).released, false);
  assert.equal(store.holderNow(), winner);
  // varredura: ao longo do tempo, em nenhum instante há dois donos
  for (let step = 0; step < 20; step += 1) {
    clock.t += 20_000;
    await (winner === "A" ? apiA : apiB).renew({ ttlSeconds: 60 });
    const tryLoser = await loser.acquire({ ttlSeconds: 60 });
    assert.equal(tryLoser.acquired, false, `instante ${step}`);
  }
});

test("lease: renovação estende o prazo; renovação que falha (rede) mantém o lease e avisa uma vez", async () => {
  const clock = { t: 1_000_000 };
  const store = makeLeaseStore(clock);
  let outage = null;
  const timers = [];
  const { manager, events } = leaseHarness({
    store, clock, bootId: "A", down: () => outage,
    extra: { setTimer: (fn) => { const t = { fn, unref() {} }; timers.push(t); return t; }, clearTimer: () => {} }
  });
  await manager.start();
  const tick = () => timers.at(-1).fn();
  clock.t += 15_000; tick(); await new Promise((r) => setImmediate(r));
  assert.equal(store.row.expires_at, 1_000_000 + 15_000 + 60_000, "prazo estendido");
  outage = "network";
  for (let i = 0; i < 3; i += 1) { clock.t += 15_000; tick(); await new Promise((r) => setImmediate(r)); }
  assert.equal(manager.isHolder(), true, "falha de rede não derruba o lease");
  assert.equal(events.filter((e) => e.type === "lease_unavailable").length, 1, "avisa uma vez, sem inundar");
  assert.equal(events.filter((e) => e.type === "lease_lost").length, 0);
});

test("lease: se outro assumir, o serviço PERDE, suspende as sessões (sem logout) e volta a esperar", async () => {
  const clock = { t: 1_000_000 };
  const store = makeLeaseStore(clock);
  const timers = [];
  const lost = [];
  const { manager, events } = leaseHarness({
    store, clock, bootId: "A",
    extra: { sleep: () => new Promise(() => {}), setTimer: (fn) => { const t = { fn, unref() {} }; timers.push(t); return t; }, clearTimer: () => {}, onLost: (reason) => lost.push(reason) }
  });
  await manager.start();
  // Outro serviço assume depois de o lease de A vencer (A ficou sem renovar).
  clock.t += 61_000;
  await apiFor(store, "B").acquire({ ttlSeconds: 60 });
  timers.at(-1).fn();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(lost, ["taken_by_other"]);
  assert.equal(manager.isHolder(), false);
  assert.equal(manager.state(), LEASE_STATE.WAITING, "recuou e voltou a esperar");
  assert.ok(events.some((e) => e.type === "lease_lost" && e.reason === "taken_by_other"));
  manager.stop();
});

test("lease: sem tabela/endpoint (migration pendente) aguarda a carência e segue SEM lease, com aviso", async () => {
  const clock = { t: 1_000_000 };
  const store = makeLeaseStore(clock);
  const { manager, events } = leaseHarness({ store, clock, bootId: "A", down: () => "lease_table_missing", extra: { unavailableGraceMs: 90_000 } });
  const info = await manager.start();
  assert.equal(info.mode, LEASE_MODE.UNLEASED);
  assert.equal(manager.isHolder(), true, "comportamento antigo: pode conectar");
  assert.equal(manager.state(), LEASE_STATE.UNLEASED);
  assert.ok(clock.t - 1_000_000 >= 90_000, "esperou a carência (Vercel pode estar subindo junto)");
  const reasons = events.filter((e) => e.type === "lease_unavailable").map((e) => e.reason);
  assert.ok(reasons.includes("lease_table_missing") && reasons.includes("fallback_unleased"));
  assert.equal(store.row, null, "nada gravado");
  manager.stop();
});

test("lease: o endpoint aparece depois (reprobe) -> passa a deter o lease sem reiniciar sessões", async () => {
  const clock = { t: 1_000_000 };
  const store = makeLeaseStore(clock);
  let outage = "endpoint_missing";
  const timers = [];
  const { manager, events } = leaseHarness({
    store, clock, bootId: "A", down: () => outage,
    extra: { unavailableGraceMs: 0, setTimer: (fn) => { const t = { fn, unref() {} }; timers.push(t); return t; }, clearTimer: () => {} }
  });
  assert.equal((await manager.start()).mode, LEASE_MODE.UNLEASED);
  outage = null;
  timers.at(-1).fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(manager.state(), LEASE_STATE.LEASED);
  assert.ok(events.some((e) => e.type === "lease_acquired" && e.reason === "late_start"));
  manager.stop();
});

test("lease: release só funciona para o dono; encerrar durante a espera não deixa lease preso", async () => {
  const clock = { t: 1_000_000 };
  const store = makeLeaseStore(clock);
  const a = leaseHarness({ store, clock, bootId: "A" });
  await a.manager.start();
  const b = leaseHarness({ store, clock, bootId: "B", onSleep: async () => { if (clock.t > 1_010_000) b.manager.stop(); } });
  assert.equal((await b.manager.start()).mode, LEASE_MODE.STOPPED);
  assert.equal(store.holderNow(), "A", "o dono não foi afetado");
  assert.deepEqual(await b.manager.release(), { released: false, reason: "not_holder" });
  assert.deepEqual(await a.manager.release("shutdown"), { released: true });
  assert.equal(store.holderNow(), null);
});

test("rota/lib do lease: validação do pedido, normalização e detecção de 'migration pendente'", () => {
  assert.equal(parseLeaseRequest({ action: "x", bootId: "a" }).ok, false);
  assert.equal(parseLeaseRequest({ action: "acquire", bootId: "com espaço;drop" }).ok, false);
  assert.equal(parseLeaseRequest({ action: "acquire" }).ok, false);
  const ok = parseLeaseRequest({ action: "acquire", bootId: "boot-1", deployId: "dep_9", ttlSeconds: 9999 });
  assert.equal(ok.ok, true);
  assert.equal(ok.ttlSeconds, 120, "TTL limitado");
  assert.equal(parseLeaseRequest({ action: "renew", bootId: "boot-1", ttlSeconds: 1 }).ttlSeconds, 20);
  assert.equal(parseLeaseRequest({ action: "renew", bootId: "b" }).ttlSeconds, 60);
  assert.equal(isLeaseUnavailableError({ code: "PGRST202" }), true);
  assert.equal(isLeaseUnavailableError({ code: "42P01" }), true);
  assert.equal(isLeaseUnavailableError({ message: 'relation "whatsapp_service_lease" does not exist' }), true);
  assert.equal(isLeaseUnavailableError({ code: "57014", message: "timeout" }), false);
  assert.deepEqual(normalizeLeaseResult("acquire", { acquired: false, holder_boot_id: "x", retry_after_ms: 1500.7 }).retryAfterMs, 1500);
  assert.equal(normalizeLeaseResult("release", { released: true }).released, true);
});

test("migration do lease: aditiva, idempotente, 14 dígitos, RLS só service_role, sem DROP de dado", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const file = readdirSync(dir).find((name) => name.endsWith("_whatsapp_service_lease.sql"));
  assert.ok(file && /^\d{14}_/.test(file), "nome com 14 dígitos");
  const sql = readFileSync(new URL(file, dir), "utf8");
  assert.match(sql, /create table if not exists public\.whatsapp_service_lease/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.whatsapp_service_lease from anon, authenticated/);
  assert.match(sql, /create or replace function public\.whatsapp_service_lease_acquire/);
  assert.match(sql, /for update/);
  assert.match(sql, /grant execute on function public\.whatsapp_service_lease_acquire[^;]+to service_role/);
  assert.ok(!/drop table|truncate|delete from/i.test(sql), "nada destrutivo");
  // Só derruba/recria CHECKs da telemetria (aditivo: lista antiga continua válida).
  for (const type of ["service_boot", "intervention_required", "lease_acquired", "lease_waiting", "lease_released", "lease_lost", "lease_unavailable", "session_reconciled"]) {
    assert.ok(sql.includes(`'${type}'`), `CHECK da telemetria deve listar ${type}`);
  }
});

// ---------- Política por código ----------
function harness({ random = () => 0.5, unpaired = false, config = DEFAULT_CONFIG, shuttingDown = () => false } = {}) {
  let nowMs = 1_790_000_000_000;
  const events = [];
  const calls = { notify: [], clearCreds: 0, retired: [], retries: [] };
  const controller = createReconnectController({
    config, random, now: () => nowMs, newId: (() => { let n = 0; return () => `cycle-${++n}`; })(),
    setTimer: () => ({ unref() {} }), clearTimer: () => {},
    record: (type, fields) => events.push({ type, ...fields })
  });
  const entry = { sock: null, status: "connecting", qr: null, pairingCode: null, pairingMode: false, pairingError: null };
  const handleClose = createCloseHandler({
    userId: USER, entry, controller,
    notifyStatus: async (_id, payload) => { calls.notify.push(payload); },
    clearSessionCreds: async () => { calls.clearCreds += 1; },
    retireSocket: async (sock) => { calls.retired.push(sock); },
    scheduleRetry: (info) => { calls.retries.push(info); },
    isShuttingDown: shuttingDown
  });
  const makeSock = () => ({ authState: { creds: unpaired ? { registered: false } : { registered: false, me: { id: "x:1@s.whatsapp.net" } } } });
  const drop = async (statusCode, errorMessage = "queda de teste") => {
    const sock = makeSock();
    entry.sock = sock;
    return handleClose({ sock, statusCode, errorMessage, payload: { statusCode } });
  };
  return { controller, entry, drop, events, calls, advance: (ms) => { nowMs += ms; }, handleClose, makeSock };
}

test("401: definitivo — para, apaga a credencial inválida, pede QR por ação humana, NENHUMA reconexão", async () => {
  const h = harness();
  h.controller.beginCycle("manual");
  const decision = await h.drop(401);
  assert.equal(decision.action, ACTION.LOGOUT);
  assert.equal(h.calls.retries.length, 0);
  assert.equal(h.calls.clearCreds, 1);
  assert.equal(h.entry.status, "disconnected");
  assert.equal(h.calls.notify.at(-1).error, "logged_out");
  assert.equal(h.controller.state.active, false);
  assert.ok(h.events.some((e) => e.type === "cycle_end" && e.reason === "logout"));
});

test("403: restrição — NÃO reconecta, sem logout e SEM apagar credencial, exige ação humana", async () => {
  const h = harness();
  h.controller.beginCycle("manual");
  const decision = await h.drop(403);
  assert.equal(decision.action, ACTION.INTERVENE);
  assert.equal(h.calls.retries.length, 0);
  assert.equal(h.calls.clearCreds, 0);
  assert.equal(h.entry.status, "error", "nunca fica preso em 'reconnecting'");
  assert.match(h.calls.notify.at(-1).error, /^needs_attention:forbidden:/);
  assert.ok(h.events.some((e) => e.type === "intervention_required" && e.reason === "forbidden"));
});

test("408 de REDE: backoff exponencial com teto e jitter; no limite vira 'interrupted_limit' com intervenção", async () => {
  const h = harness({ random: () => 0.5 });
  h.controller.beginCycle("manual");
  const delays = [];
  let last;
  for (let i = 0; i < DEFAULT_CONFIG.maxRetries + 1; i += 1) {
    last = await h.drop(408, "Connection was lost");
    if (last.action === ACTION.RETRY) { delays.push(last.delayMs); h.controller.beginRetry(); }
  }
  assert.deepEqual(delays, [4000, 8000, 16000, 32000, 64000, 120000]);
  assert.equal(last.action, ACTION.GIVE_UP);
  assert.equal(h.entry.status, "error");
  assert.match(h.calls.notify.at(-1).error, /^needs_attention:retry_limit:/);
  assert.equal(h.events.filter((e) => e.type === "interrupted_limit").length, 1);
  // jitter: dentro de ±25% e nunca acima do teto
  for (let i = 1; i <= 12; i += 1) {
    const d = computeBackoffDelay(i, DEFAULT_CONFIG, Math.random);
    assert.ok(d >= 1000 && d <= DEFAULT_CONFIG.maxDelayMs);
  }
  assert.equal(h.calls.clearCreds, 0);
});

test("408 de QR não lido é DIFERENTE de 408 de rede: não gera QR sozinho, pede QR só por ação humana", async () => {
  assert.equal(classifyDisconnect(408, "QR refs attempts ended").kind, KIND.QR_TIMEOUT);
  assert.equal(classifyDisconnect(408, "Connection was lost").kind, KIND.TRANSIENT);
  const h = harness({ unpaired: true });
  h.controller.beginCycle("manual");
  const decision = await h.drop(408, "QR refs attempts ended");
  assert.equal(decision.action, ACTION.GIVE_UP_PAIRING);
  assert.equal(h.calls.retries.length, 0, "nenhum QR novo automático");
  assert.equal(h.entry.status, "disconnected");
  assert.equal(h.calls.notify.at(-1).error, "qr_expired");
  assert.equal(h.calls.clearCreds, 0);
  // timeout de rede de sessão ainda sem pareamento também não reconecta/gera QR sozinho
  const net = harness({ unpaired: true });
  net.controller.beginCycle("manual");
  const netDecision = await net.drop(408, "Connection was lost");
  assert.equal(netDecision.action, ACTION.GIVE_UP_PAIRING);
  assert.equal(net.calls.notify.at(-1).error, "pairing_interrupted");
});

test("sessão pareada por QR NÃO é tratada como 'não pareada' (creds.registered fica false no QR; vale creds.me)", async () => {
  assert.equal(isPairedCreds({ registered: false, me: { id: "5514@s.whatsapp.net" } }), true);
  assert.equal(isPairedCreds({ registered: true }), true);
  assert.equal(isPairedCreds({ registered: false }), false);
  assert.equal(isPairedCreds(undefined), false);
  const h = harness(); // pareada por QR (registered:false + me)
  h.controller.beginCycle("resume");
  const decision = await h.drop(408, "Connection was lost");
  assert.equal(decision.action, ACTION.RETRY);
  assert.equal(decision.delayMs, 4000, "backoff exponencial, não os 2 s do pareamento");
});

test("440: outra conexão assumiu — NÃO reconecta (sem briga de instâncias), 'precisa de atenção', credencial preservada", async () => {
  const h = harness();
  h.controller.beginCycle("resume");
  const decision = await h.drop(440, "Stream Errored (conflict)");
  assert.equal(decision.action, ACTION.INTERVENE);
  assert.equal(decision.reason, "connection_replaced");
  assert.equal(h.calls.retries.length, 0);
  assert.equal(h.calls.clearCreds, 0);
  assert.match(h.calls.notify.at(-1).error, /^needs_attention:connection_replaced:/);
  assert.equal(h.entry.status, "error");
});

test("440/qualquer fechamento durante o SIGTERM do serviço: não grava estado, não agenda nada (a sessão segue 'connected' para o dono do lease)", async () => {
  let stopping = false;
  const h = harness({ shuttingDown: () => stopping });
  h.controller.beginCycle("resume");
  stopping = true;
  for (const code of [440, 408, 500, 401]) {
    const decision = await h.drop(code);
    assert.equal(decision.action, "shutdown");
  }
  assert.equal(h.calls.notify.length, 0);
  assert.equal(h.calls.retries.length, 0);
  assert.equal(h.calls.clearCreds, 0, "401 durante o encerramento também não apaga nada");
});

test("500 'Stream Errored (ack)': reconexão controlada (backoff curto), sem apagar credencial; repetição em janela curta para e pede atenção", async () => {
  const h = harness({ random: () => 0.5 });
  h.controller.beginCycle("manual");
  const first = await h.drop(500, "Stream Errored (ack)");
  assert.equal(first.action, ACTION.RETRY);
  assert.equal(first.delayMs, 4000);
  h.controller.beginRetry();
  h.advance(60_000);
  const second = await h.drop(500, "Stream Errored (ack)");
  assert.equal(second.action, ACTION.RETRY);
  h.controller.beginRetry();
  h.advance(60_000);
  const third = await h.drop(500, "Stream Errored (ack)");
  assert.equal(third.action, ACTION.INTERVENE, "3 em 10 min: para");
  assert.equal(third.reason, "repeated_stream_errors");
  assert.match(h.calls.notify.at(-1).error, /^needs_attention:repeated_stream_errors:/);
  assert.equal(h.calls.clearCreds, 0);
  assert.equal(h.entry.status, "error");
});

test("500 isolado e espaçado (fora da janela) continua só reconectando", async () => {
  const h = harness();
  h.controller.beginCycle("manual");
  for (let i = 0; i < 5; i += 1) {
    const decision = await h.drop(500, "Stream Errored (ack)");
    assert.equal(decision.action, ACTION.RETRY, `queda ${i + 1}`);
    h.controller.beginCycle("manual"); // reconectou e ficou estável
    h.advance(11 * 60_000); // 11 min depois (fora da janela de 10 min)
  }
});

test("515 logo após parear é comportamento NORMAL: reinício imediato, sem tentativa de falha, sem alerta, sem backoff", async () => {
  const h = harness({ unpaired: true });
  h.controller.beginCycle("manual");
  const decision = await h.drop(515, "Stream Errored (restart required)");
  assert.equal(decision.action, ACTION.RESTART);
  assert.equal(decision.delayMs, DEFAULT_CONFIG.restartDelayMs);
  assert.equal(h.controller.state.attempt, 1);
  assert.equal(h.calls.notify.at(-1).error, undefined);
  assert.equal(h.calls.notify.at(-1).status, "connecting");
  assert.equal(h.calls.clearCreds, 0);
  // não gera alerta de 'precisa de atenção' (nem é "reconnecting")
  assert.equal(classifySessionAttention({ status: "connecting", error: "" }), null);
  assert.equal(h.events.filter((e) => e.type === "interrupted_limit" || e.type === "intervention_required").length, 0);
  // o controlador registra o reinício como tentativa 'restart' do MESMO ciclo
  h.controller.beginRestart();
  assert.equal(h.controller.state.attempt, 1);
  assert.ok(h.events.some((e) => e.type === "connect_attempt" && e.trigger === "restart"));
});

test("515 em laço (mais de 3 em 1 min sem conectar) para e pede atenção; depois de conectar o contador zera", async () => {
  const h = harness();
  h.controller.beginCycle("manual");
  let last;
  for (let i = 0; i < 4; i += 1) { last = await h.drop(515); if (last.action === ACTION.RESTART) h.controller.beginRestart(); }
  assert.equal(last.action, ACTION.INTERVENE);
  assert.equal(last.reason, "restart_loop");
  assert.match(h.calls.notify.at(-1).error, /^needs_attention:restart_loop:/);

  const ok = harness();
  ok.controller.beginCycle("manual");
  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < 3; i += 1) { const d = await ok.drop(515); assert.equal(d.action, ACTION.RESTART); ok.controller.beginRestart(); }
    ok.controller.onOpen(); // conectou: zera
  }
});

test("alerta 'precisa de atenção': motivos novos têm texto próprio, sem código técnico", () => {
  for (const reason of ["repeated_stream_errors", "restart_loop", "no_active_attempt"]) {
    const classification = classifySessionAttention({ status: "error", error: `needs_attention:${reason}: texto` });
    assert.equal(classification.reason, reason);
    const text = describeAttention({ classification, brokerName: "Corretor Teste", at: 1_790_000_000_000 });
    assert.ok(text.includes("Corretor Teste"));
    assert.ok(!/\b(401|403|408|440|500|515)\b/.test(text), "sem código técnico para a gestora");
    assert.ok(!text.includes("não conhece") || reason === "x", "texto específico, não o genérico");
  }
});

// ---------- Mutex por sessão ----------
test("mutex por sessão: operações do MESMO corretor nunca correm juntas; corretores diferentes seguem em paralelo", async () => {
  const mutex = createKeyedMutex();
  const log = [];
  let running = 0;
  let maxRunningSameKey = 0;
  const op = (key, name, ms) => mutex.run(key, async () => {
    running += 1;
    if (key === "u1") maxRunningSameKey = Math.max(maxRunningSameKey, running);
    log.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, ms));
    log.push(`end ${name}`);
    running -= 1;
  });
  await Promise.all([op("u1", "resume", 20), op("u1", "manual", 5), op("u1", "auto", 1)]);
  assert.equal(maxRunningSameKey, 1);
  assert.deepEqual(log, ["start resume", "end resume", "start manual", "end manual", "start auto", "end auto"]);
  assert.equal(mutex.pendingKeys, 0);
  // falha de uma não trava a próxima
  await assert.rejects(mutex.run("u2", async () => { throw new Error("falhou"); }), /falhou/);
  assert.equal(await mutex.run("u2", async () => "ok"), "ok");
  // paralelismo entre chaves diferentes
  let both = 0;
  await Promise.all([mutex.run("a", async () => { both += 1; await new Promise((r) => setTimeout(r, 10)); assert.equal(both, 2); }), mutex.run("b", async () => { both += 1; await new Promise((r) => setTimeout(r, 10)); })]);
});

// ---------- Retomada escalonada ----------
test("retomada: uma sessão por vez, com intervalo e jitter; só 'connected'; não retoma sessão ativa; nunca envia", async () => {
  const sleeps = [];
  const connected = [];
  const records = [];
  const rows = {
    u1: { status: "connected" }, u2: { status: "error" }, u3: { status: "connected" }, u4: { status: "connected" }, u5: null
  };
  let inflight = 0;
  let maxInflight = 0;
  const runner = createResumeRunner({
    listIds: async () => Object.keys(rows),
    readRow: async (id) => rows[id],
    shouldResume: (row) => row?.status === "connected",
    connect: async (id) => { inflight += 1; maxInflight = Math.max(maxInflight, inflight); connected.push(id); await Promise.resolve(); inflight -= 1; },
    isActive: (id) => id === "u3",
    spacingMs: () => 5000 + sleeps.length * 100,
    sleep: async (ms) => { sleeps.push(ms); },
    record: (userId, type, fields) => records.push({ userId, type, ...fields }),
    log: silent
  });
  const result = await runner.run();
  assert.deepEqual(connected, ["u1", "u4"]);
  assert.equal(maxInflight, 1);
  assert.ok(sleeps.length >= 1 && sleeps.every((ms) => ms >= 5000), "intervalo entre sessões");
  assert.ok(records.some((r) => r.userId === "u2" && r.type === "resume_skipped" && r.reason === "status_error"));
  assert.ok(records.some((r) => r.userId === "u3" && r.reason === "already_active"));
  assert.equal(records.at(-1).detail, "resumed_2_of_5");
  assert.equal(result.resumed, 2);
});

test("retomada: single-flight (duas chamadas = uma execução) e aborta ao perder o lease/encerrar", async () => {
  let calls = 0;
  let abort = false;
  const connected = [];
  const runner = createResumeRunner({
    listIds: async () => { calls += 1; return ["a", "b", "c"]; },
    readRow: async () => ({ status: "connected" }),
    shouldResume: () => true,
    connect: async (id) => { connected.push(id); abort = true; }, // perde o lease depois da 1ª
    shouldAbort: () => abort,
    spacingMs: () => 1,
    sleep: async () => {},
    log: silent
  });
  const [r1, r2] = [runner.run(), runner.run()];
  assert.equal(r1, r2, "mesma promessa: nunca duas retomadas simultâneas");
  const result = await r1;
  assert.equal(calls, 1);
  assert.deepEqual(connected, ["a"]);
  assert.equal(result.aborted, true);
});

test("retomada: espera de assentamento — curta na passagem limpa, maior quando não há dono anterior conhecido", () => {
  assert.equal(resumeSettleMs({ mode: "leased", previousReleased: true }), 3000);
  assert.equal(resumeSettleMs({ mode: "leased", previousReleased: false }), 20_000);
  assert.equal(resumeSettleMs({ mode: "unleased" }), 0);
  assert.equal(resumeSettleMs({ mode: "leased", override: 0 }), 0);
});

// ---------- Reconciliação ----------
test("reconciliação: 'reconnecting' preso sem tentativa ativa há > N min vira 'error' (needs_attention); com tentativa real, nunca", async () => {
  const now = 1_790_000_000_000;
  const old = new Date(now - 15 * 60_000).toISOString();
  const fresh = new Date(now - 2 * 60_000).toISOString();
  const rows = [
    { user_id: "stuck", status: "reconnecting", updated_at: old },
    { user_id: "stuck-connecting", status: "connecting", updated_at: old },
    { user_id: "recent", status: "reconnecting", updated_at: fresh },
    { user_id: "active", status: "reconnecting", updated_at: old },
    { user_id: "ok", status: "connected", updated_at: old },
    { user_id: "nodate", status: "reconnecting", updated_at: null }
  ];
  const plan = planReconcile({ rows, isActive: (id) => id === "active", now, staleMs: 10 * 60_000 });
  assert.deepEqual(plan.map((p) => p.userId).sort(), ["stuck", "stuck-connecting"]);

  const notified = [];
  const records = [];
  const reconciler = createReconciler({
    listTransientRows: async () => rows,
    isActive: (id) => id === "active",
    notifyStatus: async (id, payload) => { notified.push({ id, ...payload }); },
    record: (userId, type, fields) => records.push({ userId, type, ...fields }),
    now: () => now,
    log: silent
  });
  const result = await reconciler.runOnce();
  assert.equal(result.reconciled, 2);
  assert.ok(notified.every((n) => n.status === "error" && n.error.startsWith("needs_attention:no_active_attempt:")));
  assert.ok(records.every((r) => r.type === "session_reconciled" && r.reason === "no_active_attempt"));
  // sem o lease não reconcilia (outra instância pode ter a tentativa em memória)
  const blocked = createReconciler({ listTransientRows: async () => rows, isActive: () => false, notifyStatus: async () => { throw new Error("não deveria"); }, canRun: () => false, now: () => now, log: silent });
  assert.equal((await blocked.runOnce()).skipped, true);
});

// ---------- Encerramento gracioso ----------
test("SIGTERM: para de aceitar, fecha sockets sem logout, grava credenciais, LIBERA o lease depois, flush; SIGTERM duplo ignorado", async () => {
  const order = [];
  const exits = [];
  const shutdown = createShutdown({
    stopAccepting: async () => { order.push("stop_accepting"); },
    closeSockets: async () => { order.push("close_sockets"); },
    flushCredentials: async () => { order.push("flush_credentials"); },
    releaseLease: async () => { order.push("release_lease"); },
    flushTelemetry: async () => { order.push("flush_telemetry"); },
    record: (signal) => order.push(`record_${signal}`),
    exit: (code) => exits.push(code),
    log: silent
  });
  const first = shutdown("SIGTERM");
  const second = shutdown("SIGTERM");
  assert.equal(first, second);
  await first;
  assert.deepEqual(order, ["record_SIGTERM", "stop_accepting", "close_sockets", "flush_credentials", "release_lease", "flush_telemetry"]);
  assert.deepEqual(exits, [0], "sai uma única vez");
});

test("SIGTERM: um passo que falha/trava não impede os seguintes (o lease sempre é liberado)", async () => {
  const order = [];
  const shutdown = createShutdown({
    closeSockets: async () => { throw new Error("socket quebrou"); },
    flushCredentials: () => new Promise(() => {}), // trava para sempre
    releaseLease: async () => { order.push("release_lease"); },
    flushTelemetry: async () => { order.push("flush_telemetry"); },
    exit: () => order.push("exit"),
    log: silent,
    stepTimeoutMs: 30, releaseTimeoutMs: 30
  });
  await shutdown("SIGINT");
  assert.deepEqual(order, ["release_lease", "flush_telemetry", "exit"]);
});

test("runtime: lease -> assentamento -> retomada -> reconciliação; perda do lease suspende; shutdown libera depois de fechar", async () => {
  const clock = { t: 1_000_000 };
  const store = makeLeaseStore(clock);
  const order = [];
  const timers = [];
  const exits = [];
  let runtime;
  const lease = createLeaseManager({
    api: apiFor(store, "RT"), now: () => clock.t, random: () => 0.5, sleep: async (ms) => { clock.t += ms; },
    setTimer: (fn) => { const t = { fn, unref() {} }; timers.push(t); return t; }, clearTimer: () => {},
    record: (type, f) => order.push(`tel:${type}:${f.reason || ""}`), log: silent,
    onLost: (r) => runtime.onLost(r), onRegained: (i) => runtime.onRegained(i)
  });
  const resumeRunner = { run: async () => { order.push("resume"); return { resumed: 1 }; } };
  const reconciler = { start: () => order.push("reconcile_start"), stop: () => order.push("reconcile_stop"), runOnce: async () => order.push("reconcile_once") };
  runtime = createServiceRuntime({
    lease, resumeRunner, reconciler,
    suspendAllSessions: async ({ shutdown }) => { order.push(`suspend_${shutdown ? "shutdown" : "lost"}`); },
    flushPendingWrites: async () => { order.push("flush_creds"); },
    flushTelemetry: async () => { order.push("flush_tel"); },
    record: (_u, type, f) => order.push(`tel:${type}:${f.reason || ""}`),
    sleep: async (ms) => { order.push(`settle_${ms}`); },
    exit: (code) => exits.push(code), log: silent
  });
  assert.equal(runtime.guard(), "waiting_lease", "antes do lease nenhuma conexão");
  assert.equal(runtime.health().ok, true, "health sempre 200, mesmo esperando o lease");
  await runtime.boot();
  assert.equal(runtime.guard(), null);
  assert.deepEqual(order.filter((o) => !o.startsWith("tel:")), ["settle_20000", "resume", "reconcile_start", "reconcile_once"]);
  assert.equal(runtime.health().lease, "leased");

  order.length = 0;
  await runtime.shutdown("SIGTERM");
  assert.deepEqual(order.filter((o) => !o.startsWith("tel:service")), ["reconcile_stop", "suspend_shutdown", "flush_creds", "tel:lease_released:shutdown", "flush_tel"]);
  assert.equal(store.holderNow(), null, "lease liberado no SIGTERM");
  assert.equal(runtime.guard(), "shutting_down");
  assert.deepEqual(exits, [0]);
});

test("runtime: sem o lease (aguardando) nada é retomado nem conectado; ao perder o lease as sessões são suspensas sem logout", async () => {
  const clock = { t: 1_000_000 };
  const store = makeLeaseStore(clock);
  store.acquire({ bootId: "OUTRO", deployId: "dep-old", ttlSeconds: 60 }); // outro dono ativo
  let runtime;
  const suspended = [];
  let resumed = 0;
  let openGate;
  const gate = new Promise((resolve) => { openGate = () => { store.release({ bootId: "OUTRO" }); resolve(); }; });
  const lease = createLeaseManager({
    api: apiFor(store, "NOVO"), now: () => clock.t, random: () => 0.5,
    sleep: async (ms) => { clock.t += ms; await gate; },
    setTimer: () => ({ unref() {} }), clearTimer: () => {}, log: silent,
    onLost: (r) => runtime.onLost(r), onRegained: (i) => runtime.onRegained(i)
  });
  runtime = createServiceRuntime({
    lease,
    resumeRunner: { run: async () => { resumed += 1; assert.equal(lease.isHolder(), true, "só retoma com o lease"); } },
    reconciler: { start() {}, stop() {}, runOnce: async () => {} },
    suspendAllSessions: async (opts) => { suspended.push(opts); },
    sleep: async () => {}, exit: () => {}, log: silent
  });
  const booting = runtime.boot();
  await new Promise((r) => setImmediate(r));
  assert.equal(runtime.guard(), "waiting_lease");
  assert.equal(resumed, 0);
  openGate(); // o dono antigo recebe SIGTERM e libera
  await booting;
  assert.equal(resumed, 1, "retomou depois de assumir");
  await runtime.onLost("taken_by_other");
  assert.deepEqual(suspended, [{ shutdown: false }]);
});

// ---------- Telemetria e segurança ----------
test("telemetria: eventos novos (lease/reconciliação) são aceitos no servidor, sem credenciais, mensagens ou telefones", async () => {
  const sent = [];
  const t = createTelemetry({ send: async (batch) => { sent.push(...batch); }, env: { SESSION_ENCRYPTION_KEY: "segredo-nao-pode-vazar" }, baileysVersion: "6.7.24", bootId: "boot-9" });
  t.record(null, "lease_waiting", { reason: "holder_active", delayMs: 6000, detail: "holder_dep-1", creds: "SEGREDO" });
  t.record(null, "lease_acquired", { reason: "handoff_released", delayMs: 7000 });
  t.record(USER, "session_reconciled", { reason: "no_active_attempt", detail: "from_reconnecting", text: "mensagem do cliente" });
  await t.flush();
  assert.equal(sent.length, 3);
  assert.ok(!JSON.stringify(sent).match(/SEGREDO|segredo-nao-pode-vazar|mensagem do cliente/));
  for (const event of sent) {
    const row = sanitizeTelemetryEvent(event, Date.now());
    assert.ok(row, `servidor deve aceitar ${event.type}`);
    assert.ok(!("creds" in row) && !("text" in row));
  }
  // evento de lease sem corretor é aceito; session_reconciled SEM corretor não
  assert.ok(sanitizeTelemetryEvent({ type: "lease_lost", bootId: "b", occurredAt: new Date().toISOString() }));
  assert.equal(sanitizeTelemetryEvent({ type: "session_reconciled", bootId: "b" }), null);
});

test("segurança do código novo: nenhum módulo novo envia mensagem, pareia, faz logout ou apaga credencial; suspensão/encerramento não chamam logout", () => {
  for (const file of ["lease.js", "shutdown.js", "resume.js", "reconcile.js", "runtime.js", "session-mutex.js", "session-lifecycle.js"]) {
    const source = src(file);
    assert.ok(!/sendMessage|requestPairingCode|makeWASocket|\.logout\(/.test(source), `${file}: sem envio/pareamento/logout`);
  }
  for (const file of ["lease.js", "shutdown.js", "resume.js", "reconcile.js", "runtime.js"]) {
    assert.ok(!/clearSessionCreds/.test(src(file)), `${file}: nunca apaga credencial`);
  }
  const sessions = src("sessions.js");
  const suspend = sessions.slice(sessions.indexOf("export async function suspendAllSessions"), sessions.indexOf("export async function disconnectSession"));
  assert.ok(suspend.length > 200 && !/logout|clearSessionCreds|notifyStatus/.test(suspend), "suspender/encerrar não faz logout, não apaga credencial e não grava estado");
  // mutex e guarda do lease realmente ligados no caminho de conexão
  assert.match(sessions, /sessionLocks\.run\(userId, \(\) => connectSessionLocked/);
  assert.match(sessions, /connectGuard\(options\.trigger/);
  assert.match(sessions, /syncFullHistory: HISTORY_SYNC_ENABLED/);
});

test("Railway: railway.json válido com watchPatterns e drainingSeconds; nomes de aparelho/versão do WhatsApp NÃO foram alterados", () => {
  const config = JSON.parse(readFileSync(new URL("../whatsapp-individual-service/railway.json", import.meta.url), "utf8"));
  assert.deepEqual(config.build.watchPatterns, ["/whatsapp-individual-service/**"]);
  assert.equal(config.deploy.drainingSeconds, 30);
  assert.equal(config.deploy.healthcheckPath, "/health");
  const sessions = src("sessions.js");
  assert.match(sessions, /\["CRM Imoveis", "Chrome", "1\.0"\]/);
  assert.match(sessions, /Browsers\.macOS\("Chrome"\)/);
  assert.match(sessions, /fetchLatestBaileysVersion\(\)/);
});
