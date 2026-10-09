import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Conversa do número OFICIAL com a janela de 24 h aberta responde pelo oficial, mesmo que o WhatsApp pessoal do
// corretor esteja desconectado (dono, 2026-10-09; caso da Bruna).
test("resolveSendRoute: janela aberta no oficial -> cloud_api antes de olhar a sessão pessoal do atendente", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  const start = chat.indexOf("async function resolveSendRoute(");
  const body = chat.slice(start, chat.indexOf("const assignedUserId = conversation.assigned_user_id || null;", start));
  assert.match(body, /windowInfo\(conversation\.last_inbound_at\)\?\.open\) return \{ sendChannel: "cloud_api"/);
  assert.ok(body.indexOf("windowInfo(conversation.last_inbound_at)") < body.indexOf("listIndividualSessionRows"), "antes de consultar a sessão pessoal");
});

test("conversa no WhatsApp pessoal cujo cliente escreveu pelo oficial (janela aberta) responde pelo oficial e a tela mostra isso", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  const route = chat.slice(chat.indexOf("async function resolveSendRoute("), chat.indexOf("// Chat híbrido (2026-10-08): conversa do número OFICIAL"));
  assert.match(route, /lastInboundWasOfficial\(conversation\.id\)/);
  assert.match(route, /return \{ sendChannel: "cloud_api", sessionUserId: null, sessionSlot: null \}/);
  assert.match(chat, /replyViaOfficial,/);
  assert.match(readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8"), /conversation\.sessionUserId && !conversation\.replyViaOfficial/);
});
