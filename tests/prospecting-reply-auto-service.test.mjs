import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CHAT_CLIENT_EVENT, nextClientStatusOnChatEvent } from "../lib/whatsapp-client-status-core.mjs";

// Regra do dono (2026-10-02): cliente em "Tentando contato" que RESPONDE passa
// sozinho para "Em atendimento" — inclusive o que está em Prospecção (antes
// ficava parado esperando o corretor clicar na pendência). Teste estrutural dos
// pontos que garantem isso, mais a regra pura da transição.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFileSync(path.join(root, file), "utf8");

test("resposta do cliente em Tentando contato -> Em atendimento (regra pura)", () => {
  assert.equal(nextClientStatusOnChatEvent("awaiting_return", CHAT_CLIENT_EVENT.CLIENT_REPLIED), "in_service");
  assert.equal(nextClientStatusOnChatEvent("in_service", CHAT_CLIENT_EVENT.CLIENT_REPLIED), null);
  assert.equal(nextClientStatusOnChatEvent("do_not_contact", CHAT_CLIENT_EVENT.CLIENT_REPLIED), null);
});

test("Prospecção promove o cliente que respondeu e só abre pendência como rede de segurança", () => {
  const code = source("lib/prospecting-reply.js");
  const branch = code.slice(code.indexOf("REPLY_ACTION.ALERT_REPLY) {"), code.indexOf("REPLY_ACTION.ALERT_REACTIVATION) {"));
  assert.match(branch, /stopCadenceOnReply\(/);
  assert.match(branch, /markClientsInServiceOnReply\(\[client\.id\], \{ includeProspected: true \}\)/);
  assert.match(branch, /if \(changes\.length\)/);
  assert.match(branch, /else \{[\s\S]*upsertAlert\(/);
  assert.ok(branch.indexOf("stopCadenceOnReply(") < branch.indexOf("markClientsInServiceOnReply("), "encerra a cadência antes de promover");
});

test("Chat do WhatsApp individual deixa o cliente em Prospecção para a Prospecção (evita corrida)", () => {
  const code = source("lib/whatsapp-client-status.js");
  assert.match(code, /markClientsInServiceOnReply\(clientIds, \{ includeProspected = false \} = \{\}\)/);
  assert.match(code, /if \(!includeProspected\) \{[\s\S]*prospecting_contacts[\s\S]*last_attempt_at/);
  const individual = source("lib/whatsapp-individual-inbound.js");
  assert.match(individual, /markClientsInServiceOnReply\(\[clientId\]\)/);
});

test("número oficial (sem consumidor da Prospecção) promove direto", () => {
  assert.match(source("lib/whatsapp-chat.js"), /markClientsInServiceOnReply\(\[\.\.\.repliedClientIds\], \{ includeProspected: true \}\)/);
});
