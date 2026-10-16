import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CASE_STATUS,
  COOLED_NO_CONVERSATION_KEY,
  applyCaseAction,
  autoCancelReason,
  directTransferReasonKey,
  isNoConversationReasonText
} from "../lib/cooled-clients-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-16, complemento da FUN-15j] Motivo que diz que o corretor NUNCA teve conversa com o
// cliente = botão "Cliente não respondeu mais": transfere direto, sem decisora, marcado "sem_conversa".

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const REAL_REASONS = [
  "Cliente não era meu, não tenho mensagem.",
  "Não tenho mensagens com o cliente.",
  "Não tenho conversa com esse cliente.",
  "Nunca falei com essa cliente.",
  "Não tem nada de conversa.",
  "Nunca falei com essa cliente, não era meu.",
  "Cliente não era minha, não tenho conversa.",
  "Não tem nenhuma conversa.",
  "Cliente não era minha, não tem mensagens com ela.",
  "Não tenho mensagens com esse cliente no whats.",
  "Não tenho conversa com essa cliente.",
  "Não tenho mensagens com esse cliente."
];

test("motivos reais de 'nunca teve conversa' transferem, marcados sem_conversa", () => {
  for (const text of REAL_REASONS) {
    assert.equal(isNoConversationReasonText(text), true, text);
    assert.equal(directTransferReasonKey(text), COOLED_NO_CONVERSATION_KEY, text);
  }
  assert.equal(directTransferReasonKey("Esse cliente não era meu"), COOLED_NO_CONVERSATION_KEY);
});

test("continuam com a decisora (ou encerram por restrição)", () => {
  for (const text of [
    "Não tira esse cliente, não tenho conversa mas vou chamar",
    "Já passei para a Carol, não era meu",
    "Não era meu, mas está respondendo",
    "Cliente não era meu, me mandou mensagem hoje",
    "Não tenho conversa, aguardando documentação",
    "Não tenho conversa com ele, mas vou ligar amanhã",
    "Cliente com restrição, não tenho conversa",
    "Aguardando documentação",
    "Atendimento normal, enviei a simulação"
  ]) assert.equal(directTransferReasonKey(text), "", text);
});

test("'não respondeu mais' continua com a marca própria", () => {
  assert.equal(directTransferReasonKey("Parou de responder"), "nao_respondeu");
});

test("caso na caixinha com motivo 'sem conversa': transferência automática (retroativo)", () => {
  const row = { id: "k", client_id: "c", broker_id: "b", status: CASE_STATUS.AWAITING_DECISION, first_reason: "Não tenho conversa com essa cliente." };
  const patch = applyCaseAction(row, "auto_transfer", { now: "2026-10-16T15:00:00.000Z" });
  assert.deepEqual({ status: patch.status, decision: patch.decision, decided_by: patch.decided_by }, { status: CASE_STATUS.CLOSED, decision: "transferred", decided_by: null });
  // Arquivado / Não contactar / Restrição ainda encerram antes de transferir.
  for (const status of ["archived", "do_not_contact", "restriction"]) {
    assert.ok(autoCancelReason({ row, client: { status, responsibleUserId: "b" } }), status);
  }
});

test("servidor: motivo digitado, rotina e histórico usam a mesma marca", () => {
  const lib = read("lib/cooled-clients.js");
  assert.match(lib, /if \(directTransferReasonKey\(text\)\) return answerNoResponseAndTransfer/);
  assert.match(lib, /transferReason: directTransferReasonKey\(caseLatestReason\(row\)\)/);
  assert.match(lib, /automatic: true, trigger, transferReason/);
  assert.match(lib, /transferReason: row\.decision === "transferred" && !row\.decided_by/);
  assert.match(read("app/admin/desempenho/esfriados/page.jsx"), /sem_conversa: "automático: sem conversa"/);
});
