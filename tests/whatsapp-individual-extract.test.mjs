import test from "node:test";
import assert from "node:assert/strict";
import { extractTextMessage, lidMappingFromContact, lidMappingFromMessage, resolveChatPhone } from "../whatsapp-individual-service/src/message-extract.js";

// Extração das mensagens do Baileys no microsserviço do WhatsApp individual
// (whatsapp-individual-service/src/message-extract.js). Números sintéticos.
const msg = (key, text = "oi", extra = {}) => ({ key: { id: "WA1", ...key }, message: { conversation: text }, messageTimestamp: 1790000000, pushName: "Cliente Teste", ...extra });

test("conversa endereçada por telefone continua funcionando", () => {
  const item = extractTextMessage(msg({ remoteJid: "5514999990001@s.whatsapp.net", fromMe: false }));
  assert.equal(item.from, "5514999990001");
  assert.equal(item.fromMe, false);
  assert.equal(item.contactName, "Cliente Teste");
});

test("mensagem RECEBIDA numa conversa @lid usa o telefone de senderPn (antes era descartada)", () => {
  const item = extractTextMessage(msg({ remoteJid: "123456789012345@lid", senderPn: "5514999990002@s.whatsapp.net", fromMe: false }, "Tenho interesse"));
  assert.equal(item.from, "5514999990002");
  assert.equal(item.text, "Tenho interesse");
});

test("mensagem do corretor pelo app numa conversa @lid: só com o mapa aprendido, nunca com senderPn (que é ele mesmo)", () => {
  const sent = msg({ remoteJid: "123456789012345@lid", senderPn: "5514988880000@s.whatsapp.net", fromMe: true });
  assert.equal(extractTextMessage(sent), null);
  const lidMap = new Map([["123456789012345@lid", "5514999990002"]]);
  const item = extractTextMessage(sent, lidMap);
  assert.equal(item.from, "5514999990002");
  assert.equal(item.fromMe, true);
  assert.equal(item.contactName, "");
});

test("aprende LID -> telefone da mensagem recebida e de contatos", () => {
  assert.deepEqual(lidMappingFromMessage(msg({ remoteJid: "123456789012345:7@lid", senderPn: "5514999990002:3@s.whatsapp.net", fromMe: false })), ["123456789012345@lid", "5514999990002"]);
  assert.equal(lidMappingFromMessage(msg({ remoteJid: "123456789012345@lid", senderPn: "5514988880000@s.whatsapp.net", fromMe: true })), null);
  assert.deepEqual(lidMappingFromContact({ id: "5514999990003@s.whatsapp.net", lid: "999@lid" }), ["999@lid", "5514999990003"]);
  assert.deepEqual(lidMappingFromContact({ lid: "888@lid", jid: "5514999990004@s.whatsapp.net" }), ["888@lid", "5514999990004"]);
  assert.equal(lidMappingFromContact({ id: "777@lid" }), null);
});

test("grupo, lista de transmissão e newsletter continuam ignorados", () => {
  assert.equal(extractTextMessage(msg({ remoteJid: "120363000000000000@g.us", participant: "5514999990001@s.whatsapp.net" })), null);
  assert.equal(extractTextMessage(msg({ remoteJid: "status@broadcast" })), null);
  assert.equal(extractTextMessage(msg({ remoteJid: "120363000000000000@newsletter" })), null);
  assert.equal(resolveChatPhone(msg({ remoteJid: "" })), "");
});

test("sem texto (figurinha, áudio) continua ignorado; legenda de foto conta", () => {
  assert.equal(extractTextMessage({ key: { remoteJid: "5514999990001@s.whatsapp.net", id: "x" }, message: { stickerMessage: {} } }), null);
  const item = extractTextMessage({ key: { remoteJid: "5514999990001@s.whatsapp.net", id: "y" }, message: { imageMessage: { caption: "olha essa" } }, messageTimestamp: 1790000000 });
  assert.equal(item.text, "olha essa");
});
