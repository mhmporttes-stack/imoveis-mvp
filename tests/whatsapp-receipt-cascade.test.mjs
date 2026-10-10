import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-10-10: recibos perdidos do WhatsApp pessoal deixavam mensagens em 1 tique para sempre.
test("recibo vale para as anteriores; resposta do cliente marca as anteriores como entregues", () => {
  const src = readFileSync(new URL("../lib/whatsapp-individual-inbound.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function cascadeOutboundStatus"), src.indexOf("export async function projectIndividualMessageStatus"));
  assert.match(fn, /\.in\("status", status === "read" \? \["sent", "delivered"\] : \["sent"\]\)/);
  assert.match(fn, /\.lte\("message_at", upTo\)/);
  assert.match(fn, /\.eq\("direction", "outbound"\)\.eq\("channel", "whatsapp_individual"\)/);
  assert.match(src, /status: "delivered", userId: userId \|\| null, slot: sessionSlot \}\)/);
});
