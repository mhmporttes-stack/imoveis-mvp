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

import { normalizePairingNumber } from "../whatsapp-individual-service/src/pairing-number.js";

test("pareamento por código: número com DDD ganha o 55; formato internacional é mantido", () => {
  assert.equal(normalizePairingNumber("14 99999-0001"), "5514999990001");
  assert.equal(normalizePairingNumber("(14) 9999-0001"), "551499990001");
  assert.equal(normalizePairingNumber("+55 14 99999-0001"), "5514999990001");
  assert.equal(normalizePairingNumber("5514999990001"), "5514999990001");
  assert.equal(normalizePairingNumber("014999990001"), "5514999990001");
  assert.equal(normalizePairingNumber("12345"), "");
});

// Eventos do Chat (mídia, citação, reação, edição, apagar) — 2026-10-02.
import { extractChatEvent } from "../whatsapp-individual-service/src/message-extract.js";

const chat = (message, key = {}) => ({ key: { id: "WA5", remoteJid: "5514999990001@s.whatsapp.net", fromMe: false, ...key }, message, messageTimestamp: 1790000000, pushName: "Cliente Teste" });

test("foto com legenda e resposta citada", () => {
  const event = extractChatEvent(chat({ imageMessage: { mimetype: "image/jpeg", caption: "Olha", fileLength: 1234, contextInfo: { stanzaId: "WA1" } } }));
  assert.equal(event.kind, "message");
  assert.equal(event.messageType, "image");
  assert.equal(event.text, "Olha");
  assert.equal(event.media.size, 1234);
  assert.equal(event.quotedId, "WA1");
});

test("GIF (vídeo com gifPlayback), figurinha, áudio de voz, documento com legenda e visualização temporária", () => {
  assert.equal(extractChatEvent(chat({ videoMessage: { mimetype: "video/mp4", gifPlayback: true } })).messageType, "gif");
  assert.equal(extractChatEvent(chat({ stickerMessage: { mimetype: "image/webp", isAnimated: true } })).media.animated, true);
  assert.equal(extractChatEvent(chat({ audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } })).media.mime, "audio/ogg");
  const doc = extractChatEvent(chat({ documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf", fileName: "rg.pdf", caption: "RG" } } } }));
  assert.equal(doc.messageType, "document");
  assert.equal(doc.media.fileName, "rg.pdf");
  assert.equal(doc.text, "RG");
  assert.equal(extractChatEvent(chat({ ephemeralMessage: { message: { conversation: "oi" } } })).text, "oi");
});

test("reação, remoção de reação, edição e apagar para todos", () => {
  const reaction = extractChatEvent(chat({ reactionMessage: { key: { id: "WA1" }, text: "❤️" } }));
  assert.deepEqual([reaction.kind, reaction.targetId, reaction.emoji], ["reaction", "WA1", "❤️"]);
  assert.equal(extractChatEvent(chat({ reactionMessage: { key: { id: "WA1" }, text: "" } })).emoji, "");
  const edit = extractChatEvent(chat({ protocolMessage: { type: 14, key: { id: "WA2" }, editedMessage: { conversation: "corrigido" } } }));
  assert.deepEqual([edit.kind, edit.targetId, edit.newText], ["edit", "WA2", "corrigido"]);
  const revoke = extractChatEvent(chat({ protocolMessage: { type: 0, key: { id: "WA3" } } }, { fromMe: true }));
  assert.deepEqual([revoke.kind, revoke.targetId, revoke.fromMe], ["revoke", "WA3", true]);
  assert.equal(extractChatEvent(chat({ protocolMessage: { type: 3, key: { id: "WA4" } } })), null);
});

test("grupo e mensagem vazia continuam ignorados", () => {
  assert.equal(extractChatEvent(chat({ conversation: "oi" }, { remoteJid: "123@g.us" })), null);
  assert.equal(extractChatEvent(chat({})), null);
});
