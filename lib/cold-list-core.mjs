// Lista fria da Prospecção (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24). Parte pura (testável); leitura/gravação no
// banco em lib/cold-list.js (rotina do cron scheduled-activities) e exclusão das listas em lib/simulation-list-query.js.
//
// (1) Esconder: cliente em "Tentando contato" que já recebeu tentativa de pelo menos 3 corretores DIFERENTES sai da visão
//     padrão de Clientes (listas, abas, cards e contadores). Marca = etiqueta do sistema "Lista fria"; continua achável pelo
//     filtro de etiqueta "Lista fria" e pela pesquisa por nome/telefone. Nada é apagado; permissões e escopo iguais.
// (2) Arquivar: na 3ª PASSAGEM sem resposta o cliente é arquivado sozinho (motivo COLD_LIST_ARCHIVE_REASON) e o contato
//     não volta mais à fila. Nunca arquiva quem respondeu, quem tem simulação ou quem saiu de "Tentando contato".
//
// PASSAGEM = um ciclo da Prospecção em que o cliente recebeu pelo menos 1 tentativa real e terminou DEVOLVIDO À FILA sem
// resposta. Tentativa real = linha de daily_goal_attempts (Meta Diária, manual ou automática) ou reivindicação manual na
// Prospecção (prospecting_history "claimed"/"prospecting_started" que não seja reserva: isReservationClaim). Devolução =
// prospecting_history "auto_returned" (7 dias sem tentativa), "daily_goal_round_hibernated" (24 h depois da última
// tentativa) ou "returned" (Devolver do corretor). Devolução sem tentativa desde a devolução anterior NÃO conta.
import { CLIENT_STATUS } from "./client-status.js";
import { isReservationClaim } from "./prospecting-extra-core.mjs";

export const COLD_LIST_TAG = Object.freeze({ name: "Lista fria", key: "lista fria", color: "#475569" });
export const COLD_LIST_MIN_BROKERS = 3;
export const COLD_LIST_ARCHIVE_PASSAGES = 3;
export const COLD_LIST_ARCHIVE_REASON = "lista fria — 3 passagens sem resposta";
export const COLD_LIST_HISTORY_EVENT = "cold_list_archived";
// O contato do cliente arquivado fica "Tentativa recente" com liberação nesta data: a fila (claim_* no banco) só entrega
// recent_attempt com available_after <= agora, então ele nunca volta. Sem migration (o CHECK de status só tem 4 valores).
export const COLD_LIST_LOCK_UNTIL = "2999-12-31T00:00:00.000Z";
export const COLD_LIST_RETURN_EVENTS = Object.freeze(["auto_returned", "daily_goal_round_hibernated", "returned"]);
export const COLD_LIST_MANUAL_ATTEMPT_EVENTS = Object.freeze(["claimed", "prospecting_started"]);

export function isColdListLock(availableAfter) {
  if (!availableAfter) return false;
  const time = new Date(availableAfter).getTime();
  return Number.isFinite(time) && time >= new Date(COLD_LIST_LOCK_UNTIL).getTime();
}

// Linha de prospecting_history que é uma tentativa manual real (não a reserva automática da Meta Diária/Disparar).
export function isManualAttemptHistory(row) {
  return COLD_LIST_MANUAL_ATTEMPT_EVENTS.includes(row?.event_type) && !isReservationClaim(row?.details);
}

export function countDistinctAttemptBrokers(attempts = []) {
  return new Set(attempts.map((attempt) => attempt?.brokerId).filter(Boolean)).size;
}

// attempts: [{ at }], returns: [{ at }] do MESMO cliente. Conta as devoluções que tiveram tentativa desde a anterior.
export function countColdListPassages(attempts = [], returns = []) {
  const attemptTimes = attempts.map((item) => new Date(item?.at).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const returnTimes = returns.map((item) => new Date(item?.at).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  let passages = 0;
  let previous = -Infinity;
  for (const returnedAt of returnTimes) {
    if (attemptTimes.some((at) => at > previous && at <= returnedAt)) passages += 1;
    previous = returnedAt;
  }
  return passages;
}

export function isColdListHidden({ status, privateContactAt = null, distinctBrokers = 0 } = {}) {
  return status === CLIENT_STATUS.AWAITING_RETURN && !privateContactAt && distinctBrokers >= COLD_LIST_MIN_BROKERS;
}

// Motivo para NÃO arquivar (null = arquivar). `contactInWallet`: algum contato do cliente está com um corretor agora
// (ciclo em andamento) — espera a devolução.
export function coldListArchiveBlockReason({ status, privateContactAt = null, passages = 0, responded = false, hasSimulation = false, contactInWallet = false } = {}) {
  if (status !== CLIENT_STATUS.AWAITING_RETURN) return "fora_de_tentando_contato";
  if (privateContactAt) return "particular";
  if (passages < COLD_LIST_ARCHIVE_PASSAGES) return "menos_de_3_passagens";
  if (responded) return "cliente_respondeu";
  if (hasSimulation) return "tem_simulacao";
  if (contactInWallet) return "contato_com_corretor";
  return null;
}

// Exclusão da visão padrão (lista, abas, contadores). Pesquisando por nome/telefone ou filtrando pela etiqueta "Lista
// fria" nada é escondido.
export function applyColdListExclusion(query, { hiddenIds = [], searching = false, filteringColdTag = false } = {}) {
  if (searching || filteringColdTag || !hiddenIds.length) return query;
  return query.not("id", "in", `(${hiddenIds.join(",")})`);
}
