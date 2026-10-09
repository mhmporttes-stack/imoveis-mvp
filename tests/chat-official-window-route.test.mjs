import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
const route = chat.slice(chat.indexOf("async function resolveSendRoute("), chat.indexOf("// Número OFICIAL (Cloud API): texto livre só dentro da janela"));

// Conversa do número OFICIAL responde SEMPRE pelo oficial; não migra mais para o WhatsApp pessoal (dono, 2026-10-09; caso
// Talita/Bruna: a migração deixava duas conversas do mesmo cliente quando ele voltava a escrever pelo oficial).
test("resolveSendRoute: conversa do oficial -> cloud_api, sem adoção pela sessão pessoal", () => {
  assert.match(route, /isIndividualChatSendDisabled\(\)\) return \{ sendChannel: "cloud_api"/);
  assert.match(route, /\n  return \{ sendChannel: "cloud_api", sessionUserId: null, sessionSlot: null \};\n\}/);
  assert.doesNotMatch(route, /session_key: assignedUserId|pickSendChannel|listIndividualSessionRows/);
});

test("conversa já no WhatsApp pessoal cujo cliente escreveu pelo oficial (janela aberta) responde pelo oficial e a tela mostra isso", () => {
  assert.match(route, /officialWindowOpen\(conversation\.id\)/);
  assert.match(chat, /replyViaOfficial,/);
  assert.match(readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8"), /conversation\.sessionUserId && !conversation\.replyViaOfficial/);
});

test("abrir o cliente pelo card nunca migra a conversa do oficial para o WhatsApp pessoal", () => {
  assert.doesNotMatch(chat, /adoptable/);
});

test("saudação automática não vai para quem já foi atendido por uma pessoa em outra conversa do mesmo telefone", () => {
  const flows = readFileSync(new URL("../lib/whatsapp-flows.js", import.meta.url), "utf8");
  assert.match(flows, /\.neq\("id", conversation\.id\)\.limit\(10\)/);
  assert.match(flows, /eq\("direction", "outbound"\)\.eq\("sender_type", "user"\)/);
});

test("janela do oficial aberta por QUALQUER mensagem do cliente nas últimas 24 h pelo oficial (mesmo que a última tenha sido no pessoal)", () => {
  const helper = chat.slice(chat.indexOf("async function officialWindowOpen("), chat.indexOf("async function resolveSendRoute("));
  assert.match(helper, /eq\("channel", "whatsapp_cloud_api"\)\.gt\("message_at", since\)/);
  assert.doesNotMatch(helper, /order\("message_at"/, "não depende de qual foi a ÚLTIMA mensagem");
});
