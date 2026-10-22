import { CLIENT_STATUS, normalizeClientStatus } from "./client-status.js";
import { isRouletteEligibleClient, ROULETTE_INELIGIBLE_STATUSES } from "./client-distribution-core.mjs";

// Fila de espera da roleta (pending_distribution_at): quem a roleta pode entregar a um corretor on-line.
// Regra do dono (2026-10-06): transferência MANUAL a um corretor vale — o cliente que já tem um responsável
// que não é o dono (o dono só "segura" o lead até alguém ficar on-line, FUN-11) sai da fila de espera e a
// roleta nunca o toma de volta. Puro e testado (tests/pending-roulette.test.mjs).

export function pendingRouletteRowsToDeliver(rows, ownerId = "") {
  const deliver = [];
  const release = [];
  for (const row of rows || []) {
    const responsible = row?.responsible_user_id || "";
    if (!responsible || (ownerId && responsible === ownerId)) deliver.push(row);
    else release.push(row);
  }
  return { deliver, release };
}

// Regra do dono (2026-10-08): a fila de espera é entregue AOS POUCOS — no máximo 1 cliente por corretor on-line a
// cada rodada do cron (a cada 2 minutos). Assim quem fica on-line primeiro não leva a fila inteira de uma vez e
// os outros corretores têm chance de entrar. Entre vários on-line, a ordem continua a da roleta.
export const WAITING_QUEUE_INTERVAL_MINUTES = 2;

export function waitingQueueBatchSize(pendingCount, onlineBrokerCount) {
  const pending = Math.max(0, Number(pendingCount) || 0);
  const online = Math.max(0, Number(onlineBrokerCount) || 0);
  return Math.min(pending, online);
}

// ---------------------------------------------------------------------------
// Ordem e elegibilidade da fila de espera — FONTE ÚNICA usada pelo entregador (reassignPendingRouletteLeads) e pela
// lista de Clientes (posição "Roleta · 3º na fila", filtro Roleta; dono, 2026-10-22). Não reimplemente em outro lugar.
// ---------------------------------------------------------------------------

// Quantos clientes o entregador olha por rodada (os mais antigos que não estão fora por status nem na fila de reativação).
export const WAITING_QUEUE_BATCH_LIMIT = 25;

// Ordem de entrega: o mais antigo na fila primeiro; empate (mesma hora de entrada, ex.: vários devolvidos de uma vez)
// pelo id, para a posição ser estável.
export function compareWaitingQueue(a, b) {
  const at = Date.parse(a?.pending_distribution_at || "") || 0;
  const bt = Date.parse(b?.pending_distribution_at || "") || 0;
  return at - bt || String(a?.id || "").localeCompare(String(b?.id || ""));
}

// Por que um cliente da fila não será entregue (ou "" se é elegível). Mesma régua do entregador: status fora da roleta,
// já tem corretor (sai da fila na rodada), link pessoal/canal direto e bloqueio de 30 dias da Prospecção.
export function waitingQueueBlockReason(row, { ownerId = "", availableAfter = null, now = new Date() } = {}) {
  if (ROULETTE_INELIGIBLE_STATUSES.includes(normalizeClientStatus(row?.status))) return "status";
  if (pendingRouletteRowsToDeliver([row], ownerId).release.length) return "has_broker";
  if (row?.direct_broker_link === true) return "direct_link";
  if (row?.distribution_type === "direct_channel") return "direct_channel";
  if (!isRouletteEligibleClient({ ...row, available_after: availableAfter }, now)) return "blocked_30d";
  return "";
}

// Texto curto do motivo ("Roleta · fora da fila (motivo)").
export function waitingQueueBlockLabel(reason, status = "") {
  if (reason === "status") {
    const normalized = normalizeClientStatus(status);
    if (normalized === CLIENT_STATUS.ARCHIVED) return "arquivado";
    if (normalized === CLIENT_STATUS.DO_NOT_CONTACT) return "não contactar";
    if (normalized === CLIENT_STATUS.SALE_COMPLETED || normalized === CLIENT_STATUS.SALE_PAID) return "venda";
    return "status negativo";
  }
  return {
    has_broker: "já tem corretor",
    direct_link: "link pessoal",
    direct_channel: "canal direto",
    blocked_30d: "bloqueio de 30 dias",
    stalled: "travado atrás de link pessoal/canal direto",
    reactivation_out: "não pode ir à roleta"
  }[reason] || "inelegível";
}

// Planeja a fila de espera comum. `rows`: clientes com pending_distribution_at (qualquer ordem). `reactivationIds`:
// clientes da fila de reativação (FUN-15l), que esta fila ignora. Devolve:
//  - deliver: o que o entregador tenta entregar NESTA rodada (elegíveis dentro do lote dos `limit` mais antigos), em ordem;
//  - release: quem já tem corretor dentro do lote (o entregador tira da fila);
//  - entries: Map id -> { position } (ordem real de entrega entre os elegíveis) ou { reason } (não será entregue).
// Lote: o entregador olha só os `limit` mais antigos que não estão fora por status nem em bloqueio de 30 dias.
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-22] "bloqueados de 30 dias não seguram a fila": o cliente em bloqueio da
// Prospecção NÃO ocupa o lote (antes, 30 bloqueados na frente travaram a fila de 17/10 a 22/10); continua guardado
// com o dono e volta à fila sozinho quando o bloqueio vence (available_after no passado). Link pessoal/canal direto
// ainda ocupam o lote; se `limit` ou mais deles estiverem à frente de um elegível, ele não é alcançado ("stalled").
export function planWaitingQueue(rows, { ownerId = "", reactivationIds = new Set(), availableAfterByContact = new Map(), now = new Date(), limit = WAITING_QUEUE_BATCH_LIMIT } = {}) {
  const entries = new Map();
  const deliver = [];
  const release = [];
  const ordered = [...(rows || [])].sort(compareWaitingQueue);
  let windowCount = 0;
  let stuckAhead = 0;
  let position = 0;
  for (const row of ordered) {
    if (reactivationIds.has(row.id)) continue; // posição dada pela fila de reativação
    const reason = waitingQueueBlockReason(row, { ownerId, availableAfter: availableAfterByContact.get(row.prospecting_contact_id) || null, now });
    if (reason === "status" || reason === "blocked_30d") { entries.set(row.id, { reason }); continue; } // nem entra no lote
    const inWindow = windowCount < limit;
    windowCount += 1;
    if (reason === "has_broker") {
      if (inWindow) release.push(row);
      entries.set(row.id, { reason });
      continue;
    }
    if (reason) { // parado: ocupa o lote até o bloqueio passar
      stuckAhead += 1;
      entries.set(row.id, { reason });
      continue;
    }
    if (stuckAhead >= limit) { entries.set(row.id, { reason: "stalled" }); continue; }
    position += 1;
    entries.set(row.id, { position });
    if (inWindow) deliver.push(row);
  }
  return { deliver, release, entries };
}

// Etiqueta do responsável para quem está na fila (card e ficha de Clientes). `entry`: { queue: "waiting"|"reactivation",
// position } ou { queue, reason, status }.
export function rouletteQueueLabel(entry) {
  if (!entry) return "Roleta";
  const prefix = entry.queue === "reactivation" ? "Fila de reativação" : "Roleta";
  if (entry.position) return entry.queue === "reactivation" ? `${prefix} · ${entry.position}º` : `${prefix} · ${entry.position}º na fila`;
  return `${prefix} · fora da fila (${waitingQueueBlockLabel(entry.reason, entry.status)})`;
}

// Ordem do filtro "Roleta": fila de espera pela posição, depois fila de reativação pela posição, depois quem está fora
// (mais antigo primeiro).
export function compareRouletteQueueEntries(a, b) {
  const rank = (entry) => (!entry?.position ? 2 : entry.queue === "reactivation" ? 1 : 0);
  return rank(a) - rank(b) || (a?.position || 0) - (b?.position || 0) || compareWaitingQueue(a, b);
}
