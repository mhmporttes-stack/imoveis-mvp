// Chat leve no celular (2026-10-30): trava das otimizações de desempenho do Chat.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
const lib = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");

test("bolhas e linhas da lista são memo (busca/rolagem não redesenham tudo)", () => {
  assert.match(chat, /const MessageBubble = memo\(function MessageBubble/);
  assert.match(chat, /const ConversationRow = memo\(function ConversationRow/);
  assert.match(chat, /onSelect=\{selectRow\} onPreview=\{setPreviewId\}/);
});

test("página de 50 mensagens e anteriores ao rolar para cima, sem pular a tela", () => {
  assert.match(lib, /const MESSAGE_PAGE_SIZE = 50;/);
  assert.match(chat, /onScroll=\{onThreadScroll\}/);
  assert.match(chat, /olderAnchorRef\.current = element \?/);
  assert.match(chat, /Ver mensagens anteriores/);
});
