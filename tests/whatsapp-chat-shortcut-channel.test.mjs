import { test } from "node:test";
import assert from "node:assert/strict";
import { shortcutChannelOf, shortcutVisibleIn, validateShortcutChannel } from "../lib/chat-shortcut-channel.mjs";
import { fillMarketplaceShortcut, marketplaceOfficialWhatsappText } from "../lib/marketplace-chat-core.mjs";
import { OFFICIAL_WHATSAPP_DIGITS } from "../lib/official-whatsapp.mjs";
import { extractContactCode } from "../lib/whatsapp-contact-code-core.mjs";

// MKT-2f (dono, 2026-10-22): atalhos de texto no Chat do Marketplace e "Nosso WhatsApp".

test("sem a coluna channel (migration não aplicada) tudo é do Chat do WhatsApp", () => {
  assert.equal(shortcutChannelOf({ kind: "text" }), "whatsapp");
  assert.equal(shortcutVisibleIn({ kind: "text" }, "whatsapp"), true);
  assert.equal(shortcutVisibleIn({ kind: "text" }, "marketplace"), false);
});

test("Marketplace lista só TEXTO do canal marketplace ou both; WhatsApp não vê os só do Marketplace", () => {
  assert.equal(shortcutVisibleIn({ kind: "text", channel: "marketplace" }, "marketplace"), true);
  assert.equal(shortcutVisibleIn({ kind: "text", channel: "both" }, "marketplace"), true);
  assert.equal(shortcutVisibleIn({ kind: "image", channel: "both" }, "marketplace"), false);
  assert.equal(shortcutVisibleIn({ kind: "text", channel: "whatsapp" }, "marketplace"), false);
  assert.equal(shortcutVisibleIn({ kind: "text", channel: "marketplace" }, "whatsapp"), false);
  assert.equal(shortcutVisibleIn({ kind: "image", channel: "both" }, "whatsapp"), true);
});

test("canal: só texto vai ao Marketplace, com até 2.000 caracteres", () => {
  assert.deepEqual(validateShortcutChannel({ channel: "both", kind: "text", body: "oi" }), { channel: "both" });
  assert.ok(validateShortcutChannel({ channel: "marketplace", kind: "image" }).error);
  assert.ok(validateShortcutChannel({ channel: "outro", kind: "text" }).error);
  assert.ok(validateShortcutChannel({ channel: "marketplace", kind: "text", body: "x".repeat(2001) }).error);
  assert.deepEqual(validateShortcutChannel({ channel: "whatsapp", kind: "text", body: "x".repeat(3000) }), { channel: "whatsapp" });
});

test("preenche [nome], [anúncio] e [corretor]; o resto fica para editar", () => {
  const body = "Oi, [nome]! Aqui é [corretor]. O [anúncio] tem [quartos] quartos. [Anuncio]";
  const filled = fillMarketplaceShortcut(body, { clientName: "  Maria  da Silva", listingTitle: "Casa no Jardim", brokerName: "Eduardo Bueno" });
  assert.equal(filled, "Oi, Maria! Aqui é Eduardo. O Casa no Jardim tem [quartos] quartos. Casa no Jardim");
  assert.equal(fillMarketplaceShortcut("Oi, [nome]!", {}), "Oi, [nome]!");
});

test("Nosso WhatsApp: link do número OFICIAL com o código do atendimento do cliente", () => {
  const clientId = "1a2b3c4d-1111-2222-3333-444455556666";
  const text = marketplaceOfficialWhatsappText({ clientId, listingTitle: "Casa no Jardim" });
  assert.ok(text.includes(`https://wa.me/${OFFICIAL_WHATSAPP_DIGITS}?text=`));
  const ready = decodeURIComponent(text.split("?text=")[1]);
  assert.ok(ready.startsWith("Olá! Vim do Marketplace (anúncio: Casa no Jardim)."));
  assert.equal(extractContactCode(ready), "1a2b3c4d");
  // Sem cliente ligado: oficial, sem código.
  const plain = decodeURIComponent(marketplaceOfficialWhatsappText({}).split("?text=")[1]);
  assert.equal(plain, "Olá! Vim do Marketplace.");
});
