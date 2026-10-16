import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CASE_STATUS,
  COOLED_RESTRICTION_CANCEL_REASON,
  applyCaseAction,
  autoCancelReason,
  isCooledCandidate,
  isNoResponseReasonText,
  isRestrictionHoldActive,
  isRestrictionReasonText
} from "../lib/cooled-clients-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-16, FUN-15k] "clientes com restrição, arquivados ou não contactar não entram nessa regra".

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-16T15:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const responsible = { id: "b1", role: "broker", status: "active" };
const client = (extra = {}) => ({
  id: "c1", status: "in_service", responsibleUserId: "b1",
  lastWhatsappContactAt: iso(NOW - 5 * DAY), lastStatusChangeAt: iso(NOW - 6 * DAY), createdAt: iso(NOW - 10 * DAY), ...extra
});
const openRow = (extra = {}) => ({ id: "k1", client_id: "c1", broker_id: "b1", status: CASE_STATUS.AWAITING_REASON, ...extra });

test("base do teste: cliente esfriado comum entra no fluxo", () => {
  assert.equal(isCooledCandidate({ client: client(), responsible, now: NOW }), true);
});

test("Arquivado, Não contactar e Restrição (status) ficam fora da detecção", () => {
  for (const status of ["archived", "do_not_contact", "restriction", "rejected", "income_commitment"]) {
    assert.equal(isCooledCandidate({ client: client({ status }), responsible, now: NOW }), false, status);
  }
});

test("Arquivado e Não contactar encerram casos abertos (nos dois passos)", () => {
  for (const status of ["archived", "do_not_contact"]) {
    for (const row of [openRow(), openRow({ status: CASE_STATUS.AWAITING_DECISION, first_reason: "Cliente sumiu faz dias" })]) {
      assert.equal(autoCancelReason({ row, client: client({ status }) }), "status_negativo", `${status}/${row.status}`);
    }
  }
});

test("status Restrição encerra caso aberto com motivo próprio", () => {
  assert.equal(autoCancelReason({ row: openRow(), client: client({ status: "restriction" }) }), COOLED_RESTRICTION_CANCEL_REASON);
  assert.equal(autoCancelReason({ row: openRow({ status: CASE_STATUS.AWAITING_DECISION }), client: client({ status: "restriction" }) }), COOLED_RESTRICTION_CANCEL_REASON);
});

test("classificador de restrição: frases que citam restrição", () => {
  for (const text of [
    "Cliente com restrição no CPF",
    "cliente com restricao, nao consegue financiar",
    "Está com o nome sujo",
    "Cliente negativado no Serasa",
    "Ela está negativada",
    "Score muito baixo, banco não aprovou",
    "Tem RESTRIÇÃO e parou de responder"
  ]) assert.equal(isRestrictionReasonText(text), true, text);
});

test("classificador de restrição: menção negada ou ausente não conta", () => {
  for (const text of [
    "Cliente sem restrição, mas parou de responder",
    "Não tem restrição nenhuma, só sumiu",
    "Não possui restrição e não respondeu",
    "Não está negativado, falta documentação",
    "Cliente não respondeu mais",
    "Ficou de enviar a documentação"
  ]) assert.equal(isRestrictionReasonText(text), false, text);
});

test("motivo com restrição nunca vira transferência por 'não respondeu mais'", () => {
  assert.equal(isNoResponseReasonText("Cliente negativado e parou de responder"), false);
  assert.equal(isNoResponseReasonText("Score baixo, não responde mais"), false);
  assert.equal(isNoResponseReasonText("Parou de responder"), true);
});

test("restriction_reason grava o motivo e encerra o caso como restrição (sem decisora/roleta)", () => {
  const now = iso(NOW);
  const patch = applyCaseAction(openRow(), "restriction_reason", { actorId: "b1", text: "Cliente com nome sujo no Serasa", now });
  assert.equal(patch.status, CASE_STATUS.CANCELED);
  assert.equal(patch.canceled_reason, COOLED_RESTRICTION_CANCEL_REASON);
  assert.equal(patch.first_reason, "Cliente com nome sujo no Serasa");
  assert.equal(patch.decision, undefined);
  const second = applyCaseAction(openRow({ returned_at: now }), "restriction_reason", { actorId: "b1", text: "Descobri que tem restrição no CPF", now });
  assert.equal(second.second_reason, "Descobri que tem restrição no CPF");
  assert.throws(() => applyCaseAction(openRow(), "restriction_reason", { text: "Cliente parou de responder" }));
  assert.throws(() => applyCaseAction(openRow({ status: CASE_STATUS.AWAITING_DECISION }), "restriction_reason", { text: "Cliente com restrição no CPF" }));
});

test("caso que já aguarda a decisora com motivo de restrição é encerrado (backlog)", () => {
  const row = openRow({ status: CASE_STATUS.AWAITING_DECISION, first_reason: "Cliente negativado, sem condições" });
  assert.equal(autoCancelReason({ row, client: client() }), COOLED_RESTRICTION_CANCEL_REASON);
  assert.equal(autoCancelReason({ row: { ...row, first_reason: "Sem restrição, só não responde" }, client: client() }), "");
});

test("caso encerrado como restrição segura o cliente fora até mudar de status", () => {
  const closedAt = iso(NOW - DAY);
  assert.equal(isRestrictionHoldActive({ restrictionClosedAt: closedAt, lastStatusChangeAt: iso(NOW - 6 * DAY) }), true);
  assert.equal(isRestrictionHoldActive({ restrictionClosedAt: closedAt, lastStatusChangeAt: null }), true);
  assert.equal(isRestrictionHoldActive({ restrictionClosedAt: closedAt, lastStatusChangeAt: iso(NOW - DAY / 2) }), false);
  assert.equal(isRestrictionHoldActive({}), false);
  assert.equal(isCooledCandidate({ client: client({ restrictionClosedAt: closedAt }), responsible, now: NOW }), false);
});

test("servidor: motivo com restrição é tratado antes do 'não respondeu mais'; histórico mostra o motivo", () => {
  const server = read("lib/cooled-clients.js");
  const restriction = server.indexOf("if (isRestrictionReasonText(text)) return answerRestrictionAndClose");
  const noResponse = server.indexOf("if (isNoResponseReasonText(text)) return answerNoResponseAndTransfer");
  assert.ok(restriction > 0 && noResponse > restriction);
  assert.match(server, /restrictionClosedAt: restrictionClosedAt\.get\(client\.id\)/);
  assert.match(read("app/admin/desempenho/esfriados/page.jsx"), /cliente_com_restricao: "cliente com restrição"/);
});
