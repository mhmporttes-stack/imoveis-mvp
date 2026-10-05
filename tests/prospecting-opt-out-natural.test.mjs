import test from "node:test";
import assert from "node:assert/strict";
import { REPLY_ACTION, decideProspectingReplyAction, isClearOptOut } from "../lib/prospecting-reply-core.mjs";

// Pedido de sair em linguagem natural (dono, 2026-10-05): vira "Não contactar" automático, inclusive quando uma 1ª resposta
// já promoveu o cliente a "Em atendimento" ("Não tenho interesse, agradeço." e, 3 s depois, "SAIR").
const attemptAt = "2026-10-05T17:55:00.000Z";
const contacts = [{ id: "c1", status: "claimed", last_attempt_at: attemptAt }];

test("frases claras de saída", () => {
  for (const text of ["Não tenho interesse, agradeço.", "SAIR", "Quero sair", "quero parar de receber mensagens", "Gostaria de deixar de receber mensagens de vocês", "Não quero receber mais mensagens", "Me tire da lista, por favor", "não tenho interesse em receber mensagens", "Pode parar, obrigado"]) {
    assert.equal(isClearOptOut(text), true, text);
  }
});

test("na dúvida NÃO é opt-out (humano decide)", () => {
  for (const text of ["Não tenho interesse agora", "Quero saber mais, tem entrada?", "Quero sair do aluguel", "agora não, me chama depois", "Não tenho interesse em apartamento, tem casa?", "Quero parar de pagar aluguel?"]) {
    assert.equal(isClearOptOut(text), false, text);
  }
});

test("cliente já promovido a Em atendimento + pedido claro de sair logo depois de uma tentativa → Não contactar", () => {
  const base = { clientId: "k1", contacts, messageAt: "2026-10-05T17:57:27.000Z" };
  assert.equal(decideProspectingReplyAction({ ...base, clientStatus: "in_service", text: "SAIR" }), REPLY_ACTION.OPT_OUT);
  assert.equal(decideProspectingReplyAction({ ...base, clientStatus: "awaiting_return", text: "Não tenho interesse, agradeço." }), REPLY_ACTION.OPT_OUT);
  // sem tentativa recente (cliente em atendimento de verdade): nada automático
  assert.equal(decideProspectingReplyAction({ ...base, clientStatus: "in_service", contacts: [{ id: "c2", status: "claimed", last_attempt_at: "2026-09-01T10:00:00.000Z" }], text: "SAIR" }), REPLY_ACTION.IGNORE);
  assert.equal(decideProspectingReplyAction({ ...base, clientStatus: "in_service", text: "Oi, tudo bem?" }), REPLY_ACTION.IGNORE);
});
