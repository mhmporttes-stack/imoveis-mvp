// Visualização única (WA-35, dono 2026-10-23): o serviço manda só o marcador (nunca baixa a mídia), nos dois sentidos, e
// o CRM grava a linha "view_once" com texto fixo. Aba "Mídias" de Particular: tipos sem figurinha e cursor seguro.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractChatEvent, extractUndecryptedOwnEvent, viewOnceOf } from "../whatsapp-individual-service/src/message-extract.js";
import { VIEW_ONCE_MESSAGE_TYPE, normalizeViewOnce, viewOnceText } from "../lib/whatsapp-view-once-core.mjs";
import { PRIVATE_MEDIA_TYPES, encodePrivateMediaCursor, normalizeBrokerFilter, normalizePrivateMediaType, parsePrivateMediaCursor } from "../lib/whatsapp-private-media-core.mjs";

const JID = "5514988887777@s.whatsapp.net";
const stub = (fromMe) => ({ key: { id: "VO1", fromMe, remoteJid: JID, isViewOnce: true }, messageStubType: 2, messageStubParameters: ["Message absent from node"], messageTimestamp: 1760900000 });

test("stub de visualização única do CONTATO (antes descartado) vira marcador sem mídia", () => {
  const event = extractChatEvent(stub(false));
  assert.equal(event.kind, "message");
  assert.equal(event.messageType, VIEW_ONCE_MESSAGE_TYPE);
  assert.equal(event.media, null);
  assert.deepEqual(event.viewOnce, { media: "" });
  assert.equal(event.fromMe, false);
  assert.equal(event.waMessageId, "VO1");
});

test("stub de visualização única do CELULAR do corretor: marcador próprio, não 'não decifrada'", () => {
  assert.equal(extractUndecryptedOwnEvent(stub(true)), null);
  const event = extractChatEvent(stub(true));
  assert.equal(event.messageType, VIEW_ONCE_MESSAGE_TYPE);
  assert.equal(event.fromMe, true);
});

test("stub comum (sem isViewOnce) continua como antes", () => {
  const plain = { ...stub(true), key: { id: "X", fromMe: true, remoteJid: JID } };
  assert.ok(extractUndecryptedOwnEvent(plain));
  assert.equal(extractChatEvent({ ...plain, key: { ...plain.key, fromMe: false } }), null);
});

test("envelope viewOnceMessageV2 com foto: marcador com o tipo, mídia NUNCA vai para download", () => {
  const msg = { key: { id: "VO2", fromMe: false, remoteJid: JID }, messageTimestamp: 1760900000, message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg", viewOnce: true, caption: "olha" } } } } };
  const event = extractChatEvent(msg);
  assert.equal(event.messageType, VIEW_ONCE_MESSAGE_TYPE);
  assert.equal(event.media, null);
  assert.equal(event.text, "");
  assert.deepEqual(event.viewOnce, { media: "image" });
});

test("áudio de visualização única (V2Extension) e flag viewOnce sem envelope", () => {
  assert.deepEqual(viewOnceOf({ message: { viewOnceMessageV2Extension: { message: { audioMessage: { ptt: true } } } } }), { media: "audio" });
  assert.deepEqual(viewOnceOf({ message: { videoMessage: { viewOnce: true } } }), { media: "video" });
  assert.equal(viewOnceOf({ message: { imageMessage: { mimetype: "image/jpeg" } } }), null);
  assert.equal(viewOnceOf({ message: { ephemeralMessage: { message: { imageMessage: {} } } } }), null);
});

test("foto comum continua sendo mídia normal", () => {
  const event = extractChatEvent({ key: { id: "N1", fromMe: false, remoteJid: JID }, messageTimestamp: 1760900000, message: { imageMessage: { mimetype: "image/jpeg" } } });
  assert.equal(event.messageType, "image");
  assert.equal(event.media.kind, "image");
});

test("grupo: visualização única não vai ao CRM (nada baixado)", () => {
  const msg = { key: { id: "G1", fromMe: false, remoteJid: "123-456@g.us", isViewOnce: true }, messageStubType: 2, messageTimestamp: 1760900000 };
  assert.equal(extractChatEvent(msg), null);
});

test("CRM: normaliza o marcador e escolhe o texto do balão", () => {
  assert.equal(normalizeViewOnce(null), null);
  assert.deepEqual(normalizeViewOnce({ media: "sticker" }), { media: "" });
  assert.match(viewOnceText("image"), /^📷 Foto\/vídeo de visualização única — só pode ser aberto no celular$/);
  assert.match(viewOnceText("audio"), /Áudio de visualização única/);
  assert.match(viewOnceText(""), /visualização única/);
});

test("CRM grava view_once sem arquivo e o webhook repassa viewOnce", () => {
  const inbound = readFileSync(new URL("../lib/whatsapp-individual-inbound.js", import.meta.url), "utf8");
  assert.match(inbound, /if \(viewOnce\) return \{ messageType: VIEW_ONCE_MESSAGE_TYPE, metadataMedia: null/);
  const route = readFileSync(new URL("../app/api/webhooks/whatsapp-individual/route.js", import.meta.url), "utf8");
  assert.match(route, /viewOnce: normalizeViewOnce\(payload\.viewOnce\)/);
});

test("Mídias de Particular: sem figurinha, filtros e cursor seguros", () => {
  assert.deepEqual(PRIVATE_MEDIA_TYPES, ["image", "video", "audio", "document"]);
  assert.equal(normalizePrivateMediaType("sticker"), "");
  assert.equal(normalizePrivateMediaType("video"), "video");
  assert.equal(normalizeBrokerFilter("abc"), "");
  const id = "0b0b0b0b-0000-4000-8000-000000000000";
  assert.equal(normalizeBrokerFilter(id.toUpperCase()), id);
  const cursor = encodePrivateMediaCursor({ message_at: "2026-10-23T12:00:00.123456+00:00", id });
  assert.deepEqual(parsePrivateMediaCursor(cursor), { at: "2026-10-23T12:00:00.123456+00:00", id });
  assert.equal(parsePrivateMediaCursor(`x),id.gt.0|${id}`), null);
  assert.equal(parsePrivateMediaCursor("2026-10-23|nao-uuid"), null);
});

test("Mídias de Particular: barreira no servidor (admin geral) e grupos só para quem vê Grupos", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  const body = chat.slice(chat.indexOf("export async function listPrivateMediaGallery"));
  assert.match(body, /if \(!auth \|\| !isGeneralAdminAuth\(auth\)\) throw new WhatsappChatError/);
  assert.match(body, /const withGroups = isArchivedChatViewer\(auth\);/);
  assert.match(body, /if \(!withGroups\) request = request\.not\("whatsapp_conversations\.contact_phone", "like", "group:%"\)/);
});
