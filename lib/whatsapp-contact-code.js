import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { findConversationByPhone } from "./client-phone-lookup";
import { phoneComparisonKey } from "./phone-utils";
import { contactCodeIdRange, decideCodedConversationLink, extractContactCode, hasContactCodeMarker } from "./whatsapp-contact-code-core.mjs";

// Mensagem que chega no número OFICIAL vinda de um botão do link (REGRA OFICIAL — dono, 2026-10-18): a conversa fica com o
// corretor responsável pelo cliente, o cliente continua com ele, não passa pela roleta e não vira cliente novo. Regras puras
// em lib/whatsapp-contact-code-core.mjs. Chamado por processWhatsappWebhook (lib/whatsapp-master.js) em dois passos:
//  1) resolveCodedContacts ANTES de projetar o Chat: o cadastro do código passa a ser o cliente do telefone nesta entrega
//     (conversa nova já nasce ligada a ele — o cadastro automático do contato direto vê "cliente já vinculado" e não roda);
//  2) attachCodedConversations DEPOIS de projetar: liga/religa a conversa e a atribui ao responsável ATIVO.

const CONVERSATION_COLUMNS = "id, client_id, assigned_user_id, private_at, origin";

function db() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase não configurado no servidor.");
  return supabase;
}

function log(event, details) {
  console.log(JSON.stringify({ source: "whatsapp-contact-code", event, ...details }));
}

// Cadastro cujo id começa com o código; ambíguo (2 ou mais) ou nenhum = null.
async function findRegistrationIdByCode(prefix) {
  const range = contactCodeIdRange(prefix);
  if (!range) return null;
  const { data, error } = await db().from("simulation_registrations").select("id").gte("id", range.from).lte("id", range.to).limit(2);
  if (error) throw error;
  return data?.length === 1 ? data[0].id : null;
}

/**
 * Telefones desta entrega cuja mensagem traz o código de um botão do link → { registration, via: "codigo"|"telefone" }.
 * Código ilegível/ambíguo: fallback pelo cadastro do telefone (o mesmo que o webhook já achou). Sem código: nada muda.
 */
export async function resolveCodedContacts(events, clientByPhone = new Map()) {
  const prefixByPhone = new Map();
  for (const event of events || []) {
    if (event?.event_type !== "message" || event.direction !== "inbound" || !event.sender_phone) continue;
    if (!hasContactCodeMarker(event.message_text)) continue;
    prefixByPhone.set(event.sender_phone, extractContactCode(event.message_text));
  }

  const resolved = new Map();
  for (const [phone, prefix] of prefixByPhone) {
    try {
      let registrationId = prefix ? await findRegistrationIdByCode(prefix) : null;
      const via = registrationId ? "codigo" : "telefone";
      registrationId = registrationId || clientByPhone.get(phone) || null;
      if (!registrationId) {
        log("sem_cadastro", { codeFound: Boolean(prefix) });
        continue;
      }
      const { data: registration, error } = await db()
        .from("simulation_registrations")
        .select("id, status, responsible_user_id, phone_normalized")
        .eq("id", registrationId)
        .maybeSingle();
      if (error) throw error;
      if (registration) resolved.set(phone, { registration, via });
    } catch (error) {
      console.error("Falha ao resolver o código do atendimento no WhatsApp oficial:", error?.message || error);
    }
  }
  return resolved;
}

/** Liga a conversa do oficial ao cadastro do código e a entrega ao corretor responsável ativo (nunca troca o responsável). */
export async function attachCodedConversations(resolved) {
  const results = [];
  for (const [phone, { registration, via }] of resolved || []) {
    try {
      const conversation = await findConversationByPhone(phone, CONVERSATION_COLUMNS);
      let currentClientStatus = "";
      if (conversation?.client_id && conversation.client_id !== registration.id) {
        const { data, error } = await db().from("simulation_registrations").select("status").eq("id", conversation.client_id).maybeSingle();
        if (error) throw error;
        currentClientStatus = data?.status || "";
      }
      let responsibleActive = false;
      if (registration.responsible_user_id) {
        const { data, error } = await db().from("admin_users").select("status").eq("id", registration.responsible_user_id).maybeSingle();
        if (error) throw error;
        responsibleActive = data?.status === "active";
      }
      const samePhone = Boolean(registration.phone_normalized) && phoneComparisonKey(registration.phone_normalized) === phoneComparisonKey(phone);
      const decision = decideCodedConversationLink({ conversation, registration, responsibleActive, currentClientStatus, samePhone });
      const details = { conversationId: conversation?.id || null, registrationId: registration.id, via };
      if (decision.action !== "update") {
        log("ignorado", { ...details, reason: decision.reason });
        results.push({ ...details, skipped: decision.reason });
        continue;
      }
      const { error } = await db()
        .from("whatsapp_conversations")
        .update({ ...decision.patch, updated_at: new Date().toISOString() })
        .eq("id", conversation.id);
      if (error) throw error;
      log("atribuida", { ...details, relinked: decision.relinked, assigned: decision.assigned });
      results.push({ ...details, relinked: decision.relinked, assigned: decision.assigned });
    } catch (error) {
      console.error("Falha ao atribuir a conversa do código do atendimento:", error?.message || error);
      results.push({ registrationId: registration?.id || null, error: String(error?.message || error).slice(0, 200) });
    }
  }
  return results;
}
