// Mensagem AUTOMÁTICA enviada pelo WhatsApp PESSOAL do corretor (Meta Diária, fila "Disparar", confirmação de
// descadastro) -> linha do Chat (whatsapp_messages). Puro e testado (tests/whatsapp-automation-chat.test.mjs).
//
// Por quê (incidente 2026-10-17, "o povo não sabe o que foi mandado"): até aqui essas mensagens só ficavam em
// daily_goal_auto_queue; o serviço do WhatsApp descarta o eco do próprio envio (APPEND_OWN_SEND_GRACE_MS) e o eco que
// chegava era descartado como "eco_automacao". Resultado: o cliente respondia e o corretor via só a resposta.
//
// A linha é de AUTOMAÇÃO (sender_type "automation", etiqueta "Automação" no Chat): nunca é contato humano, primeiro
// contato, "Em atendimento" nem pontuação (MD-13, WA-4a, human-contact-core). Mesmo formato do lembrete do formulário
// (lib/whatsapp-form-reminder.js sendReservedAutomationMessage), sem reserva: o envio já aconteceu e tem wa_message_id,
// que é a chave do dedupe (índice único por sessão + wa_message_id) — o eco do celular, se chegar, vira duplicata.

export const DAILY_GOAL_AUTO_CHAT_KIND = "daily_goal_auto";
export const OPT_OUT_CONFIRMATION_CHAT_KIND = "opt_out_confirmation";

// -> linha para inserir em whatsapp_messages, ou null quando falta o essencial (nunca grava linha sem id do WhatsApp:
// sem ele não há dedupe e o eco duplicaria).
export function buildIndividualAutomationMessageRow({ conversationId, userId, sessionSlot = 1, text, waMessageId, remoteJid = "", sentAt, metadata = {} } = {}) {
  const body = String(text || "").trim();
  const waId = String(waMessageId || "").trim();
  if (!conversationId || !userId || !body || !waId) return null;
  const at = sentAt && !Number.isNaN(new Date(sentAt).getTime()) ? new Date(sentAt).toISOString() : new Date().toISOString();
  const slot = Number(sessionSlot) === 2 ? 2 : 1;
  return {
    conversation_id: conversationId,
    direction: "outbound",
    sender_type: "automation",
    channel: "whatsapp_individual",
    session_user_id: userId,
    session_slot: slot,
    message_type: "text",
    body,
    metadata: { ...(metadata || {}), wa_message_id: waId, ...(remoteJid ? { remote_jid: String(remoteJid) } : {}) },
    status: "sent",
    sent_at: at,
    message_at: at
  };
}
