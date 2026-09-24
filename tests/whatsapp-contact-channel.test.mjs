import test from "node:test";
import assert from "node:assert/strict";
import { resolveClientWhatsappDestination } from "../lib/whatsapp-contact-channel.js";

function mockFetch(handler) {
  globalThis.fetch = async (url) => handler(String(url));
}
const json = (body, ok = true) => ({ ok, json: async () => body });

test("dentro da janela de 24h abre o Chat do cliente", async () => {
  mockFetch(() => json({ windowOpen: true }));
  const result = await resolveClientWhatsappDestination("abc-123", "+5514991099548");
  assert.deepEqual(result, { channel: "chat", url: "/admin/chat?client=abc-123" });
});

test("fora da janela de 24h abre o WhatsApp pessoal do corretor (wa.me)", async () => {
  mockFetch(() => json({ windowOpen: false }));
  const result = await resolveClientWhatsappDestination("abc-123", "+5514991099548");
  assert.deepEqual(result, { channel: "personal", url: "https://wa.me/5514991099548" });
});

test("sem conversa ou erro na consulta cai no WhatsApp pessoal (nunca trava o botão)", async () => {
  mockFetch(() => json({ error: "x" }, false));
  assert.equal((await resolveClientWhatsappDestination("c", "14991099548")).channel, "personal");
  mockFetch(() => { throw new Error("rede"); });
  const result = await resolveClientWhatsappDestination("c", "14991099548");
  assert.deepEqual(result, { channel: "personal", url: "https://wa.me/5514991099548" });
});
