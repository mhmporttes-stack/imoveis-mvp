import test from "node:test";
import assert from "node:assert/strict";
import {
  DELETE_FOR_EVERYONE_WINDOW_MS,
  EDIT_WINDOW_MS,
  canDeleteForEveryone,
  canEditMessage,
  canReplyOrReact,
  chatTypeForIndividualMedia,
  messageRefId,
  outboundKindForMime,
  replyTargetRefId
} from "../lib/whatsapp-message-actions.mjs";

// Regras das ações por mensagem do Chat — as MESMAS para celular, app de
// computador e navegador (a tela só exibe o que o servidor permite).
const NOW = Date.parse("2026-10-02T15:00:00Z");
const sent = (minutesAgo, extra = {}) => ({
  id: "m1", direction: "outbound", sender_type: "user", sender_user_id: "u1", channel: "whatsapp_individual",
  message_type: "text", body: "Oi", status: "delivered", metadata: { wa_message_id: "WA1" },
  sent_at: new Date(NOW - minutesAgo * 60000).toISOString(), ...extra
});

test("editar: só quem enviou (ou gestor/admin), só texto ou legenda, até 15 min", () => {
  assert.equal(canEditMessage(sent(5), { userId: "u1" }, NOW), true);
  assert.equal(canEditMessage(sent(5), { userId: "u2" }, NOW), false);
  assert.equal(canEditMessage(sent(5), { userId: "u2", isManager: true }, NOW), true);
  assert.equal(canEditMessage(sent(EDIT_WINDOW_MS / 60000 + 1), { userId: "u1" }, NOW), false);
  assert.equal(canEditMessage(sent(1, { message_type: "audio", body: "" }), { userId: "u1" }, NOW), false);
  assert.equal(canEditMessage(sent(1, { message_type: "image", body: "legenda" }), { userId: "u1" }, NOW), true);
  assert.equal(canEditMessage(sent(1, { message_type: "image", body: "" }), { userId: "u1" }, NOW), false);
});

test("editar/apagar nunca no número oficial, em mensagem do cliente, falhada, apagada ou de automação", () => {
  const actor = { userId: "u1", isManager: true };
  assert.equal(canEditMessage(sent(1, { channel: "whatsapp_cloud_api" }), actor, NOW), false);
  assert.equal(canDeleteForEveryone(sent(1, { direction: "inbound" }), actor, NOW), false);
  assert.equal(canDeleteForEveryone(sent(1, { status: "failed" }), actor, NOW), false);
  assert.equal(canDeleteForEveryone(sent(1, { metadata: { wa_message_id: "WA1", revoked_at: "x" } }), actor, NOW), false);
  assert.equal(canDeleteForEveryone(sent(1, { sender_type: "automation" }), actor, NOW), false);
  assert.equal(canDeleteForEveryone(sent(1, { metadata: {} }), actor, NOW), false);
});

test("apagar para todos: até 48 h, qualquer tipo de mídia", () => {
  assert.equal(canDeleteForEveryone(sent(60 * 47, { message_type: "video" }), { userId: "u1" }, NOW), true);
  assert.equal(canDeleteForEveryone(sent(DELETE_FOR_EVERYONE_WINDOW_MS / 60000 + 1), { userId: "u1" }, NOW), false);
});

test("responder/reagir: individual nas duas direções; oficial só na mensagem do cliente", () => {
  assert.equal(canReplyOrReact(sent(1)), true);
  assert.equal(canReplyOrReact(sent(1, { direction: "inbound", sender_type: "customer" })), true);
  assert.equal(canReplyOrReact({ direction: "inbound", channel: "whatsapp_cloud_api", meta_message_id: "wamid.1", metadata: {} }), true);
  assert.equal(canReplyOrReact({ direction: "outbound", channel: "whatsapp_cloud_api", meta_message_id: "wamid.2", metadata: {} }), false);
  assert.equal(canReplyOrReact({ direction: "internal", metadata: {} }), false);
  assert.equal(canReplyOrReact(sent(1, { metadata: { wa_message_id: "WA1", revoked_at: "x" } })), false);
});

test("ids: mesma referência para Meta e individual (citação e reação)", () => {
  assert.equal(messageRefId({ meta_message_id: "wamid.1" }), "wamid.1");
  assert.equal(messageRefId({ metadata: { wa_message_id: "WA1" } }), "WA1");
  assert.equal(replyTargetRefId({ payload: { context: { id: "wamid.0" } } }), "wamid.0");
  assert.equal(replyTargetRefId({ metadata: { reply_to_wa_id: "WA0" } }), "WA0");
});

test("anexo do atendente: tipo de envio por MIME (GIF, figurinha, vídeo)", () => {
  assert.equal(outboundKindForMime("image/jpeg"), "image");
  assert.equal(outboundKindForMime("image/webp"), "sticker");
  assert.equal(outboundKindForMime("image/gif"), "gif_file");
  assert.equal(outboundKindForMime("video/mp4"), "video");
  assert.equal(outboundKindForMime("video/mp4", { asGif: true }), "gif");
  assert.equal(outboundKindForMime("video/quicktime", { asGif: true }), "video");
  assert.equal(outboundKindForMime("application/x-msdownload"), "");
  assert.equal(chatTypeForIndividualMedia("gif"), "video");
  assert.equal(chatTypeForIndividualMedia("sticker"), "sticker");
  assert.equal(chatTypeForIndividualMedia("qualquer"), "document");
});
