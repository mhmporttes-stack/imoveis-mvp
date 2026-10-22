import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { findLatestRegistrationIdsByPhones } from "./client-phone-lookup";
import { isLidPlaceholder } from "./whatsapp-lid-placeholder.mjs";
import { loadClientPrivateBlockReasons } from "./whatsapp-private-eligibility";

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

// Cliente ARQUIVADO que fala no WhatsApp pessoal do corretor (regra do dono, 2026-10-11): o card continua arquivado e a
// conversa vai para Particular (antes ficava escondida pela WA-13). Só sai de lá se o cliente for cadastrado de novo /
// entrar por link ou anúncio (card deixa de estar arquivado) — aí volta ligada ao cliente.
async function archivedClientIds(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Set();
  const { data } = await db().from("simulation_registrations").select("id, status").in("id", unique);
  return new Set((data || []).filter((row) => row.status === "archived").map((row) => row.id));
}

async function rescueArchivedConversations(rows) {
  const candidates = rows.filter((row) => row?.deleted_at && row.client_id && row.session_key && row.session_key !== OFFICIAL_SESSION_KEY && !row.private_at);
  if (!candidates.length) return 0;
  const archived = await archivedClientIds(candidates.map((row) => row.client_id));
  // WA-19b (dono, 2026-10-22, "não, altere"): arquivado de origem bloqueada (oficial, link do Matheus, roleta, link de
  // campanha, Marketplace) NÃO vai sozinho para Particular — fica como antes da WA-26a (escondido pela WA-13).
  const blocked = await loadClientPrivateBlockReasons([...archived]);
  const now = new Date().toISOString();
  let rescued = 0;
  for (const row of candidates) {
    if (!archived.has(row.client_id) || blocked.has(row.client_id)) continue;
    const { error } = await db().from("whatsapp_conversations").update({
      deleted_at: null, deleted_by: null, client_id: null, private_at: now, private_by: null,
      origin: { ...(row.origin || {}), auto_private: true, archived_client_id: row.client_id }, updated_at: now
    }).eq("id", row.id);
    if (!error) rescued += 1;
  }
  return rescued;
}

async function decide(rows) {
  await rescueArchivedConversations(rows);
  const personal = rows.filter((row) => row && !row.deleted_at && row.session_key && row.session_key !== OFFICIAL_SESSION_KEY);
  const lookupPhones = personal.filter((row) => !row.client_id && !isLidPlaceholder(row.contact_phone) && (!row.private_at || isAutoPrivate(row))).map((row) => row.contact_phone);
  const rawMatches = lookupPhones.length ? await findLatestRegistrationIdsByPhones(lookupPhones) : new Map();
  // Card arquivado não tira a conversa do Particular (só cadastro novo / link / anúncio, que desarquivam o card).
  const archived = await archivedClientIds([...rawMatches.values()]);
  // Conversa pessoal ligada a card ARQUIVADO (ex.: religada por engano) -> Particular, sem cliente (WA-26a).
  const linkedArchived = await archivedClientIds(personal.map((row) => row.client_id));
  // WA-19b (dono, 2026-10-22): card arquivado de origem bloqueada nunca leva a conversa ao Particular automático —
  // a conversa fica como está (sem cliente e fora do Particular, ou ligada ao card); Particular que já existia não muda.
  const blocked = await loadClientPrivateBlockReasons([...archived, ...linkedArchived]);
  const matches = new Map([...rawMatches].filter(([, id]) => id && !archived.has(id)));
  const now = new Date().toISOString();
  for (const row of personal) {
    if (!row.client_id || !linkedArchived.has(row.client_id) || blocked.has(row.client_id) || (row.private_at && !isAutoPrivate(row))) continue;
    await db().from("whatsapp_conversations").update({
      client_id: null, private_at: row.private_at || now, private_by: null,
      origin: { ...(row.origin || {}), auto_private: true, archived_client_id: row.client_id }, updated_at: now
    }).eq("id", row.id);
    row.client_id = null;
    row.private_at = row.private_at || now;
    row.origin = { ...(row.origin || {}), auto_private: true };
  }
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
    if (row.private_at || blocked.has(rawMatches.get(row.contact_phone))) continue;
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
  // Conversa pessoal visível ligada a card arquivado (não deveria existir; rede de segurança).
  const { data: archivedLinked } = await db().from("whatsapp_conversations").select(`${COLUMNS}, cs:simulation_registrations!client_id!inner(status)`)
    .neq("session_key", OFFICIAL_SESSION_KEY).is("deleted_at", null).eq("cs.status", "archived").limit(200);
  const cleanArchived = (archivedLinked || []).map(({ cs, ...row }) => row);
  return decide([...(loose || []), ...autoRows, ...cleanArchived]);
}
