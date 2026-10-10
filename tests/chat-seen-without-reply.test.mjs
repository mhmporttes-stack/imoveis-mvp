import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regra do dono (2026-10-10): "Sem resposta" = cliente VISUALIZOU a nossa última mensagem e não respondeu.
test("filtro Sem resposta = última mensagem nossa e lida", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /safeFilter === "awaiting"\) request = request\.eq\("last_message_direction", "outbound"\)/);
  assert.match(chat, /safeFilter === "awaiting" \? await keepSeenWithoutReply\(rows\) : rows/);
  assert.match(chat, /latest\.get\(row\.id\) === "read"/);
});

// Pedido do dono (2026-10-10): a prévia da lista mostra enviada / entregue / lida.
test("prévia da lista usa o status da última mensagem enviada", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /lastOutboundStatus: statuses\.get\(row\.id\)/);
  const ui = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
  assert.match(ui, /<StatusTicks status=\{conversation\.lastOutboundStatus\} \/>/);
});
