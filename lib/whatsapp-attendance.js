import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { phoneLookupCandidates } from "./phone-utils";
import { pickProtectedClientIds } from "./whatsapp-attendance-core.mjs";

// "ATENDIMENTO HUMANO ESTÁ ATIVO" — sinal próprio, SEPARADO de tudo que gera
// pontuação/meta/ranking. Guardado só em whatsapp_conversations.last_human_reply_at
// (nunca em simulation_registrations.last_whatsapp_contact_at, que alimenta Meta
// Diária, ranking e desempenho). Só uma pessoa respondendo pelo Chat marca — mensagem
// automática (Fluxo, resposta por palavra-chave, Disparo) NUNCA marca.
//
// Usos: (1) a regra "REDISTRIBUIÇÃO DE LEADS" não devolve à fila um cliente cujo
// corretor já está respondendo; (2) a resposta automática por palavra-chave
// não interfere enquanto um humano está conversando.

export const HUMAN_ATTENDING_MS = 30 * 60 * 1000;

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Chamado só depois que a Meta ACEITOU uma mensagem enviada por uma pessoa.
// Best-effort: nunca derruba o envio já feito.
export async function markConversationHumanReply(conversationId, at = new Date()) {
  if (!conversationId) return;
  try {
    const { error } = await db()
      .from("whatsapp_conversations")
      .update({ last_human_reply_at: at.toISOString() })
      .eq("id", conversationId);
    if (error) throw error;
  } catch (error) {
    console.warn("Falha ao registrar o atendimento humano da conversa:", error?.message || error);
  }
}

// Há uma pessoa conversando com este telefone agora (resposta humana recente)?
export async function isHumanAttendingPhone(phone, now = Date.now()) {
  // Pergunta sobre o CLIENTE (não sobre um número): alguém respondeu a este
  // telefone em QUALQUER sessão recentemente?
  const { data: rows } = await db()
    .from("whatsapp_conversations")
    .select("last_human_reply_at")
    .in("contact_phone", phoneLookupCandidates(phone))
    .not("last_human_reply_at", "is", null)
    .order("last_human_reply_at", { ascending: false })
    .limit(1);
  const conversation = rows?.[0] || null;
  const last = conversation?.last_human_reply_at ? new Date(conversation.last_human_reply_at).getTime() : 0;
  return Boolean(last) && now - last < HUMAN_ATTENDING_MS;
}

// Dos clientes candidatos à redistribuição, quais JÁ têm resposta humana no Chat OU foram ASSUMIDOS por alguém
// ("Assumir atendimento", assumed_at) depois que o responsável atual os recebeu (responsible_changed_at, ou a criação).
// Uma resposta/assunção de um corretor anterior não protege quem recebeu depois.
export async function listClientIdsWithHumanAttendance(clients, { ever = false } = {}) {
  const ids = (clients || []).map((client) => client.id).filter(Boolean);
  const protectedIds = new Set();
  if (!ids.length) return protectedIds;

  const { data, error } = await db()
    .from("whatsapp_conversations")
    .select("client_id, last_human_reply_at, assumed_at")
    .in("client_id", ids)
    .or("last_human_reply_at.not.is.null,assumed_at.not.is.null");
  if (error) throw error;

  return ever ? new Set((data || []).map((row) => row.client_id).filter(Boolean)) : pickProtectedClientIds(data, clients);
}
