import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regra do dono (2026-10-10, WA-26): WhatsApp pessoal sem card de cliente -> Particular automático; ganhou card -> sai.
const src = readFileSync(new URL("../lib/whatsapp-auto-private.js", import.meta.url), "utf8");

test("só o WhatsApp pessoal e só sem card", () => {
  assert.match(src, /row\.session_key !== OFFICIAL_SESSION_KEY/);
  assert.match(src, /origin: \{ \.\.\.\(row\.origin \|\| \{\}\), auto_private: true \}/);
  assert.match(src, /\.eq\("id", row\.id\)\.is\("client_id", null\)\.is\("private_at", null\)/);
});

test("Particular marcada à mão nunca é desfeita; a automática sai quando ganha card", () => {
  assert.match(src, /if \(row\.private_at && !isAutoPrivate\(row\)\) continue;/);
  assert.match(src, /private_at: null, private_by: null, origin: \{ \.\.\.\(row\.origin \|\| \{\}\), auto_private: false \}/);
});

test("ligado na chegada de mensagem, no cron e nos botões de card", () => {
  const inbound = readFileSync(new URL("../lib/whatsapp-individual-inbound.js", import.meta.url), "utf8");
  assert.equal((inbound.match(/await applyAutoPrivacy\(conversation\.id\)/g) || []).length, 2);
  const cron = readFileSync(new URL("../app/api/cron/scheduled-activities/route.js", import.meta.url), "utf8");
  assert.match(cron, /reconcileAutoPrivateConversations\(\)/);
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.ok((chat.match(/applyAutoPrivacy\(id\)/g) || []).length >= 2);
});
