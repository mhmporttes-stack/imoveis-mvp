import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTOMATION_ECHO_WINDOW_MS,
  isAutomationEcho,
  isHumanContactMessage,
  pickUnambiguousRegistration,
  resolveContactChangedBy,
  shouldAdvanceContactAt
} from "../lib/human-contact-core.mjs";
import { CLIENT_STATUS } from "../lib/client-status.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chatMessage = { direction: "outbound", senderType: "user", status: "sent", messageType: "text", metadata: {} };

// 1) envio pelo Chat
test("1: texto enviado por pessoa pelo Chat é contato humano", () => {
  assert.equal(isHumanContactMessage(chatMessage), true);
  assert.equal(isHumanContactMessage({ ...chatMessage, messageType: "template" }), true);
  assert.equal(isHumanContactMessage({ ...chatMessage, messageType: "image" }), true);
});

test("1: os 3 pontos de envio do Chat usam a função única (e não gravam o contato por conta própria)", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.equal((chat.match(/await noteHumanContact\(/g) || []).length, 3, "texto, modelo e mídia/atalho");
  assert.match(chat, /registerHumanContact\(/);
  assert.doesNotMatch(chat, /markClientOnHumanMessage\(/);
  assert.doesNotMatch(chat, /markConversationHumanReply\(/);
});

// 2) humano pelo celular
test("2: mensagem do corretor pelo aplicativo do celular é contato humano (mesma regra do Chat)", () => {
  const phoneMessage = { direction: "outbound", senderType: "user", status: "sent", messageType: "text", metadata: { wa_message_id: "ABC", remote_jid: "5511999999999@s.whatsapp.net" } };
  assert.equal(isHumanContactMessage(phoneMessage), true);
  assert.equal(isHumanContactMessage({ ...phoneMessage, messageType: "audio" }), true);
});

test("2: o caminho do celular usa a MESMA função única, com vínculo por telefone", () => {
  const inbound = read("lib/whatsapp-individual-inbound.js");
  assert.match(inbound, /registerHumanContact\(\{/);
  assert.match(inbound, /phoneFallback: true/);
  assert.doesNotMatch(inbound, /markConversationHumanReply\(/);
  assert.match(read("lib/whatsapp-human-contact.js"), /markClientOnHumanMessage\(/);
});

// 3) cliente/conversa sem client_id
test("3: conversa sem client_id — telefone com um único cadastro vincula", () => {
  const picked = pickUnambiguousRegistration([{ id: "c1", status: "in_service", responsible_user_id: "b1" }], { brokerIds: ["b9"] });
  assert.equal(picked.id, "c1");
});

test("3: telefone com vários cadastros (CLI-4) não é chutado", () => {
  const rows = [
    { id: "c1", status: "in_service", responsible_user_id: "b1" },
    { id: "c2", status: "pending", responsible_user_id: "b2" }
  ];
  assert.equal(pickUnambiguousRegistration(rows, { brokerIds: ["b9"] }), null);
  assert.equal(pickUnambiguousRegistration(rows, { brokerIds: [] }), null);
});

test("3: vários cadastros — só o do corretor dono da conversa desempata, e só se for único", () => {
  const rows = [
    { id: "c1", status: "in_service", responsible_user_id: "b1" },
    { id: "c2", status: "pending", responsible_user_id: "b2" }
  ];
  assert.equal(pickUnambiguousRegistration(rows, { brokerIds: ["b2"] }).id, "c2");
  const twoOfSame = [...rows, { id: "c3", status: "pending", responsible_user_id: "b2" }];
  assert.equal(pickUnambiguousRegistration(twoOfSame, { brokerIds: ["b2"] }), null);
});

test("3: sem cadastro, ou cadastro arquivado, não vincula", () => {
  assert.equal(pickUnambiguousRegistration([], { brokerIds: ["b1"] }), null);
  assert.equal(pickUnambiguousRegistration([{ id: "c1", status: "archived", responsible_user_id: "b1" }], { brokerIds: ["b1"] }), null);
});

// 4) resposta de gestor/admin
test("4: resposta de gestor/admin conta como atendimento humano do cliente (a função não filtra por perfil)", () => {
  assert.equal(isHumanContactMessage({ ...chatMessage }), true);
  const src = read("lib/whatsapp-human-contact.js");
  assert.doesNotMatch(src, /isGeneralAdmin|isManagerProfile|role ===/, "nenhum filtro por perfil na gravação do contato");
});

// 5) autoria diferente do responsável
test("5: gestor responde cliente do corretor -> a mudança de status fica no nome do gestor, nunca do corretor", () => {
  const changedBy = resolveContactChangedBy({
    nextStatus: CLIENT_STATUS.IN_SERVICE,
    inServiceStatus: CLIENT_STATUS.IN_SERVICE,
    actor: { userId: "gestor-1", email: "gestora@x.com" },
    responsibleUserId: "corretor-1",
    responsibleEmail: "corretor@x.com"
  });
  assert.equal(changedBy, "gestora@x.com");
});

test("5: o próprio corretor responsável (ou o associado dele) mantém o marco no nome do responsável (WA-9)", () => {
  const base = { nextStatus: CLIENT_STATUS.IN_SERVICE, inServiceStatus: CLIENT_STATUS.IN_SERVICE, responsibleUserId: "corretor-1", responsibleEmail: "corretor@x.com" };
  assert.equal(resolveContactChangedBy({ ...base, actor: { userId: "corretor-1", email: "corretor@x.com" } }), "corretor@x.com");
  assert.equal(resolveContactChangedBy({ ...base, actor: { userId: "assoc-1", email: "assoc@x.com", linkedBrokerId: "corretor-1" } }), "corretor@x.com");
});

test("5: demais transições ficam sempre no e-mail de quem enviou; sem e-mail cai em 'sistema'", () => {
  const out = resolveContactChangedBy({ nextStatus: CLIENT_STATUS.AWAITING_RETURN, inServiceStatus: CLIENT_STATUS.IN_SERVICE, actor: { userId: "corretor-1", email: "corretor@x.com" }, responsibleUserId: "corretor-1", responsibleEmail: "r@x.com" });
  assert.equal(out, "corretor@x.com");
  assert.equal(resolveContactChangedBy({ nextStatus: CLIENT_STATUS.AWAITING_RETURN, inServiceStatus: CLIENT_STATUS.IN_SERVICE, actor: {} }), "sistema");
});

test("5: a gravação do contato usa a regra de autoria (não atribui ao responsável quem não é ele)", () => {
  const src = read("lib/whatsapp-client-status.js");
  assert.match(src, /resolveContactChangedBy\(/);
  assert.doesNotMatch(src, /emailOfUser\(client\.responsible_user_id\)\) \|\| actorEmail/);
});

// 6) automática não conta
test("6: automação, falha, nota interna, reação e histórico NUNCA são contato humano", () => {
  assert.equal(isHumanContactMessage({ ...chatMessage, senderType: "automation" }), false);
  assert.equal(isHumanContactMessage({ ...chatMessage, status: "failed" }), false);
  assert.equal(isHumanContactMessage({ ...chatMessage, status: "queued" }), false);
  assert.equal(isHumanContactMessage({ ...chatMessage, direction: "internal", messageType: "internal", metadata: { internal: true } }), false);
  assert.equal(isHumanContactMessage({ ...chatMessage, messageType: "reaction" }), false);
  assert.equal(isHumanContactMessage({ ...chatMessage, metadata: { history: true } }), false);
  assert.equal(isHumanContactMessage({ ...chatMessage, direction: "inbound", senderType: "customer" }), false);
});

test("6: eco da Meta Diária no celular é reconhecido por wa_message_id e por texto+janela", () => {
  const at = "2026-10-03T12:00:00Z";
  const rows = [{ wa_message_id: "WA1", message_text: "Bom dia Ana, tudo bem?", send_started_at: "2026-10-03T11:59:58Z" }];
  assert.equal(isAutomationEcho({ waMessageId: "WA1", body: "outro texto", messageAt: at }, rows), true);
  assert.equal(isAutomationEcho({ waMessageId: "", body: "Bom dia  Ana, tudo bem?", messageAt: at }, rows), true, "espaços normalizados; eco antes do wa_message_id ser gravado");
  assert.equal(isAutomationEcho({ waMessageId: "OUTRO", body: "Olá Ana, posso ajudar?", messageAt: at }, rows), false, "texto digitado pela pessoa");
  const late = new Date(Date.parse(at) + AUTOMATION_ECHO_WINDOW_MS + 60_000).toISOString();
  assert.equal(isAutomationEcho({ waMessageId: "", body: "Bom dia Ana, tudo bem?", messageAt: late }, rows), false, "mesmo texto fora da janela é digitação nova");
  assert.equal(isAutomationEcho({ waMessageId: "WA1", body: "x", messageAt: at }, []), false);
});

test("6: o caminho do celular descarta o eco da automação antes de gravar a mensagem", () => {
  const inbound = read("lib/whatsapp-individual-inbound.js");
  assert.ok(inbound.indexOf("isAutomationEchoForBroker(") < inbound.indexOf('from("whatsapp_messages").insert({'), "eco checado antes do insert da mensagem");
});

// 7) clique no botão não conta
test("7: clique no botão WhatsApp não é mensagem enviada e não passa pela função de contato humano", () => {
  assert.equal(isHumanContactMessage({ direction: "click", senderType: "user", status: "sent", messageType: "text" }), false);
  assert.equal(isHumanContactMessage({}), false);
  assert.equal(isHumanContactMessage(), false);
  const clickPath = read("lib/simulation-registrations.js");
  assert.doesNotMatch(clickPath, /registerHumanContact|whatsapp-human-contact/);
  assert.match(clickPath, /last_whatsapp_contact_at/, "o clique segue gravando como antes (comportamento preservado)");
});

// 15) idempotência
test("15: o contato só avança no tempo (reprocessar ou entrega atrasada não muda nada)", () => {
  assert.equal(shouldAdvanceContactAt(null, "2026-10-03T12:00:00Z"), true);
  assert.equal(shouldAdvanceContactAt("2026-10-03T12:00:00Z", "2026-10-03T12:00:00Z"), false, "mesma mensagem reprocessada");
  assert.equal(shouldAdvanceContactAt("2026-10-03T12:00:00Z", "2026-10-03T11:00:00Z"), false, "mensagem antiga chegando atrasada");
  assert.equal(shouldAdvanceContactAt("2026-10-03T12:00:00Z", "2026-10-03T12:00:01Z"), true);
  assert.equal(shouldAdvanceContactAt(null, "lixo"), false);
});
