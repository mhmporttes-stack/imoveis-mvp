// FUN-15m (REGRA OFICIAL — dono, 2026-10-17): "Segunda chance" — a decisora mantém o cliente com o mesmo corretor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CASE_STATUS,
  COOLED_DEDUPE_PREFIX,
  COOLED_SECOND_CHANCE_DECISION,
  applyCaseAction,
  availableDecisionActions,
  buildSecondChanceAlertDelivery,
  isCooledCandidate,
  isCooledDedupeKey,
  keepFirstPendingCooledAlert
} from "../lib/cooled-clients-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-17T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const broker = { id: "b1", role: "broker", status: "active", manager_id: "m1" };
const client = (patch = {}) => ({ id: "c1", status: "in_service", responsibleUserId: "b1", lastWhatsappContactAt: new Date(NOW - 10 * DAY).toISOString(), createdAt: new Date(NOW - 30 * DAY).toISOString(), latestActivityAt: null, privateContactAt: null, ...patch });
const awaiting = { id: "k1", client_id: "c1", broker_id: "b1", decider_id: "m1", status: CASE_STATUS.AWAITING_DECISION, first_reason: "Esqueci de agendar a próxima atividade" };

test("disponível em todo caso aguardando decisão (antes e depois do Devolver); nunca fora dele", () => {
  assert.ok(availableDecisionActions(awaiting).includes("second_chance"));
  assert.ok(availableDecisionActions({ ...awaiting, returned_at: "t" }).includes("second_chance"));
  assert.deepEqual(availableDecisionActions({ ...awaiting, status: CASE_STATUS.AWAITING_REASON }), []);
  assert.deepEqual(availableDecisionActions({ ...awaiting, status: CASE_STATUS.CLOSED }), []);
});

test("fecha o caso com decision second_chance, quem/quando, sem transferência nem status", () => {
  const patch = applyCaseAction(awaiting, "second_chance", { actorId: "m1", now: "t1" });
  assert.equal(patch.status, CASE_STATUS.CLOSED);
  assert.equal(patch.decision, COOLED_SECOND_CHANCE_DECISION);
  assert.equal(patch.decided_by, "m1");
  assert.equal(patch.decided_at, "t1");
  assert.equal(patch.closed_at, "t1");
  assert.equal(patch.decision_status, null);
  assert.equal(patch.transferred_to, undefined);
  assert.equal(patch.reactivation_status, undefined);
  assert.throws(() => applyCaseAction({ ...awaiting, status: CASE_STATUS.AWAITING_REASON }, "second_chance", { actorId: "m1" }));
});

test("os 3 dias recomeçam a partir da decisão (sem atividade fictícia)", () => {
  assert.equal(isCooledCandidate({ client: client({ secondChanceAt: new Date(NOW - DAY).toISOString() }), responsible: broker, now: NOW }), false);
  assert.equal(isCooledCandidate({ client: client({ secondChanceAt: new Date(NOW - 2.9 * DAY).toISOString() }), responsible: broker, now: NOW }), false);
  assert.equal(isCooledCandidate({ client: client({ secondChanceAt: new Date(NOW - 3.1 * DAY).toISOString() }), responsible: broker, now: NOW }), true);
  assert.equal(isCooledCandidate({ client: client(), responsible: broker, now: NOW }), true);
});

test("aviso ao corretor: Informativo com o texto do dono; não é a janela do motivo", () => {
  const delivery = buildSecondChanceAlertDelivery({ caseRow: awaiting, clientName: "Ana Souza" });
  assert.equal(delivery.recipient_id, "b1");
  assert.equal(delivery.kind, "informative");
  assert.equal(delivery.body, "Segunda chance: Ana Souza continua com você — agende a próxima atividade.");
  assert.ok(!delivery.dedupe_key.startsWith(COOLED_DEDUPE_PREFIX));
  assert.equal(isCooledDedupeKey(delivery.dedupe_key), false);
  // Não entra no filtro "um card por vez" da janela do motivo.
  const rows = [{ id: "x", created_at: "2026-10-17T10:00:00Z", context: delivery.context }];
  assert.equal(keepFirstPendingCooledAlert(rows).length, 1);
  assert.notEqual(delivery.context.type, "cooled_client");
});

test("servidor: sem roleta, sem fila de reativação, sem etiqueta; relógio lido na varredura; histórico filtra", () => {
  const code = read("lib/cooled-clients.js");
  const branch = code.slice(code.indexOf('} else if (action === "second_chance") {'), code.indexOf('} else if (action === "transfer") {'));
  assert.ok(branch.length > 0);
  assert.ok(!/returnClientToRoulette|tagTransferredClient|addSystemTagToClient|reactivation/.test(branch));
  assert.ok(branch.includes("buildSecondChanceAlertDelivery"));
  assert.ok(branch.includes('eventType: "cooled_decision"'));
  assert.ok(code.includes('const reactivation = action === "transfer" && await isCooledReactivationAvailable();'));
  assert.ok(code.includes("secondChanceAt: secondChanceAt.get(client.id) || null"));
  assert.ok(code.includes('query = query.eq("decision", COOLED_SECOND_CHANCE_DECISION)'));
  const migration = read("supabase/migrations/20261017180000_cooled_second_chance.sql");
  assert.ok(migration.includes("'transferred', 'status', 'second_chance'"));
  // Nunca envia nada ao cliente nem cria notificação fora da política (Central de Alertas Informativo não tem push).
  assert.ok(!/sendPushToUser|crm_notifications/.test(branch));
});
