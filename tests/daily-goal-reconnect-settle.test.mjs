import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyConnections, settleAnchorFor, isQuickReconnectDropCode, needsSettleTelemetry,
  SETTLE_REASON, SETTLE_LOOKBACK_MS, SETTLE_TELEMETRY_MATCH_TOLERANCE_MS
} from "../lib/daily-goal-reconnect-settle-core.mjs";
import { slotsPastReconnectWait, reconnectHoldUntilMs, brokerReconnectReferenceMs, RECONNECT_SETTLE_MINUTES } from "../lib/daily-goal-policy-core.mjs";
import { clearSlotPauses, LOW_DELIVERY_LONG_OUTAGE_MS } from "../lib/daily-goal-protection-core.mjs";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = Date.parse("2026-10-15T09:00:00.000Z"); // 06:00 em São Paulo
const iso = (ms) => new Date(ms).toISOString();
const attempt = (ms, trigger) => ({ type: "connect_attempt", trigger, occurredAt: iso(ms) });
const connected = (ms) => ({ type: "connected", occurredAt: iso(ms) });
const drop = (ms, statusCode) => ({ type: "disconnected", statusCode, occurredAt: iso(ms) });

// Pareamento por QR (Conectar -> 515 -> abriu) e, depois, quedas comuns 500/428 a cada ~50 min com reconexão em 20 s:
// o padrão de 14-15/10 (mediana de ~50 min entre conexões na janela).
function pairingThenQuickDrops(count, code = 500) {
  const events = [attempt(T0 - 2 * MIN, "manual"), drop(T0 - MIN, 515), attempt(T0 - MIN + 1000, "restart"), connected(T0)];
  let last = T0;
  for (let i = 1; i <= count; i += 1) {
    const dropAt = T0 + i * 50 * MIN;
    events.push(drop(dropAt, i % 2 ? code : 428), attempt(dropAt + 15 * 1000, "auto_reconnect"), connected(dropAt + 20 * 1000));
    last = dropAt + 20 * 1000;
  }
  return { events, last };
}

test("códigos de queda comum (reconexão automática) x quedas que exigem cautela", () => {
  for (const code of [null, 408, 428, 500, 503, 515, 599]) assert.equal(isQuickReconnectDropCode(code), true, String(code));
  for (const code of [401, 403, 440, 411, 405]) assert.equal(isQuickReconnectDropCode(code), false, String(code));
});

test("caso de 14-15/10: reconexão rápida a cada 50 min NÃO recomeça a espera; ela conta do pareamento", () => {
  const { events, last } = pairingThenQuickDrops(3);
  const kinds = classifyConnections(events).map((item) => item.reason);
  assert.deepEqual(kinds, [SETTLE_REASON.MANUAL, SETTLE_REASON.QUICK_AUTO, SETTLE_REASON.QUICK_AUTO, SETTLE_REASON.QUICK_AUTO]);
  const anchor = settleAnchorFor({ lastConnectedAt: iso(last), events });
  assert.equal(anchor.anchorMs, T0);
  assert.equal(anchor.reason, SETTLE_REASON.MANUAL);

  const nowMs = T0 + RECONNECT_SETTLE_MINUTES * MIN + 5 * MIN; // 08:05 em São Paulo
  const rawRow = { slot: 1, status: "connected", last_connected_at: iso(T0 + 100 * MIN + 20 * 1000) }; // reconectou às 07:40
  const settleRow = { ...rawRow, settle_anchor_at: iso(T0) };
  assert.deepEqual(slotsPastReconnectWait({ rows: [rawRow], slots: [1], nowMs }), [], "regra antiga: segurava até 09:40");
  assert.deepEqual(slotsPastReconnectWait({ rows: [settleRow], slots: [1], nowMs }), [1], "regra nova: libera 2 h depois do pareamento");
  assert.equal(reconnectHoldUntilMs({ rows: [settleRow], slots: [1], nowMs: T0 + HOUR }), T0 + 2 * HOUR, "antes das 2 h continua segurando");
});

test("número estável sem pareamento recente: só quedas rápidas na janela => nada segura (null)", () => {
  const events = [];
  for (let i = 0; i < 3; i += 1) {
    const dropAt = T0 + i * 50 * MIN;
    events.push(drop(dropAt, 500), attempt(dropAt + 10 * 1000, "auto_reconnect"), connected(dropAt + 30 * 1000));
  }
  const result = settleAnchorFor({ lastConnectedAt: iso(T0 + 100 * MIN + 30 * 1000), events });
  assert.equal(result.anchorMs, null);
  assert.equal(result.reason, SETTLE_REASON.QUICK_AUTO);
  assert.equal(brokerReconnectReferenceMs({ rows: [{ slot: 1, last_connected_at: iso(T0 + 100 * MIN), settle_anchor_at: null }], slots: [1] }), null);
});

test("403 e 401 recomeçam a espera, mesmo com reconexão automática", () => {
  const forbidden = [connected(T0), drop(T0 + HOUR, 403), { type: "intervention_required", statusCode: 403, occurredAt: iso(T0 + HOUR) }, attempt(T0 + HOUR + 5 * MIN, "manual"), connected(T0 + HOUR + 6 * MIN)];
  assert.equal(settleAnchorFor({ lastConnectedAt: iso(T0 + HOUR + 6 * MIN), events: forbidden }).anchorMs, T0 + HOUR + 6 * MIN);
  const logout = [connected(T0), drop(T0 + HOUR, 401), attempt(T0 + HOUR + 2 * MIN, "auto_reconnect"), connected(T0 + HOUR + 3 * MIN)];
  const result = settleAnchorFor({ lastConnectedAt: iso(T0 + HOUR + 3 * MIN), events: logout });
  assert.equal(result.anchorMs, T0 + HOUR + 3 * MIN);
  assert.equal(result.reason, SETTLE_REASON.SERIOUS_DROP);
});

test("queda LONGA (>= 30 min fora) recomeça a espera; 29 min não", () => {
  const long = [connected(T0), drop(T0 + HOUR, 500), attempt(T0 + HOUR + LOW_DELIVERY_LONG_OUTAGE_MS, "auto_reconnect"), connected(T0 + HOUR + LOW_DELIVERY_LONG_OUTAGE_MS)];
  assert.equal(settleAnchorFor({ lastConnectedAt: iso(T0 + HOUR + 30 * MIN), events: long }).reason, SETTLE_REASON.LONG_OUTAGE);
  const short = [connected(T0), drop(T0 + HOUR, 503), connected(T0 + HOUR + 29 * MIN)];
  assert.equal(settleAnchorFor({ lastConnectedAt: iso(T0 + HOUR + 29 * MIN), events: short }).anchorMs, T0, "continua contando da conexão anterior (T0, sem histórico antes dela = na dúvida, segura)");
});

test("reinício do serviço (encerramento + retomada em minutos) não recomeça; queda sem registro recomeça (na dúvida, segura)", () => {
  const restart = [connected(T0), { type: "service_drop", occurredAt: iso(T0 + HOUR) }, attempt(T0 + HOUR + 2 * MIN, "resume"), connected(T0 + HOUR + 2 * MIN)];
  assert.equal(settleAnchorFor({ lastConnectedAt: iso(T0 + HOUR + 2 * MIN), events: restart }).anchorMs, T0, "a retomada não recomeça: vale a conexão anterior");
  // conexão anterior fora da janela lida: a queda do serviço ainda conta para o número
  const restartOnly = [{ type: "service_drop", occurredAt: iso(T0) }, attempt(T0 + MIN, "resume"), connected(T0 + MIN)];
  assert.equal(settleAnchorFor({ lastConnectedAt: iso(T0 + MIN), events: restartOnly }).anchorMs, null);
  const crash = [attempt(T0 + MIN, "resume"), connected(T0 + MIN)];
  const result = settleAnchorFor({ lastConnectedAt: iso(T0 + MIN), events: crash });
  assert.equal(result.anchorMs, T0 + MIN);
  assert.equal(result.reason, SETTLE_REASON.UNKNOWN_DROP);
});

test("telemetria sem a conexão atual (atrasada/ausente) => espera conta da última conexão, como antes", () => {
  const { events, last } = pairingThenQuickDrops(2);
  const lastConnectedAt = iso(last + SETTLE_TELEMETRY_MATCH_TOLERANCE_MS + MIN);
  const result = settleAnchorFor({ lastConnectedAt, events });
  assert.equal(result.reason, SETTLE_REASON.NO_TELEMETRY);
  assert.equal(result.anchorMs, Date.parse(lastConnectedAt));
  assert.equal(settleAnchorFor({ lastConnectedAt: iso(T0), events: [] }).anchorMs, T0, "sem telemetria nenhuma");
  assert.equal(settleAnchorFor({ lastConnectedAt: iso(last + 30 * 1000), events }).anchorMs, T0, "dentro da tolerância: usa a telemetria");
  assert.deepEqual(settleAnchorFor({ lastConnectedAt: null, events: [] }), { anchorMs: null, reason: null }, "nunca conectou: não segura (como antes)");
});

test("retomada manual de pausa recomeça a espera e fica gravada em slot_controls (resumedAt)", () => {
  const paused = { 1: { phone: "x", paused: true, pausedKind: "low_delivery", pausedAt: iso(T0), lowDeliveryAfter: iso(T0) } };
  const resumedIso = iso(T0 + 3 * HOUR);
  const { controls } = clearSlotPauses(paused, { todayDate: "2026-10-15", nowIso: resumedIso });
  assert.equal(controls[1].resumedAt, resumedIso);
  assert.equal(clearSlotPauses(paused, { todayDate: "2026-10-15" }).controls[1].resumedAt, undefined, "sem nowIso nada muda");
  const { events, last } = pairingThenQuickDrops(1);
  const result = settleAnchorFor({ lastConnectedAt: iso(last), events, resumedAt: controls[1].resumedAt });
  assert.equal(result.anchorMs, T0 + 3 * HOUR);
  assert.equal(result.reason, SETTLE_REASON.RESUMED);
});

test("só lê telemetria para conexão que ainda pode estar na espera; janela cobre espera + queda longa", () => {
  assert.equal(needsSettleTelemetry({ lastConnectedAt: iso(T0), nowMs: T0 + HOUR }), true);
  assert.equal(needsSettleTelemetry({ lastConnectedAt: iso(T0), nowMs: T0 + 3 * HOUR }), false);
  assert.equal(needsSettleTelemetry({ lastConnectedAt: null, nowMs: T0 }), false);
  assert.ok(SETTLE_LOOKBACK_MS >= RECONNECT_SETTLE_MINUTES * MIN + LOW_DELIVERY_LONG_OUTAGE_MS);
});

test("linha sem settle_anchor_at continua na regra antiga (last_connected_at)", () => {
  const nowMs = T0 + HOUR;
  assert.deepEqual(slotsPastReconnectWait({ rows: [{ slot: 1, status: "connected", last_connected_at: iso(T0) }], slots: [1], nowMs }), []);
  assert.deepEqual(slotsPastReconnectWait({ rows: [{ slot: 1, status: "connected", last_connected_at: iso(T0), settle_anchor_at: null }], slots: [1], nowMs }), [1]);
});
