import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DELIVERY_ALERT_THRESHOLD_PERCENT, DELIVERY_MIN_SAMPLE, DELIVERY_MAX_ALERTS_PER_RUN, DELIVERY_EVAL_INTERVAL_MS,
  resolveMonitorConfig, evaluateBrokerDelivery, relevantDates, buildDeliveryAlertEmail, deliveryAlertKey, runDeliveryMonitor
} from "../lib/daily-goal-delivery-monitor-core.mjs";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
// Terça-feira 06/10/2026 em São Paulo; segunda 05/10 (dia útil), domingo 04/10. NOW = 08:00 (as mensagens de segunda
// das 09:00 às 11:00 têm entre 21 e 23 h); NOW14 = 14:00.
const NOW = Date.parse("2026-10-06T08:00:00-03:00");
const NOW14 = Date.parse("2026-10-06T14:00:00-03:00");
const connected = { status: "connected", lastDisconnectAtMs: null };

// n mensagens enviadas em `date` entre 09:00 e 12:00 (SP), `delivered` delas com confirmação.
function rowsFor(date, n, delivered, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    broker_id: "b1", source: "meta", status: "sent",
    sent_at: new Date(Date.parse(`${date}T09:00:00-03:00`) + i * 5 * MIN).toISOString(),
    delivered_at: i < delivered ? new Date(Date.parse(`${date}T12:30:00-03:00`)).toISOString() : null,
    ...extra
  }));
}

test("padrões: limiar 60%, amostra mínima 20, no máximo 5 e-mails por execução, 1 avaliação por hora", () => {
  assert.equal(DELIVERY_ALERT_THRESHOLD_PERCENT, 60);
  assert.equal(DELIVERY_MIN_SAMPLE, 20);
  assert.equal(DELIVERY_MAX_ALERTS_PER_RUN, 5);
  assert.equal(DELIVERY_EVAL_INTERVAL_MS, HOUR);
  assert.deepEqual(resolveMonitorConfig(null), { thresholdPercent: 60, minSample: 20, maxAlertsPerRun: 5 });
  assert.deepEqual(resolveMonitorConfig({ thresholdPercent: 70, minSample: 30, maxAlertsPerRun: 2 }), { thresholdPercent: 70, minSample: 30, maxAlertsPerRun: 2 }, "configurável por crm_settings");
  assert.deepEqual(resolveMonitorConfig({ thresholdPercent: -5, minSample: 0, maxAlertsPerRun: "x" }), { thresholdPercent: 60, minSample: 20, maxAlertsPerRun: 5 }, "valor inválido volta ao padrão");
});

test("taxa de entrega por corretor e por dia: enviadas x com confirmação (1 tique ou mais)", () => {
  const result = evaluateBrokerDelivery({ rows: rowsFor("2026-10-05", 25, 10), nowMs: NOW, session: connected });
  assert.equal(result.groups.length, 1);
  const [group] = result.groups;
  assert.deepEqual({ date: group.date, evaluated: group.evaluated, delivered: group.delivered, percent: group.percent }, { date: "2026-10-05", evaluated: 25, delivered: 10, percent: 40 });
  assert.equal(group.enoughSample, true);
  assert.equal(group.belowThreshold, true);
});

test("limiar: exatamente 60% não alerta; abaixo alerta; limiar configurável", () => {
  assert.equal(evaluateBrokerDelivery({ rows: rowsFor("2026-10-05", 30, 18), nowMs: NOW, session: connected }).groups[0].belowThreshold, false, "60% não é abaixo de 60%");
  assert.equal(evaluateBrokerDelivery({ rows: rowsFor("2026-10-05", 30, 17), nowMs: NOW, session: connected }).groups[0].belowThreshold, true, "56,7%");
  const strict = resolveMonitorConfig({ thresholdPercent: 70 });
  assert.equal(evaluateBrokerDelivery({ rows: rowsFor("2026-10-05", 30, 18), nowMs: NOW, session: connected, config: strict }).groups[0].belowThreshold, true);
});

test("amostra mínima: com menos de 20 mensagens nunca alerta", () => {
  const group = evaluateBrokerDelivery({ rows: rowsFor("2026-10-05", 19, 0), nowMs: NOW, session: connected }).groups[0];
  assert.equal(group.enoughSample, false);
  assert.equal(group.belowThreshold, false);
  assert.equal(evaluateBrokerDelivery({ rows: rowsFor("2026-10-05", 20, 0), nowMs: NOW, session: connected }).groups[0].belowThreshold, true, "20 já vale");
});

test("janela de avaliação: só mensagens de 1 a 24 horas atrás", () => {
  const mk = (iso) => ({ source: "meta", status: "sent", sent_at: new Date(Date.parse(iso)).toISOString(), delivered_at: null });
  const rows = [
    mk("2026-10-06T13:30:00-03:00"), // 30 min atrás: recibo pode estar a caminho
    mk("2026-10-06T12:59:00-03:00"), // 61 min: entra
    mk("2026-10-05T14:10:00-03:00"), // 23h50: entra
    mk("2026-10-05T13:59:00-03:00") //  24h01: fora
  ];
  const groups = evaluateBrokerDelivery({ rows, nowMs: NOW14, session: connected }).groups;
  assert.equal(groups.reduce((sum, g) => sum + g.evaluated, 0), 2);
});

test("ignora domingo, fora do horário de disparo e quem não é Meta Diária/enviada", () => {
  const sunday = rowsFor("2026-10-04", 25, 0);
  assert.deepEqual(evaluateBrokerDelivery({ rows: sunday, nowMs: Date.parse("2026-10-05T10:00:00-03:00"), session: connected }).groups, [], "domingo ignorado");
  const mk = (iso, extra = {}) => ({ source: "meta", status: "sent", sent_at: new Date(Date.parse(iso)).toISOString(), delivered_at: null, ...extra });
  const rows = [
    mk("2026-10-05T06:00:00-03:00"), mk("2026-10-05T16:00:00-03:00"), mk("2026-10-05T06:29:00-03:00"), mk("2026-10-05T15:31:00-03:00"), // fora de 06:30–15:30
    mk("2026-10-05T10:00:00-03:00", { source: "extra" }), // fila extra não é automação da Meta Diária
    mk("2026-10-05T10:05:00-03:00", { status: "error" }),
    mk("2026-10-05T10:10:00-03:00", { status: "canceled" })
  ];
  assert.deepEqual(evaluateBrokerDelivery({ rows, nowMs: NOW, session: connected }).groups, []);
});

test("ignora corretor com a sessão desconectada agora e mensagens enviadas antes da última queda", () => {
  assert.deepEqual(evaluateBrokerDelivery({ rows: rowsFor("2026-10-05", 25, 0), nowMs: NOW, session: { status: "disconnected" } }), { skipped: "sessao_desconectada" });
  assert.deepEqual(evaluateBrokerDelivery({ rows: rowsFor("2026-10-05", 25, 0), nowMs: NOW, session: { status: "reconnecting" } }), { skipped: "sessao_desconectada" });
  assert.deepEqual(evaluateBrokerDelivery({ rows: rowsFor("2026-10-05", 25, 0), nowMs: NOW, session: undefined }), { skipped: "sessao_desconectada" });
  // Caiu hoje às 10:00 e já voltou: só vale o que foi enviado depois da queda.
  const fell = evaluateBrokerDelivery({ rows: rowsFor("2026-10-06", 25, 0).map((r, i) => ({ ...r, sent_at: new Date(Date.parse("2026-10-06T07:00:00-03:00") + i * 2 * MIN).toISOString() })), nowMs: NOW14, session: { status: "connected", lastDisconnectAtMs: Date.parse("2026-10-06T07:30:00-03:00") } });
  assert.equal(fell.groups[0].evaluated, 10, "envios de 07:00–07:28 (15) saem da conta; sobram 07:30–07:48");
});

test("só o dia corrente e o anterior entram", () => {
  assert.deepEqual([...relevantDates(NOW)].sort(), ["2026-10-05", "2026-10-06"]);
});

test("texto do e-mail: quem, qual dia, quantos %, quantas mensagens, aviso de falso alarme, nada pausado e como pausar", () => {
  const email = buildDeliveryAlertEmail({ recipientName: "Caroline", brokerName: "Bruna Santos", date: "2026-10-05", percent: 46.7, evaluated: 30, delivered: 14, thresholdPercent: 60 });
  assert.match(email.subject, /Bruna Santos/);
  assert.match(email.subject, /46,7%/);
  assert.match(email.subject, /05\/10\/2026/);
  for (const part of ["Caroline", "Bruna Santos", "05/10/2026", "46,7%", "30 mensagens", "14 tiveram confirmação", "60%", "celular desligado", "recibos", "NADA foi pausado automaticamente", 'Gestão > Meta Diária > aba Automação', '"Pausar"', '"Retomar"']) {
    assert.ok(email.text.includes(part), `texto sem: ${part}`);
  }
  assert.ok(email.html.includes("Bruna Santos") && !email.html.includes("<script"));
  assert.doesNotMatch(email.text, /\d{10,}/, "sem telefone");
  assert.match(buildDeliveryAlertEmail({ brokerName: "<b>X</b>", date: "2026-10-05", percent: 10, evaluated: 20, delivered: 2, thresholdPercent: 60 }).html, /&lt;b&gt;X&lt;\/b&gt;/, "HTML escapado");
});

// ---- orquestração com tudo injetado (nenhum e-mail real, nenhum banco) ----
function makeDeps(overrides = {}) {
  const calls = { emails: [], claims: new Set(), released: [], saved: null };
  const brokers = overrides.brokers || [{ id: "b1", name: "Bruna Santos", managerId: "m1" }];
  const deps = {
    loadConfig: async () => overrides.config || null,
    loadState: async () => overrides.state || null,
    saveState: async (state) => { calls.saved = state; },
    loadBrokers: async () => brokers,
    loadSessions: async () => new Map(brokers.map((b) => [b.id, overrides.session || connected])),
    loadQueueRows: async () => overrides.rows || brokers.flatMap((b) => rowsFor("2026-10-05", 25, 5).map((r) => ({ ...r, broker_id: b.id }))),
    loadRecipients: async () => (overrides.recipients === undefined ? [{ email: "gestora@example.test", name: "Caroline" }] : overrides.recipients),
    claimAlert: async (key) => { if (calls.claims.has(key)) return false; calls.claims.add(key); return true; },
    releaseAlert: async (key) => { calls.claims.delete(key); calls.released.push(key); },
    sendEmail: overrides.sendEmail || (async (mail) => { calls.emails.push(mail); return { sent: true }; })
  };
  return { deps, calls };
}

test("alerta: 1 e-mail por corretor por dia (idempotente), enviado com a função injetada", async () => {
  const { deps, calls } = makeDeps();
  const first = await runDeliveryMonitor({ nowMs: NOW, deps });
  assert.equal(first.alerts.length, 1);
  assert.equal(calls.emails.length, 1);
  assert.equal(calls.emails[0].to, "gestora@example.test");
  assert.match(calls.emails[0].subject, /Bruna Santos/);
  assert.ok(calls.claims.has(deliveryAlertKey("2026-10-05", "b1")));
  const again = await runDeliveryMonitor({ nowMs: NOW + 2 * HOUR, deps, force: true });
  assert.equal(again.alerts.length, 0, "segunda avaliação no mesmo dia não reenvia");
  assert.equal(calls.emails.length, 1);
  assert.equal(calls.saved.summary.evaluatedBrokers, 1);
});

test("limite por execução: no máximo 5 e-mails, o resto fica para a próxima avaliação", async () => {
  const brokers = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, name: `Corretor ${i}`, managerId: "m1" }));
  const { deps, calls } = makeDeps({ brokers });
  const result = await runDeliveryMonitor({ nowMs: NOW, deps });
  assert.equal(result.alerts.length, 5);
  assert.equal(result.pendingAlerts, 3);
  assert.equal(calls.emails.length, 5);
  assert.equal(calls.claims.size, 5, "os 3 pendentes NÃO foram marcados como alertados");
  const next = await runDeliveryMonitor({ nowMs: NOW + HOUR + MIN, deps, force: true });
  assert.equal(next.alerts.length, 3, "na avaliação seguinte saem os que faltavam");
  assert.equal(calls.emails.length, 8);
});

test("configurável: limite por execução pelo crm_settings", async () => {
  const brokers = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, name: `C${i}`, managerId: "m1" }));
  const { deps, calls } = makeDeps({ brokers, config: { maxAlertsPerRun: 2 } });
  await runDeliveryMonitor({ nowMs: NOW, deps });
  assert.equal(calls.emails.length, 2);
});

test("domingo: nada é avaliado nem enviado", async () => {
  const { deps, calls } = makeDeps();
  const result = await runDeliveryMonitor({ nowMs: Date.parse("2026-10-04T10:00:00-03:00"), deps });
  assert.deepEqual(result, { skipped: "domingo" });
  assert.equal(calls.emails.length, 0);
  assert.equal(calls.saved, null);
});

test("no máximo 1 avaliação por hora", async () => {
  const { deps, calls } = makeDeps({ state: { lastRunMs: NOW - 30 * MIN } });
  assert.deepEqual(await runDeliveryMonitor({ nowMs: NOW, deps }), { skipped: "avaliado_ha_menos_de_1h" });
  assert.equal(calls.emails.length, 0);
  const ok = makeDeps({ state: { lastRunMs: NOW - 61 * MIN } });
  assert.equal((await runDeliveryMonitor({ nowMs: NOW, deps: ok.deps })).alerts.length, 1);
});

test("sessão desconectada: corretor ignorado, nenhum e-mail (ex.: hoje, domingo com sessões caídas)", async () => {
  const { deps, calls } = makeDeps({ session: { status: "disconnected" } });
  const result = await runDeliveryMonitor({ nowMs: NOW, deps });
  assert.equal(result.evaluatedBrokers, 0);
  assert.deepEqual(result.ignored, { b1: "sessao_desconectada" });
  assert.equal(calls.emails.length, 0);
});

test("taxa boa não alerta", async () => {
  const rows = rowsFor("2026-10-05", 25, 22);
  const { deps, calls } = makeDeps({ rows });
  assert.equal((await runDeliveryMonitor({ nowMs: NOW, deps })).alerts.length, 0);
  assert.equal(calls.emails.length, 0);
});

test("falha ao enviar (Resend sem configuração) ou sem gestora: a marca é liberada e o alerta é tentado na próxima avaliação", async () => {
  const noConfig = makeDeps({ sendEmail: async () => ({ skipped: true, reason: "resend_nao_configurado" }) });
  const result = await runDeliveryMonitor({ nowMs: NOW, deps: noConfig.deps });
  assert.equal(result.alerts.length, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /resend_nao_configurado/);
  assert.deepEqual(noConfig.calls.released, [deliveryAlertKey("2026-10-05", "b1")]);
  const noManager = makeDeps({ recipients: [] });
  const r2 = await runDeliveryMonitor({ nowMs: NOW, deps: noManager.deps });
  assert.equal(r2.failed.length, 1);
  assert.match(r2.failed[0].error, /sem destinatário/);
  assert.equal(noManager.calls.claims.size, 0);
});

test("o monitor só lê e avisa: nenhum código dele pausa, desliga ou altera fila/sessão", () => {
  for (const file of ["lib/daily-goal-delivery-monitor-core.mjs", "lib/daily-goal-delivery-monitor.js"]) {
    const code = readFileSync(file, "utf8");
    const withoutComments = code.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    assert.doesNotMatch(withoutComments, /paused|daily_goal_auto_settings"\)\s*\.(update|upsert)|\.update\(/, `${file} não pode pausar nem alterar configuração`);
  }
  const wiring = readFileSync("lib/daily-goal-delivery-monitor.js", "utf8");
  assert.doesNotMatch(wiring, /\.from\("daily_goal_auto_queue"\)\s*\.(update|insert|delete)/);
  assert.match(wiring, /crm_settings/, "estado e marca de alerta em crm_settings (sem migration)");
  const cron = readFileSync("lib/daily-goal-auto.js", "utf8");
  assert.match(cron, /runDeliveryMonitorForCron\(\)/, "roda a partir do cron existente");
  assert.match(cron, /Falha no monitor de taxa de entrega/, "falha do monitor é registrada (não mascarada) e não derruba o envio");
});
