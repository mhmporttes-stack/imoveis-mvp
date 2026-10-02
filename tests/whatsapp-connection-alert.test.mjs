import test from "node:test";
import assert from "node:assert/strict";
import {
  CONNECTION_ACTION, DISCONNECT_COOLDOWN_MS, buildConnectionDelivery, decideConnectionAlert, disconnectDedupeKey, resolveResponsibleManager
} from "../lib/whatsapp-connection-alert-core.mjs";
import { onlyOwnRows, splitPendingAlerts } from "../lib/crm-alerts-core.mjs";

const users = [
  { id: "G", role: "admin", status: "active", manager_id: null },
  { id: "M1", role: "manager", status: "active", manager_id: null },
  { id: "M2", role: "manager", status: "active", manager_id: null },
  { id: "A", name: "Ana Souza", role: "broker", status: "active", manager_id: "M1" },
  { id: "C", name: "Caio Lima", role: "broker", status: "active", manager_id: "M2" },
  { id: "AS", name: "Assoc", role: "associate", status: "active", manager_id: null, linked_broker_id: "A" },
  { id: "SOLO", name: "Sem Gestora", role: "broker", status: "active", manager_id: null },
  { id: "OFF", name: "Gestora Inativa", role: "manager", status: "inactive", manager_id: null },
  { id: "B2", name: "Do Inativo", role: "broker", status: "active", manager_id: "OFF" }
];
const definition = {
  id: "def1", enabled: true, title: "WhatsApp desconectado", body_template: "O WhatsApp de {corretor} foi desconectado.",
  trigger: { reconnected_title: "WhatsApp reconectado", reconnected_body_template: "O WhatsApp de {corretor} foi conectado novamente." }
};
const T0 = "2026-10-02T12:00:00.000Z";
const now = new Date("2026-10-02T15:00:00.000Z").getTime();

// Simula o fluxo do servidor (applyIndividualSessionStatus + notifyWhatsappConnectionChange) com banco em memória.
function makeSim() {
  const session = new Map(); // userId -> { status, last_connected_at }
  const deliveries = []; // { recipient_id, dedupe_key, title, body, created_at }
  let clock = now;
  function apply(userId, status) {
    const prev = session.get(userId) || null;
    const next = { status, last_connected_at: status === "connected" ? new Date(clock).toISOString() : prev?.last_connected_at || null };
    session.set(userId, next);
    if (!prev || prev.status === status) return;
    if (status !== "disconnected" && status !== "connected") return;
    const managerId = resolveResponsibleManager(users, userId);
    if (!managerId) return;
    const recent = deliveries.filter((d) => d.recipient_id === managerId && d.dedupe_key.startsWith(`wa_disc:${userId}:`)).sort((a, b) => b.created_at - a.created_at)[0];
    const emitted = prev.last_connected_at ? deliveries.some((d) => d.recipient_id === managerId && d.dedupe_key === disconnectDedupeKey(userId, prev.last_connected_at)) : false;
    const decision = decideConnectionAlert({ userId, prev, nextStatus: status, now: clock, recentDisconnectAt: recent ? new Date(recent.created_at).toISOString() : null, disconnectEmitted: emitted });
    if (!decision) return;
    const row = buildConnectionDelivery({ definition, action: decision.action, managerId, brokerId: userId, brokerName: users.find((u) => u.id === userId).name, dedupeKey: decision.dedupeKey });
    if (deliveries.some((d) => d.recipient_id === row.recipient_id && d.dedupe_key === row.dedupe_key)) return; // UNIQUE
    deliveries.push({ ...row, created_at: clock });
  }
  return { apply, deliveries, session, advance: (ms) => { clock += ms; } };
}
const connectFirst = (sim, userId) => { sim.session.set(userId, { status: "connected", last_connected_at: T0 }); };

test("responsável: manager_id do corretor; associado herda a gestora do corretor; sem gestora = ninguém", () => {
  assert.equal(resolveResponsibleManager(users, "A"), "M1");
  assert.equal(resolveResponsibleManager(users, "C"), "M2");
  assert.equal(resolveResponsibleManager(users, "AS"), "M1");
  assert.equal(resolveResponsibleManager(users, "SOLO"), null);
  assert.equal(resolveResponsibleManager(users, "B2"), null, "gestora inativa não recebe");
  assert.equal(resolveResponsibleManager(users, "M1"), null);
  assert.equal(resolveResponsibleManager(users, "G"), null);
});

test("conectado -> desconectado: um alerta informativo SÓ para a gestora do corretor, com o texto combinado", () => {
  const sim = makeSim();
  connectFirst(sim, "A");
  sim.apply("A", "disconnected");
  assert.equal(sim.deliveries.length, 1);
  const [d] = sim.deliveries;
  assert.equal(d.recipient_id, "M1");
  assert.equal(d.kind, "informative");
  assert.equal(d.title, "WhatsApp desconectado");
  assert.equal(d.body, "O WhatsApp de Ana Souza foi desconectado.");
});

test("sem alerta novo enquanto continua desconectado (repetição do mesmo estado)", () => {
  const sim = makeSim();
  connectFirst(sim, "A");
  sim.apply("A", "disconnected");
  sim.apply("A", "disconnected");
  sim.apply("A", "disconnected");
  assert.equal(sim.deliveries.length, 1);
});

test("'reconnecting' não conta como desconexão: laço reconnecting/403 não gera alerta nenhum", () => {
  const sim = makeSim();
  connectFirst(sim, "A");
  for (let i = 0; i < 50; i += 1) { sim.advance(10_000); sim.apply("A", "reconnecting"); }
  assert.equal(sim.deliveries.length, 0);
});

test("connected -> reconnecting -> connected (queda transitória): nenhum alerta, nem de reconexão", () => {
  const sim = makeSim();
  connectFirst(sim, "A");
  sim.apply("A", "reconnecting");
  sim.advance(30_000);
  sim.apply("A", "connected");
  assert.equal(sim.deliveries.length, 0);
});

test("connected -> reconnecting (laço) -> disconnected: alerta uma única vez; laço seguinte não repete", () => {
  const sim = makeSim();
  connectFirst(sim, "A");
  sim.apply("A", "reconnecting");
  sim.apply("A", "disconnected");
  sim.apply("A", "reconnecting");
  sim.apply("A", "reconnecting");
  sim.apply("A", "disconnected");
  assert.equal(sim.deliveries.length, 1);
});

test("reconectou: alerta 'WhatsApp reconectado' só porque o de desconexão do episódio foi emitido", () => {
  const sim = makeSim();
  connectFirst(sim, "A");
  sim.apply("A", "disconnected");
  sim.advance(60_000);
  sim.apply("A", "qr_required"); // estados intermediários não geram nada
  sim.apply("A", "connected");
  assert.equal(sim.deliveries.length, 2);
  assert.equal(sim.deliveries[1].title, "WhatsApp reconectado");
  assert.equal(sim.deliveries[1].body, "O WhatsApp de Ana Souza foi conectado novamente.");
  assert.equal(sim.deliveries[1].recipient_id, "M1");
  sim.apply("A", "connected");
  assert.equal(sim.deliveries.length, 2, "connected repetido não duplica");
});

test("flapping: oscilação rápida respeita o intervalo mínimo e nunca vira rajada", () => {
  const sim = makeSim();
  connectFirst(sim, "A");
  sim.apply("A", "disconnected");
  for (let i = 0; i < 6; i += 1) { sim.advance(60_000); sim.apply("A", "connected"); sim.advance(30_000); sim.apply("A", "disconnected"); }
  const disconnects = sim.deliveries.filter((d) => d.title === "WhatsApp desconectado");
  assert.equal(disconnects.length, 1, "dentro do cooldown só o 1º aviso de desconexão sai");
  // reconexão só é avisada para o episódio cuja desconexão foi avisada
  assert.ok(sim.deliveries.filter((d) => d.title === "WhatsApp reconectado").length <= 1);
  // passado o cooldown, uma queda nova (episódio novo) volta a avisar
  sim.advance(DISCONNECT_COOLDOWN_MS + 60_000);
  sim.apply("A", "connected");
  sim.advance(DISCONNECT_COOLDOWN_MS + 60_000);
  sim.apply("A", "disconnected");
  assert.equal(sim.deliveries.filter((d) => d.title === "WhatsApp desconectado").length, 2);
});

test("sessão que nunca conectou ou já estava desconectada: sem alerta", () => {
  const sim = makeSim();
  sim.apply("A", "disconnected"); // sem linha anterior
  sim.apply("A", "disconnected");
  sim.session.set("A", { status: "disconnected", last_connected_at: T0 });
  sim.apply("A", "disconnected");
  assert.equal(sim.deliveries.length, 0);
});

test("corretor sem gestora: ninguém é alertado (nem admin, nem o próprio)", () => {
  const sim = makeSim();
  connectFirst(sim, "SOLO");
  sim.apply("SOLO", "disconnected");
  assert.equal(sim.deliveries.length, 0);
});

test("privacidade: o alerta é privado da gestora da equipe (outra gestora, admin e corretor não recebem)", () => {
  const sim = makeSim();
  connectFirst(sim, "A");
  connectFirst(sim, "C");
  sim.apply("A", "disconnected");
  const rowsFor = (viewer) => splitPendingAlerts(onlyOwnRows(sim.deliveries.filter((d) => d.recipient_id === viewer).map((d, i) => ({ id: `x${i}`, ...d, created_at: new Date(d.created_at).toISOString(), acknowledged_at: null, shown_at: null })), viewer), now);
  assert.equal(rowsFor("M1").informative.length, 1);
  for (const other of ["M2", "G", "A", "C", "AS"]) assert.equal(rowsFor(other).informative.length, 0, `${other} não pode receber`);
  // consulta que esqueceu o filtro: a defesa em profundidade ainda barra
  assert.equal(onlyOwnRows(sim.deliveries, "M2").length, 0);
});

test("episódios diferentes têm chaves de deduplicação diferentes; mesmo episódio, mesma chave", () => {
  assert.equal(disconnectDedupeKey("A", T0), disconnectDedupeKey("A", new Date(T0)));
  assert.notEqual(disconnectDedupeKey("A", T0), disconnectDedupeKey("A", "2026-10-02T13:00:00.000Z"));
  assert.notEqual(disconnectDedupeKey("A", T0), disconnectDedupeKey("C", T0));
});

test("definição desligada ou campos faltando: nenhuma entrega montada", () => {
  const base = { action: CONNECTION_ACTION.DISCONNECTED, managerId: "M1", brokerId: "A", brokerName: "Ana", dedupeKey: "k" };
  assert.equal(buildConnectionDelivery({ ...base, definition: { ...definition, enabled: false } }), null);
  assert.equal(buildConnectionDelivery({ ...base, definition, managerId: "" }), null);
  assert.equal(buildConnectionDelivery({ ...base, definition, action: "x" }), null);
  assert.equal(buildConnectionDelivery({ ...base, definition }).kind, "informative");
});
