import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { markConversationHumanReply } from "./whatsapp-attendance";
import { markClientOnHumanMessage } from "./whatsapp-client-status";
import { findRegistrationsByPhone } from "./client-phone-lookup";
import { findInternalTeamPhone } from "./internal-phones";
import { AUTOMATION_ECHO_WINDOW_MS, isAutomationEcho, isHumanContactMessage, pickUnambiguousRegistration } from "./human-contact-core.mjs";

// FONTE ÚNICA do "contato humano com o cliente" (P-11). Chamada pelos três pontos de envio do Chat do
// CRM (texto, modelo, mídia/atalho — lib/whatsapp-chat.js) e pelo caminho em que o corretor responde pelo
// aplicativo do celular (recordBrokerAppMessage, lib/whatsapp-individual-inbound.js). Regra e definições
// (PRIMEIRO CONTATO, autoria x responsável): lib/human-contact-core.mjs.
//
// O que faz, quando a mensagem é prova de contato humano (enviada, por pessoa, não é histórico/nota/reação):
//  1) marca a conversa (whatsapp_conversations.last_human_reply_at) — "atendimento humano ativo", protege
//     contra a redistribuição da roleta (ROL-4) e contra a cadência automática da Meta Diária;
//  2) se a conversa está ligada a um cliente: grava o contato do cliente (last_whatsapp_contact_at, só
//     avança no tempo) e aplica a mudança de status do Chat (WA-9). Autor da mudança = quem enviou;
//  3) só com phoneFallback (celular): conversa SEM cliente -> procura o cliente pelo telefone e só vincula
//     se houver um único candidato claro (CLI-4: um telefone pode ter vários atendimentos).
// Nunca cria cliente. Melhor esforço: a mensagem já foi enviada, uma falha aqui nunca a desfaz.
//
// NÃO é contato humano (e não passa por aqui): clique no botão WhatsApp (continua gravando
// last_whatsapp_contact_at pelo caminho dele, sem mudar), abertura de conversa, nota interna,
// mensagem automática, tentativa com status failed, reação, histórico importado.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function resolveClientByPhone({ conversation, phone, actor }) {
  if (!phone) return null;
  try {
    if (await findInternalTeamPhone(phone)) return null; // WA-12: número da equipe nunca vira cliente
  } catch (error) {
    console.warn("Falha ao checar telefone da equipe no contato humano:", error?.message || error);
    return null; // na dúvida, não vincula
  }
  const rows = await findRegistrationsByPhone(phone);
  const chosen = pickUnambiguousRegistration(rows, { brokerIds: [actor?.userId, actor?.linkedBrokerId] });
  if (!chosen) return null;
  const { error } = await db().from("whatsapp_conversations").update({ client_id: chosen.id }).eq("id", conversation.id).is("client_id", null);
  if (error) throw error;
  return chosen.id;
}

// conversation: { id, client_id, contact_phone? }; actor: { userId, email, linkedBrokerId } = QUEM ENVIOU;
// at: hora real da mensagem; message: { direction, senderType, status, messageType, metadata }.
export async function registerHumanContact({ conversation, actor, at = new Date(), message, phoneFallback = false }) {
  if (!conversation?.id) return { counted: false, reason: "sem_conversa" };
  if (!isHumanContactMessage(message)) return { counted: false, reason: "nao_e_contato_humano" };

  const when = at instanceof Date ? at : new Date(at);
  await markConversationHumanReply(conversation.id, Number.isNaN(when.getTime()) ? new Date() : when);

  let clientId = conversation.client_id || null;
  try {
    if (!clientId && phoneFallback) clientId = await resolveClientByPhone({ conversation, phone: conversation.contact_phone, actor });
    if (!clientId) return { counted: true, clientId: null };
    const statusChange = await markClientOnHumanMessage(clientId, actor, { at: when });
    return { counted: true, clientId, statusChange };
  } catch (error) {
    console.warn("Falha ao registrar o contato humano no cliente:", error?.message || error);
    return { counted: true, clientId, error: true };
  }
}

// Eco, no celular do corretor, de uma mensagem que a AUTOMAÇÃO da Meta Diária acabou de enviar? Então não é
// contato humano (nem entra no Chat como mensagem da pessoa). Consulta a fila do mesmo WhatsApp.
export async function isAutomationEchoForBroker({ userId, waMessageId, body, messageAt }) {
  if (!userId) return false;
  const rows = [];
  const id = String(waMessageId || "").trim();
  if (id) {
    const { data, error } = await db().from("daily_goal_auto_queue").select("wa_message_id, message_text, send_started_at, sent_at").eq("broker_id", userId).eq("wa_message_id", id).limit(1);
    if (error) throw error;
    rows.push(...(data || []));
  }
  const at = new Date(messageAt || Date.now()).getTime();
  if (Number.isFinite(at)) {
    const from = new Date(at - AUTOMATION_ECHO_WINDOW_MS).toISOString();
    const to = new Date(at + AUTOMATION_ECHO_WINDOW_MS).toISOString();
    const { data, error } = await db().from("daily_goal_auto_queue").select("wa_message_id, message_text, send_started_at, sent_at").eq("broker_id", userId).gte("send_started_at", from).lte("send_started_at", to).limit(50);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return isAutomationEcho({ waMessageId: id, body, messageAt }, rows);
}
