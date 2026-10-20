// Microsserviço: saída do corretor que a sessão do CRM não decifrou (stub CIPHERTEXT) vira o evento
// `undecrypted_message` aceito pelo CRM (lib/whatsapp-undecrypted-core.mjs) — 2026-10-19. Sem rede, sem Baileys.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractUndecryptedOwnEvent } from "../whatsapp-individual-service/src/message-extract.js";
import { undecryptedOwnMessageEvent } from "../lib/whatsapp-undecrypted-core.mjs";

const stub = (key, extra = {}) => ({ key: { id: "ABC123", fromMe: true, ...key }, messageStubType: 2, messageTimestamp: 1760900000, ...extra });

test("saída não decifrada 1:1 -> evento com telefone, id e jid, sem texto; o CRM aceita", () => {
  const event = extractUndecryptedOwnEvent(stub({ remoteJid: "5514988887777@s.whatsapp.net" }));
  assert.deepEqual(Object.keys(event).sort(), ["at", "from", "fromMe", "remoteJid", "waMessageId"]);
  assert.equal(event.from, "5514988887777");
  assert.equal(event.fromMe, true);
  assert.equal(event.waMessageId, "ABC123");
  assert.equal(event.at, new Date(1760900000 * 1000).toISOString());
  assert.ok(undecryptedOwnMessageEvent(event).event, "contrato do CRM");
});

test("conversa por LID usa o mapa LID -> telefone (resolveChatPhone)", () => {
  const event = extractUndecryptedOwnEvent(stub({ remoteJid: "123456789@lid" }), new Map([["123456789@lid", "5514988887777"]]));
  assert.equal(event.from, "5514988887777");
  assert.equal(extractUndecryptedOwnEvent(stub({ remoteJid: "999@lid" }), new Map()), null, "LID sem telefone: nada");
});

test("fica de fora: mensagem do contato, decifrada, grupo, broadcast/status, sem id", () => {
  assert.equal(extractUndecryptedOwnEvent(stub({ remoteJid: "5514988887777@s.whatsapp.net", fromMe: false })), null);
  assert.equal(extractUndecryptedOwnEvent({ key: { id: "X", fromMe: true, remoteJid: "5514988887777@s.whatsapp.net" }, message: { conversation: "oi" } }), null);
  assert.equal(extractUndecryptedOwnEvent(stub({ remoteJid: "120363000@g.us" })), null);
  assert.equal(extractUndecryptedOwnEvent(stub({ remoteJid: "status@broadcast" })), null);
  assert.equal(extractUndecryptedOwnEvent(stub({ remoteJid: "5514988887777@s.whatsapp.net", id: "" })), null);
});

test("sessions.js manda o evento antes do caminho normal; webhook usa o tipo do CRM", () => {
  const src = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  assert.match(src, /extractUndecryptedOwnEvent\(msg, lidMap\)[\s\S]{0,200}notifyUndecryptedOwnMessage\(userId, undecrypted\)[\s\S]{0,80}extractChatEvent\(msg, lidMap\)/);
  const hook = readFileSync(new URL("../whatsapp-individual-service/src/webhook.js", import.meta.url), "utf8");
  assert.match(hook, /type: "undecrypted_message"/);
});
