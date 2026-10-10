import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateBrokerDelivery, evaluateBrokerTrends, buildTrendAlertEmail, buildNoTickAlertEmail,
  deliveryAlertKey, deliveryTrendKey, deliveryStreakKey, runDeliveryMonitor
} from "../lib/daily-goal-delivery-monitor-core.mjs";

// Tendência do monitor de entrega (dono, 2026-10-10): só alerta, nunca pausa.
// Terça 06/10/2026 08:00 (SP); o dia avaliado é segunda 05/10.
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.parse("2026-10-06T08:00:00-03:00");
const connected = { status: "connected", lastDisconnectAtMs: null };

// n mensagens em `date` das 09:00 em diante (a cada 5 min), as `delivered` MAIS ANTIGAS com confirmação.
function rowsFor(date, n, delivered, brokerId = "b1") {
  return Array.from({ length: n }, (_, i) => ({
    broker_id: brokerId, source: "meta", status: "sent",
    sent_at: new Date(Date.parse(`${date}T09:00:00-03:00`) + i * 5 * MIN).toISOString(),
    delivered_at: i < delivered ? new Date(Date.parse(`${date}T12:30:00-03:00`)).toISOString() : null
  }));
}
const histDays = ["2026-10-03", "2026-10-02", "2026-10-01", "2026-09-30"];
const histRows = (delivered = 19, n = 20, days = histDays) => days.flatMap((d) => rowsFor(d, n, delivered));
const groupsOf = (rows) => evaluateBrokerDelivery({ rows, nowMs: NOW, session: connected }).groups;
const trends = (rows, history, session = connected) => evaluateBrokerTrends({ groups: groupsOf(rows), history, rows, nowMs: NOW, session });

test("queda de mais de 20 pontos vs. a média dos 7 dias anteriores do próprio corretor alerta (mesmo acima de 60%)", () => {
  const rows = rowsFor("2026-10-05", 25, 17); // 68%
  const alerts = trends(rows, histRows());
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, "trend");
  assert.equal(alerts[0].baselinePercent, 95);
  assert.equal(alerts[0].percent, 68);
  assert.equal(alerts[0].drop, 27);
  assert.equal(alerts[0].baselineDays, 4);
});

test("sem alerta de tendência: queda de até 20 pontos, média insuficiente, amostra pequena ou já abaixo de 60%", () => {
  assert.deepEqual(trends(rowsFor("2026-10-05", 25, 19), histRows()), [], "76% vs 95% = 19 pontos");
  const exact = rowsFor("2026-10-05", 20, 15); // 75% vs 95% = exatamente 20 (não é "mais de 20")
  assert.deepEqual(trends(exact, histRows()).filter((a) => a.type === "trend"), []);
  const drop = rowsFor("2026-10-05", 25, 17);
  assert.deepEqual(trends(drop, histRows(19, 20, histDays.slice(0, 2))), [], "só 2 dias: não existe média");
  assert.deepEqual(trends(drop, histRows(9, 9)), [], "dias anteriores com menos de 10 mensagens não contam");
  const small = rowsFor("2026-10-05", 10, 1);
  assert.deepEqual(trends(small, histRows()).filter((a) => a.type === "trend"), [], "amostra do dia menor que 20");
  const low = rowsFor("2026-10-05", 25, 10); // 40%: o limite fixo já alerta
  assert.equal(groupsOf(low)[0].belowThreshold, true);
  assert.deepEqual(trends(low, histRows()).filter((a) => a.type === "trend"), []);
});

test("a média ignora domingo e dias fora dos 7 anteriores; sessão desconectada não é avaliada", () => {
  const rows = rowsFor("2026-10-05", 25, 17);
  const noisy = [...histRows(), ...rowsFor("2026-10-04", 30, 0), ...rowsFor("2026-09-20", 30, 0)];
  assert.equal(trends(rows, noisy)[0].baselinePercent, 95, "domingo (0%) e dia antigo (0%) não entram");
  assert.deepEqual(trends(rows, histRows(), { status: "disconnected" }), []);
});

test("as 10 últimas mensagens seguidas sem nenhum tique alertam; um tique entre as 10 mais recentes desfaz", () => {
  const rows = rowsFor("2026-10-05", 25, 15); // as 10 mais novas sem tique; taxa do dia = 60% (não abaixo do limite)
  assert.deepEqual(trends(rows, []), [{ type: "streak", date: "2026-10-05", count: 10 }]);
  const mixed = rows.map((r, i) => (i === 20 ? { ...r, delivered_at: new Date(Date.parse("2026-10-05T12:40:00-03:00")).toISOString() } : r));
  assert.deepEqual(trends(mixed, []), []);
  assert.deepEqual(trends(rowsFor("2026-10-05", 9, 0), []), [], "menos de 10 mensagens: sem sequência");
});

test("e-mails: dizem quem, quanto caiu, que NADA foi pausado e como pausar; sem telefone; chaves distintas", () => {
  const trend = buildTrendAlertEmail({ recipientName: "Caroline", brokerName: "Bruna Santos", date: "2026-10-05", percent: 68, baselinePercent: 95, baselineDays: 4, drop: 27, evaluated: 25, delivered: 17 });
  for (const part of ["Caroline", "Bruna Santos", "05/10/2026", "68%", "95%", "27 pontos", "4 dias", "NADA foi pausado automaticamente", '"Pausar"']) assert.ok(trend.text.includes(part), `sem: ${part}`);
  const none = buildNoTickAlertEmail({ brokerName: "Bruna Santos", date: "2026-10-05", count: 10 });
  for (const part of ["10 mensagens", "SEM nenhum tique", "NADA foi pausado automaticamente", '"Retomar"']) assert.ok(none.text.includes(part), `sem: ${part}`);
  assert.doesNotMatch(trend.text + none.text, /\d{10,}/);
  assert.notEqual(deliveryTrendKey("2026-10-05", "b1"), deliveryStreakKey("2026-10-05", "b1"));
  assert.notEqual(deliveryTrendKey("2026-10-05", "b1"), deliveryAlertKey("2026-10-05", "b1"));
});

function makeDeps(rows, history) {
  const calls = { emails: [], claims: new Set(), released: [] };
  const deps = {
    loadConfig: async () => null, loadState: async () => null, saveState: async () => {},
    loadBrokers: async () => [{ id: "b1", name: "Bruna Santos", managerId: "m1" }],
    loadSessions: async () => new Map([["b1", connected]]),
    loadQueueRows: async () => rows,
    loadHistoryRows: history,
    loadRecipients: async () => [{ email: "gestora@example.test", name: "Caroline" }],
    claimAlert: async (key) => { if (calls.claims.has(key)) return false; calls.claims.add(key); return true; },
    releaseAlert: async (key) => { calls.claims.delete(key); calls.released.push(key); },
    sendEmail: async (mail) => { calls.emails.push(mail); return { sent: true }; }
  };
  return { deps, calls };
}

test("orquestração: queda vira e-mail (1 por corretor/dia, idempotente) e não pausa nada", async () => {
  const rows = rowsFor("2026-10-05", 25, 17);
  const { deps, calls } = makeDeps(rows, async () => histRows().map((r) => ({ ...r, broker_id: "b1" })));
  const first = await runDeliveryMonitor({ nowMs: NOW, deps });
  assert.deepEqual(first.alerts, [], "68% está acima do limite fixo");
  assert.deepEqual(first.trendAlerts, [{ brokerId: "b1", type: "trend", date: "2026-10-05" }]);
  assert.equal(calls.emails.length, 1);
  assert.match(calls.emails[0].text, /NADA foi pausado automaticamente/);
  await runDeliveryMonitor({ nowMs: NOW + 2 * HOUR, deps, force: true });
  assert.equal(calls.emails.length, 1, "não repete no mesmo dia");
});

test("orquestração: sequência sem tique vira e-mail; sem a função de histórico nada de tendência muda", async () => {
  const rows = rowsFor("2026-10-05", 25, 15);
  const withHistory = makeDeps(rows, async () => []);
  const result = await runDeliveryMonitor({ nowMs: NOW, deps: withHistory.deps });
  assert.deepEqual(result.trendAlerts, [{ brokerId: "b1", type: "streak", date: "2026-10-05" }]);
  const legacy = makeDeps(rows, undefined);
  const old = await runDeliveryMonitor({ nowMs: NOW, deps: legacy.deps });
  assert.deepEqual(old.trendAlerts, []);
  assert.equal(legacy.calls.emails.length, 0);
});

test("falha ao ler o histórico não derruba o alerta do limite fixo e fica registrada", async () => {
  const { deps } = makeDeps(rowsFor("2026-10-05", 25, 5), async () => { throw new Error("banco indisponível"); });
  const result = await runDeliveryMonitor({ nowMs: NOW, deps });
  assert.equal(result.alerts.length, 1);
  assert.match(result.historyError, /banco indisponível/);
});
