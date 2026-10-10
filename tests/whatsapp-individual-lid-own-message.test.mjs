import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Caso Anderson/Bencke (2026-10-10): a corretora mandou a simulação PELO CELULAR para um cliente novo; a mensagem veio
// endereçada só por LID (sem telefone) e era descartada — o Chat ficou vazio.
test("mensagem do corretor para LID desconhecido fica guardada e é resolvida pelos candidatos do CRM", () => {
  const sessions = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.match(sessions, /const pendingLid = unresolvedOwnLid\(userId, msg\);/);
  assert.match(sessions, /sock\.onWhatsApp\(\.\.\.phones\.map/);
  assert.match(sessions, /if \(pendingLidMessages\.has\(`\$\{userId\}\|\$\{mapping\[0\]\}`\)\) flushPendingLid/);
  const webhook = readFileSync(new URL("../whatsapp-individual-service/src/webhook.js", import.meta.url), "utf8");
  assert.match(webhook, /type: "lid_candidates"/);
  const route = readFileSync(new URL("../app/api/webhooks/whatsapp-individual/route.js", import.meta.url), "utf8");
  assert.match(route, /payload\.type === "lid_candidates"/);
  const inbound = readFileSync(new URL("../lib/whatsapp-individual-inbound.js", import.meta.url), "utf8");
  assert.match(inbound, /export async function listLidCandidatePhones/);
});
