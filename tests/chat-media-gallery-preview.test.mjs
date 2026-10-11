import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Pedido do dono (2026-10-11): "Mídia, links e docs" e pré-visualização ao segurar a conversa (sem marcar lida).
test("pré-visualização não marca nada como lido/visto", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /if \(!preview && conversation\.private_at && !privateContentHidden\(conversation, auth\)\) await markSeenByViewer/);
  assert.match(chat, /if \(!preview && !archivedReadOnly && await readerOwnsConversation/);
  const route = readFileSync(new URL("../app/api/admin/whatsapp-chat/conversations/[id]/route.js", import.meta.url), "utf8");
  assert.match(route, /const preview = searchParams\.get\("preview"\) === "1";/);
  const ui = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
  assert.match(ui, /conversations\/\$\{conversationId\}\?preview=1/);
  // a pré-visualização nunca chama a rota que marca como lida
  const modal = ui.slice(ui.indexOf("function ConversationPreviewModal"), ui.indexOf("function ConversationMediaButton"));
  assert.doesNotMatch(modal, /\/read`/);
});

test("galeria de mídia usa a checagem de acesso da conversa e das mensagens", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  const fn = chat.slice(chat.indexOf("export async function listChatConversationMedia"), chat.indexOf("// Compatibilidade: só áudio"));
  assert.match(fn, /await loadConversation\(id, auth/);
  assert.match(fn, /canSeeMessage\(scope, row\)/);
  const route = readFileSync(new URL("../app/api/admin/whatsapp-chat/conversations/[id]/media-list/route.js", import.meta.url), "utf8");
  assert.match(route, /requireAdminApi/);
});
