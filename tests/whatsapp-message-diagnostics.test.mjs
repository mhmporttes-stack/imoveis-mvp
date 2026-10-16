// Diagnóstico PASSIVO do microsserviço (dono, 2026-10-16): mensagens que não decifram, pedidos de reenvio das nossas e o
// <ack> do stream:error. Só observa: ids em hash, nunca telefone/JID/texto. Sem rede, sem Baileys.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CIPHERTEXT_STUB_TYPE, DIAG_REASON, createMessageDiagnostics, decryptFailureCode, describeDecryptFailure, describeRetryReceipt, hashMessageId
} from "../whatsapp-individual-service/src/message-diagnostics.js";
import { summarizeDisconnectData } from "../whatsapp-individual-service/src/reconnect-policy.js";
import { createCloseHandler } from "../whatsapp-individual-service/src/session-lifecycle.js";
import { sanitizeTelemetryEvent } from "../lib/whatsapp-session-telemetry-core.mjs";

const PHONE = "5514999990000";

test("mensagem que não decifra vira evento com código curto e id em hash (sem telefone nem texto do erro)", () => {
  const msg = { key: { id: "3EB0ABC", remoteJid: `${PHONE}@s.whatsapp.net`, fromMe: false }, messageStubType: CIPHERTEXT_STUB_TYPE, messageStubParameters: [`Bad MAC from ${PHONE}`] };
  const fields = describeDecryptFailure(msg);
  assert.deepEqual(fields, { reason: DIAG_REASON.DECRYPT_FAIL, kind: "bad_mac", trigger: "from_contact", detail: `id_${hashMessageId("3EB0ABC")}` });
  assert.doesNotMatch(JSON.stringify(fields), new RegExp(PHONE));
  assert.equal(describeDecryptFailure({ key: { id: "x" }, message: { conversation: "oi" } }), null, "mensagem normal não conta");
  assert.equal(decryptFailureCode("Missing keys for sender"), "missing_keys");
  assert.equal(decryptFailureCode("No session found to decrypt message"), "no_session");
  assert.equal(decryptFailureCode("qualquer coisa"), "other");
  assert.equal(decryptFailureCode(""), "unknown");
});

test("pedido de reenvio (recibo type=retry) conta com o número do pedido; recibo comum não conta", () => {
  const node = { tag: "receipt", attrs: { id: "MSG1", from: `${PHONE}@s.whatsapp.net`, type: "retry" }, content: [{ tag: "retry", attrs: { count: "2", id: "MSG1" } }] };
  const fields = describeRetryReceipt(node);
  assert.deepEqual(fields, { reason: DIAG_REASON.RETRY_RECEIPT, attempt: 2, detail: `id_${hashMessageId("MSG1")}` });
  assert.doesNotMatch(JSON.stringify(fields), new RegExp(PHONE));
  assert.equal(describeRetryReceipt({ tag: "receipt", attrs: { id: "MSG1", type: "read" } }), null);
  assert.equal(describeRetryReceipt({ tag: "receipt", attrs: { id: "MSG1" } }), null, "entrega comum");
});

test("por socket: no máximo N eventos individuais por motivo; o resumo do fechamento soma tudo", () => {
  const diag = createMessageDiagnostics({ maxEventsPerReason: 2 });
  assert.equal(diag.summary(), null, "nada a relatar");
  assert.deepEqual([1, 2, 3].map(() => diag.track(DIAG_REASON.DECRYPT_FAIL)), [true, true, false]);
  diag.track(DIAG_REASON.RETRY_RECEIPT);
  assert.deepEqual(diag.summary(), { reason: DIAG_REASON.SOCKET_SUMMARY, detail: "dec3_rr1" });
});

test("os eventos passam pela telemetria do CRM (tipo existente, sem migration) e não parecem telefone", () => {
  const base = { userId: "11111111-1111-4111-8111-111111111111", type: "history_sync", bootId: "boot-1", occurredAt: new Date().toISOString() };
  for (const fields of [
    describeDecryptFailure({ key: { id: "A" }, messageStubType: 2, messageStubParameters: ["Bad MAC"] }),
    describeRetryReceipt({ attrs: { id: "B", type: "retry" }, content: [{ tag: "retry", attrs: { count: "1" } }] }),
    { reason: DIAG_REASON.SOCKET_SUMMARY, detail: "dec12_rr3" }
  ]) {
    const row = sanitizeTelemetryEvent({ ...base, ...fields });
    assert.ok(row, "aceito");
    assert.equal(row.reason, fields.reason);
    assert.equal(row.detail, fields.detail);
  }
});

test("queda stream:error com <ack>: detail guarda tipo, classe e id em hash (até 40); conflict continua igual", () => {
  const data = { tag: "stream:error", attrs: {}, content: [{ tag: "ack", attrs: { id: "3EB0ABC", class: "message", type: "text", from: `${PHONE}@s.whatsapp.net` } }] };
  const detail = summarizeDisconnectData(data);
  assert.equal(detail, `stream:error.ack.text.message.h${hashMessageId("3EB0ABC").slice(0, 4)}`);
  assert.ok(detail.length <= 40);
  assert.doesNotMatch(detail, /\d{9,}/);
  const long = summarizeDisconnectData({ tag: "stream:error", content: [{ tag: "ack", attrs: { id: "x", class: "notification", type: "reaction" } }] });
  assert.ok(long.length <= 40 && long.startsWith("stream:error.ack.reaction."));
  assert.equal(summarizeDisconnectData({ tag: "stream:error", attrs: {}, content: [{ tag: "conflict", attrs: { type: "device_removed" } }] }), "stream:error.conflict.device_removed");
});

test("o detail da queda também vai no output do status (whatsapp_session_events), sem mudar a decisão", async () => {
  const calls = [];
  const entry = { status: "connected" };
  const controller = { onClose: () => ({ action: "retry", delayMs: 1000 }), cancel() {} };
  const handle = createCloseHandler({
    userId: "u1", entry, controller,
    notifyStatus: async (userId, body) => { calls.push(body); },
    clearSessionCreds: async () => {}, retireSocket: async () => {}, scheduleRetry: () => {}
  });
  const payload = { statusCode: 500, error: "Internal Server Error", message: "Stream Errored (ack)" };
  await handle({ sock: null, statusCode: 500, errorMessage: "Stream Errored (ack)", payload, errorData: { tag: "stream:error", content: [{ tag: "ack", attrs: { id: "Z", class: "message", type: "text" } }] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, "reconnecting");
  assert.deepEqual(calls[0].output, { ...payload, detail: `stream:error.ack.text.message.h${hashMessageId("Z").slice(0, 4)}` });
  // Sem detail: output exatamente como antes.
  const calls2 = [];
  const handle2 = createCloseHandler({ userId: "u1", entry: { status: "connected" }, controller, notifyStatus: async (u, b) => { calls2.push(b); }, clearSessionCreds: async () => {}, retireSocket: async () => {}, scheduleRetry: () => {} });
  await handle2({ sock: null, statusCode: 428, errorMessage: "x", payload });
  assert.equal(calls2[0].output, payload);
});

test("sessions.js: diagnóstico só observa (sem ack/nack/reenvio, sem log debug ligado)", () => {
  const code = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.match(code, /describeDecryptFailure\(msg\)/);
  assert.match(code, /describeRetryReceipt\(node\)/);
  assert.match(code, /const logger = pino\(\{ level: process\.env\.BAILEYS_LOG_LEVEL \|\| "silent" \}\);/, "log do Baileys continua silencioso por padrão");
  const diagModule = readFileSync(new URL("../whatsapp-individual-service/src/message-diagnostics.js", import.meta.url), "utf8");
  assert.doesNotMatch(diagModule, /sendNode|sendMessageAck|sendReceipt|sendMessage\(|import .*baileys/i, "não fala com o WhatsApp");
});
