// "Primeira mensagem = link da simulação" (regra do dono, 2026-10-09). Cliente da roleta que chegou com os dados da
// simulação (renda informada) e ainda não recebeu a simulação: o Chat do CRM não deixa o corretor mandar nada antes do
// link da apresentação (/s/<token>). Motivo do dono: o corretor se apresentava, não simulava, o cliente voltava para a
// roleta em 5 min e o próximo corretor se apresentava de novo. Puro e testado (tests/simulation-first.test.mjs).
import { PRE_SIMULATION_STATUSES, hasSimulationData } from "./simulation-deadline-core.mjs";

// Não retroativo: só clientes recebidos depois da publicação.
export const SIMULATION_FIRST_SINCE = "2026-10-09T13:00:00Z";

export const SIMULATION_FIRST_MESSAGE = "Este cliente já preencheu os dados: a primeira mensagem tem que ser a simulação. Faça a simulação e envie o link da apresentação (Simulação → Enviar link) — depois o Chat libera as outras mensagens.";

// Também "Simulação realizada" (completed) enquanto o link não saiu (caso Gabriel, 2026-10-09: simulação feita, corretora
// mandou "Olá, bom dia" e o cliente nunca recebeu a simulação).
export const SIMULATION_FIRST_STATUSES = [...PRE_SIMULATION_STATUSES, "completed"];

const PRESENTATION_LINK = /https?:\/\/[^\s]+\/s\/[A-Za-z0-9_-]{8,}/i;

export function isPresentationLinkMessage(text) {
  return PRESENTATION_LINK.test(String(text || ""));
}

export function requiresSimulationFirst(client, { presentationSent = false } = {}) {
  if (!client || presentationSent) return false;
  if (client.distribution_type !== "round_robin") return false;
  if (!hasSimulationData(client)) return false;
  if (!SIMULATION_FIRST_STATUSES.includes(client.status)) return false;
  const receivedAt = Date.parse(client.responsible_changed_at || client.created_at || "");
  return receivedAt >= Date.parse(SIMULATION_FIRST_SINCE);
}

// Link INTERNO do CRM (/admin/...) não abre para o cliente (pede login). Caso real 2026-10-09: corretora colou o endereço
// da tela de apresentação do CRM em vez do link público /s/<token>.
const INTERNAL_CRM_LINK = /https?:\/\/[^\s]*\/admin\//i;

export const INTERNAL_LINK_MESSAGE = "Esse link é da área interna do CRM e o cliente não consegue abrir (pede login). Para mandar a simulação, use o botão \"Enviar simulação\" (Link da apresentação) — ele já coloca o link certo aqui no Chat.";

export function hasInternalCrmLink(text) {
  return INTERNAL_CRM_LINK.test(String(text || ""));
}
