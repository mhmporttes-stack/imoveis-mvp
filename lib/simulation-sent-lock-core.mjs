// Trava "Simulação enviada" (regra do dono, 2026-10-12): o corretor/associado não marca "Simulação enviada" à mão sem
// ter enviado a simulação de verdade. Fonte ÚNICA do que conta como "simulação enviada" para um cliente — usada também
// pela trava "primeira mensagem = link da simulação" (ROL-4c, lib/whatsapp-chat.js). Puro e testado
// (tests/simulation-sent-lock.test.mjs); a leitura do banco fica em lib/simulation-sent-evidence.js.
import { isPresentationLinkMessage } from "./simulation-first-core.mjs";

export const SIMULATION_SENT_STATUS = "simulation_sent";

export const SIMULATION_SENT_LOCK_MESSAGE = "Envie a simulação ao cliente pelo Chat (link da apresentação) antes de marcar 'Simulação enviada'.";

// PDF gerado pelo CRM sai com o nome "simulacao-<cliente>.pdf" (components/SimulationGenerator.jsx). É a única marcação
// identificável de um PDF de simulação enviado pelo Chat.
const SIMULATION_PDF_NAME = /^simulacao-.*\.pdf$/i;

// Mensagem de SAÍDA ao cliente (Chat do CRM ou celular do corretor) que não falhou. Nota interna não é "outbound".
function isDeliveredOutbound(message) {
  return message?.direction === "outbound" && message?.status !== "failed";
}

export function isSimulationPdfMessage(message) {
  if (!isDeliveredOutbound(message) || message.message_type !== "document") return false;
  return SIMULATION_PDF_NAME.test(String(message.metadata?.media?.name || "").trim());
}

// O link pode estar no texto OU em metadata.link.url: pelo número OFICIAL a apresentação sai como botão "Visualizar
// simulação" (lib/whatsapp-chat.js, desde 2026-10-09) e o texto gravado fica sem o link (caso #C6600, 2026-10-19).
export function isPresentationLinkSent(message) {
  if (!isDeliveredOutbound(message)) return false;
  return isPresentationLinkMessage(message.body) || isPresentationLinkMessage(message.metadata?.link?.url);
}

// presentationEvents = quantos eventos "presentation_sent" o cliente tem na jornada; messages = mensagens das conversas dele.
export function classifySimulationSentEvidence({ presentationEvents = 0, messages = [] } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const presentationEvent = Number(presentationEvents) > 0;
  const presentationLink = list.some(isPresentationLinkSent);
  const simulationPdf = list.some(isSimulationPdfMessage);
  return { presentationEvent, presentationLink, simulationPdf, sent: presentationEvent || presentationLink || simulationPdf };
}

// Quem é travado: corretor e associado — pelo perfil EFETIVO, então vale também para admin/gestor em "Alterar conta"
// como eles (ação operacional como o corretor é do corretor). Admin geral e gestor no próprio perfil passam.
export function isSimulationSentRestrictedProfile(profile) {
  return ["broker", "associate"].includes(profile?.role);
}

export function shouldBlockManualSimulationSent({ currentStatus, nextStatus, profile, evidenceSent }) {
  if (nextStatus !== SIMULATION_SENT_STATUS || currentStatus === SIMULATION_SENT_STATUS) return false;
  if (!isSimulationSentRestrictedProfile(profile)) return false;
  return !evidenceSent;
}
