import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Pedido do dono (2026-10-11): "Não lidas" dentro de Particular = o que EU ainda não abri (leitura por pessoa).
test("Particular > Não lidas usa leitura por pessoa e abrir marca como vista", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /"private_unseen"/);
  assert.match(chat, /from\("whatsapp_conversation_reads"\)/);
  assert.match(chat, /if \(!preview && !\(conversation\.private_at && privateContentHidden\(conversation, auth\)\)\) await Promise\.all\(groupIds\.map\(\(conversationId\) => markSeenByViewer/);
  assert.match(chat, /safeFilter === "private_unseen" \|\| safeFilter === "unread" \? unresolved\.filter\(\(row\) => !seenIds\.has\(row\.id\)\)/);
  const ui = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
  assert.match(ui, /\{ key: "private_unseen", label: "Não lidas" \}/);
  assert.match(ui, /const unseenByMe = conversation\.seenByMe === false;/);
});

test("não lida por pessoa: abrir zera só para quem abriu, sem recibo ao cliente", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /if \(!preview && !\(conversation\.private_at && privateContentHidden\(conversation, auth\)\)\) await Promise\.all\(groupIds\.map\(\(conversationId\) => markSeenByViewer/);
  assert.match(chat, /seenIds\.has\(row\.id\) && withStatus\.unreadCount > 0 \? \{ \.\.\.withStatus, unreadCount: 0 \}/);
  assert.match(chat, /const unreadRows = pending\.filter\(\(row\) => !seenIds\.has\(row\.id\)\);/);
  const service = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.doesNotMatch(service, /readMessages\(/);
});
