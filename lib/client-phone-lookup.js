import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { phoneLookupCandidates } from "./phone-utils";
import { RECENT_FORM_WINDOW_MS } from "./whatsapp-form-completion.mjs";

// Buscas de cliente/conversa por telefone — ÚNICO ponto usado pelo webhook, pelo
// Chat, pela roleta, pelos Fluxos e pelas automações (antes cada um tinha a sua
// cópia, e só a do Chat tratava o 9º dígito). A regra de formato vive em
// lib/phone-utils.js (phoneLookupCandidates). Nunca cria nem altera cliente.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// phone -> id do cadastro MAIS RECENTE que bate com qualquer formato do
// telefone (mesmo desempate que já existia: o mais novo entre todas as
// variantes). Não cria nem altera cliente nenhum.
export async function findLatestRegistrationIdsByPhones(phones) {
  const unique = [...new Set((phones || []).filter(Boolean))];
  const result = new Map();
  if (!unique.length) return result;

  const candidatesByPhone = new Map(unique.map((phone) => [phone, phoneLookupCandidates(phone)]));
  const allCandidates = [...new Set([...candidatesByPhone.values()].flat())];
  if (!allCandidates.length) return result;

  const { data, error } = await db()
    .from("simulation_registrations")
    .select("id, phone_normalized, created_at")
    .in("phone_normalized", allCandidates)
    .is("private_contact_at", null) // cadastro de contato Particular fica fora: mensagem nova não o revive nem vincula
    .order("created_at", { ascending: false });
  if (error) throw error;

  const byNormalized = new Map();
  for (const row of data || []) {
    if (!byNormalized.has(row.phone_normalized)) byNormalized.set(row.phone_normalized, row);
  }

  for (const phone of unique) {
    let best = null;
    for (const candidate of candidatesByPhone.get(phone) || []) {
      const row = byNormalized.get(candidate);
      if (row && (!best || row.created_at > best.created_at)) best = row;
    }
    result.set(phone, best?.id || null);
  }
  return result;
}

// TODOS os cadastros que batem com o telefone (qualquer formato) — para quem precisa saber se há
// ambiguidade (CLI-4: um telefone pode ter vários atendimentos) em vez de aceitar "o mais recente".
// Não cria nem altera cliente.
export async function findRegistrationsByPhone(phone, limit = 20) {
  const candidates = phoneLookupCandidates(phone);
  if (!candidates.length) return [];
  const { data, error } = await db()
    .from("simulation_registrations")
    .select("id, phone_normalized, responsible_user_id, status, created_at")
    .in("phone_normalized", candidates)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Conversa do Chat deste telefone (em qualquer formato gravado) NA SESSÃO
// pedida. A identidade da conversa é (telefone + sessão do WhatsApp): o mesmo
// cliente falando com dois WhatsApps tem duas conversas, e quem procura por
// telefone nunca pode cair na do outro número.
//   - sessionKey omitido  -> número OFICIAL (chave vazia): é o que os
//     chamadores do webhook oficial/Fluxos/automações sempre quiseram;
//   - sessionKey = id     -> WhatsApp pessoal desse usuário;
//   - { anySession: true } -> qualquer sessão (só para perguntas sobre o
//     CLIENTE, como "alguém está atendendo agora?"; a mais recente).
// Se houver mais de uma no mesmo escopo (legado de formato), a com mensagem
// mais recente.
export const OFFICIAL_CONVERSATION_SESSION_KEY = "00000000-0000-0000-0000-000000000000";

export async function findConversationByPhone(phone, columns = "id, contact_phone", { sessionKey = OFFICIAL_CONVERSATION_SESSION_KEY, anySession = false } = {}) {
  const candidates = phoneLookupCandidates(phone);
  if (!candidates.length) return null;
  let query = db()
    .from("whatsapp_conversations")
    .select(columns)
    .in("contact_phone", candidates);
  if (!anySession) query = query.eq("session_key", sessionKey || OFFICIAL_CONVERSATION_SESSION_KEY);
  const { data, error } = await query
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// Cadastro feito há pouco (janela de 24h) por FORMULÁRIO/LINK para este telefone (qualquer
// formato do número)? Ignora cadastro manual do corretor e os criados pelo próprio WhatsApp
// (esses não vieram de "acabou de preencher o formulário"). Só consulta.
export async function findRecentFormRegistration(phone, withinMs = RECENT_FORM_WINDOW_MS) {
  const candidates = phoneLookupCandidates(phone);
  if (!candidates.length) return null;
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data: rows, error } = await db()
    .from("simulation_registrations")
    .select("id, created_at")
    .in("phone_normalized", candidates)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  if (!rows?.length) return null;

  const { data: origins, error: originError } = await db()
    .from("client_origins")
    .select("client_id, source_kind")
    .in("client_id", rows.map((row) => row.id));
  if (originError) throw originError;
  const kindByClient = new Map((origins || []).map((row) => [row.client_id, String(row.source_kind || "")]));
  return rows.find((row) => {
    const kind = kindByClient.get(row.id) || "";
    return kind !== "manual" && !kind.startsWith("whatsapp");
  }) || null;
}
