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

test("Particular trancado: só o dono vê o conteúdo; corretor e gestão veem a linha (nome, telefone, rótulo)", () => {
  const chat = read("lib/whatsapp-chat.js");
  assert.match(chat, /function privateContentHidden\(conversation, auth\) \{\s*return Boolean\(conversation\?\.private_at\) && !\(Boolean\(auth\) && isGeneralAdminAuth\(auth\)\);/);
  assert.match(chat, /if \(!allowPrivateShell && privateContentHidden\(data, auth\)\) throw new WhatsappChatError\(PRIVATE_CONVERSATION_MESSAGE/);
  // só abrir a casca, marcar lida e destrancar passam pelo atalho
  assert.equal((chat.match(/allowPrivateShell: true/g) || []).length, 3);
  assert.match(chat, /if \(privateContentHidden\(conversation, auth\)\) return \{ conversation: \{ \.\.\.conversationView, privateLocked: true[^}]*\}, messages: \[\], hasMore: false \};/);
  assert.match(chat, /last_message_preview: "", last_message_direction: null, unread_count: 0/);
  const ui = read("components/WhatsappChat.jsx");
  assert.match(ui, /Conversa particular<\/span>/);
  assert.match(ui, /\{conversation\.privateLocked \? null : conversation\.archivedReadOnly \?/);
});

test("Destrancar: cópia interna, apaga o histórico, contato volta limpo e o passado reimportado não aparece", () => {
  const chat = read("lib/whatsapp-chat.js");
  const unlock = chat.slice(chat.indexOf("DESTRANCAR = recomeço limpo"), chat.indexOf("async function wipeConversationMessages"));
  assert.match(unlock, /await wipeConversationMessages\(conversation, auth\)/);
  assert.match(unlock, /client_id: null, status: "open", unread_count: 0, history_cutoff_at: now/);
  assert.match(unlock, /deleted_at: now/);
  const wipe = chat.slice(chat.indexOf("async function wipeConversationMessages"));
  assert.ok(wipe.indexOf('from("whatsapp_private_wipe_backup")') < wipe.indexOf('.from("whatsapp_messages").delete()'), "copia antes de apagar");
  assert.match(wipe, /if \(backupError\) throw backupError;/);
  assert.match(chat, /if \(conversation\.history_cutoff_at\) request = request\.gte\("message_at", conversation\.history_cutoff_at\);/);
  const inbound = read("lib/whatsapp-individual-inbound.js");
  assert.match(inbound, /allItems\.filter\(\(item\) => new Date\(item\.messageAt\)\.getTime\(\) >= cutoff\)/);
  const lookup = read("lib/client-phone-lookup.js");
  assert.match(lookup, /\.is\("private_contact_at", null\)/);
  const sql = read("supabase/migrations/20261010120000_private_conversation_wipe.sql");
  assert.match(sql, /history_cutoff_at timestamptz/);
  assert.match(sql, /whatsapp_private_wipe_backup enable row level security/);
  // sem aviso na tela ao destrancar: a confirmação continua só ao mover para Particular
  assert.match(read("components/WhatsappChat.jsx"), /if \(makePrivate && conversation\.client\?\.id && !window\.confirm/);
});
