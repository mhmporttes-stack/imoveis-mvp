import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifySendError } from "../lib/daily-goal-auto-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Número que NÃO existe no WhatsApp (dono, 2026-10-13): não abre o Chat, não envia, e a Meta Diária trata como erro do contato.
test("serviço: consulta onWhatsApp antes de enviar e responde NOT_ON_WHATSAPP (422) sem enviar nada", () => {
  const sessions = read("whatsapp-individual-service/src/sessions.js");
  const send = sessions.slice(sessions.indexOf("export async function sendMessage("), sessions.indexOf("// Reação (emoji vazio remove a reação)"));
  assert.match(send, /await checkRecipient\(sock, to\)/);
  assert.match(send, /recipient\.exists === false/);
  assert.match(send, /error\.code = "NOT_ON_WHATSAPP"/);
  assert.ok(send.indexOf("recipient.exists === false") < send.indexOf("sock.sendMessage"), "checa ANTES de enviar");
  assert.match(sessions, /Consulta sem resposta\/com erro NÃO bloqueia/);
  const server = read("whatsapp-individual-service/src/server.js");
  assert.match(server, /error\.code === "NOT_ON_WHATSAPP" \? 422/);
  assert.match(server, /\/sessions\/:userId\/check-number/);
});

test("CRM: código do serviço chega ao Chat como NO_WHATSAPP e a Meta Diária classifica como erro do contato", () => {
  assert.match(read("lib/whatsapp-individual.js"), /if \(payload\?\.code\) error\.code = String\(payload\.code\)/);
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /error\?\.code === "NOT_ON_WHATSAPP"\) return new WhatsappChatError\("O número não possui WhatsApp\."/);
  assert.equal((chat.match(/throw sendFailureError\(error,/g) || []).length, 2, "texto e mídia/atalho");
  assert.equal(classifySendError(Object.assign(new Error("O número não possui WhatsApp."), { status: 422, code: "NOT_ON_WHATSAPP" })), "contact");
});

test("abrir conversa NOVA e o botão do card consultam o número e não abrem se não existir", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /probe\.exists === false\) throw new WhatsappChatError\("O número não possui WhatsApp\.", \{ status: 422, code: "NO_WHATSAPP" \}\)/);
  const card = read("components/clients/useClientList.js");
  assert.match(card, /check-client\?clientId=/);
  assert.match(card, /check\?\.exists === false/);
  assert.match(card, /O número não possui WhatsApp\./);
  assert.match(read("app/api/admin/whatsapp-chat/check-client/route.js"), /checkClientHasWhatsapp/);
});
