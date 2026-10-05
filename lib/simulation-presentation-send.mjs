import { canTouchClientOnForecast } from "./documents-forecast-core.mjs";

// Terceira opção do "Enviar simulação" (PDF / Imagem / Apresentação): mensagem com o link /s/<token>. Regras puras e testáveis;
// a ligação ao banco fica na rota /api/admin/simulacoes/[id]/apresentacao. Nunca envia nada sozinho: o corretor confirma.

export const PRESENTATION_SENT_EVENT = "presentation_sent";
export const PRESENTATION_SENT_JOURNEY_TEXT = "Apresentação da simulação enviada";

/** Só o link, sem texto junto: o WhatsApp só abre a pré-visualização (cartão do link) quando a mensagem é apenas a URL. */
export function buildPresentationSendMessage({ link = "" } = {}) {
  return String(link || "").trim();
}

/** Cliente vinculado arquivado ou "Não contactar" não recebe. Simulação sem cadastro vinculado não tem status a respeitar. */
export function canSendPresentationTo(registration) {
  if (!registration) return true;
  return canTouchClientOnForecast(registration.status);
}
