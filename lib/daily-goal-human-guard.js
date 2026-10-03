import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { phoneLookupCandidates } from "./phone-utils";
import { HUMAN_CONVERSATION_RECENT_MS, humanConversationBlockReason } from "./daily-goal-human-guard-core.mjs";

// Lê o estado das conversas do Chat para a trava da cadência automática (regra pura em
// daily-goal-human-guard-core.mjs). Só leitura. Qualquer sessão de WhatsApp conta: o cliente pode estar
// conversando com outra pessoa da equipe (gestor, outro corretor) e a automação não pode atropelar.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// telefones -> Map(telefone -> motivo do bloqueio). Telefone sem bloqueio não aparece no mapa.
// Erro de leitura PROPAGA (quem chama decide não enviar: na dúvida, não envia).
// Telefones por consulta: cada telefone gera vários formatos (9º dígito, +55...) e a lista vai na URL do
// PostgREST — lotes pequenos evitam estourar o tamanho da URL (incidente real de 2026-09-30 em outra consulta).
const PHONES_PER_QUERY = 20;

export async function listPhonesBlockedByHumanConversation(phones, { now = new Date() } = {}) {
  const unique = [...new Set((phones || []).filter(Boolean))];
  const blocked = new Map();
  if (!unique.length) return blocked;
  const cutoff = new Date(now.getTime() - HUMAN_CONVERSATION_RECENT_MS).toISOString();

  for (let offset = 0; offset < unique.length; offset += PHONES_PER_QUERY) {
    const chunk = unique.slice(offset, offset + PHONES_PER_QUERY);
    const candidatesByPhone = new Map(chunk.map((phone) => [phone, phoneLookupCandidates(phone)]));
    const all = [...new Set([...candidatesByPhone.values()].flat())];
    if (!all.length) continue;

    const { data, error } = await db()
      .from("whatsapp_conversations")
      .select("contact_phone, last_human_reply_at, last_inbound_at")
      .in("contact_phone", all)
      .or(`last_human_reply_at.gte.${cutoff},last_inbound_at.gte.${cutoff}`);
    if (error) throw error;

    const rowsByPhone = new Map();
    for (const row of data || []) {
      if (!rowsByPhone.has(row.contact_phone)) rowsByPhone.set(row.contact_phone, []);
      rowsByPhone.get(row.contact_phone).push(row);
    }
    for (const [phone, candidates] of candidatesByPhone) {
      const rows = candidates.flatMap((candidate) => rowsByPhone.get(candidate) || []);
      const reason = humanConversationBlockReason(rows, { now });
      if (reason) blocked.set(phone, reason);
    }
  }
  return blocked;
}

// Um telefone só: motivo do bloqueio ou null.
export async function humanConversationBlockFor(phone, { now = new Date() } = {}) {
  const blocked = await listPhonesBlockedByHumanConversation([phone], { now });
  return blocked.get(phone) || null;
}
