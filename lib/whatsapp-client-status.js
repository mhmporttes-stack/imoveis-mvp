import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { recordClientStatusChange } from "./client-status-history";
import { CHAT_CLIENT_EVENT, nextClientStatusOnChatEvent } from "./whatsapp-client-status-core.mjs";

// Grava a mudança automática do status do cliente por causa do Chat (regra em
// whatsapp-client-status-core.mjs). Escreve direto (status + last_status_change_at
// + client_status_history), como as demais mudanças automáticas — sem passar por
// updateSimulationRegistration, que também carimba "última edição do
// administrador" (uma mensagem não é edição de cadastro). Cada mudança é
// condicionada ao status lido (.eq("status", atual)): duas mensagens quase
// simultâneas nunca gravam duas vezes nem sobrescrevem uma mudança manual.

const SOURCE = "whatsapp_chat";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function applyChange(client, event, changedBy) {
  const next = nextClientStatusOnChatEvent(client.status, event);
  if (!next) return null;
  const changedAt = new Date().toISOString();
  const { data, error } = await db()
    .from("simulation_registrations")
    .update({ status: next, last_status_change_at: changedAt })
    .eq("id", client.id)
    .eq("status", client.status)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null; // mudou no meio do caminho: quem chegou primeiro vale
  await recordClientStatusChange({ supabase: db(), clientId: client.id, previousStatus: client.status, newStatus: next, changedAt, changedBy, source: SOURCE });
  return { clientId: client.id, from: client.status, to: next };
}

// Uma pessoa da equipe enviou mensagem pelo Chat. `actorEmail` = quem enviou
// (mesmo e-mail que as mudanças manuais gravam em changed_by).
export async function markClientTryingContact(clientId, actorEmail) {
  if (!clientId) return null;
  const { data: client, error } = await db().from("simulation_registrations").select("id, status").eq("id", clientId).maybeSingle();
  if (error) throw error;
  if (!client) return null;
  return applyChange(client, CHAT_CLIENT_EVENT.HUMAN_MESSAGE_SENT, actorEmail || "sistema");
}

// Clientes que acabaram de RESPONDER no Chat. Só passa para "Em atendimento" quem
// estava em "Tentando contato" e tem corretor responsável — a mudança fica no
// nome dele (é o marco de "atendimento" que ele ganharia ao marcar à mão, uma vez
// por cliente). Sem responsável não muda nada: o cliente ainda não é de ninguém
// (roleta) e a mudança viraria um "em atendimento" órfão.
export async function markClientsInServiceOnReply(clientIds) {
  const ids = [...new Set((clientIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data: clients, error } = await db().from("simulation_registrations").select("id, status, responsible_user_id").in("id", ids);
  if (error) throw error;

  const eligible = (clients || []).filter((client) => client.responsible_user_id && nextClientStatusOnChatEvent(client.status, CHAT_CLIENT_EVENT.CLIENT_REPLIED));
  if (!eligible.length) return [];

  const responsibleIds = [...new Set(eligible.map((client) => client.responsible_user_id))];
  const { data: profiles, error: profileError } = await db().from("admin_users").select("id, email").in("id", responsibleIds);
  if (profileError) throw profileError;
  const emailById = new Map((profiles || []).map((profile) => [profile.id, profile.email]));

  const changes = [];
  for (const client of eligible) {
    const change = await applyChange(client, CHAT_CLIENT_EVENT.CLIENT_REPLIED, emailById.get(client.responsible_user_id) || "sistema");
    if (change) changes.push(change);
  }
  return changes;
}
