import { CLIENT_STATUS, NEGATIVE_CLIENT_STATUS_VALUES, normalizeClientStatus } from "./client-status.js";

// Núcleo PURO (testável) das regras de "cliente sem responsável" e de elegibilidade para a roleta.
//
// [REGRA OFICIAL DE NEGÓCIO — decidida pelo dono em 2026-10-03] (P-05)
// Cliente DEVOLVIDO À FILA pela Prospecção (retorno automático de 7 dias, hibernação da Meta Diária,
// "Devolver" do corretor, "Devolver à fila" do administrador) fica SEM RESPONSÁVEL de verdade
// (responsible_user_id = null) e assim permanece até uma regra válida de distribuição atribuir (a
// Prospecção/Meta Diária, ao reivindicar o contato, ou a transferência manual). A rede de segurança
// reassignOrphanedClientsToOwner NÃO devolve esse cliente ao administrador principal.
// NÃO muda: "Ninguém (liberar)" do Chat (D1) devolve o cliente para a roleta por presença; "Não contactar"
// mantém o responsável (CLI-9); cliente da fila de espera da roleta (pending_distribution_at) é do
// reassignPendingRouletteLeads.

// Status que o cliente devolvido à fila carrega ("Tentando contato"): os quatro caminhos de devolução
// (B, C, D2, D3) o mantêm/colocam nele.
export const RETURNED_TO_QUEUE_STATUS = CLIENT_STATUS.AWAITING_RETURN;

// Campos do cliente quando a Prospecção o devolve à fila. `setStatus` = caminhos que também colocam o
// cliente em "Tentando contato" (devolução manual); os automáticos (B, C) só atuam sobre quem já está nele.
export function returnedToQueueClientPatch(nowIso, { setStatus = false } = {}) {
  const patch = { responsible_user_id: null, last_status_change_at: nowIso };
  if (setStatus) patch.status = RETURNED_TO_QUEUE_STATUS;
  return patch;
}

// Os retornos AUTOMÁTICOS da Prospecção (7 dias sem tentativa e hibernação da Meta Diária) só podem tirar o cliente de
// quem estava no ciclo parado. Contato antigo ainda "claimed" (de outro corretor ou de ninguém) NÃO derruba o cliente que
// foi entregue a OUTRA pessoa depois desse ciclo (fila de reativação FUN-15l, roleta, transferência CLI-7): o clique no
// WhatsApp leva o transferido a "Tentando contato" (CLI-7c) e, sem esta trava, o retorno de 7 dias zerava o responsável
// de quem acabou de receber (incidente 2026-10-26, Wilson Guedes). `referenceAt` = fim do ciclo parado (última tentativa
// ou fim da rodada). Nesses casos o contato fica como está (nada é devolvido nem registrado).
export function clientReceivedAfterStaleCycle({ client, contactAssignedUserId = null, referenceAt }) {
  const responsible = client?.responsible_user_id || null;
  if (!responsible || responsible === (contactAssignedUserId || null)) return false;
  const received = Date.parse(client?.responsible_changed_at || "");
  const reference = Date.parse(referenceAt || "");
  return Number.isFinite(received) && Number.isFinite(reference) && received > reference;
}

// A rede de segurança do cron (reassignOrphanedClientsToOwner) deve devolver este cliente sem responsável
// ao administrador principal? Não: fila de espera da roleta (tem dono próprio) e cliente devolvido à fila
// da Prospecção. Os demais órfãos (usuário removido, reatribuição manual para "sem responsável", falha da
// roleta) continuam sendo resgatados — nenhum cliente fica invisível.
export function shouldRescueOrphanToOwner(client) {
  // [REGRA OFICIAL, dono, 2026-10-06 — substitui a exceção de 2026-10-03/P-05] NENHUM cliente fica sem
  // responsável: devolvido à fila e fila de espera da roleta também entram na rede de segurança
  // (decideOrphanAssignment diz para quem vão).
  if (!client) return false;
  return !client.responsible_user_id;
}

// Status em que o cliente "órfão" ainda é um lead a distribuir: depois de o dono segurá-lo, a roleta o entrega
// ao primeiro corretor on-line (reassignPendingRouletteLeads).
const WAITING_FOR_BROKER_STATUSES = new Set([CLIENT_STATUS.PENDING, CLIENT_STATUS.AUTO_SIMULATION, CLIENT_STATUS.AUTOMATED_SERVICE, CLIENT_STATUS.AWAITING_RETURN]);

// Para quem vai um cliente sem responsável:
//  1) devolvido à fila por um corretor que continua ATIVO -> volta para ele (quem disparou/atendeu);
//  2) senão, em ÚLTIMO CASO, para o dono (administrador principal) — e, se ainda é um lead a distribuir,
//     entra na fila de espera da roleta (markPending) para ir ao primeiro corretor on-line, automaticamente.
export function decideOrphanAssignment(client, { activeUserIds = new Set(), ownerId = "" } = {}) {
  if (!shouldRescueOrphanToOwner(client)) return null;
  const from = client.returned_from_user_id || "";
  if (from && activeUserIds.has(from)) return { responsibleUserId: from, markPending: false, clearPending: true, reason: "returned_to_dispatcher" };
  if (!ownerId) return null;
  const waiting = WAITING_FOR_BROKER_STATUSES.has(normalizeClientStatus(client.status));
  return { responsibleUserId: ownerId, markPending: waiting && !client.pending_distribution_at, clearPending: false, reason: "owner_last_resort" };
}

// Status que NUNCA entram na distribuição da roleta: os negativos (fonte única NEGATIVE_CLIENT_STATUS_VALUES,
// lib/client-status.js) mais venda concluída/paga — diferença proposital (venda não é negativo, mas não volta à roleta).
export const ROULETTE_INELIGIBLE_STATUSES = [
  ...NEGATIVE_CLIENT_STATUS_VALUES,
  CLIENT_STATUS.SALE_COMPLETED,
  CLIENT_STATUS.SALE_PAID
];

// Marca de ORIGEM do cliente frio da fila de reativação (FUN-15l; REGRA OFICIAL — dono, 2026-10-24, item 3): gravada em
// simulation_registrations.distribution_type quando o cliente entra na fila e quando é entregue. Não é "round_robin", então
// a trava "1ª mensagem = simulação" (ROL-4c, requiresSimulationFirst) e a REDISTRIBUIÇÃO de 10 min (canReturnToRoulette,
// return_to_round_robin) não agem sobre ele — vale só o prazo próprio do FUN-15l. Para contagens que separam "veio da
// distribuição" de "cadastro do corretor" (pontuação de cliente novo, WA-19b), conta como distribuição.
export const COOLED_REACTIVATION_DISTRIBUTION = "cooled_reactivation";

export function isRouletteDistributionType(type) {
  return type === "round_robin" || type === COOLED_REACTIVATION_DISTRIBUTION;
}

// Cliente que pode ser entregue pela roleta (fila de espera): status ativo, não é de link pessoal de
// corretor (ROL-5) nem de canal direto, e não está em bloqueio de prospecção (available_after no futuro).
export function isRouletteEligibleClient(client, now = new Date()) {
  if (!client) return false;
  if (ROULETTE_INELIGIBLE_STATUSES.includes(normalizeClientStatus(client.status))) return false;
  if (client.direct_broker_link === true) return false;
  if (client.distribution_type === "direct_channel") return false;
  if (client.available_after && new Date(client.available_after).getTime() > now.getTime()) return false;
  return true;
}
