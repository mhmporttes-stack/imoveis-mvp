// Botão "Enviar simulação pelo meu WhatsApp" do Chat (pedido do dono, 2026-11-02) — regras PURAS (tests/chat-send-simulation.test.mjs).
// Aparece quando o Chat não deixa responder (cliente ainda não escreveu / janela do oficial fechada / WhatsApp do CRM fora do ar)
// e abre o WhatsApp do PRÓPRIO celular do corretor com SÓ o link da apresentação. Não é um caminho novo de envio: usa a MESMA rota
// do "Simulação › Enviar simulação" (/api/admin/simulacoes/<id>/apresentacao: "enviar-preparar" e "enviar-registrar").

import { toWhatsAppDigits } from "./phone-utils.js";
import { canSendPresentationTo } from "./simulation-presentation-send.mjs";

export const CHAT_SEND_SIM_NO_SIMULATION = "Este cliente ainda não tem simulação. Faça a simulação no card do cliente e volte aqui.";

// Retorna { visible, needsSimulation, hint }. Sem cliente ligado à conversa, grupo, Particular, arquivado/Não contactar
// ou telefone inválido = sem botão. `simulationId` vem do servidor (a simulação do cadastro, a mesma escolhida pela lista de Clientes).
export function chatSendSimulationState({ client = null, simulationId = "", phone = "", isGroup = false, isPrivate = false, archivedReadOnly = false } = {}) {
  const hidden = { visible: false, needsSimulation: false, hint: "" };
  if (!client?.id || isGroup || isPrivate || archivedReadOnly) return hidden;
  if (!canSendPresentationTo({ status: client.status })) return hidden;
  if (!toWhatsAppDigits(phone || client.phone)) return hidden;
  if (!simulationId) return { visible: true, needsSimulation: true, hint: CHAT_SEND_SIM_NO_SIMULATION };
  return { visible: true, needsSimulation: false, hint: "" };
}
