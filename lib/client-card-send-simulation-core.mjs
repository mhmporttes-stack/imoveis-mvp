// Botão "Enviar simulação" do card do cliente (pedido do dono, 2026-11-02) — regras PURAS (tests/client-card-send-simulation.test.mjs).
// Não é um caminho novo de envio: o botão chama a MESMA rota do "Simulação › Enviar simulação"
// (/api/admin/simulacoes/<id>/apresentacao: "enviar-preparar" → mensagem com o link /s/<token> → "enviar-registrar" = presentation_sent).
// Aqui só ficam o estado do botão e a escolha do canal, reaproveitando decideCardWhatsapp (decisão única do botão WhatsApp).

import { toWhatsAppDigits } from "./phone-utils.js";
import { decideCardWhatsapp, CARD_WA_EXTERNAL } from "./client-card-whatsapp-core.mjs";
import { canSendPresentationTo } from "./simulation-presentation-send.mjs";

export const SEND_SIM_HINT_NO_SIMULATION = "Faça a simulação primeiro";
export const SEND_SIM_HINT_BLOCKED = "Este cliente não pode receber mensagens.";
export const SEND_SIM_HINT_NO_PHONE = "Este cliente não tem um WhatsApp válido.";

export const SEND_SIM_CHANNEL_OFFICIAL = "official"; // Chat Oficial, janela de 24 h aberta: envia o link direto
export const SEND_SIM_CHANNEL_CRM_CHAT = "crm_chat"; // WhatsApp do corretor conectado: abre o Chat do CRM com o link pronto
export const SEND_SIM_CHANNEL_EXTERNAL = "external"; // sem WhatsApp conectado / Chat desligado / lista impressa: wa.me ou WhatsApp Web

// Simulação "feita" = a mesma que o card mostra (poder de compra) ou a automática do site (SIM-AUTO, pode ser enviada).
export function clientHasSendableSimulation(client) {
  if (!client?.simulation?.id) return false;
  return Boolean((client.completed && client.summary) || client.summary?.automatic);
}

// Retorna { visible, disabled, reason, hint }. `needsSimulation`: botão fica ativo (aria-disabled) só para explicar a dica ao toque.
export function sendSimulationButtonState({ client = null, whatsappBlocked = false } = {}) {
  if (!client || whatsappBlocked) return { visible: false, disabled: true, reason: "hidden", hint: "" };
  if (!canSendPresentationTo({ status: client.status })) return { visible: true, disabled: true, reason: "blocked", hint: SEND_SIM_HINT_BLOCKED };
  const phone = client.registration?.phoneNormalized || client.registration?.phone;
  if (!toWhatsAppDigits(phone)) return { visible: true, disabled: true, reason: "no_phone", hint: SEND_SIM_HINT_NO_PHONE };
  if (!clientHasSendableSimulation(client)) return { visible: true, disabled: false, needsSimulation: true, reason: "no_simulation", hint: SEND_SIM_HINT_NO_SIMULATION };
  return { visible: true, disabled: false, reason: "ready", hint: "" };
}

// Entrada: { officialConversationId, waState, client, phone, device }. Saída: canal.
// Ordem: conversa do Oficial com janela aberta → (regras do botão WhatsApp: Chat desligado / lista impressa = fora) →
// WhatsApp do corretor conectado e cliente dele → Chat do CRM; qualquer outro caso (estado desconhecido, serviço fora do ar,
// corretor sem WhatsApp conectado, cliente de outro responsável) → abre o WhatsApp/app com o link pronto.
export function decideSendSimulationChannel({ officialConversationId = "", waState = null, client = null, phone = "", device = "desktop" } = {}) {
  if (officialConversationId) return SEND_SIM_CHANNEL_OFFICIAL;
  const isOwnClient = Boolean(waState?.userId) && client?.registration?.responsibleUserId === waState.userId;
  const decision = decideCardWhatsapp({
    stateKnown: Boolean(waState),
    sessionStatus: waState?.sessionStatus ?? null,
    restricted: waState?.restricted === true,
    chatDisabled: waState?.chatDisabled === true,
    printedListMode: waState?.printedListMode === true,
    device,
    clientStatus: client?.status || "",
    isOwnClient,
    phone
  });
  if (decision.action === CARD_WA_EXTERNAL) return SEND_SIM_CHANNEL_EXTERNAL;
  if (Boolean(waState) && isOwnClient && waState.sessionStatus === "connected") return SEND_SIM_CHANNEL_CRM_CHAT;
  return SEND_SIM_CHANNEL_EXTERNAL;
}
