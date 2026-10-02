import test from "node:test";
import assert from "node:assert/strict";
import { composeReplyAlertSpeech, findUnansweredStreaks, isReplyAlertHour } from "../lib/alexa-reply-alert-core.mjs";

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

test("frase do alerta", () => {
  assert.equal(
    composeReplyAlertSpeech({ brokerName: "Carol Alves", brokerGender: "female", clientName: "João Silva", waitingMinutes: 10 }),
    "Atenção, corretora Carol. O cliente João Silva está aguardando uma resposta há 10 minutos."
  );
  assert.match(composeReplyAlertSpeech({ brokerName: "Edu", brokerGender: "male", clientName: "", waitingMinutes: 10 }), /^Atenção, corretor Edu\. Um cliente está/);
  assert.match(composeReplyAlertSpeech({ brokerName: "", clientName: "5511999998888", waitingMinutes: 11 }), /^Atenção\. Um cliente está aguardando uma resposta há 11 minutos\.$/);
});

test("só em horário comercial de São Paulo", () => {
  assert.equal(isReplyAlertHour(now(0)), true); // 11h
  assert.equal(isReplyAlertHour(new Date("2026-10-02T02:00:00Z")), false); // 23h
});
