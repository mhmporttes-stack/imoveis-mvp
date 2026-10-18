import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  contactCodeFor,
  contactCodeIdRange,
  decideCodedConversationLink,
  extractContactCode,
  hasContactCodeMarker,
  officialChatAssignedNotice,
  withContactCode
} from "../lib/whatsapp-contact-code-core.mjs";

// REGRA OFICIAL (dono, 2026-10-18): botões do link abrem o número OFICIAL, mas a conversa fica com o corretor responsável.
const ID = "3f9a12c4-1111-2222-3333-444455556666";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("código: 8 primeiros caracteres do id do cadastro; sem uuid válido, sem código", () => {
  assert.equal(contactCodeFor(ID), "MM-3F9A12C4");
  for (const value of ["", null, undefined, "r1", "5514991112222", "3f9a12c4"]) assert.equal(contactCodeFor(value), "");
  assert.equal(withContactCode("Olá!", ID), "Olá!\n\nCódigo do atendimento: MM-3F9A12C4");
  assert.equal(withContactCode("Olá!", ""), "Olá!");
});

test("leitura do código na mensagem recebida (caixa e espaços do WhatsApp não atrapalham)", () => {
  assert.equal(extractContactCode(withContactCode("Olá!", ID)), "3f9a12c4");
  assert.equal(extractContactCode("oi, codigo do atendimento: mm-3f9a12c4 obrigado"), "3f9a12c4");
  assert.equal(extractContactCode("Olá, preenchi meu cadastro."), "");
  assert.equal(extractContactCode("MM-3F9A"), "");
  // marcador sem código legível = veio do botão: fallback pelo telefone do cadastro
  assert.equal(hasContactCodeMarker("Código do atendimento: MM-3F9"), true);
  assert.equal(hasContactCodeMarker("Olá, quero saber de um imóvel"), false);
  assert.deepEqual(contactCodeIdRange("3f9a12c4"), { from: "3f9a12c4-0000-0000-0000-000000000000", to: "3f9a12c4-ffff-ffff-ffff-ffffffffffff" });
  assert.equal(contactCodeIdRange("xyz"), null);
});

const registration = { id: ID, status: "simulation_sent", responsible_user_id: "broker-1" };

test("conversa nova sem cliente: liga ao cadastro e entrega ao responsável ativo (sem roleta, sem cliente novo)", () => {
  const decision = decideCodedConversationLink({ conversation: { id: "c1", client_id: null, assigned_user_id: null }, registration, responsibleActive: true });
  assert.deepEqual(decision, { action: "update", patch: { client_id: ID, assigned_user_id: "broker-1" }, relinked: true, assigned: true });
});

test("conversa já do cliente, mas com outra pessoa (ou ninguém): só troca a atribuição; nunca o responsável do cliente", () => {
  const decision = decideCodedConversationLink({ conversation: { id: "c1", client_id: ID, assigned_user_id: "owner" }, registration, responsibleActive: true });
  assert.deepEqual(decision.patch, { assigned_user_id: "broker-1" });
  assert.equal("responsible_user_id" in decision.patch, false);
  assert.deepEqual(decideCodedConversationLink({ conversation: { id: "c1", client_id: ID, assigned_user_id: "broker-1" }, registration, responsibleActive: true }), { action: "skip", reason: "ja_atribuida" });
});

test("responsável inativo/sem responsável: liga ao cliente (não vira cliente novo), sem atribuir", () => {
  assert.deepEqual(decideCodedConversationLink({ conversation: { id: "c1", client_id: null }, registration, responsibleActive: false }).patch, { client_id: ID });
  assert.deepEqual(decideCodedConversationLink({ conversation: { id: "c1", client_id: ID }, registration: { ...registration, responsible_user_id: null }, responsibleActive: false }), { action: "skip", reason: "sem_responsavel_ativo" });
});

test("conversa de outro atendimento da mesma pessoa (mesmo telefone): religa ao cadastro do código", () => {
  const decision = decideCodedConversationLink({ conversation: { id: "c1", client_id: "old", assigned_user_id: "x" }, registration, responsibleActive: true, currentClientStatus: "in_service", samePhone: true });
  assert.deepEqual(decision.patch, { client_id: ID, assigned_user_id: "broker-1" });
});

test("conversa ligada a cadastro ARQUIVADO: religa e reaparece; de outro cliente ativo de outro telefone: não mexe", () => {
  const hidden = { id: "c1", client_id: "old", assigned_user_id: null, origin: { kind: "x", archived_hidden_at: "2026-10-01" } };
  const decision = decideCodedConversationLink({ conversation: hidden, registration, responsibleActive: true, currentClientStatus: "archived" });
  assert.deepEqual(decision.patch, { client_id: ID, origin: { kind: "x" }, deleted_at: null, deleted_by: null, assigned_user_id: "broker-1" });
  assert.deepEqual(
    decideCodedConversationLink({ conversation: { id: "c1", client_id: "spouse" }, registration, responsibleActive: true, currentClientStatus: "in_service", samePhone: false }),
    { action: "skip", reason: "conversa_de_outro_cliente" }
  );
});

test("Particular (WA-19), cliente do código arquivado (WA-13) e sem conversa: nada muda", () => {
  assert.equal(decideCodedConversationLink({ conversation: { id: "c1", private_at: "2026-10-10" }, registration, responsibleActive: true }).reason, "conversa_particular");
  assert.equal(decideCodedConversationLink({ conversation: { id: "c1" }, registration: { ...registration, status: "archived" }, responsibleActive: true }).reason, "cliente_arquivado");
  assert.equal(decideCodedConversationLink({ conversation: null, registration, responsibleActive: true }).reason, "sem_conversa");
});

test("webhook do oficial: resolve o código ANTES do Chat e atribui ANTES do cadastro automático do contato direto", () => {
  const master = read("lib/whatsapp-master.js");
  const resolveAt = master.indexOf("resolveCodedContacts(events, clientByPhone)");
  const projectAt = master.indexOf("await projectChatFromEvents(events, clientByPhone)");
  const attachAt = master.indexOf("await attachCodedConversations(codedContacts)");
  const organicAt = master.indexOf("await processOrganicLeads(automationRows)");
  assert.ok(resolveAt > 0 && resolveAt < projectAt && projectAt < attachAt && attachAt < organicAt);
  assert.ok(resolveAt < master.indexOf("related_client_id: event.sender_phone"));
});

test("todos os botões de contato do link e o 'Receber minha simulação' levam o código do cadastro", () => {
  assert.match(read("lib/documents-forecast-store.mjs"), /buildBrokerWhatsappUrl\(client\?\.id \|\| registrationId, message\)/);
  assert.equal((read("lib/client-appointments.js").match(/buildBrokerWhatsappUrl\(ctx\.client\.id, message\)/g) || []).length, 2);
  assert.match(read("lib/payment-strategy.js"), /buildBrokerWhatsappUrl\(loaded\.simulation\.registration\?\.id \|\| loaded\.simulation\.registrationId, message\)/);
  assert.match(read("components/simulation-form/ReceiveSimulationWhatsappButton.jsx"), /withContactCode\(MESSAGE, registrationId\)/);
});

test("aviso ao corretor (exceção do dono, 2026-10-18): sino + push só na ATRIBUIÇÃO, uma vez", () => {
  assert.deepEqual(officialChatAssignedNotice("Maria Souza"), {
    title: "Cliente Maria Souza chamou no WhatsApp oficial pelo link — abra o Chat.",
    description: "A conversa do WhatsApp oficial já está atribuída a você no Chat."
  });
  assert.match(officialChatAssignedNotice("").title, /^Cliente sem nome chamou/);
  assert.ok(!/[\n\r]/.test(officialChatAssignedNotice("Ana\nX").title));
  const code = read("lib/whatsapp-contact-code.js");
  // só avisa quando a atribuição mudou agora, e a gravação é condicionada à atribuição lida (entregas simultâneas = 1 aviso)
  assert.match(code, /if \(decision\.assigned\) await notifyAssignedBroker\(/);
  assert.match(code, /query\.eq\("assigned_user_id", conversation\.assigned_user_id\) : query\.is\("assigned_user_id", null\)/);
  assert.ok(code.indexOf("if (!updated?.length)") < code.indexOf("if (decision.assigned) await notifyAssignedBroker("));
  assert.match(code, /notification_type: NOTIFICATION_KIND\.OFFICIAL_CHAT_ASSIGNED/);
  assert.match(code, /kind: NOTIFICATION_KIND\.OFFICIAL_CHAT_ASSIGNED, title, body: description, url: "\/admin\/chat"/);
  // as demais mensagens do Chat continuam sem aviso
  assert.ok(!/sendPushToUser\([^)]*kind:/.test(read("lib/whatsapp-chat.js")));
});
