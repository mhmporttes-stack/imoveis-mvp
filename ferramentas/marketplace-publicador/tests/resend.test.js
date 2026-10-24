// 1.9.6 (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24): "se a mensagem não foi enviada, você espera 30 segundos e tenta
// enviar de novo, até ela ser concluída." A extensão confere a conversa antes de reenviar (nunca duplica no escuro) e
// avisa o CRM quando o Facebook bloqueou/encerrou a conversa.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../selectors.js";
import { SEND_RETRY_WAIT_MS, outboundResultBody, verifyOutcome } from "../lib/chat-agenda.js";

const { MP } = globalThis;

test("conferência antes do reenvio: já está na conversa = enviada; não deu para ler = não digita", () => {
  assert.equal(verifyOutcome(null), null, "sem conferência: segue para digitar");
  assert.equal(verifyOutcome({ ok: true, present: false }), null, "não está lá: digita de novo");
  assert.deepEqual(verifyOutcome({ ok: true, present: true }), { ok: true, verified: true, sentAttempted: false });
  const unknown = verifyOutcome({ ok: false, unknown: true, error: "x" });
  assert.equal(unknown.ok, false);
  assert.equal(outboundResultBody(unknown).retry, false, "nunca reenvio no escuro");
  assert.equal(outboundResultBody(unknown).unconfirmed, true);
  const closed = verifyOutcome({ ok: false, closed: true });
  assert.equal(outboundResultBody(closed).closed, true);
  assert.equal(outboundResultBody(closed).retry, false);
  assert.deepEqual(outboundResultBody({ ok: true, verified: true }), { status: "sent", verified: true });
  assert.deepEqual(outboundResultBody({ ok: true }), { status: "sent" });
});

test("conversa bloqueada/encerrada pelo Facebook (pt-BR e inglês)", () => {
  assert.equal(MP.isConversationClosed("Você não pode responder a esta conversa."), true);
  assert.equal(MP.isConversationClosed("Esta pessoa não está disponível no Messenger."), true);
  assert.equal(MP.isConversationClosed("You can't reply to this conversation"), true);
  assert.equal(MP.isConversationClosed("This person is unavailable on Messenger."), true);
  assert.equal(MP.isConversationClosed("Olá, ainda está disponível?"), false);
  assert.equal(MP.isConversationClosed(""), false);
});

test("envio: espera 30 s e tenta de novo na mesma rodada; confere antes de digitar quando o CRM pede", () => {
  assert.equal(SEND_RETRY_WAIT_MS, 30 * 1000);
  const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(source, /aguardando 30 s para reenviar/);
  assert.doesNotMatch(source, /if \(!outcome\.ok\) break; \/\/ não insiste na mesma rodada/);
  assert.match(source, /message\.verify\s*\?\s*await pageCall\(tabId, \{ type: "mp-inbox-verify"/);
  assert.match(source, /verifyOutcome\(check\) \|\|/, "conferência vem antes de digitar");
  const inbox = readFileSync(new URL("../inbox.js", import.meta.url), "utf8");
  assert.match(inbox, /case "mp-inbox-verify":/);
  assert.match(inbox, /present: count > known/);
});
