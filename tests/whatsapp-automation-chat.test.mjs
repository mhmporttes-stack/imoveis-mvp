import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIndividualAutomationMessageRow, DAILY_GOAL_AUTO_CHAT_KIND } from "../lib/whatsapp-automation-chat-core.mjs";

// Incidente 2026-10-17 ("o povo não sabe o que foi mandado"): a mensagem enviada pela automação da Meta Diária / fila
// "Disparar" pelo WhatsApp pessoal do corretor não aparecia no Chat — o corretor via só a resposta do cliente.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bodyOf = (source, signature) => {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `não achou ${signature}`);
  const next = source.indexOf("\nasync function ", start + 10);
  const nextExport = source.indexOf("\nexport ", start + 10);
  const ends = [next, nextExport].filter((value) => value > 0);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
};

test("linha do Chat é de AUTOMAÇÃO, no número que enviou, com o id do WhatsApp para o dedupe", () => {
  const row = buildIndividualAutomationMessageRow({
    conversationId: "c1", userId: "u1", sessionSlot: 2, text: "  Oi, Ana!  ", waMessageId: "3EB0ABC", remoteJid: "5511@s.whatsapp.net",
    sentAt: "2026-10-17T12:00:00.000Z", metadata: { kind: DAILY_GOAL_AUTO_CHAT_KIND, daily_goal_queue_id: "q1" }
  });
  assert.equal(row.sender_type, "automation");
  assert.equal(row.direction, "outbound");
  assert.equal(row.channel, "whatsapp_individual");
  assert.equal(row.session_user_id, "u1");
  assert.equal(row.session_slot, 2);
  assert.equal(row.body, "Oi, Ana!");
  assert.equal(row.status, "sent");
  assert.equal(row.message_at, "2026-10-17T12:00:00.000Z");
  assert.equal(row.metadata.wa_message_id, "3EB0ABC");
  assert.equal(row.metadata.remote_jid, "5511@s.whatsapp.net");
  assert.equal(row.metadata.kind, DAILY_GOAL_AUTO_CHAT_KIND);
  assert.equal(row.sender_user_id, undefined, "automação nunca tem autor humano");
});

test("sem id do WhatsApp, texto, conversa ou corretor não grava (sem dedupe o eco duplicaria)", () => {
  const base = { conversationId: "c1", userId: "u1", text: "Oi", waMessageId: "X" };
  assert.equal(buildIndividualAutomationMessageRow({ ...base, waMessageId: "" }), null);
  assert.equal(buildIndividualAutomationMessageRow({ ...base, text: "   " }), null);
  assert.equal(buildIndividualAutomationMessageRow({ ...base, conversationId: "" }), null);
  assert.equal(buildIndividualAutomationMessageRow({ ...base, userId: "" }), null);
  assert.equal(buildIndividualAutomationMessageRow({ ...base, sessionSlot: 7 }).session_slot, 1);
});

test("processClaimedItem grava a mensagem enviada no Chat nos dois desfechos (registrada ou não)", () => {
  const body = bodyOf(read("lib/daily-goal-auto.js"), "async function processClaimedItem");
  const sendAt = body.indexOf("sendIndividualMessage(");
  const calls = [...body.matchAll(/recordSentMessageInChat\(/g)].map((match) => match.index);
  assert.equal(calls.length, 2);
  for (const index of calls) assert.ok(index > sendAt, "só depois do envio");
});

test("gravação no Chat nunca vira contato humano nem reenvio", () => {
  const source = read("lib/whatsapp-individual-inbound.js");
  const body = bodyOf(source, "export async function recordIndividualAutomationMessage") + bodyOf(source, "async function insertAutomationRow");
  assert.doesNotMatch(body, /registerHumanContact|sendIndividualMessage|endLiveFlowSession|assigned_user_id/);
  assert.match(body, /p_mark_in_service: false/);
  const recorder = bodyOf(read("lib/daily-goal-auto.js"), "async function recordSentMessageInChat");
  assert.doesNotMatch(recorder, /markItem|sendIndividualMessage/);
});

test("eco da automação no celular entra como AUTOMAÇÃO, nunca como mensagem do corretor", () => {
  const body = bodyOf(read("lib/whatsapp-individual-inbound.js"), "async function recordBrokerAppMessage");
  const echoAt = body.indexOf("isAutomationEchoForBroker(");
  const humanInsertAt = body.indexOf('sender_type: "user"');
  assert.ok(echoAt > 0 && humanInsertAt > echoAt, "o eco é tratado antes da gravação como mensagem do corretor");
  const echoBlock = body.slice(echoAt, humanInsertAt);
  assert.match(echoBlock, /buildIndividualAutomationMessageRow/);
  assert.match(echoBlock, /insertAutomationRow\(/);
  assert.doesNotMatch(echoBlock, /registerHumanContact/);
});

test("recibo de mensagem que está no Chat continua confirmando a fila da automação (monitor de entrega, MD-15)", () => {
  const body = bodyOf(read("lib/whatsapp-individual-inbound.js"), "export async function projectIndividualMessageStatus");
  const foundAt = body.indexOf("if (data?.id)");
  const returnAt = body.indexOf("return { messageId: data.id", foundAt);
  assert.ok(foundAt > 0 && returnAt > foundAt);
  assert.match(body.slice(foundAt, returnAt), /markAutoQueueReceipt\(/);
});
