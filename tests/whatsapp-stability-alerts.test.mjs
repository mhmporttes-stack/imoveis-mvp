import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DISCONNECT_COOLDOWN_MS, SELF_ALERT_LINK, buildBrokerSelfDelivery, decideBrokerSelfAlert, selfDisconnectDedupeKey, selfKeyPrefix
} from "../lib/whatsapp-connection-alert-core.mjs";
import {
  STALL_THRESHOLD_MS, buildServiceStallDeliveries, decideServiceStall, resolveServiceStallRecipients
} from "../lib/whatsapp-service-stall-core.mjs";
import { alertSubjectKey } from "../lib/whatsapp-session-slots.mjs";
import { isNotificationAllowed } from "../lib/notification-policy-core.mjs";
import { onlyOwnRows } from "../lib/crm-alerts-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const T0 = "2026-10-10T12:00:00.000Z";
const now = new Date("2026-10-10T15:00:00.000Z").getTime();
const up = { status: "connected", last_connected_at: T0 };

test("alerta direto: conexão que caiu de verdade (401 / parou de reconectar) avisa o corretor; reconnecting nunca", () => {
  const dropped = decideBrokerSelfAlert({ userId: "A", prev: up, nextStatus: "disconnected", error: "logged_out", now });
  assert.equal(dropped.dedupeKey, selfDisconnectDedupeKey("A", T0));
  assert.ok(dropped.dedupeKey.startsWith(selfKeyPrefix("A")));
  const stopped = decideBrokerSelfAlert({ userId: "A", prev: up, nextStatus: "error", error: "needs_attention:repeated_drops: texto", now });
  assert.equal(stopped.dedupeKey, dropped.dedupeKey, "mesmo episódio = mesma chave (1 alerta por episódio)");
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: up, nextStatus: "reconnecting", error: "x", now }), null);
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: up, nextStatus: "connecting", now }), null);
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: up, nextStatus: "connected", now }), null);
});

test("alerta direto: desconexão pedida pelo próprio corretor (sem motivo) e 'error' sem selo não alertam", () => {
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: up, nextStatus: "disconnected", error: "", now }), null);
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: up, nextStatus: "disconnected", now }), null);
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: up, nextStatus: "error", error: "falha qualquer", now }), null);
});

test("alerta direto: reconnecting -> queda real conta (episódio); já fora do ar, nunca conectado e episódio velho não", () => {
  const fromReconnecting = decideBrokerSelfAlert({ userId: "A", prev: { status: "reconnecting", last_connected_at: T0 }, nextStatus: "error", error: "needs_attention:retry_limit: x", now });
  assert.ok(fromReconnecting);
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: { status: "error", last_connected_at: T0 }, nextStatus: "disconnected", error: "logged_out", now }), null);
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: { status: "qr_required", last_connected_at: T0 }, nextStatus: "disconnected", error: "logged_out", now }), null);
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: { status: "connecting", last_connected_at: null }, nextStatus: "disconnected", error: "logged_out", now }), null);
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: null, nextStatus: "disconnected", error: "logged_out", now }), null);
  const old = { status: "reconnecting", last_connected_at: "2026-10-08T12:00:00.000Z" };
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: old, nextStatus: "error", error: "needs_attention:retry_limit: x", now }), null);
});

test("alerta direto: intervalo mínimo de 10 min entre alertas do mesmo número", () => {
  const recent = new Date(now - DISCONNECT_COOLDOWN_MS + 60_000).toISOString();
  const old = new Date(now - DISCONNECT_COOLDOWN_MS - 60_000).toISOString();
  assert.equal(decideBrokerSelfAlert({ userId: "A", prev: up, nextStatus: "disconnected", error: "logged_out", now, recentAt: recent }), null);
  assert.ok(decideBrokerSelfAlert({ userId: "A", prev: up, nextStatus: "disconnected", error: "logged_out", now, recentAt: old }));
});

test("alerta direto: por número — Número 2 usa chave própria e nome '(Número 2)' no texto", () => {
  const key2 = alertSubjectKey("A", 2);
  const d1 = decideBrokerSelfAlert({ userId: "A", prev: up, nextStatus: "disconnected", error: "logged_out", now });
  const d2 = decideBrokerSelfAlert({ userId: key2, prev: up, nextStatus: "disconnected", error: "logged_out", now });
  assert.notEqual(d1.dedupeKey, d2.dedupeKey);
  assert.ok(!d2.dedupeKey.startsWith(selfKeyPrefix("A")), "o prefixo do Número 1 não encerra o alerta do Número 2");
  const delivery = buildBrokerSelfDelivery({ brokerId: "A", slot: 2, dedupeKey: d2.dedupeKey, episode: d2.episode });
  assert.match(delivery.body, /WhatsApp \(Número 2\) saiu do ar/);
  assert.match(buildBrokerSelfDelivery({ brokerId: "A", slot: 1, dedupeKey: d1.dedupeKey }).body, /Seu WhatsApp saiu do ar/);
});

test("alerta direto: destinatário explícito = só o dono; Importante; chamada para reconectar; push declarado; AL-PRIV", () => {
  const delivery = buildBrokerSelfDelivery({ brokerId: "A", slot: 1, dedupeKey: "k", episode: T0 });
  assert.equal(delivery.recipient_id, "A");
  assert.equal(delivery.kind, "important");
  assert.match(delivery.body, /conecte de novo/);
  assert.equal(delivery.context.link, SELF_ALERT_LINK);
  assert.equal(delivery.context.push_kind, "whatsapp_connection");
  assert.deepEqual(onlyOwnRows([delivery, { ...delivery, recipient_id: "M1" }], "A").map((r) => r.recipient_id), ["A"]);
  assert.equal(buildBrokerSelfDelivery({ definition: { enabled: false }, brokerId: "A", dedupeKey: "k" }), null, "definição desligada pelo dono");
  assert.ok(buildBrokerSelfDelivery({ definition: null, brokerId: "A", dedupeKey: "k" }), "sem definição (migration pendente) usa o padrão");
  assert.equal(buildBrokerSelfDelivery({ brokerId: "", dedupeKey: "k" }), null);
});

test("push do alerta direto: só o tipo whatsapp_connection passa pela política; os demais alertas continuam bloqueados", () => {
  assert.equal(isNotificationAllowed("whatsapp_connection"), true);
  const alerts = read("lib/crm-alerts.js");
  assert.ok(alerts.includes("row.context?.push_kind === NOTIFICATION_KIND.WHATSAPP_CONNECTION"));
  const wiring = read("lib/whatsapp-individual.js");
  assert.ok(wiring.includes("notifyBrokerOwnConnection(userId, prevRow, { status, error, slot: sessionSlot })"));
  const detection = read("lib/whatsapp-connection-alert.js");
  assert.ok(!/sendPushToUser/.test(detection), "a detecção só cria a entrega; o push sai do ponto único createAlertDeliveries");
});

test("serviço parado: lease sem renovar além do limite alerta; dentro do limite ou sem lease não", () => {
  const fresh = new Date(now - 60_000).toISOString();
  assert.equal(decideServiceStall({ lease: { heartbeat_at: fresh }, now }).stalled, false);
  assert.equal(decideServiceStall({ lease: null, now }).stalled, false);
  assert.equal(decideServiceStall({ lease: { heartbeat_at: null }, now }).stalled, false);
  const edge = new Date(now - STALL_THRESHOLD_MS).toISOString();
  assert.equal(decideServiceStall({ lease: { heartbeat_at: edge }, now }).stalled, false);
  const stale = new Date(now - 12 * 60_000).toISOString();
  const decision = decideServiceStall({ lease: { heartbeat_at: stale }, now });
  assert.equal(decision.stalled, true);
  assert.equal(decision.minutes, 12);
  assert.equal(decision.dedupeKey, `wa_svc_stalled:${stale}`, "1 alerta por episódio (último heartbeat)");
  // Mesmo travamento visto em outra execução do cron = mesma chave.
  assert.equal(decideServiceStall({ lease: { heartbeat_at: stale }, now: now + 600_000 }).dedupeKey, decision.dedupeKey);
  // Serviço voltou e travou de novo = episódio novo.
  const later = new Date(now + 3_600_000).toISOString();
  assert.notEqual(decideServiceStall({ lease: { heartbeat_at: later }, now: now + 4_200_000 }).dedupeKey, decision.dedupeKey);
});

test("serviço parado: só administradores gerais ativos recebem; gestora/corretor/inativo não", () => {
  const users = [
    { id: "G", role: "admin", status: "active" },
    { id: "G2", role: "admin", status: "active" },
    { id: "GOFF", role: "admin", status: "inactive" },
    { id: "GDIS", role: "admin", status: "active", disabled_at: "2026-10-01T00:00:00Z" },
    { id: "M", role: "manager", status: "active" },
    { id: "B", role: "broker", status: "active" }
  ];
  assert.deepEqual(resolveServiceStallRecipients(users), ["G", "G2"]);
  const decision = decideServiceStall({ lease: { heartbeat_at: new Date(now - 9 * 60_000).toISOString() }, now });
  const deliveries = buildServiceStallDeliveries({ recipientIds: ["G", "G2"], decision });
  assert.equal(deliveries.length, 2);
  assert.ok(deliveries.every((d) => d.kind === "important" && d.dedupe_key === decision.dedupeKey && /9 minutos/.test(d.body)));
  assert.deepEqual(buildServiceStallDeliveries({ definition: { enabled: false }, recipientIds: ["G"], decision }), []);
  assert.deepEqual(buildServiceStallDeliveries({ recipientIds: ["G"], decision: { stalled: false } }), []);
});

test("serviço parado: roda no cron existente whatsapp-flows (sem cron novo) e nunca lança", () => {
  const route = read("app/api/cron/whatsapp-flows/route.js");
  assert.ok(route.includes("checkWhatsappServiceStalled()"));
  const lib = read("lib/whatsapp-service-stall.js");
  assert.ok(/catch \(err\)/.test(lib));
  assert.ok(!/\.(insert|update|delete|upsert)\(/.test(lib.replace(/resolveAlertDeliveriesByPrefix/g, "")), "somente leitura do lease");
});
