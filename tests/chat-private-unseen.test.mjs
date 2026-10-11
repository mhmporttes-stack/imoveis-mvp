import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Pedido do dono (2026-10-11): "Não lidas" dentro de Particular = o que EU ainda não abri (leitura por pessoa).
test("Particular > Não lidas usa leitura por pessoa e abrir marca como vista", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /"private_unseen"/);
  assert.match(chat, /from\("whatsapp_conversation_reads"\)/);
  assert.match(chat, /if \(!preview && conversation\.private_at && !privateContentHidden\(conversation, auth\)\) await markSeenByViewer/);
  assert.match(chat, /safeFilter === "private_unseen" \? unresolved\.filter\(\(row\) => !seenIds\.has\(row\.id\)\)/);
  const ui = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
  assert.match(ui, /\{ key: "private_unseen", label: "Não lidas" \}/);
  assert.match(ui, /const unseenByMe = conversation\.seenByMe === false;/);
});
