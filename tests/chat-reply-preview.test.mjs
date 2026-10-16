// Citação ("Em resposta a") com a original fora da página carregada ou fora do CRM (2026-10-15).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quotedPreviewOf } from "../whatsapp-individual-service/src/message-extract.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("trecho da mensagem citada: texto (até 160), legenda ou rótulo da mídia; sem citação = vazio", () => {
  assert.equal(quotedPreviewOf({ quotedMessage: { conversation: "  Oi,   tudo bem?  " } }), "Oi, tudo bem?");
  assert.equal(quotedPreviewOf({ quotedMessage: { extendedTextMessage: { text: "x".repeat(300) } } }).length, 160);
  assert.equal(quotedPreviewOf({ quotedMessage: { imageMessage: { caption: "Casa" } } }), "Casa");
  assert.equal(quotedPreviewOf({ quotedMessage: { imageMessage: { mimetype: "image/jpeg" } } }), "Foto");
  assert.equal(quotedPreviewOf({ quotedMessage: { audioMessage: { ptt: true } } }), "Áudio");
  assert.equal(quotedPreviewOf({ quotedMessage: { ephemeralMessage: { message: { conversation: "Dentro" } } } }), "Dentro");
  assert.equal(quotedPreviewOf({}), "");
  assert.equal(quotedPreviewOf(null), "");
});

test("servidor resolve a original fora da página e guarda o trecho enviado pelo WhatsApp", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /async function loadReplyTargets\(conversationId, rows\)/);
  assert.match(chat, /\.in\("conversation_id", scopeIds\)\.in\("metadata->>wa_message_id", missing\)/, "mesma conversa e a conversa irmã (mesmo corretor e contato)");
  assert.match(chat, /replyPreview: replyPreviewFor\(row, replyTargets\),/);
  assert.match(read("lib/whatsapp-individual-inbound.js"), /metadata\.reply_to_preview = preview/);
  assert.match(read("app/api/webhooks/whatsapp-individual/route.js"), /quotedText: payload\.quotedText,/);
  assert.match(read("components/WhatsappChat.jsx"), /const replyRef = quoted \|\| message\.replyPreview \|\| null;/);
});
