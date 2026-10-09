// Conversas Particulares (regra do dono, 2026-10-09).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("lista: Particular só na aba própria (e na busca); demais filtros e contadores excluem", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /safeFilter === "private"\) request = request\.not\("private_at", "is", null\)/);
  assert.match(chat, /if \(safeFilter !== "private" && !term\) request = request\.is\("private_at", null\);/);
  assert.match(chat, /base\.is\("private_at", null\)\.or\("unread_count\.gt\.0/);
  assert.ok((chat.match(/\.is\("private_at", null\)/g) || []).length >= 8);
});

test("marcar Particular desvincula o cliente e o tira das listas de Clientes", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /private_at: now, private_by: auth\?\.profile\?\.id \|\| null, client_id: null/);
  assert.match(chat, /update\(\{ private_contact_at: now \}\)/);
  const list = read("lib/simulation-list-query.js");
  assert.ok((list.match(/private_contact_at/g) || []).length >= 4);
});

test("mensagem nova em conversa particular não reabre, não vincula e não cria cliente nem avisa", () => {
  const sql = read("supabase/migrations/20261009160000_whatsapp_private_conversations.sql");
  assert.match(sql, /status = case when c\.status = 'finished' and c\.private_at is null then 'open' else c\.status end/);
  assert.match(sql, /client_id = case when c\.private_at is not null then c\.client_id/);
  const inbound = read("lib/whatsapp-individual-inbound.js");
  assert.match(inbound, /const internalContact = privateContact \|\| await findInternalTeamPhone\(phone\);/);
  assert.match(inbound, /const hiddenConversation = Boolean\(afterApply\?\.deleted_at\) \|\| privateContact;/);
  assert.match(inbound, /if \(!conversation\.client_id && !conversation\.private_at\) \{/);
  const lead = read("lib/whatsapp-sponsored-lead.js");
  assert.equal((lead.match(/if \(conversation\.private_at\) return \{ skipped: "conversa_particular" \};/g) || []).length, 2);
});

test("excluir usuário não conta, não transfere e não resgata contato particular", () => {
  const profiles = read("lib/admin-profiles.js");
  const fn = profiles.slice(profiles.indexOf("async function listClientsOfProfile"), profiles.indexOf("async function listClientsOfProfile") + 600);
  assert.match(fn, /\.is\("private_contact_at", null\)/);
  const sql = read("supabase/migrations/20261009160200_remove_broker_skips_private_contacts.sql");
  assert.match(sql, /responsible_user_id = p_broker_id and private_contact_at is null/);
  const regs = read("lib/simulation-registrations.js");
  assert.match(regs, /\.is\("responsible_user_id", null\)\n\s+\.is\("private_contact_at", null\)/);
});

test("responder no interno cita a mensagem só para a equipe (2026-10-09)", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /export async function sendChatInternalMessage\(id, text, auth, replyToMessageId = ""\)/);
  assert.match(chat, /\.eq\("id", replyToMessageId\)\.eq\("conversation_id", id\)/);
  assert.match(chat, /internal_reply_to: internalReplyTo/);
  const menu = read("components/WhatsappMessageActions.jsx");
  assert.ok((menu.match(/Responder no interno/g) || []).length >= 2);
});

test("conversa particular não gera notificação de nenhum tipo (dono, 2026-10-09)", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /\.or\("deleted_at\.not\.is\.null,private_at\.not\.is\.null"\)/, "push do número oficial");
  assert.match(chat, /async function notifyInternalMessage\(conversation, auth\) \{\n[^\n]*\n\s+if \(conversation\?\.private_at\) return;/, "nota interna");
  assert.match(read("lib/whatsapp-individual-inbound.js"), /\|\| privateContact;/, "push do WhatsApp pessoal");
  assert.match(read("lib/alexa-reply-alert.js"), /row\.private_at/, "alerta de cliente sem resposta");
  assert.match(read("lib/prospecting-reply.js"), /return \{ outcome: "conversa_particular" \}/, "resposta da prospecção");
  assert.match(read("lib/whatsapp-form-reminder.js"), /if \(!conversation \|\| conversation\.private_at\) return null;/, "lembrete do formulário");
  assert.match(read("lib/whatsapp-flows.js"), /if \(loadedConversation\.private_at\) return true;/, "fluxos e respostas automáticas");
});
