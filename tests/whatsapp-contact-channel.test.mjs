import test from "node:test";
import assert from "node:assert/strict";
import { resolveClientWhatsappDestination } from "../lib/whatsapp-contact-channel.js";

test("botão WhatsApp do card sempre abre o Chat do cliente", async () => {
  const result = await resolveClientWhatsappDestination("abc-123");
  assert.deepEqual(result, { channel: "chat", url: "/admin/chat?client=abc-123" });
});

test("codifica o clientId na URL", async () => {
  const result = await resolveClientWhatsappDestination("abc/123 xyz");
  assert.deepEqual(result, { channel: "chat", url: "/admin/chat?client=abc%2F123%20xyz" });
});
