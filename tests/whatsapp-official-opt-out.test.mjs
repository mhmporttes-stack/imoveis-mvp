// "Pare" no número oficial (B12 — regra do dono, 2026-10-12, decisão 3 da Mesa do robô do Chat).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOfficialOptOutText, decideOfficialOptOut, isOfficialOptOutCandidate } from "../lib/whatsapp-official-opt-out-core.mjs";

const base = (overrides = {}) => ({
  messageType: "text",
  text: "pare",
  isTeamPhone: false,
  conversation: { private_at: null, last_human_reply_at: null },
  client: { id: "c1", status: "automated_service" },
  doNotContactReason: null,
  ...overrides
});

test("texto B12 com e sem nome, até 1024 caracteres", () => {
  assert.equal(buildOfficialOptOutText("maria souza"), "Tudo bem, Maria. Não vamos mais te mandar mensagens. Se um dia quiser conversar, é só chamar aqui.");
  assert.equal(buildOfficialOptOutText("Cliente WhatsApp"), "Tudo bem. Não vamos mais te mandar mensagens. Se um dia quiser conversar, é só chamar aqui.");
  assert.equal(buildOfficialOptOutText(""), "Tudo bem. Não vamos mais te mandar mensagens. Se um dia quiser conversar, é só chamar aqui.");
  assert.ok(buildOfficialOptOutText("Maximiliano Alexandre").length <= 1024);
});

test("pedido claro (mesma regra da Prospecção): marca e manda a frase", () => {
  for (const text of ["pare", "PARAR", "não tenho interesse", "Não quero mais, obrigado", "quero sair", "número errado"]) {
    assert.deepEqual(decideOfficialOptOut(base({ text })), { apply: true, sendText: true, reason: "pedido_claro" }, text);
  }
});

test("na dúvida não marca (PRO-8): ambíguo, pergunta, temporário", () => {
  for (const text of ["agora não", "não tenho interesse no momento", "parar? como assim", "me chama depois", "não quero esse, tem outro?", "oi"]) {
    assert.equal(decideOfficialOptOut(base({ text })).apply, false, text);
  }
});

test("só texto digitado: toque em botão, áudio e reação nunca são 'pare'", () => {
  assert.equal(isOfficialOptOutCandidate("interactive", "pare"), false);
  assert.equal(isOfficialOptOutCandidate("button", "parar"), false);
  assert.equal(isOfficialOptOutCandidate("audio", ""), false);
  assert.equal(isOfficialOptOutCandidate("text", "pare"), true);
});

test("não marca: equipe, Particular, sem cliente, arquivado, já Não contactar, pessoa já atendeu", () => {
  assert.equal(decideOfficialOptOut(base({ isTeamPhone: true })).reason, "numero_da_equipe");
  assert.equal(decideOfficialOptOut(base({ conversation: null })).reason, "sem_conversa");
  assert.equal(decideOfficialOptOut(base({ conversation: { private_at: "2026-10-12T10:00:00Z" } })).reason, "conversa_particular");
  assert.equal(decideOfficialOptOut(base({ client: null })).reason, "sem_cliente");
  assert.equal(decideOfficialOptOut(base({ client: { id: "c1", status: "archived" } })).reason, "cliente_arquivado");
  assert.equal(decideOfficialOptOut(base({ client: { id: "c1", status: "do_not_contact" } })).reason, "ja_nao_contactar");
  assert.equal(decideOfficialOptOut(base({ conversation: { last_human_reply_at: "2026-10-12T10:00:00Z" } })).reason, "pessoa_ja_atendeu");
});

test("telefone já bloqueado por outro cadastro/fila: marca este cadastro, mas não manda a frase (regra 9)", () => {
  assert.deepEqual(decideOfficialOptOut(base({ doNotContactReason: "telefone_nao_contactar" })), { apply: true, sendText: false, reason: "pedido_claro" });
});

test("webhook: B12 roda depois do Chat e antes da roleta/Fluxo; quem pediu sai das automações seguintes", () => {
  const master = readFileSync(new URL("../lib/whatsapp-master.js", import.meta.url), "utf8");
  const chat = master.indexOf("projectChatFromEvents(events");
  const optOut = master.indexOf("processOfficialOptOuts(data");
  const sponsored = master.indexOf("processSponsoredLeads(automationRows)");
  const organic = master.indexOf("processOrganicLeads(automationRows)");
  const flows = master.indexOf("automationRows.filter((row) => row.event_type === \"message\"");
  assert.ok(chat > 0 && chat < optOut && optOut < sponsored && sponsored < organic && organic < flows);
  const reply = readFileSync(new URL("../lib/prospecting-reply.js", import.meta.url), "utf8");
  // mesmo caminho de gravação do opt-out da Prospecção (clientDoNotContactPatch, responsável preservado)
  assert.match(reply, /export async function processOfficialOptOuts[\s\S]*applyAutomaticOptOut\(\{ client, contacts/);
  assert.match(reply, /\.update\(clientDoNotContactPatch\(now\)\)/);
});
