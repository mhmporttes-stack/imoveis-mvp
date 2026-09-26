import { CLIENT_STATUS, normalizeClientStatus } from "./client-status.js";

// Status do CLIENTE que muda sozinho conforme a conversa no Chat (regra do dono,
// 2026-09-25). Puro e testado; a gravação fica em whatsapp-client-status.js.
//
//  - Uma PESSOA da equipe envia mensagem ao cliente  -> "Tentando contato"
//    (só se ele ainda está em "Aguardando simulação").
//  - O cliente RESPONDE                               -> "Em atendimento"
//    (só se ele estava em "Tentando contato", isto é, respondeu a uma tentativa).
//
// Só anda para a frente: cliente mais adiante no funil, arquivado ou "não
// contactar" nunca é rebaixado nem reaberto por uma mensagem.
export const CHAT_CLIENT_EVENT = { HUMAN_MESSAGE_SENT: "human_message_sent", CLIENT_REPLIED: "client_replied" };

export function nextClientStatusOnChatEvent(currentStatus, event) {
  const status = normalizeClientStatus(currentStatus);
  if (event === CHAT_CLIENT_EVENT.HUMAN_MESSAGE_SENT && status === CLIENT_STATUS.PENDING) return CLIENT_STATUS.AWAITING_RETURN;
  if (event === CHAT_CLIENT_EVENT.CLIENT_REPLIED && status === CLIENT_STATUS.AWAITING_RETURN) return CLIENT_STATUS.IN_SERVICE;
  return null;
}

// Mensagem do cliente que conta como "respondeu": qualquer conteúdo, menos uma
// reação (👍 a uma mensagem) — isso não é uma resposta de atendimento.
export function isClientReplyMessage(messageType) {
  return String(messageType || "text") !== "reaction";
}
