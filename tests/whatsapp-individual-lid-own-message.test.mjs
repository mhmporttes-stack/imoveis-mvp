import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Caso Anderson/Bencke (2026-10-10): a corretora mandou a simulação PELO CELULAR para um cliente novo; a mensagem veio
// endereçada só por LID (sem telefone) e era descartada — o Chat ficou vazio.
test("mensagem do corretor para LID desconhecido fica guardada e é resolvida pelos candidatos do CRM", () => {
  const sessions = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.match(sessions, /const ownLid = unresolvedOwnLid\(userId, msg\);/);
  assert.match(sessions, /sock\.onWhatsApp\(\.\.\.phones\.map/);
  assert.match(sessions, /placeholderLids\.has\(placeholderId\)/);
  const webhook = readFileSync(new URL("../whatsapp-individual-service/src/webhook.js", import.meta.url), "utf8");
  assert.match(webhook, /type: "lid_candidates"/);
  const route = readFileSync(new URL("../app/api/webhooks/whatsapp-individual/route.js", import.meta.url), "utf8");
  assert.match(route, /payload\.type === "lid_candidates"/);
  const inbound = readFileSync(new URL("../lib/whatsapp-individual-inbound.js", import.meta.url), "utf8");
  assert.match(inbound, /export async function listLidCandidatePhones/);
});

// Histórico ao conectar (2026-10-11): desde 29/09 nenhuma mensagem de histórico entrou — contato só com LID era descartado.
test("histórico: contato sem telefone (LID) entra como Número não identificado e vira Particular se não tiver card", async () => {
  const { extractChatEvent } = await import("../whatsapp-individual-service/src/message-extract.js");
  const msg = { key: { remoteJid: "247050881003585@lid", fromMe: false, id: "H1" }, messageTimestamp: 1791600000, message: { conversation: "oi" } };
  assert.equal(extractChatEvent(msg), null);
  assert.equal(extractChatEvent(msg, new Map([["247050881003585@lid", "lid:247050881003585"]])).from, "lid:247050881003585");
  const sessions = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.match(sessions, /const event = extractChatEvent\(msg, ownLid \? withPlaceholder\(userId, ownLid\) : lidMapFor\(userId\)\);/);
  assert.match(sessions, /rememberLidsFromContacts\(userId, contacts\);/);
  const inbound = readFileSync(new URL("../lib/whatsapp-individual-inbound.js", import.meta.url), "utf8");
  assert.match(inbound, /phone = knownByLid\.get\(placeholder\) \|\| placeholder;/);
  assert.match(inbound, /Falha no Particular automático \(histórico\)/);
});
