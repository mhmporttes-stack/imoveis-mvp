import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { recordClientStatusChange } from "./client-status-history";
import { CHAT_CLIENT_EVENT, nextClientStatusOnChatEvent, shouldStartServiceOnManualAdd } from "./whatsapp-client-status-core.mjs";
import { CLIENT_STATUS } from "./client-status";
import { hasSimulationData } from "./simulation-registration-schema";

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

async function emailOfUser(userId) {
  if (!userId) return "";
  const { data } = await db().from("admin_users").select("email").eq("id", userId).maybeSingle();
  return data?.email || "";
}

// Uma pessoa da equipe enviou mensagem pelo Chat. `actorEmail` = quem enviou (mesmo e-mail
// que as mudanças manuais gravam em changed_by). "Aguardando simulação" -> "Tentando contato"
// (no nome de quem enviou); "Atendimento automático" -> "Em atendimento" (no nome do corretor
// responsável, com quem enviou como plano B: é o marco de atendimento da pontuação, uma vez por cliente).
export async function markClientOnHumanMessage(clientId, actorEmail) {
  if (!clientId) return null;
  const { data: client, error } = await db().from("simulation_registrations").select("id, status, responsible_user_id").eq("id", clientId).maybeSingle();
  if (error) throw error;
  if (!client) return null;
  // last_whatsapp_contact_at grava SEMPRE que um humano manda mensagem pelo Chat,
  // mesmo quando o status não muda (ex.: cliente já "Em atendimento") — é o campo
  // que "Clientes pendentes"/Meta Diária usam pra saber há quanto tempo sem
  // contato; antes disso só era gravado ao clicar o botão WhatsApp do card do
  // cliente ou reivindicar/tentar contato pela Prospecção, nunca ao mandar
  // mensagem direto na conversa do Chat — cliente conversando ativamente no Chat
  // podia continuar contando como "pendente"/"sem contato" (bug real, 2026-09-28).
  const { error: contactError } = await db().from("simulation_registrations").update({ last_whatsapp_contact_at: new Date().toISOString() }).eq("id", clientId);
  if (contactError) throw contactError;
  const next = nextClientStatusOnChatEvent(client.status, CHAT_CLIENT_EVENT.HUMAN_MESSAGE_SENT);
  if (!next) return null;
  const changedBy = next === CLIENT_STATUS.IN_SERVICE ? (await emailOfUser(client.responsible_user_id)) || actorEmail || "sistema" : actorEmail || "sistema";
  return applyChange(client, CHAT_CLIENT_EVENT.HUMAN_MESSAGE_SENT, changedBy);
}

// Corretor adicionou a conversa ao CRM (cadastro reaproveitado ou novo). Se o cliente ficou em
// "Aguardando simulação" sem ter preenchido o formulário, quem cuida dele já é um corretor:
// "Em atendimento". `registration` = cadastro completo do cliente.
export async function startServiceOnManualAdd(registration, actorEmail) {
  if (!registration?.id || !shouldStartServiceOnManualAdd(registration.status, hasSimulationData(registration))) return null;
  const changedAt = new Date().toISOString();
  const { data, error } = await db()
    .from("simulation_registrations")
    .update({ status: CLIENT_STATUS.IN_SERVICE, last_status_change_at: changedAt })
    .eq("id", registration.id)
    .eq("status", CLIENT_STATUS.PENDING)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await recordClientStatusChange({ supabase: db(), clientId: registration.id, previousStatus: CLIENT_STATUS.PENDING, newStatus: CLIENT_STATUS.IN_SERVICE, changedAt, changedBy: actorEmail || "sistema", source: SOURCE });
  return { clientId: registration.id, from: CLIENT_STATUS.PENDING, to: CLIENT_STATUS.IN_SERVICE };
}

// Clientes que acabaram de RESPONDER. Só passa para "Em atendimento" quem estava em
// "Tentando contato" e tem corretor responsável — a mudança fica no nome dele (é o
// marco de "atendimento" que ele ganharia ao marcar à mão, uma vez por cliente). Sem
// responsável não muda nada: o cliente ainda não é de ninguém (roleta) e a mudança
// viraria um "em atendimento" órfão.
// Cliente em PROSPECÇÃO (já recebeu tentativa pela fila/Meta Diária) é promovido pelo
// consumidor da Prospecção (lib/prospecting-reply.js, includeProspected: true), que
// também encerra a cadência — por isso o caminho do Chat do WhatsApp individual o deixa
// de fora: se o Chat promovesse antes, a Prospecção não o veria mais em "Tentando
// contato" e a cadência continuaria enviando. Regra do dono, 2026-10-02: a resposta de
// cliente em prospecção também vira "Em atendimento" sozinha (substituiu a pendência manual).
export async function markClientsInServiceOnReply(clientIds, { includeProspected = false } = {}) {
  const ids = [...new Set((clientIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { data: clients, error } = await db().from("simulation_registrations").select("id, status, responsible_user_id").in("id", ids);
  if (error) throw error;

  let eligible = (clients || []).filter((client) => client.responsible_user_id && nextClientStatusOnChatEvent(client.status, CHAT_CLIENT_EVENT.CLIENT_REPLIED));
  if (!eligible.length) return [];

  if (!includeProspected) {
    const { data: prospected, error: prospectedError } = await db().from("prospecting_contacts").select("registration_id").in("registration_id", eligible.map((client) => client.id)).not("last_attempt_at", "is", null);
    if (prospectedError) throw prospectedError;
    const prospectedIds = new Set((prospected || []).map((row) => row.registration_id));
    eligible = eligible.filter((client) => !prospectedIds.has(client.id));
    if (!eligible.length) return [];
  }

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
