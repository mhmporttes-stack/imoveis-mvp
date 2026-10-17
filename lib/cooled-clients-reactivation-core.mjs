// Núcleo PURO (testável) da fila de reativação dos clientes TRANSFERIDOS pelo fluxo de clientes que esfriaram (FUN-15l).
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-17] "Os clientes devem seguir a regra da roleta, volte todos que não foram
// contactados para a fila, quem fica on-line recebe 1 e depois de 3 minutos recebe outro depois de 3 minutos se não for
// enviada nenhuma mensagem ele volta para a roleta para o final da fila de distribuição e espera outro corretor ficar
// online". Correção do dono no mesmo dia: o cliente NUNCA volta ao corretor que o perdeu no FUN-15 (o `broker_id` do
// caso, mais de 3 dias sem contato); quem o perdeu NESTA fila por não mandar mensagem em 3 min PODE recebê-lo de novo
// se a roleta cair nele outra vez.
//
// Estados (cooled_client_cases.reactivation_status): queued (na fila, com o dono — FUN-11 — e pending_distribution_at)
// → offered (entregue a um corretor on-line, prazo de 3 min) → kept (ele mandou mensagem: fica com ele) ou de volta a
// queued (FIM da fila). left = saiu da fila por outro motivo (transferência manual, status que não pode ir à roleta).
// Servidor: lib/cooled-clients-reactivation.js.

import { isHumanContactMessage } from "./human-contact-core.mjs";

export const REACTIVATION_STATUS = Object.freeze({ QUEUED: "queued", OFFERED: "offered", KEPT: "kept", LEFT: "left" });
// Prazo para mandar a 1ª mensagem depois de receber.
export const REACTIVATION_DEADLINE_MS = 3 * 60 * 1000;
// Espaçamento entre duas entregas da fila ao MESMO corretor.
export const REACTIVATION_SPACING_MS = 3 * 60 * 1000;

const time = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : NaN;
};

// Houve mensagem humana real ao cliente depois de `sinceIso`? Mesma régua do CRM para "contato" (isHumanContactMessage:
// saída, enviada por pessoa, com evidência de envio; nunca automação, nota, reação, histórico importado nem falha).
export function hasHumanMessageSince(messages = [], sinceIso) {
  const since = time(sinceIso);
  if (!Number.isFinite(since)) return false;
  return (messages || []).some((message) => time(message?.message_at) > since && isHumanContactMessage({
    direction: message?.direction,
    senderType: message?.sender_type,
    status: message?.status,
    messageType: message?.message_type,
    metadata: message?.metadata
  }));
}

// O que fazer com um cliente ENTREGUE (offered) nesta rodada.
//  - "left": o responsável já não é quem recebeu (transferência manual etc.) ou o cliente não pode ir à roleta.
//  - "kept": quem recebeu mandou mensagem (a qualquer momento antes desta checagem) — fica com ele.
//  - "requeue": passaram 3 min sem mensagem — volta ao FIM da fila.
//  - "wait": ainda dentro dos 3 min.
export function offeredCaseOutcome({ offeredTo, offeredAt, clientResponsibleId, clientEligible = true, contacted = false, now = Date.now() }) {
  if (!offeredTo || clientResponsibleId !== offeredTo || !clientEligible) return "left";
  if (contacted) return "kept";
  const at = time(offeredAt);
  if (!Number.isFinite(at)) return "requeue";
  return Number(now) - at >= REACTIVATION_DEADLINE_MS ? "requeue" : "wait";
}

// Cliente na fila (queued) ainda pode esperar a entrega? Precisa continuar com o dono (ou sem ninguém) e marcado na fila
// de espera; se alguém o transferiu à mão ou o status saiu da roleta, sai da fila ("left").
export function queuedCaseStillWaiting({ clientResponsibleId, ownerId, pendingDistributionAt, clientEligible = true }) {
  if (!clientEligible) return false;
  if (!pendingDistributionAt) return false;
  return !clientResponsibleId || (Boolean(ownerId) && clientResponsibleId === ownerId);
}

// Quem recebe nesta rodada. `queue` já em ordem (mais antigo primeiro) e só com clientes que podem ser entregues:
// [{ caseId, previousBrokerId }]. `onlineBrokerIds`: elegíveis da roleta agora (on-line, WhatsApp ativo, presença).
// `lastOfferAtByBroker`: última entrega da fila a cada corretor. Regras: 1 por corretor por rodada e só 3 min depois da
// entrega anterior a ele; nunca ao corretor que perdeu o cliente no FUN-15 (previousBrokerId) nem ao dono (que só
// segura a fila, FUN-11). Entre os disponíveis, primeiro quem recebeu da fila há mais tempo (nunca recebeu = primeiro),
// depois a ordem da roleta (`positionByBroker`). Quem perdeu o cliente nesta fila NÃO é bloqueado (dono, 2026-10-17).
export function planReactivationDeliveries({ queue = [], onlineBrokerIds = [], lastOfferAtByBroker = new Map(), positionByBroker = new Map(), ownerId = "", now = Date.now() }) {
  const lastOf = (id) => {
    const at = time(lastOfferAtByBroker.get(id));
    return Number.isFinite(at) ? at : -Infinity;
  };
  const available = [...new Set(onlineBrokerIds || [])]
    .filter((id) => id && id !== ownerId && Number(now) - lastOf(id) >= REACTIVATION_SPACING_MS)
    .sort((a, b) => lastOf(a) - lastOf(b) || (Number(positionByBroker.get(a)) || 999999) - (Number(positionByBroker.get(b)) || 999999) || String(a).localeCompare(String(b)));
  const used = new Set();
  const plan = [];
  for (const item of queue || []) {
    if (used.size >= available.length) break;
    const brokerId = available.find((id) => !used.has(id) && id !== item.previousBrokerId);
    if (!brokerId) continue; // só sobrou quem o perdeu no FUN-15: espera outro corretor
    used.add(brokerId);
    plan.push({ caseId: item.caseId, brokerId });
  }
  return plan;
}

// Backfill (uma vez): caso transferido pelo FUN-15 que entra na fila. Fica de fora quem foi contactado depois da
// transferência, quem já está na fila nova, quem saiu da roleta (status) e quem foi parar com outra pessoa à mão.
export function backfillCaseDecision({ caseRow, client, ownerId, contacted }) {
  if (!caseRow || caseRow.decision !== "transferred") return "skip_not_transferred";
  // "left" (saiu da fila) pode voltar; queued/offered/kept nunca entram de novo.
  if (caseRow.reactivation_status && caseRow.reactivation_status !== REACTIVATION_STATUS.LEFT) return "skip_already_in_queue";
  if (!client) return "skip_client_missing";
  if (contacted) return "skip_contacted";
  if (client.eligible === false) return "skip_ineligible";
  const responsible = client.responsible_user_id || "";
  if (responsible && responsible === caseRow.broker_id) return "skip_back_with_previous";
  const allowed = [caseRow.transferred_to, ownerId].filter(Boolean);
  if (responsible && !allowed.includes(responsible)) return "skip_moved_by_hand";
  return "queue";
}
