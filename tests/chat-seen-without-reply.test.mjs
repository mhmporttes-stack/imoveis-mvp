import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regra do dono (2026-10-10): "Sem resposta" = cliente VISUALIZOU a nossa última mensagem e não respondeu.
test("filtro Sem resposta = última mensagem nossa e lida", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /safeFilter === "awaiting"\) request = request\.eq\("last_message_direction", "outbound"\)/);
  assert.match(chat, /safeFilter === "awaiting" \? await keepSeenWithoutReply\(unresolved\) : unresolved/);
  assert.match(chat, /latest\.get\(row\.id\) === "read"/);
});

// Pedido do dono (2026-10-10): a prévia da lista mostra enviada / entregue / lida.
test("prévia da lista usa o status da última mensagem enviada", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /lastOutboundStatus: statuses\.get\(row\.id\)/);
  const ui = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
  assert.match(ui, /<StatusTicks status=\{conversation\.lastOutboundStatus\} \/>/);
});

// Pedidos do dono (2026-10-10): "Aguardando nós", "Marcar como resolvida", vincular cliente, "/" atalhos, transcrição e resumo.
test("Aguardando nós = última mensagem do cliente; resolvida sai dos filtros de espera", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /safeFilter === "waiting_us"\) request = request\.eq\("last_message_direction", "inbound"\)/);
  assert.match(chat, /WAITING_FILTERS = new Set\(\["awaiting", "waiting_us", "silent"\]\)/);
  assert.match(chat, /new Date\(row\.resolved_at\)\.getTime\(\) >= new Date\(row\.last_message_at\)\.getTime\(\)/);
});

test("vincular cliente respeita escopo, particular e equipe", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  const fn = chat.slice(chat.indexOf("export async function linkChatConversationToClient"), chat.indexOf("// ---", chat.indexOf("export async function linkChatConversationToClient")));
  assert.match(fn, /assertCanAccessResponsibleUser\(auth, registration\.responsible_user_id\)/);
  assert.match(fn, /conversation\.private_at/);
  assert.match(fn, /findInternalTeamPhone/);
  const route = readFileSync(new URL("../app/api/admin/whatsapp-chat/conversations/[id]/link-client/route.js", import.meta.url), "utf8");
  assert.match(route, /requireAdminApi/);
});

test("transcrição e resumo: sob demanda, com guard e registro de gasto", () => {
  for (const path of ["../app/api/admin/whatsapp-chat/conversations/[id]/summary/route.js", "../app/api/admin/whatsapp-chat/media/[messageId]/transcript/route.js"]) {
    assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /requireAdminApi/);
  }
  const ai = readFileSync(new URL("../lib/ai-chat-assist.js", import.meta.url), "utf8");
  assert.match(ai, /feature: "chat_summary"/);
  assert.match(ai, /feature: "chat_audio_transcription"/);
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /canSeeMessage\(scope, row\)\)\.map/);
});
