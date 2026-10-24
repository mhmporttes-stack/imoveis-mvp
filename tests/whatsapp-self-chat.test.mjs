import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSessionOwnPhone } from "../lib/whatsapp-self-chat-core.mjs";

// Caso do dono (2026-10-24): conversa com o PRÓPRIO número na Particular, 41 "Mensagem enviada pelo celular — o CRM não
// conseguiu ler o conteúdo.", todas com remote_jid = LID da própria conta. O número da sessão nunca vira conversa.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const OWN_PHONE = "5514990000001";
const OWN_LID = "111111111111111@lid";
// Parte do microsserviço (filtro na origem) entra com a publicação do Railway: branch fix-self-chat, commit 718cfc27.

test("CRM: o próprio número da sessão (qualquer formato) nunca vira conversa", () => {
  assert.equal(isSessionOwnPhone("+5514990000001", OWN_PHONE), true);
  assert.equal(isSessionOwnPhone("+551490000001", OWN_PHONE), true); // sem o 9
  assert.equal(isSessionOwnPhone("+5514990000002", OWN_PHONE), false);
  assert.equal(isSessionOwnPhone("lid:111111111111111", OWN_PHONE), false);
  assert.equal(isSessionOwnPhone("+5514990000001", ""), false); // sessão sem número conhecido: decide o serviço
});

test("ligações: o CRM filtra antes de criar/juntar conversa", () => {
  const inbound = read("lib/whatsapp-individual-inbound.js");
  assert.match(inbound, /isOwnSessionConversationPhone\(userId, sessionSlot, phone\)\) return \{ skipped: "proprio_numero" \}/);
  assert.match(inbound, /isOwnSessionConversationPhone\(userId, sessionSlot, realPhone\)\) return \{ merged: false, skipped: "proprio_numero" \}/);
  assert.match(inbound, /Histórico da conversa consigo mesmo[\s\S]{0,120}isOwnSessionConversationPhone/);
});
