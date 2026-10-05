import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTION, DEFAULT_CONFIG, KIND, classifyDisconnect, computeBackoffDelay, configFromEnv,
  createReconnectController, resumeSpacingMs, shouldResumeSession
} from "../whatsapp-individual-service/src/reconnect-policy.js";
import { createCloseHandler, NEEDS_ATTENTION_PREFIX } from "../whatsapp-individual-service/src/session-lifecycle.js";
import { createTelemetry } from "../whatsapp-individual-service/src/telemetry.js";
import { sanitizeTelemetryBatch, sanitizeTelemetryEvent } from "../lib/whatsapp-session-telemetry-core.mjs";

// Política de reconexão, ciclo de tentativas, telemetria e retomada no boot do
// WhatsApp individual. Tudo com dependências falsas: sem Baileys, sem rede, sem
// banco e SEM enviar mensagem. Códigos conforme DisconnectReason do Baileys 6.7.24.

const USER = "11111111-2222-3333-4444-555555555555";

function harness({ random = () => 0.5, unpaired = false, config = DEFAULT_CONFIG } = {}) {
  let nowMs = 1_790_000_000_000;
  const timers = [];
  const events = [];
  const calls = { notify: [], clearCreds: 0, retired: [], retries: [] };
  const controller = createReconnectController({
    config, random, now: () => nowMs, newId: (() => { let n = 0; return () => `cycle-${++n}`; })(),
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
    record: (type, fields) => events.push({ type, ...fields })
  });
  const entry = { sock: null, status: "connecting", qr: null, pairingCode: null, pairingMode: false, pairingError: null };
  const handleClose = createCloseHandler({
    userId: USER, entry, controller,
    notifyStatus: async (_id, payload) => { calls.notify.push(payload); },
    clearSessionCreds: async () => { calls.clearCreds += 1; },
    retireSocket: async (sock) => { calls.retired.push(sock); },
    scheduleRetry: (info) => { calls.retries.push(info); }
  });
  const makeSock = () => ({ authState: { creds: { registered: !unpaired } } });
  // Um ciclo de queda: abre o socket (entry.sock) e fecha com o código.
  const drop = async (statusCode) => {
    const sock = makeSock();
    entry.sock = sock;
    return handleClose({ sock, statusCode, errorMessage: "queda de teste", payload: { statusCode } });
  };
  return { controller, entry, handleClose, drop, events, calls, timers, advance: (ms) => { nowMs += ms; }, makeSock };
}

test("classificação dos códigos (Baileys 6.7.24)", () => {
  const kinds = (code) => classifyDisconnect(code).kind;
  assert.equal(kinds(401), KIND.LOGOUT);
  for (const code of [408, 428, 500, 503, 502]) assert.equal(kinds(code), KIND.TRANSIENT, `código ${code}`);
  assert.equal(kinds(515), KIND.RESTART);
  for (const code of [403, 440, 411, 405, 402]) assert.equal(kinds(code), KIND.INTERVENTION, `código ${code}`);
  assert.equal(classifyDisconnect(403).reason, "forbidden");
  assert.equal(classifyDisconnect(440).reason, "connection_replaced");
  assert.equal(kinds(undefined), KIND.TRANSIENT);
  assert.equal(kinds(null), KIND.TRANSIENT);
  assert.equal(kinds("403"), KIND.INTERVENTION);
});

test("401 (logout) não reconecta: apaga credenciais, status desconectado, sem tentativa agendada", async () => {
  const h = harness();
  h.controller.beginCycle("manual");
  const decision = await h.drop(401);
  assert.equal(decision.action, ACTION.LOGOUT);
  assert.equal(h.calls.retries.length, 0);
  assert.equal(h.calls.clearCreds, 1);
  assert.equal(h.entry.status, "disconnected");
  assert.equal(h.calls.notify.at(-1).status, "disconnected");
  assert.equal(h.calls.notify.at(-1).error, "logged_out");
  assert.equal(h.calls.retired.length, 1);
});

for (const [code, reason] of [[403, "forbidden"], [440, "connection_replaced"]]) {
  test(`${code} não entra em laço: nenhuma reconexão, socket encerrado, estado de intervenção, credenciais preservadas`, async () => {
    const h = harness();
    h.controller.beginCycle("manual");
    const decision = await h.drop(code);
    assert.equal(decision.action, ACTION.INTERVENE);
    assert.equal(h.calls.retries.length, 0, "não pode agendar reconexão");
    assert.equal(h.calls.clearCreds, 0, "intervenção não apaga a sessão");
    assert.equal(h.entry.sock, null);
    assert.equal(h.calls.retired.length, 1, "socket precisa ser encerrado (end + removeAllListeners em sessions.js)");
    assert.equal(h.entry.status, "error");
    const last = h.calls.notify.at(-1);
    assert.equal(last.status, "error");
    assert.equal(last.statusCode, code);
    assert.ok(last.error.startsWith(`${NEEDS_ATTENTION_PREFIX}${reason}:`), last.error);
    assert.ok(last.error.length <= 300);
    assert.ok(h.events.some((e) => e.type === "intervention_required" && e.statusCode === code));
    assert.ok(h.events.some((e) => e.type === "cycle_end" && e.reason === "intervention"));
  });
}

test("conexão manual depois da intervenção abre um ciclo novo e zera o contador", async () => {
  const h = harness();
  h.controller.beginCycle("manual");
  await h.drop(403);
  assert.equal(h.controller.state.active, false);
  const { attempt, cycleId } = h.controller.beginCycle("manual");
  assert.equal(attempt, 1);
  assert.equal(cycleId, "cycle-2");
});

test("erro transitório: backoff crescente com teto (jitter neutro)", async () => {
  const h = harness({ random: () => 0.5 });
  h.controller.beginCycle("manual");
  const delays = [];
  for (let i = 0; i < DEFAULT_CONFIG.maxRetries; i += 1) {
    const decision = await h.drop(408);
    assert.equal(decision.action, ACTION.RETRY, `queda ${i + 1}`);
    delays.push(decision.delayMs);
    h.controller.beginRetry();
  }
  assert.deepEqual(delays, [4000, 8000, 16000, 32000, 64000, 120000]);
  assert.equal(h.calls.retries.length, DEFAULT_CONFIG.maxRetries);
  assert.ok(delays.every((d, i) => i === 0 || d >= delays[i - 1]));
  assert.ok(Math.max(...delays) <= DEFAULT_CONFIG.maxDelayMs);
  assert.equal(h.entry.status, "reconnecting");
});

test("jitter fica dentro de ±25% e nunca passa do teto", () => {
  assert.equal(computeBackoffDelay(1, DEFAULT_CONFIG, () => 0), 3000);
  assert.equal(computeBackoffDelay(1, DEFAULT_CONFIG, () => 1), 5000);
  assert.equal(computeBackoffDelay(10, DEFAULT_CONFIG, () => 1), DEFAULT_CONFIG.maxDelayMs);
  for (let i = 1; i <= 12; i += 1) {
    const d = computeBackoffDelay(i, DEFAULT_CONFIG, Math.random);
    assert.ok(d >= 1000 && d <= DEFAULT_CONFIG.maxDelayMs);
  }
});

test("limite de tentativas: para, registra 'interrupção por limite' e deixa estado de intervenção", async () => {
  const h = harness();
  h.controller.beginCycle("manual");
  let last;
  for (let i = 0; i < DEFAULT_CONFIG.maxRetries + 1; i += 1) {
    last = await h.drop(408);
    if (last.action === ACTION.RETRY) h.controller.beginRetry();
  }
  assert.equal(last.action, ACTION.GIVE_UP);
  assert.equal(h.calls.retries.length, DEFAULT_CONFIG.maxRetries, "exatamente maxRetries reconexões, nunca mais");
  assert.equal(h.entry.status, "error");
  assert.ok(h.calls.notify.at(-1).error.startsWith(`${NEEDS_ATTENTION_PREFIX}retry_limit:`));
  assert.equal(h.events.filter((e) => e.type === "interrupted_limit").length, 1);
  assert.ok(h.events.some((e) => e.type === "cycle_end" && e.reason === "limit"));
  assert.equal(h.events.filter((e) => e.type === "connect_attempt").length, DEFAULT_CONFIG.maxRetries + 1);
  // Nenhuma queda adicional agenda coisa alguma depois do limite.
  assert.equal(h.controller.state.active, false);
});

test("515 (restart após parear) é reinício NORMAL: rápido, sem consumir tentativa, sem erro", async () => {
  const h = harness();
  h.controller.beginCycle("manual");
  const decision = await h.drop(515);
  assert.equal(decision.action, ACTION.RESTART);
  assert.equal(decision.delayMs, DEFAULT_CONFIG.restartDelayMs);
  assert.equal(h.entry.pairingMode, false);
  assert.equal(h.entry.status, "connecting");
  assert.equal(h.calls.notify.at(-1).status, "connecting");
  assert.equal(h.calls.notify.at(-1).error, undefined, "515 não grava erro (nada de alerta de atenção)");
  assert.equal(h.controller.state.attempt, 1, "515 não consome tentativa de reconexão");
  assert.equal(h.calls.retries.at(-1).trigger, "restart");
});

test("conexão ESTABILIZADA zera o ciclo; conexão INSTÁVEL (cai antes da janela) NÃO zera", async () => {
  // Instável: abre, cai em 10 s, abre, cai... o contador continua subindo.
  const unstable = harness();
  unstable.controller.beginCycle("manual");
  const first = await unstable.drop(408);
  unstable.controller.beginRetry();
  unstable.controller.onOpen();
  unstable.advance(10_000);
  const second = await unstable.drop(408);
  assert.equal(first.delayMs, 4000);
  assert.equal(second.delayMs, 8000, "um 'open' que cai logo NÃO reinicia o backoff");
  assert.equal(unstable.controller.state.attempt, 2);
  assert.ok(unstable.timers.at(-1).cleared, "timer de estabilidade é cancelado na queda");
  assert.ok(!unstable.events.some((e) => e.type === "cycle_end" && e.reason === "stable"));

  // Estável: passa a janela conectada → ciclo encerrado, contador zerado.
  const stable = harness();
  stable.controller.beginCycle("manual");
  await stable.drop(408);
  stable.controller.beginRetry();
  stable.controller.onOpen();
  const timer = stable.timers.at(-1);
  assert.equal(timer.ms, DEFAULT_CONFIG.stableMs);
  stable.advance(DEFAULT_CONFIG.stableMs);
  timer.fn();
  assert.ok(stable.events.some((e) => e.type === "cycle_end" && e.reason === "stable"));
  assert.equal(stable.controller.state.attempt, 0);
  const afterStable = await stable.drop(408);
  assert.equal(afterStable.delayMs, 4000, "depois de estável o backoff recomeça do início");
  assert.ok(stable.events.some((e) => e.type === "cycle_start" && e.trigger === "drop"));
});

test("sessão ainda não pareada: QR sem escanear NUNCA gera QR sozinho — termina desconectada na hora", async () => {
  const h = harness({ unpaired: true });
  h.controller.beginCycle("manual");
  const sock = h.makeSock();
  h.entry.sock = sock;
  const last = await h.handleClose({ sock, statusCode: 408, errorMessage: "QR refs attempts ended" });
  assert.equal(last.action, ACTION.GIVE_UP_PAIRING);
  assert.equal(last.reason, "qr_expired");
  assert.equal(h.calls.retries.length, 0, "nenhuma reconexão/QR automático");
  assert.equal(h.entry.status, "disconnected");
  assert.equal(h.calls.notify.at(-1).error, "qr_expired");
  assert.equal(h.calls.clearCreds, 0);
});

test("configFromEnv respeita limites seguros", () => {
  assert.equal(configFromEnv({}).maxRetries, DEFAULT_CONFIG.maxRetries);
  assert.equal(configFromEnv({ WHATSAPP_RECONNECT_MAX_RETRIES: "3" }).maxRetries, 3);
  assert.equal(configFromEnv({ WHATSAPP_RECONNECT_MAX_RETRIES: "9999" }).maxRetries, DEFAULT_CONFIG.maxRetries);
  assert.equal(configFromEnv({ WHATSAPP_RECONNECT_STABLE_MS: "5" }).stableMs, DEFAULT_CONFIG.stableMs);
});

test("a telemetria registra CADA tentativa (sem deduplicar) e permite contar tentativas e intervalo", async () => {
  const h = harness();
  h.controller.beginCycle("resume");
  for (let i = 0; i < 4; i += 1) {
    const decision = await h.drop(408);
    if (decision.action === ACTION.RETRY) h.controller.beginRetry();
  }
  const attempts = h.events.filter((e) => e.type === "connect_attempt");
  assert.deepEqual(attempts.map((e) => e.attempt), [1, 2, 3, 4, 5]);
  assert.equal(new Set(attempts.map((e) => e.cycleId)).size, 1, "todas no mesmo ciclo");
  assert.equal(attempts[0].trigger, "resume");
  assert.ok(attempts.slice(1).every((e) => e.trigger === "auto_reconnect"));
  assert.equal(h.events.filter((e) => e.type === "retry_scheduled").length, 4);
  assert.equal(h.events.filter((e) => e.type === "disconnected").length, 4);
});

test("telemetria do serviço: lote, campos fixos, nunca credencial/mensagem/telefone", async () => {
  const sent = [];
  const t = createTelemetry({
    send: async (batch) => { sent.push(...batch); },
    env: { RAILWAY_DEPLOYMENT_ID: "dep-123", RAILWAY_GIT_COMMIT_SHA: "abc123def456", SESSION_ENCRYPTION_KEY: "segredo-nao-pode-vazar" },
    baileysVersion: "6.7.24", bootId: "boot-1", now: () => 1_790_000_000_000
  });
  t.setWaVersion([2, 3000, 1234], true);
  t.record(USER, "connect_attempt", {
    cycleId: "c1", attempt: 3, trigger: "auto_reconnect",
    creds: "SEGREDO", text: "mensagem do cliente", phone: "5514999990001", sessionKey: "k"
  });
  t.record(null, "service_boot", { detail: "baileys_6.7.24" });
  await t.flush();
  assert.equal(sent.length, 2);
  const [attempt, boot] = sent;
  assert.equal(attempt.baileysVersion, "6.7.24");
  assert.equal(attempt.waVersion, "2.3000.1234");
  assert.equal(attempt.waVersionIsLatest, true);
  assert.equal(attempt.deployId, "dep-123");
  assert.equal(attempt.commitSha, "abc123def456");
  assert.equal(attempt.bootId, "boot-1");
  assert.equal(attempt.attempt, 3);
  const flat = JSON.stringify(sent);
  for (const forbidden of ["SEGREDO", "mensagem do cliente", "5514999990001", "segredo-nao-pode-vazar", "creds", "sessionKey"]) {
    assert.ok(!flat.includes(forbidden), `vazou: ${forbidden}`);
  }
  assert.equal(boot.userId, null);
});

test("telemetria: fila limitada e falha de envio nunca lança", async () => {
  const t = createTelemetry({ send: async () => { throw new Error("CRM fora do ar"); }, maxQueue: 5, maxBatch: 1000, bootId: "b", baileysVersion: "x" });
  for (let i = 0; i < 20; i += 1) t.record(USER, "connect_attempt", { attempt: i });
  assert.equal(t.queued, 5);
  await assert.doesNotReject(() => t.flush());
});

test("servidor: sanitiza o lote e recusa evento inválido", () => {
  const now = 1_790_000_000_000;
  const good = { userId: USER, type: "disconnected", bootId: "boot-1", statusCode: 403, reason: "forbidden", occurredAt: new Date(now).toISOString(), baileysVersion: "6.7.24" };
  const { rows, rejected } = sanitizeTelemetryBatch([
    good,
    { ...good, type: "inventado" },
    { ...good, userId: "não-é-uuid" },
    { ...good, userId: null },
    { ...good, bootId: "" },
    "lixo"
  ], now);
  assert.equal(rows.length, 1);
  assert.equal(rejected, 5);
  assert.equal(rows[0].status_code, 403);
  assert.equal(rows[0].user_id, USER);
  // evento do próprio serviço pode não ter corretor
  assert.ok(sanitizeTelemetryEvent({ type: "service_boot", bootId: "b" }, now));
  // texto livre parecido com telefone é descartado; campos fora da lista nem chegam
  const row = sanitizeTelemetryEvent({ ...good, reason: "5514999990001", detail: "ok_1", creds: "x", text: "oi" }, now);
  assert.equal(row.reason, null);
  assert.equal(row.detail, "ok_1");
  assert.ok(!("creds" in row) && !("text" in row));
  // relógio absurdo vira hora do recebimento
  assert.equal(sanitizeTelemetryEvent({ ...good, occurredAt: "2999-01-01" }, now).occurred_at, new Date(now).toISOString());
  assert.equal(sanitizeTelemetryBatch(Array.from({ length: 150 }, () => good), now).rows.length, 100);
});

test("retomada no boot: só reabre sessão que estava 'connected'; bloqueada/logout/QR/reconectando ficam quietas", () => {
  assert.equal(shouldResumeSession({ status: "connected" }), true);
  for (const status of ["reconnecting", "error", "disconnected", "qr_required", "pairing_code_required", "connecting"]) {
    assert.equal(shouldResumeSession({ status }), false, status);
  }
  assert.equal(shouldResumeSession(null), false);
  assert.equal(shouldResumeSession({}), false);
  const spacing = [resumeSpacingMs(() => 0), resumeSpacingMs(() => 0.999)];
  assert.ok(spacing[0] >= 5000 && spacing[1] < 8000 && spacing[1] > spacing[0]);
});

test("nenhum caminho da política/lifecycle envia mensagem nem fala com o WhatsApp", () => {
  for (const file of ["reconnect-policy.js", "session-lifecycle.js", "telemetry.js"]) {
    const source = readFileSync(new URL(`../whatsapp-individual-service/src/${file}`, import.meta.url), "utf8");
    assert.ok(!/sendMessage|\.sendMessage\(|requestPairingCode|makeWASocket|\.logout\(/.test(source), `${file} não pode enviar/parear`);
  }
});
