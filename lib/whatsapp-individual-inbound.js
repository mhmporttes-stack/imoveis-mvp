import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { canonicalWhatsappPhone, phoneLookupCandidates } from "./phone-utils";
import { findLatestRegistrationIdsByPhones } from "./client-phone-lookup";
import { markClientsInServiceOnReply } from "./whatsapp-client-status";
import { markConversationHumanReply } from "./whatsapp-attendance";
import { sendPushToUser } from "./push-subscriptions";
import { broadcastChatChanged } from "./whatsapp-chat";

// Mensagem recebida pela sessão INDIVIDUAL (Baileys, WhatsApp pessoal do
// corretor) — projeta no MESMO Chat (whatsapp_conversations/whatsapp_messages)
// que o número oficial usa, só marcando channel/session_user_id diferentes.
// client_id do CRM continua sendo a identidade principal: aqui só decide em
// QUAL conversa a mensagem entra.
//
// Contato NOVO (ainda sem client_id): diferente do número oficial (que
// sorteia na roleta geral), aqui o cliente é SEMPRE do corretor dono da
// sessão — a mensagem chegou no celular pessoal dele, não faz sentido
// mandar para outro corretor por sorteio.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

function previewForText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 140) || "[Mensagem]";
}

const CONVERSATION_COLUMNS = "id, contact_name, client_id, assigned_user_id, deleted_at, origin, last_message_at";

async function findOrCreateConversation(phone) {
  const candidates = phoneLookupCandidates(phone);
  const { data: existing, error } = await db()
    .from("whatsapp_conversations")
    .select(CONVERSATION_COLUMNS)
    .in("contact_phone", candidates)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  if (existing?.[0]) return existing[0];

  const { error: upsertError } = await db()
    .from("whatsapp_conversations")
    .upsert({ contact_phone: phone }, { onConflict: "contact_phone", ignoreDuplicates: true });
  if (upsertError) throw upsertError;

  const { data: refetched, error: refetchError } = await db()
    .from("whatsapp_conversations")
    .select(CONVERSATION_COLUMNS)
    .in("contact_phone", candidates)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (refetchError) throw refetchError;
  return refetched?.[0] || null;
}

async function alreadyRecorded(conversationId, cleanWaMessageId) {
  if (!cleanWaMessageId) return false;
  const { data } = await db()
    .from("whatsapp_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("channel", "whatsapp_individual")
    .eq("metadata->>wa_message_id", cleanWaMessageId)
    .maybeSingle();
  return Boolean(data?.id);
}

// Mensagem que o corretor mandou pelo APLICATIVO OFICIAL do WhatsApp (não
// pelo Chat) — o WhatsApp ecoa pra cá por ser um dispositivo conectado.
// Só REGISTRA (já foi enviada de verdade): mesma atualização de
// última-mensagem/ordem/status que sendChatMessage faz, sem reenviar nada.
// Reaproveita whatsapp_chat_apply_outbound (mesma função do envio pelo
// Chat) — não inventa lógica nova.
async function recordBrokerAppMessage({ userId, conversation, phone, body, messageAt, cleanWaMessageId }) {
  if (await alreadyRecorded(conversation.id, cleanWaMessageId)) {
    return { conversationId: conversation.id, duplicate: true };
  }

  const { data: broker } = await db().from("admin_users").select("name").eq("id", userId).maybeSingle();

  const { error: insertError } = await db().from("whatsapp_messages").insert({
    conversation_id: conversation.id,
    direction: "outbound",
    sender_type: "user",
    sender_user_id: userId,
    sent_by_name: broker?.name || "",
    channel: "whatsapp_individual",
    session_user_id: userId,
    message_type: "text",
    body,
    metadata: cleanWaMessageId ? { wa_message_id: cleanWaMessageId } : {},
    status: "sent",
    sent_at: messageAt,
    message_at: messageAt
  });
  if (insertError) {
    if (insertError.code === "23505") return { conversationId: conversation.id, duplicate: true };
    throw insertError;
  }

  const { error: rpcError } = await db().rpc("whatsapp_chat_apply_outbound", {
    p_conversation_id: conversation.id,
    p_at: messageAt,
    p_preview: previewForText(body),
    p_mark_in_service: true
  });
  if (rpcError) throw rpcError;

  await markConversationHumanReply(conversation.id);
  try {
    const { endLiveFlowSession } = await import("./whatsapp-flows");
    await endLiveFlowSession(phone, "atendente_assumiu");
  } catch (flowError) {
    console.warn("Falha ao encerrar o fluxo automático (mensagem via app oficial):", flowError?.message || flowError);
  }

  // Conversa sem responsável: quem está com o WhatsApp conectado no celular
  // e respondeu é o responsável, sem ambiguidade.
  if (!conversation.assigned_user_id) {
    await db().from("whatsapp_conversations").update({ assigned_user_id: userId, updated_at: new Date().toISOString() }).eq("id", conversation.id);
  }

  await broadcastChatChanged();
  return { conversationId: conversation.id };
}

// { userId, from, text, waMessageId, at, contactName, fromMe } -> { conversationId, duplicate, skipped }
export async function projectIndividualInboundMessage({ userId, from, text, waMessageId = "", at = "", contactName = "", fromMe = false }) {
  const phone = canonicalWhatsappPhone(from);
  if (!phone) return { skipped: "telefone_invalido" };
  const body = String(text || "").trim();
  if (!body) return { skipped: "mensagem_vazia" };

  const conversation = await findOrCreateConversation(phone);
  if (!conversation?.id) return { skipped: "conversa_nao_criada" };

  const messageAt = at && !Number.isNaN(new Date(at).getTime()) ? new Date(at).toISOString() : new Date().toISOString();
  const cleanWaMessageId = String(waMessageId || "").trim();

  if (fromMe) {
    if (!userId) return { skipped: "sem_corretor" };
    return recordBrokerAppMessage({ userId, conversation, phone, body, messageAt, cleanWaMessageId });
  }

  // Idempotência: o microsserviço pode reentregar o mesmo evento (retry de
  // rede) — o índice único parcial (channel, metadata->>'wa_message_id')
  // garante isso no banco; aqui só evita trabalho repetido (RPC, push, roleta).
  if (await alreadyRecorded(conversation.id, cleanWaMessageId)) {
    return { conversationId: conversation.id, duplicate: true };
  }

  const { error: insertError } = await db().from("whatsapp_messages").insert({
    conversation_id: conversation.id,
    direction: "inbound",
    sender_type: "customer",
    channel: "whatsapp_individual",
    session_user_id: userId || null,
    message_type: "text",
    body,
    metadata: cleanWaMessageId ? { wa_message_id: cleanWaMessageId } : {},
    status: "received",
    message_at: messageAt
  });
  if (insertError) {
    // 23505 = violação do índice único parcial (mesma mensagem reentregue no
    // exato instante de uma corrida concorrente) — trata como duplicata, não como falha.
    if (insertError.code === "23505") return { conversationId: conversation.id, duplicate: true };
    throw insertError;
  }

  const clientId = (await findLatestRegistrationIdsByPhones([phone])).get(phone) || null;
  const { error: rpcError } = await db().rpc("whatsapp_chat_apply_inbound", {
    p_conversation_id: conversation.id,
    p_count: 1,
    p_at: messageAt,
    p_preview: previewForText(body),
    p_name: contactName || null,
    p_client_id: clientId,
    p_origin: null
  });
  if (rpcError) throw rpcError;

  if (clientId) {
    try {
      await markClientsInServiceOnReply([clientId]);
    } catch (statusError) {
      console.warn("Falha ao atualizar o status do cliente que respondeu (WhatsApp individual):", statusError?.message || statusError);
    }
  }

  // Mesma regra do canal oficial: só notifica quem já atende a conversa.
  if (conversation.assigned_user_id) {
    try {
      await sendPushToUser(conversation.assigned_user_id, {
        title: contactName || phone,
        body: previewForText(body),
        url: "/admin/chat",
        tag: `whatsapp-chat:${conversation.assigned_user_id}`
      });
    } catch (pushError) {
      console.warn("Falha ao enviar push de mensagem nova (WhatsApp individual):", pushError?.message || pushError);
    }
  }

  // Contato ainda sem cliente vinculado: cria/vincula direto para o corretor
  // dono da sessão que recebeu a mensagem (nunca sorteia — a mensagem já
  // chegou no WhatsApp pessoal dele).
  if (!conversation.client_id && userId) {
    try {
      const { sanitizeContactFullName } = await import("./whatsapp-referral.mjs");
      const fullName = sanitizeContactFullName(contactName);
      const { error: assignError } = await db().rpc("whatsapp_get_or_create_client_for_broker", {
        p_candidates: phoneLookupCandidates(phone),
        p_full_name: fullName,
        p_phone: phone,
        p_phone_normalized: phone,
        p_broker_id: userId,
        p_context: {
          kind: "whatsapp_individual",
          label: "Contato direto no WhatsApp pessoal do corretor",
          actor: "sistema",
          destination: "corretor_dono_da_sessao"
        },
        p_conversation_id: conversation.id,
        p_history_details: { source: "whatsapp_individual", via: "contato_direto", conversationId: conversation.id, phoneLast4: phone.slice(-4) }
      });
      if (assignError) throw assignError;
    } catch (leadError) {
      console.error("Falha ao atribuir o contato direto do WhatsApp individual ao corretor:", leadError?.message || leadError);
    }
  }

  await broadcastChatChanged();
  return { conversationId: conversation.id };
}
