import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLidPlaceholder, lidPlaceholderFromJid } from "../lib/whatsapp-lid-placeholder.mjs";

// Regra do dono (2026-10-10): tudo do WhatsApp do corretor entra no Chat, mesmo antes de se saber o número.
test("LID vira marcador estável e reconhecível", () => {
  assert.equal(lidPlaceholderFromJid("247050881003585@lid"), "lid:247050881003585");
  assert.equal(lidPlaceholderFromJid("247050881003585:12@lid"), "lid:247050881003585");
  assert.equal(lidPlaceholderFromJid("5514999990000@s.whatsapp.net"), "");
  assert.equal(isLidPlaceholder("lid:247050881003585"), true);
  assert.equal(isLidPlaceholder("+5514999990000"), false);
  assert.equal(isLidPlaceholder("lid:abc"), false);
});

test("conversa sem número entra e é juntada quando o telefone aparece", () => {
  const inbound = readFileSync(new URL("../lib/whatsapp-individual-inbound.js", import.meta.url), "utf8");
  assert.match(inbound, /export async function mergeLidConversation/);
  assert.match(inbound, /const placeholder = isLidPlaceholder\(from\)/);
  const sessions = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.match(sessions, /notifyLidResolved/);
  assert.match(sessions, /if \(lid\) return `\$\{lid\[1\]\}@lid`;/);
  const route = readFileSync(new URL("../app/api/webhooks/whatsapp-individual/route.js", import.meta.url), "utf8");
  assert.match(route, /payload\.type === "lid_resolved"/);
});
