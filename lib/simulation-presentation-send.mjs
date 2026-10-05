import { canTouchClientOnForecast, cleanFirstName } from "./documents-forecast-core.mjs";

// Terceira opção do "Enviar simulação" (PDF / Imagem / Apresentação): mensagem com o link /s/<token>. Regras puras e testáveis;
// a ligação ao banco fica na rota /api/admin/simulacoes/[id]/apresentacao. Nunca envia nada sozinho: o corretor confirma.

export const PRESENTATION_SENT_EVENT = "presentation_sent";
export const PRESENTATION_SENT_JOURNEY_TEXT = "Apresentação da simulação enviada";

/** "Olá, {primeiro nome}! Preparei a sua simulação de financiamento de um jeito interativo: {link}". Só o primeiro nome. */
export function buildPresentationSendMessage({ fullName = "", link = "" } = {}) {
  const name = cleanFirstName(fullName);
  return `Olá${name ? `, ${name}` : ""}! Preparei a sua simulação de financiamento de um jeito interativo: ${link}`;
}

/** Cliente vinculado arquivado ou "Não contactar" não recebe. Simulação sem cadastro vinculado não tem status a respeitar. */
export function canSendPresentationTo(registration) {
  if (!registration) return true;
  return canTouchClientOnForecast(registration.status);
}
