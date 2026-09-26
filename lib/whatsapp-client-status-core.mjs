import { CLIENT_STATUS, normalizeClientStatus } from "./client-status.js";

// Status do CLIENTE que muda sozinho conforme a conversa no Chat (regras do dono,
// 2026-09-25/26). Puro e testado; a gravação fica em whatsapp-client-status.js.
//
// Cliente que veio pelo WhatsApp e ainda NÃO preencheu o formulário:
//  - nasce em "Atendimento automático" (só interagiu com as automações do Chat);
//  - uma PESSOA da equipe responde no Chat            -> "Em atendimento";
//  - preenche o link do formulário                    -> "Aguardando simulação"
//    (feito por createSimulationRegistration ao reconhecer o telefone).
// Cliente que já preencheu o formulário ("Aguardando simulação"):
//  - uma PESSOA da equipe envia mensagem              -> "Tentando contato";
//  - o cliente RESPONDE (estava em "Tentando contato") -> "Em atendimento".
//
// Só anda para a frente: cliente mais adiante no funil, arquivado ou "não
// contactar" nunca é rebaixado nem reaberto por uma mensagem.
export const CHAT_CLIENT_EVENT = { HUMAN_MESSAGE_SENT: "human_message_sent", CLIENT_REPLIED: "client_replied" };

export function nextClientStatusOnChatEvent(currentStatus, event) {
  const status = normalizeClientStatus(currentStatus);
  if (event === CHAT_CLIENT_EVENT.HUMAN_MESSAGE_SENT) {
    if (status === CLIENT_STATUS.AUTOMATED_SERVICE) return CLIENT_STATUS.IN_SERVICE;
    if (status === CLIENT_STATUS.PENDING) return CLIENT_STATUS.AWAITING_RETURN;
  }
  if (event === CHAT_CLIENT_EVENT.CLIENT_REPLIED && status === CLIENT_STATUS.AWAITING_RETURN) return CLIENT_STATUS.IN_SERVICE;
  return null;
}

// Cadastro de contato do WhatsApp que ainda está "Aguardando simulação" sem o cliente ter
// preenchido o formulário (valores padrão): quem cuida dele já é um corretor -> "Em atendimento".
// Usado quando um corretor adiciona a conversa ao CRM. `simulationFilled` vem de
// hasSimulationData (lib/simulation-registration-schema.js), o critério único de "preencheu".
export function shouldStartServiceOnManualAdd(status, simulationFilled) {
  return normalizeClientStatus(status) === CLIENT_STATUS.PENDING && !simulationFilled;
}

// Mensagem do cliente que conta como "respondeu": qualquer conteúdo, menos uma
// reação (👍 a uma mensagem) — isso não é uma resposta de atendimento.
export function isClientReplyMessage(messageType) {
  return String(messageType || "text") !== "reaction";
}
