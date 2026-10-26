import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Chat só responde (2026-10-05): proteção do número após o banimento do Benck.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chat = readFileSync(path.join(root, "lib/whatsapp-chat.js"), "utf8");

test("Chat pela sessão individual exige mensagem recebida do contato e limita o volume por hora", () => {
  assert.match(chat, /async function assertIndividualChatReplyOnly\(conversation, sendChannel, sessionUserId(, sessionSlot = 1)?\)/);
  assert.match(chat, /\.eq\("direction", "inbound"\)[\s\S]{0,40}\.limit\(1\)/);
  assert.match(chat, /code: "CHAT_REPLY_ONLY"/);
  assert.match(chat, /code: "CHAT_HOURLY_CAP"/);
  assert.match(chat, /const CHAT_HOURLY_OUTBOUND_CAP = 80;/);
});

test("limite por hora conta só envio real: histórico sincronizado do celular não trava o Chat (incidente 2026-10-26)", () => {
  const fn = chat.slice(chat.indexOf("async function assertIndividualChatReplyOnly("), chat.indexOf("export async function getChatReplyReadiness("));
  assert.ok(fn.length > 0);
  assert.match(fn, /\.eq\("direction", "outbound"\)\s*\.is\("metadata->history", null\)\s*\.gte\("message_at", since\);/);
  assert.doesNotMatch(fn, /\.gte\("created_at", since\)/, "created_at conta a sincronização de histórico como envio");
});

test("todos os envios do Chat (texto, mídia, atalhos, modelos) passam pela trava", () => {
  const send = chat.slice(chat.indexOf("export async function sendChatMessage("), chat.indexOf("export async function sendChatReaction("));
  assert.match(send, /await assertIndividualChatReplyOnly\(conversation, sendChannel, assignedUserId(, sessionSlot)?\);/);
  const deliver = chat.slice(chat.indexOf("async function deliverChatMessage("), chat.indexOf("function mediaSendPlan("));
  assert.match(deliver, /await assertIndividualChatReplyOnly\(conversation, sendChannel, assignedUserId(, sessionSlot)?\);/);
});

test("conversa sem mensagem do cliente: aviso, envio pelo app do celular e link para o cliente chamar", () => {
  // Exceção (dono, 2026-10-19): cliente recebido pela distribuição tem a 1ª mensagem pelo Chat (tests/distribution-first-message.test.mjs).
  assert.match(chat, /awaitingCustomer = !\(anyInbound \|\| \[\]\)\.length && !\(await distributionFirstMessageAllowed\(conversation, awaitingOwner\)\);/);
  assert.match(chat, /archivedReadOnly, awaitingCustomer, brokerWhatsapp, individualSendDisabled[,}]/);
  const ui = readFileSync(path.join(root, "components/WhatsappChat.jsx"), "utf8");
  assert.match(ui, /conversation\.awaitingCustomer === true/);
  assert.match(ui, /Abrir no WhatsApp do celular/);
  assert.match(ui, /Copiar link para o cliente te chamar/);
  assert.match(ui, /sending \|\| conversation\.awaitingCustomer \|\| conversation\.individualSendDisabled \|\|/, "nunca envia pelo CRM enquanto aguarda o cliente");
});
