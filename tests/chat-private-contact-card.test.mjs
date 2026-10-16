// Contato Particular com card de cliente (ideia do dono, 2026-10-15): o card funciona, a conversa trancada nunca é aberta/ligada.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("servidor: abrir, checar e responder pelo card nunca tocam a conversa trancada", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /async function hasPrivateConversationForClient\(client, phone\)/);
  assert.match(chat, /\.not\("private_at", "is", null\)\.limit\(1\)/, "procura conversa trancada deste telefone");
  assert.match(chat, /if \(await hasPrivateConversationForClient\(client, phone\)\) return \{ conversationId: null, privateContact: true \};/, "open-client: sem ligar/abrir/criar");
  assert.match(chat, /return \{ exists: null, privateContact: true \};/, "check-client: avisa a tela");
  assert.match(chat, /if \(await hasPrivateConversationForClient\(client, phone\)\) return \{ ready: false, reason: "no_conversation" \};/, "lista de documentos segue pelo celular");
});

test("telas: botão do card abre o WhatsApp externo e o Chat explica, sem mostrar a conversa", () => {
  const hook = read("components/clients/useClientList.js");
  assert.match(hook, /if \(check\?\.privateContact\) \{[\s\S]*?buildExternalWhatsappUrl\(value, readCardDevice\(\)\)/);
  assert.match(read("components/WhatsappChat.jsx"), /if \(data\.privateContact\) setOpenError\("Contato particular:/);
});
