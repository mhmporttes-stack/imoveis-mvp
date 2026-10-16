// Corrida dos recibos (defeito corrigido em 2026-10-16, Mesa WhatsApp dos corretores): o recibo do WhatsApp chegava antes
// de o CRM gravar o wa_message_id do envio automático e se perdia. Checagens de código (sem banco, sem rede).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("envio automático grava o wa_message_id logo depois do envio, ANTES de registrar a tentativa", () => {
  const code = read("lib/daily-goal-auto.js");
  const start = code.indexOf("async function processClaimedItem");
  const body = code.slice(start, code.indexOf("async function handleSendFailure", start));
  const send = body.indexOf("await sendIndividualMessage(");
  const early = body.indexOf("await markItem(item.id, { wa_message_id: sendResult.messageId });");
  const register = body.indexOf("await registerDailyGoalAttemptAutomated(");
  assert.ok(send > 0 && early > send && register > early, "envio -> grava o id -> registra a tentativa");
});

test("recibo casa só pelo wa_message_id e espera um envio em andamento iniciado ANTES dele (send_started_at, não sent_at)", () => {
  const code = read("lib/whatsapp-individual-inbound.js");
  const start = code.indexOf("async function hasAutoSendInFlight");
  const body = code.slice(start, code.indexOf("export async function projectIndividualMessageStatus", start));
  assert.match(body, /\.eq\("status", "sending"\)\s*\.is\("wa_message_id", null\)\s*\.lte\("send_started_at", new Date\(receiptAtMs\)\.toISOString\(\)\)/);
  assert.doesNotMatch(body, /sent_at/, "a referência é o início do envio");
  assert.match(code, /\.eq\("wa_message_id", waMessageId\)\s*\.is\("delivered_at", null\)/, "nunca casa por palpite de horário");
  assert.equal((code.match(/await markAutoQueueReceiptAwaitingSend\(\{/g) || []).length, 2, "server_ack e delivered/read usam o mesmo caminho");
});
