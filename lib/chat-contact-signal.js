import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { isResponsibleSideConversation, latestInboundChatAt } from "./chat-contact-signal-core.mjs";

// Leituras do "último contato conforme o Chat" (regra e motivo em lib/chat-contact-signal-core.mjs). Só lê; nunca grava
// no cliente (last_whatsapp_contact_at continua sendo gravado só por registerHumanContact e pelos caminhos dele).

const CHUNK = 150;
const PAGE = 1000;

function client(supabase) {
  const db = supabase || getSupabaseAdminClient();
  if (!db) throw new Error("Supabase administrativo não configurado.");
  return db;
}

async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// associado -> corretor vinculado (a conversa no número do associado conta para o corretor dele).
export async function loadAssociateBrokerMap(db) {
  const rows = await run(db.from("admin_users").select("id, linked_broker_id").eq("role", "associate"));
  return new Map(rows.filter((row) => row.linked_broker_id).map((row) => [row.id, row.linked_broker_id]));
}

// clients: [{ id, responsibleUserId }] -> Map(clientId -> ISO da última mensagem do cliente nas conversas que contam).
export async function loadInboundChatAtByClient(supabase, clients = []) {
  const db = client(supabase);
  const list = clients.filter((item) => item?.id);
  if (!list.length) return new Map();
  const ids = [...new Set(list.map((item) => item.id))];
  const conversations = [];
  for (let index = 0; index < ids.length; index += CHUNK) {
    conversations.push(...(await run(db
      .from("whatsapp_conversations")
      .select("client_id, session_user_id, last_inbound_at, deleted_at, private_at")
      .in("client_id", ids.slice(index, index + CHUNK))
      .not("last_inbound_at", "is", null))));
  }
  if (!conversations.length) return new Map();
  const associates = await loadAssociateBrokerMap(db);
  const byClient = new Map();
  for (const row of conversations) {
    if (!byClient.has(row.client_id)) byClient.set(row.client_id, []);
    byClient.get(row.client_id).push(row);
  }
  const result = new Map();
  for (const item of list) {
    const at = latestInboundChatAt(byClient.get(item.id) || [], item.responsibleUserId || "", associates);
    if (at) result.set(item.id, at);
  }
  return result;
}
