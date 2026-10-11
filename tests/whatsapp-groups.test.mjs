import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractChatEvent, groupKeyFromJid } from "../whatsapp-individual-service/src/message-extract.js";

// Aba "Grupos" (pedido do dono, 2026-10-11): grupos do WhatsApp dos corretores, só para o dono, só leitura, com mídia;
// "Remover do chat" apaga o que foi guardado e para de receber o grupo.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("serviço: grupo vira evento próprio com quem escreveu (nunca o type 'message' de cliente)", () => {
  assert.equal(groupKeyFromJid("120363012345678901@g.us"), "group:120363012345678901");
  assert.equal(groupKeyFromJid("5514999990000@s.whatsapp.net"), "");
  const event = extractChatEvent({ key: { remoteJid: "120363012345678901@g.us", fromMe: false, id: "G1", participant: "5514999990000@s.whatsapp.net" }, pushName: "Ana", messageTimestamp: 1791600000, message: { conversation: "bom dia" } });
  assert.equal(event.from, "group:120363012345678901");
  assert.equal(event.group, true);
  assert.equal(event.senderName, "Ana");
  assert.equal(event.senderPhone, "5514999990000");
  assert.equal(event.contactName, "");
  const sessions = read("../whatsapp-individual-service/src/sessions.js");
  assert.match(sessions, /if \(event\.group\) return await deliverGroupMessage\(userId, msg, event\);/);
  assert.match(sessions, /if \(event\?\.group\) \{ counts\.groups \+= 1; continue; \}/);
  assert.match(read("../whatsapp-individual-service/src/webhook.js"), /type: "group_message"/);
});

test("CRM: grupo só para o dono, fora de toda lista/contador, só leitura, e removível", () => {
  const chat = read("../lib/whatsapp-chat.js");
  assert.match(chat, /if \(groups && !isArchivedChatViewer\(auth\)\) return \[\];/);
  assert.match(chat, /rawBuild\(query\)\.not\("contact_phone", "like", "group:%"\)/);
  assert.match(chat, /if \(groupsTab && !isArchivedChatViewer\(auth\)\) return \[\];/);
  assert.match(chat, /if \(data && isGroupConversation\(data\) && !isArchivedChatViewer\(auth\)\) throw/);
  assert.ok((chat.match(/assertNotGroup\(/g) || []).length >= 15);
  assert.match(chat, /export async function removeChatGroup\(id, auth\) \{\n  if \(!isArchivedChatViewer\(auth\)\)/);
  const inbound = read("../lib/whatsapp-individual-inbound.js");
  assert.match(inbound, /if \(conversation\?\.origin\?\.group_removed\) return \{ ignored: true \};/);
  assert.match(inbound, /const patch = \{ updated_at: new Date\(\)\.toISOString\(\), unread_count: 0 \};/);
  const route = read("../app/api/webhooks/whatsapp-individual/route.js");
  assert.ok(route.indexOf('payload.type === "group_message"') > 0);
  const upload = read("../app/api/webhooks/whatsapp-individual/media-upload/route.js");
  assert.match(upload, /isGroupRemoved/);
  const ui = read("../components/WhatsappChat.jsx");
  assert.match(ui, /\.\.\.\(canSeeArchived \? \[\{ key: "private_groups", label: "Grupos" \}\] : \[\]\)/);
  assert.match(ui, /conversations\/\$\{conversation\.id\}\/group`, \{ method: "DELETE" \}/);
});
