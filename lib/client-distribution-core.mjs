import { CLIENT_STATUS, normalizeClientStatus } from "./client-status.js";

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
const WAITING_FOR_BROKER_STATUSES = new Set([CLIENT_STATUS.PENDING, CLIENT_STATUS.AUTOMATED_SERVICE, CLIENT_STATUS.AWAITING_RETURN]);

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

// Status que NUNCA entram na distribuição da roleta (mesma lista de "negativos" das automações de contato,
// lib/crm-automations.js OUTREACH_NEGATIVE_STATUSES, mais venda concluída/paga).
export const ROULETTE_INELIGIBLE_STATUSES = [
  CLIENT_STATUS.ARCHIVED,
  CLIENT_STATUS.DO_NOT_CONTACT,
  CLIENT_STATUS.INCOME_COMMITMENT,
  CLIENT_STATUS.RESTRICTION,
  CLIENT_STATUS.REJECTED,
  CLIENT_STATUS.SALE_COMPLETED,
  CLIENT_STATUS.SALE_PAID
];

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
