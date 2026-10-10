import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { findLatestRegistrationIdsByPhones } from "./client-phone-lookup";
import { isLidPlaceholder } from "./whatsapp-lid-placeholder.mjs";

// Particular AUTOMÁTICO (regra do dono, 2026-10-10 — WA-26): no WhatsApp PESSOAL do corretor, toda conversa SEM card de
// cliente vai sozinha para "Particular"; ganhou card (cliente com esse telefone, "Adicionar ao CRM", "Vincular") -> sai
// sozinha e fica ligada ao cliente. Só vale para a conversa marcada pela automação (origin.auto_private = true); a
// Particular marcada à mão (botão) segue a WA-19 e nunca é desfeita aqui. Número oficial não entra (lá contato direto
// vira cliente sozinho, ROL/organic). Roda na chegada de cada mensagem e no cron scheduled-activities.

const OFFICIAL_SESSION_KEY = "00000000-0000-0000-0000-000000000000";
const COLUMNS = "id, contact_phone, session_key, client_id, private_at, private_by, origin, deleted_at";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export function isAutoPrivate(row) {
  return Boolean(row?.private_at && row?.origin?.auto_private === true);
}

async function decide(rows) {
  const personal = rows.filter((row) => row && !row.deleted_at && row.session_key && row.session_key !== OFFICIAL_SESSION_KEY);
  const lookupPhones = personal.filter((row) => !row.client_id && !isLidPlaceholder(row.contact_phone) && (!row.private_at || isAutoPrivate(row))).map((row) => row.contact_phone);
  const matches = lookupPhones.length ? await findLatestRegistrationIdsByPhones(lookupPhones) : new Map();
  const now = new Date().toISOString();
  let privatized = 0;
  let released = 0;
  for (const row of personal) {
    const clientId = row.client_id || matches.get(row.contact_phone) || null;
    if (clientId) {
      if (!isAutoPrivate(row) && row.client_id) continue;
      const patch = { client_id: clientId, updated_at: now };
      if (isAutoPrivate(row)) Object.assign(patch, { private_at: null, private_by: null, origin: { ...(row.origin || {}), auto_private: false } });
      if (row.private_at && !isAutoPrivate(row)) continue; // Particular manual: nunca mexe
      const { error } = await db().from("whatsapp_conversations").update(patch).eq("id", row.id);
      if (!error && isAutoPrivate(row)) released += 1;
      continue;
    }
    if (row.private_at) continue;
    const { error } = await db().from("whatsapp_conversations")
      .update({ private_at: now, private_by: null, origin: { ...(row.origin || {}), auto_private: true }, updated_at: now })
      .eq("id", row.id).is("client_id", null).is("private_at", null);
    if (!error) privatized += 1;
  }
  return { privatized, released };
}

// Uma conversa (chamado depois de gravar a mensagem).
export async function applyAutoPrivacy(conversationId) {
  if (!conversationId) return { privatized: 0, released: 0 };
  const { data, error } = await db().from("whatsapp_conversations").select(COLUMNS).eq("id", conversationId).maybeSingle();
  if (error) throw error;
  return data ? decide([data]) : { privatized: 0, released: 0 };
}

// Rede de segurança (cron): conversas pessoais sem cliente ainda fora de Particular + Particular automática cujo telefone
// ganhou card de cliente nas últimas 2 h (formulário, cadastro manual, roleta).
export async function reconcileAutoPrivateConversations() {
  const { data: loose, error } = await db().from("whatsapp_conversations").select(COLUMNS)
    .neq("session_key", OFFICIAL_SESSION_KEY).is("client_id", null).is("private_at", null).is("deleted_at", null).limit(500);
  if (error) throw error;
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: recentClients } = await db().from("simulation_registrations").select("phone_normalized")
    .gte("updated_at", since).is("private_contact_at", null).limit(500);
  const phones = [...new Set((recentClients || []).map((row) => row.phone_normalized).filter(Boolean))];
  let autoRows = [];
  if (phones.length) {
    const { phoneLookupCandidates } = await import("./phone-utils");
    const candidates = [...new Set(phones.flatMap((phone) => phoneLookupCandidates(phone)))];
    for (let i = 0; i < candidates.length; i += 300) {
      const { data } = await db().from("whatsapp_conversations").select(COLUMNS)
        .neq("session_key", OFFICIAL_SESSION_KEY).not("private_at", "is", null).eq("origin->>auto_private", "true")
        .in("contact_phone", candidates.slice(i, i + 300));
      autoRows = autoRows.concat(data || []);
    }
  }
  return decide([...(loose || []), ...autoRows]);
}
