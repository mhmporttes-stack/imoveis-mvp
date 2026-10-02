import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// [REGRA OFICIAL — dono, 2026-10-02] Cliente arquivado sai do Chat e, mesmo
// mandando mensagem de novo, a conversa não volta nem é atribuída. A regra
// vive no banco (migration 20261002320000, testada em produção numa transação
// desfeita); aqui travamos o contrato contra regressão.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/20261002320000_whatsapp_hide_archived_client_conversations.sql");

test("mensagem nova não restaura conversa de cliente arquivado", () => {
  assert.match(migration, /v_archived := exists \(select 1 from public\.simulation_registrations r where r\.id = v_client and r\.status = 'archived'\)/);
  assert.match(migration, /deleted_at = case when v_archived then coalesce\(c\.deleted_at, now\(\)\) else null end/);
  assert.match(migration, /unread_count = case when v_archived then 0/);
});

test("arquivar esconde; desarquivar APAGA o histórico do Chat (conversa nova do zero)", () => {
  assert.match(migration, /after update of status on public\.simulation_registrations/);
  assert.match(migration, /new\.status = 'archived' and old\.status is distinct from 'archived'/);
  const purge = source("supabase/migrations/20261002330000_whatsapp_unarchive_purges_chat_history.sql");
  assert.match(purge, /old\.status = 'archived' and new\.status is distinct from 'archived'/);
  // Só o Chat do cliente, só conversas ocultas; registro de auditoria antes de apagar.
  assert.match(purge, /'purged', true[\s\S]*delete from public\.whatsapp_conversations c\s+where c\.client_id = new\.id and c\.deleted_at is not null/);
  assert.doesNotMatch(purge, /simulation_registrations\s+where|client_status_history|calendar_activities|prospecting_contacts/);
});

test("sem push nem atribuição para conversa escondida; card não reabre conversa de arquivado", () => {
  const inbound = source("lib/whatsapp-individual-inbound.js");
  assert.match(inbound, /!hiddenConversation && conversation\.assigned_user_id/);
  assert.match(inbound, /!conversation\.assigned_user_id && !conversation\.deleted_at/);
  const chat = source("lib/whatsapp-chat.js");
  // Card de cliente arquivado: só o dono abre a conversa (somente leitura);
  // qualquer outro (inclusive o corretor) recebe Chat em branco.
  assert.match(chat, /client\.status === "archived"[\s\S]{0,600}if \(!isArchivedChatViewer\(auth\)\) return \{ conversationId: null \}/);
  assert.match(chat, /return \{ conversationId: archivedRows\[0\]\.id, archivedReadOnly: true \}/);
  assert.match(chat, /archivedConversationAccess\(\{[^}]*isOwner: isArchivedChatViewer\(auth\)/);
  assert.match(chat, /archivedReadOnly \? \{ canReply: false, canReact: false, canEdit: false, canDelete: false \}/);
  assert.match(source("components/WhatsappChat.jsx"), /if \(data\.conversationId\) openConversation\(data\.conversationId\)/);
  assert.match(chat, /pushTargets\.delete\(row\.id\)/);
});

test("cliente arquivado: dono lê tudo; corretor/outros recebem Chat vazio e nenhum dado (backend)", () => {
  const chat = source("lib/whatsapp-chat.js");
  // Conversa já oculta antes do arquivamento (sem a marca do gatilho) também conta; decisão pura testada em whatsapp-chat-scope.test.mjs.
  assert.match(chat, /async function loadConversation[\s\S]{0,900}clientStatus = client\?\.status/);
  assert.match(chat, /if \(access === "empty"\) throw new WhatsappChatError\("Conversa não encontrada\.", \{ status: 404, code: "ARCHIVED_HIDDEN" \}\)/);
  // A leitura (API de detalhe/páginas anteriores) devolve visualização vazia em vez de erro.
  assert.match(chat, /error\?\.code === "ARCHIVED_HIDDEN"\) return \{ empty: true, conversation: null, messages: \[\], hasMore: false \}/);
  // Frontend: resposta vazia fecha a conversa, sem mensagem de erro.
  assert.match(source("components/WhatsappChat.jsx"), /if \(data\.empty\) \{\s+setSelectedId\(""\);[\s\S]{0,160}setDetailError\(""\);\s+return;/);
});
