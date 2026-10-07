import test from "node:test";
import assert from "node:assert/strict";
import { composeGroupedReplyAlertSpeech, groupReplyAlertsByBroker, findUnansweredStreaks, isReplyAlertHour, normalizeReplyAlertSettings } from "../lib/alexa-reply-alert-core.mjs";

const at = (m) => new Date(Date.UTC(2026, 9, 2, 14, 0) + m * 60000).toISOString(); // 14:00Z = 11:00 BRT
const now = (m) => new Date(at(m));
const inbound = (m, c = "c1") => ({ conversation_id: c, direction: "inbound", sender_type: "customer", status: "received", message_at: at(m) });
const reply = (m, c = "c1", extra = {}) => ({ conversation_id: c, direction: "outbound", sender_type: "user", status: "sent", message_at: at(m), ...extra });

test("10 minutos sem resposta dispara; antes disso não", () => {
  assert.equal(findUnansweredStreaks([inbound(0)], now(9)).length, 0);
  const due = findUnansweredStreaks([inbound(0)], now(10));
  assert.equal(due.length, 1);
  assert.equal(due[0].waitingMinutes, 10);
});

test("nova mensagem do cliente não reinicia o contador (vale a primeira sem resposta)", () => {
  const due = findUnansweredStreaks([inbound(0), inbound(8)], now(10));
  assert.equal(due[0].streakStartedAt, at(0));
});

test("só resposta humana enviada encerra; automação, falha e interno não", () => {
  assert.equal(findUnansweredStreaks([inbound(0), reply(5)], now(12)).length, 0);
  assert.equal(findUnansweredStreaks([inbound(0), reply(5, "c1", { sender_type: "automation" })], now(12)).length, 1);
  assert.equal(findUnansweredStreaks([inbound(0), reply(5, "c1", { status: "failed" })], now(12)).length, 1);
  assert.equal(findUnansweredStreaks([inbound(0), reply(5, "c1", { direction: "internal" })], now(12)).length, 1);
});

test("depois da resposta, nova mensagem do cliente abre nova espera", () => {
  const due = findUnansweredStreaks([inbound(0), reply(2), inbound(20)], now(31));
  assert.equal(due.length, 1);
  assert.equal(due[0].streakStartedAt, at(20));
});

test("fila antiga (mais de 60 min) não é falada", () => {
  assert.equal(findUnansweredStreaks([inbound(0)], now(61)).length, 0);
});

test("frase do alerta: 1 cliente fala o nome; 2 ou mais só a quantidade", () => {
  // a Alexa fala com o dono, em terceira pessoa, sobre o corretor
  assert.equal(
    composeGroupedReplyAlertSpeech({ brokerName: "Bruna Souza", brokerGender: "female", count: 1, clientName: "Fanny" }),
    "Atenção. A Bruna está com o cliente Fanny aguardando resposta há mais de 10 minutos."
  );
  assert.equal(composeGroupedReplyAlertSpeech({ brokerName: "Kathleen", brokerGender: "female", count: 2, clientName: "João" }), "Atenção. A Kathleen está com 2 clientes aguardando resposta há mais de 10 minutos.");
  assert.equal(composeGroupedReplyAlertSpeech({ brokerName: "Eduardo Lima", brokerGender: "male", count: 4 }), "Atenção. O Eduardo está com 4 clientes aguardando resposta há mais de 10 minutos.");
  assert.equal(composeGroupedReplyAlertSpeech({ brokerName: "Alex", count: 3 }), "Atenção. Alex está com 3 clientes aguardando resposta há mais de 10 minutos.");
  assert.match(composeGroupedReplyAlertSpeech({ brokerName: "Edu", brokerGender: "male", count: 1, clientName: "5511999998888" }), /^Atenção\. O Edu está com um cliente aguardando/);
  assert.equal(composeGroupedReplyAlertSpeech({ brokerName: "", count: 3 }), "Atenção. Há 3 clientes sem responsável aguardando resposta há mais de 10 minutos.");
});

test("agrupa por corretor: um grupo por responsável, cliente repetido não duplica a espera", () => {
  // 3 clientes da Carol (c1 mandou 2 mensagens = 1 espera só), 1 do Eduardo
  const msgs = [inbound(0, "c1"), inbound(3, "c1"), inbound(1, "c2"), inbound(2, "c3"), inbound(2, "c4")];
  const owner = { c1: "carol", c2: "carol", c3: "carol", c4: "edu" };
  const waiting = findUnansweredStreaks(msgs, now(12)).map((item) => ({ ...item, brokerId: owner[item.conversationId] }));
  assert.equal(waiting.length, 4);
  const groups = groupReplyAlertsByBroker(waiting);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => [g.brokerId, g.items.length]).sort(), [["carol", 3], ["edu", 1]]);
  // quem já respondeu sai da contagem
  const answered = findUnansweredStreaks([...msgs, reply(5, "c2")], now(12)).map((item) => ({ ...item, brokerId: owner[item.conversationId] }));
  assert.equal(groupReplyAlertsByBroker(answered).find((g) => g.brokerId === "carol").items.length, 2);
});

test("configuração: valores válidos valem, inválidos voltam ao padrão atual", () => {
  assert.deepEqual(normalizeReplyAlertSettings(null), { startHour: 7, endHour: 20, maxAgeMinutes: 60 });
  assert.deepEqual(normalizeReplyAlertSettings({ start_hour: 8, end_hour: 18, max_age_minutes: 120 }), { startHour: 8, endHour: 18, maxAgeMinutes: 120 });
  assert.deepEqual(normalizeReplyAlertSettings({ start_hour: 20, end_hour: 8, max_age_minutes: 5 }), { startHour: 7, endHour: 20, maxAgeMinutes: 60 });
  assert.equal(isReplyAlertHour(now(0), { startHour: 12, endHour: 18 }), false); // 11h fora de 12–18
  assert.equal(findUnansweredStreaks([inbound(0)], now(61), { maxAgeMinutes: 120 }).length, 1);
});

test("só em horário comercial de São Paulo", () => {
  assert.equal(isReplyAlertHour(now(0)), true); // 11h
  assert.equal(isReplyAlertHour(new Date("2026-10-02T02:00:00Z")), false); // 23h
});
