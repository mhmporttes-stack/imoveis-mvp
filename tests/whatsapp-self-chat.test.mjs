import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSelfChatMessage, ownIdentityFromCreds } from "../whatsapp-individual-service/src/message-extract.js";
import { placeholderKeyFor } from "../whatsapp-individual-service/src/pipeline-guard.js";
import { isSessionOwnPhone } from "../lib/whatsapp-self-chat-core.mjs";

// Caso do dono (2026-10-24): conversa com o PRÓPRIO número na Particular, 41 "Mensagem enviada pelo celular — o CRM não
// conseguiu ler o conteúdo.", todas com remote_jid = LID da própria conta. O número da sessão nunca vira conversa.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const OWN_PHONE = "5514990000001";
const OWN_LID = "111111111111111@lid";
const self = ownIdentityFromCreds({ id: `${OWN_PHONE}:12@s.whatsapp.net`, lid: "111111111111111:12@lid" });
const stub = (remoteJid, fromMe = true) => ({ key: { remoteJid, fromMe, id: "6ACAB7997A032975D8AA" }, messageStubType: 2 });

test("identidade da sessão sai de creds.me (telefone e LID sem aparelho)", () => {
  assert.equal(self.phone, OWN_PHONE);
  assert.equal(self.lids.has(OWN_LID), true);
  assert.equal(ownIdentityFromCreds({}).phone, "");
});

test("conversa consigo mesmo: telefone, LID da conta, LID mapeado ao próprio número ou nó peer", () => {
  assert.equal(isSelfChatMessage(stub(`${OWN_PHONE}@s.whatsapp.net`), { self }), true);
  assert.equal(isSelfChatMessage(stub("111111111111111:3@lid"), { self }), true);
  const noLid = ownIdentityFromCreds({ id: `${OWN_PHONE}:12@s.whatsapp.net` });
  assert.equal(isSelfChatMessage(stub("222222222222222@lid"), { self: noLid, lidMap: new Map([["222222222222222@lid", OWN_PHONE]]) }), true);
  assert.equal(isSelfChatMessage(stub("333333333333333@lid"), { self: noLid, nodeCategory: "peer" }), true);
});

test("contato de verdade continua entrando (inclusive o outro número do mesmo corretor)", () => {
  assert.equal(isSelfChatMessage(stub("5514990000002@s.whatsapp.net"), { self }), false);
  assert.equal(isSelfChatMessage(stub("444444444444444@lid"), { self, lidMap: new Map([["444444444444444@lid", "5514990000002"]]) }), false);
  assert.equal(isSelfChatMessage(stub("444444444444444@lid"), { self }), false);
  assert.equal(isSelfChatMessage(stub("120363000000000000@g.us"), { self }), false);
  assert.equal(isSelfChatMessage(stub("5514990000002@s.whatsapp.net"), { self: ownIdentityFromCreds({}) }), false);
});

test("não pede ao celular o reenvio de nó peer (protocolo), mas pede o de conversa", () => {
  assert.equal(placeholderKeyFor(stub(OWN_LID), { tag: "message", attrs: { id: "x", category: "peer" } }), null);
  assert.deepEqual(placeholderKeyFor(stub("444444444444444@lid"), { tag: "message", attrs: { id: "x" } }), { remoteJid: "444444444444444@lid", fromMe: true, id: "6ACAB7997A032975D8AA" });
});

test("CRM: o próprio número da sessão (qualquer formato) nunca vira conversa", () => {
  assert.equal(isSessionOwnPhone("+5514990000001", OWN_PHONE), true);
  assert.equal(isSessionOwnPhone("+551490000001", OWN_PHONE), true); // sem o 9
  assert.equal(isSessionOwnPhone("+5514990000002", OWN_PHONE), false);
  assert.equal(isSessionOwnPhone("lid:111111111111111", OWN_PHONE), false);
  assert.equal(isSessionOwnPhone("+5514990000001", ""), false); // sessão sem número conhecido: decide o serviço
});

test("ligações: serviço filtra antes de entregar (tempo real e histórico) e o CRM antes de criar/juntar conversa", () => {
  const sessions = read("whatsapp-individual-service/src/sessions.js");
  assert.match(sessions, /if \(isSelfChat\(userId, msg\)\) continue;\n    if \(route === "history"\)/);
  assert.match(sessions, /if \(isSelfChat\(userId, msg\)\) \{ counts\.skipped \+= 1; continue; \}/);
  assert.match(sessions, /placeholderKeyFor\(msg, node\)/);
  const inbound = read("lib/whatsapp-individual-inbound.js");
  assert.match(inbound, /isOwnSessionConversationPhone\(userId, sessionSlot, phone\)\) return \{ skipped: "proprio_numero" \}/);
  assert.match(inbound, /isOwnSessionConversationPhone\(userId, sessionSlot, realPhone\)\) return \{ merged: false, skipped: "proprio_numero" \}/);
  assert.match(inbound, /Histórico da conversa consigo mesmo[\s\S]{0,120}isOwnSessionConversationPhone/);
});
