import { canTouchClientOnForecast } from "./documents-forecast-core.mjs";

// Terceira opção do "Enviar simulação" (PDF / Imagem / Apresentação): mensagem com o link /s/<token>. Regras puras e testáveis;
// a ligação ao banco fica na rota /api/admin/simulacoes/[id]/apresentacao. Nunca envia nada sozinho: o corretor confirma.

export const PRESENTATION_SENT_EVENT = "presentation_sent";
export const PRESENTATION_SENT_JOURNEY_TEXT = "Apresentação da simulação enviada";

// "Copiar link" do painel (dono, 2026-10-19): fica na jornada como COPIADO — nunca é "enviado". Não entra na evidência de
// envio (FUN-13, simulation-sent-lock-core) nem nos sinais de atendimento (FUN-15f, client-attendance-core).
export const PRESENTATION_LINK_COPIED_EVENT = "presentation_link_copied";
export const PRESENTATION_LINK_COPIED_JOURNEY_TEXT = "Link da apresentação copiado (envio não confirmado)";

// "Enviar simulação" do painel aciona a MESMA função do gerador (sendPresentationToWhatsApp) por evento de página: nenhum
// fluxo de envio novo. O gerador responde com o estado (enviando / erro) para o painel mostrar.
export const SEND_SIMULATION_REQUEST_EVENT = "mm:enviar-simulacao";
export const SEND_SIMULATION_STATE_EVENT = "mm:enviar-simulacao-estado";
export const SEND_SIMULATION_BLOCKED_TEXT = "Este cliente não pode receber mensagens.";

/** Linha discreta do painel: link aberto pelo cliente sem prova de envio. null quando não há o que avisar. */
export function unregisteredSendLine({ firstOpenedAt = "", sent = false, copiedAt = "" } = {}, formatDay = (value) => value) {
  if (!firstOpenedAt || sent) return null;
  return `Aberto pelo cliente em ${formatDay(firstOpenedAt)} · ${copiedAt ? "link copiado, envio não confirmado" : "envio não registrado"}`;
}

/** Só o link, sem texto junto: o WhatsApp só abre a pré-visualização (cartão do link) quando a mensagem é apenas a URL. */
export function buildPresentationSendMessage({ link = "" } = {}) {
  return String(link || "").trim();
}

/** Cliente vinculado arquivado ou "Não contactar" não recebe. Simulação sem cadastro vinculado não tem status a respeitar. */
export function canSendPresentationTo(registration) {
  if (!registration) return true;
  return canTouchClientOnForecast(registration.status);
}
