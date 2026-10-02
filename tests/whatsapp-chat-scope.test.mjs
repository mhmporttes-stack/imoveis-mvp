import test from "node:test";
import assert from "node:assert/strict";
import { allowedBrokerFilter, buildChatScope, canAssignTo, canSeeConversation, canSeeMessage } from "../lib/whatsapp-chat-scope.mjs";

// Ids sintéticos: dono (admin), Gestor A com C1/C2, Gestor B com C3.
const admin = buildChatScope({ generalAdmin: true, profileId: "dono" });
const gestorA = buildChatScope({ manager: true, profileId: "gA", managedUserIds: ["gA", "c1", "c2"] });
const gestorB = buildChatScope({ manager: true, profileId: "gB", managedUserIds: ["gB", "c3"] });
const corretor1 = buildChatScope({ broker: true, profileId: "c1" });
const associado = buildChatScope({ broker: true, profileId: "a1", linkedBrokerId: "c1" });
const conv = (assignedUserId, responsibleUserId = null) => ({ assignedUserId, responsibleUserId });

test("admin/dono vê todas as conversas", () => {
  for (const c of [conv("dono"), conv("c1"), conv("c3"), conv(null, "gB"), conv(null, null)]) assert.equal(canSeeConversation(admin, c), true);
});

test("Gestor A: próprias + corretores dele; nunca Gestor B, equipe B, dono ou conversa sem dono", () => {
  assert.equal(canSeeConversation(gestorA, conv("gA")), true);
  assert.equal(canSeeConversation(gestorA, conv("c1")), true);
  assert.equal(canSeeConversation(gestorA, conv(null, "c2")), true);
  assert.equal(canSeeConversation(gestorA, conv("gB")), false);
  assert.equal(canSeeConversation(gestorA, conv("c3")), false);
  assert.equal(canSeeConversation(gestorA, conv("dono")), false);
  assert.equal(canSeeConversation(gestorA, conv(null, null)), false);
});

test("Gestor B: mesma regra, isolado", () => {
  assert.equal(canSeeConversation(gestorB, conv("c3")), true);
  assert.equal(canSeeConversation(gestorB, conv("c1")), false);
  assert.equal(canSeeConversation(gestorB, conv("gA")), false);
});

test("corretor mudou de gestor: o acesso acompanha a relação atual", () => {
  const gestorANovo = buildChatScope({ manager: true, profileId: "gA", managedUserIds: ["gA", "c1"] });
  const gestorBNovo = buildChatScope({ manager: true, profileId: "gB", managedUserIds: ["gB", "c3", "c2"] });
  assert.equal(canSeeConversation(gestorANovo, conv("c2")), false);
  assert.equal(canSeeConversation(gestorBNovo, conv("c2")), true);
});

test("corretor: só as próprias (atribuída ou cliente dele); associado: as do corretor vinculado", () => {
  assert.equal(canSeeConversation(corretor1, conv("c1")), true);
  assert.equal(canSeeConversation(corretor1, conv(null, "c1")), true);
  assert.equal(canSeeConversation(corretor1, conv("c2")), false);
  assert.equal(canSeeConversation(corretor1, conv("gA")), false);
  assert.equal(canSeeConversation(corretor1, conv("dono")), false);
  assert.equal(canSeeConversation(associado, conv("c1")), true);
  assert.equal(canSeeConversation(buildChatScope({}), conv("c1")), false);
});

test("mensagem do WhatsApp pessoal de quem está fora do escopo fica oculta", () => {
  const ownerMsg = { session_user_id: "dono" };
  assert.equal(canSeeMessage(admin, ownerMsg), true);
  assert.equal(canSeeMessage(gestorA, ownerMsg), false);
  assert.equal(canSeeMessage(gestorA, { session_user_id: "c1" }), true);
  assert.equal(canSeeMessage(corretor1, { session_user_id: "c2" }), false);
  assert.equal(canSeeMessage(corretor1, { session_user_id: null }), true);
});

test("filtro de corretor e atribuição respeitam o escopo do gestor", () => {
  assert.equal(allowedBrokerFilter(gestorA, "c1"), "c1");
  assert.equal(allowedBrokerFilter(gestorA, "c3"), null);
  assert.equal(allowedBrokerFilter(admin, "c3"), "c3");
  assert.equal(allowedBrokerFilter(corretor1, "c1"), null);
  assert.equal(allowedBrokerFilter(gestorA, ""), "");
  assert.equal(canAssignTo(gestorA, "c2"), true);
  assert.equal(canAssignTo(gestorA, "c3"), false);
  assert.equal(canAssignTo(admin, "c3"), true);
  assert.equal(canAssignTo(corretor1, "c2"), false);
});
