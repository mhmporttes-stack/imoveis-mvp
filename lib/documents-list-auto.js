import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";
import { findConversationByPhone, findDoNotContactInboundBlock } from "./client-phone-lookup";
import { getSiteBaseUrl } from "./admin-profiles";
import { NOTIFICATION_KIND } from "./notification-policy-core.mjs";
import {
  AUTO_LIST_IMAGE_NAME,
  AUTO_LIST_REPEAT_MS,
  RECENT_LIST_SENT_MS,
  DOCUMENTS_LIST_AUTO_KIND,
  autoDocumentsListNotice,
  isCodedDocumentsListRequest,
  runAutoDocumentsList
} from "./documents-list-auto-core.mjs";

// Lista de documentos enviada SOZINHA pelo número OFICIAL quando o cliente a pede pelo botão da apresentação
// (REGRA OFICIAL — dono, 2026-10-20; regras puras e motivos em lib/documents-list-auto-core.mjs). Chamado por
// processWhatsappWebhook (lib/whatsapp-master.js) DEPOIS de ligar a conversa ao cadastro do código
// (attachCodedConversations) e do "pare", com as mensagens NOVAS (já deduplicadas). Envio com reserva
// (sendReservedAutomationMessage): falha nunca é reenviada; mesmo pedido no mesmo dia = 1 envio.

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function notifyBroker(registration, { sent, reason }) {
  const brokerId = registration.responsible_user_id;
  if (!brokerId) return;
  const { title, description } = autoDocumentsListNotice({ fullName: registration.full_name, sent, reason });
  try {
    const { error } = await db().from("crm_notifications").insert({
      recipient_user_id: brokerId,
      client_id: registration.id,
      title,
      description,
      notification_type: NOTIFICATION_KIND.DOCUMENTS_LIST_AUTO,
      scheduled_at: new Date().toISOString()
    });
    if (error) throw error;
  } catch (error) {
    console.error("Falha ao gravar o aviso da lista de documentos automática:", error?.message || error);
  }
  try {
    const { sendPushToUser } = await import("./push-subscriptions");
    await sendPushToUser(brokerId, { kind: NOTIFICATION_KIND.DOCUMENTS_LIST_AUTO, title, body: description, url: sent ? "/admin/chat" : "/admin/clientes" });
  } catch (error) {
    console.error("Falha ao enviar o push da lista de documentos automática:", error?.message || error);
  }
}

async function handleRequest(event, registration) {
  const phone = event.sender_phone;
  let conversation = null;
  const [{ sendReservedAutomationMessage }, { sendWhatsappMessagePayload }, forecast] = await Promise.all([
    import("./whatsapp-form-reminder"),
    import("./whatsapp-master"),
    import("./documents-forecast")
  ]);
  return runAutoDocumentsList({
    registration,
    text: event.message_text,
    deps: {
      hashText: (text) => createHash("sha256").update(text).digest("hex").slice(0, 16),
      loadContext: async () => {
        conversation = await findConversationByPhone(phone, "id, contact_phone, last_inbound_at");
        const [doNotContactReason, recent, listSent] = await Promise.all([
          findDoNotContactInboundBlock(phone, registration.id),
          conversation?.id
            ? db().from("whatsapp_messages").select("id").eq("conversation_id", conversation.id).eq("sender_type", "automation")
              .eq("metadata->>kind", DOCUMENTS_LIST_AUTO_KIND).neq("status", "failed")
              .gte("message_at", new Date(Date.now() - AUTO_LIST_REPEAT_MS).toISOString()).limit(1)
            : Promise.resolve({ data: [] }),
          db().from("client_journey_events").select("id").eq("client_id", registration.id).eq("event_type", "documents_list_sent")
            .gte("occurred_at", new Date(Date.now() - RECENT_LIST_SENT_MS).toISOString()).limit(1)
        ]);
        if (recent.error) throw recent.error;
        if (listSent.error) throw listSent.error;
        return { conversation, doNotContactReason, recentAutoList: Boolean((recent.data || []).length), recentListSent: Boolean((listSent.data || []).length) };
      },
      prepareList: () => forecast.prepareDocumentsListForAutoSend(registration.id, getSiteBaseUrl()),
      sendText: ({ claimKey, text }) => sendReservedAutomationMessage({
        conversationId: conversation.id,
        claimKey,
        text,
        metadata: { kind: DOCUMENTS_LIST_AUTO_KIND, documents_list: "personalized", client_id: registration.id },
        logLabel: "[lista-documentos-automatica]",
        send: () => sendWhatsappMessagePayload({ to: conversation.contact_phone, message: { type: "text", text: { body: text } } })
      }),
      sendImage: ({ claimKey, imageUrl, caption }) => sendReservedAutomationMessage({
        conversationId: conversation.id,
        claimKey,
        text: caption,
        messageType: "image",
        preview: "[Imagem] Lista de documentos",
        metadata: { kind: DOCUMENTS_LIST_AUTO_KIND, documents_list: "personalized", client_id: registration.id, media: { url: imageUrl, mime: "image/png", name: AUTO_LIST_IMAGE_NAME } },
        logLabel: "[lista-documentos-automatica]",
        send: () => sendWhatsappMessagePayload({ to: conversation.contact_phone, message: { type: "image", image: { link: imageUrl, ...(caption ? { caption } : {}) } } })
      }),
      recordSent: ({ image }) => forecast.recordAutoDocumentsListSent(registration.id, { image }),
      notify: (payload) => notifyBroker(registration, payload)
    }
  });
}

/** Webhook do oficial: `rows` = mensagens novas; `codedContacts` = telefone → { registration } (resolveCodedContacts). */
export async function processAutoDocumentsListRequests(rows = [], codedContacts = new Map()) {
  const results = [];
  const handledPhones = new Set();
  for (const event of rows || []) {
    if (event?.event_type !== "message" || event.direction !== "inbound" || !event.sender_phone) continue;
    if (!isCodedDocumentsListRequest(event.message_text)) continue;
    const registration = codedContacts.get(event.sender_phone)?.registration;
    if (!registration?.id || handledPhones.has(event.sender_phone)) continue;
    handledPhones.add(event.sender_phone);
    try {
      const result = await handleRequest(event, registration);
      console.info(JSON.stringify({ source: "documents-list-auto", event: result.outcome, registrationId: registration.id, messageId: event.message_id }));
      results.push(result);
    } catch (error) {
      console.error("Falha no envio automático da lista de documentos:", error?.message || error);
      results.push({ outcome: "erro" });
    }
  }
  return results;
}
