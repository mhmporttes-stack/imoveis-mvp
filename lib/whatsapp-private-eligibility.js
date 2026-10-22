import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { isOwnerAdminEmail, listAdminProfiles } from "./admin-profiles";
import { motivoBloqueioParticular } from "./whatsapp-private-eligibility-core.mjs";

// Leitura da WA-19b (regra do dono, 2026-10-22): busca a origem de entrada dos clientes e aplica a regra pura
// (lib/whatsapp-private-eligibility-core.mjs). Usada pelo botão/barreira do Chat (lib/whatsapp-chat.js) e pelo
// Particular automático do arquivado (WA-26a, lib/whatsapp-auto-private.js). Erro de leitura sobe (nunca libera às cegas).

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Map clientId -> motivo do bloqueio (só os bloqueados entram).
export async function loadClientPrivateBlockReasons(clientIds = []) {
  const ids = [...new Set((clientIds || []).filter(Boolean))];
  const reasons = new Map();
  if (!ids.length) return reasons;
  const [{ data: clients, error }, { data: marketplace, error: marketplaceError }, profiles] = await Promise.all([
    db().from("simulation_registrations").select("id, acquisition_context, distribution_type").in("id", ids),
    db().from("marketplace_conversations").select("client_id").in("client_id", ids),
    listAdminProfiles()
  ]);
  if (error) throw error;
  if (marketplaceError) throw marketplaceError;
  const owner = (profiles || []).find((profile) => isOwnerAdminEmail(profile.email));
  const ownerRefs = owner ? [owner.simulationRef, owner.captacaoRef, owner.shortRef] : [];
  const marketplaceIds = new Set((marketplace || []).map((row) => row.client_id));
  for (const client of clients || []) {
    // Só a origem do cliente (sem conversa): a conversa do oficial é tratada por quem chama.
    const reason = motivoBloqueioParticular({ client, ownerRefs, hasMarketplaceConversation: marketplaceIds.has(client.id) });
    if (reason) reasons.set(client.id, reason);
  }
  return reasons;
}

// Motivo para UMA conversa (oficial ou cliente ligado), ou null.
export async function loadConversationPrivateBlockReason(conversation) {
  const own = motivoBloqueioParticular({ conversation });
  if (own || !conversation?.client_id) return own;
  return (await loadClientPrivateBlockReasons([conversation.client_id])).get(conversation.client_id) || null;
}
