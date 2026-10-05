import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Chat só responde (2026-10-05): proteção do número após o banimento do Benck.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chat = readFileSync(path.join(root, "lib/whatsapp-chat.js"), "utf8");

test("Chat pela sessão individual exige mensagem recebida do contato e limita o volume por hora", () => {
  assert.match(chat, /async function assertIndividualChatReplyOnly\(conversation, sendChannel, sessionUserId\)/);
  assert.match(chat, /\.eq\("direction", "inbound"\)[\s\S]{0,40}\.limit\(1\)/);
  assert.match(chat, /code: "CHAT_REPLY_ONLY"/);
  assert.match(chat, /code: "CHAT_HOURLY_CAP"/);
  assert.match(chat, /const CHAT_HOURLY_OUTBOUND_CAP = 80;/);
});

test("todos os envios do Chat (texto, mídia, atalhos, modelos) passam pela trava", () => {
  const send = chat.slice(chat.indexOf("export async function sendChatMessage("), chat.indexOf("export async function sendChatReaction("));
  assert.match(send, /await assertIndividualChatReplyOnly\(conversation, sendChannel, assignedUserId\);/);
  const deliver = chat.slice(chat.indexOf("async function deliverChatMessage("), chat.indexOf("function mediaSendPlan("));
  assert.match(deliver, /await assertIndividualChatReplyOnly\(conversation, sendChannel, assignedUserId\);/);
});
