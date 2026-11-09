// Cliente frio transferido e sem retorno -> ARQUIVADO sozinho, numa aba que só o dono vê (FUN-15q, REGRA OFICIAL DE
// NEGÓCIO — dono, 2026-11-09). Parte PURA (testes: tests/cooled-transfer-archive.test.mjs). Leitura/gravação no banco:
// lib/cooled-transfer-archive.js (rotina do cron scheduled-activities) e lib/cooled-archive-hidden.js (ids escondidos).
//
// Candidato = cliente que (a) já foi transferido pelo fluxo FUN-15 (caso com decisão de transferência) e hoje NÃO está com
// o corretor original do caso; (b) está há mais de 3 dias sem atendimento (fonte única: lib/client-attendance-core.mjs) E
// há mais de 3 dias da última troca de responsável; (c) está com o novo corretor ou de volta com o dono, mas fora da fila
// de reativação e do prazo de entrega; (d) fora: arquivado/negativos, restrição, Particular, venda/aprovado (já foi
// aprovado alguma vez), atividade futura agendada e cliente que escreveu depois da transferência.
// Regras de "negativo", "aprovado" e "restrição" são as do fluxo (lib/cooled-clients-core.mjs): nada copiado aqui.
import { attendanceReferenceAt, NO_CONTACT_WINDOW_MS } from "./client-attendance-core.mjs";
import { normalizeClientStatus } from "./client-status.js";
import {
  CASE_STATUS,
  NEGATIVE_DECISION_STATUSES,
  isRestrictionHoldActive,
  wasEverApprovedForCooledFlow
} from "./cooled-clients-core.mjs";
import { REACTIVATION_STATUS } from "./cooled-clients-reactivation-core.mjs";

// Marca do núcleo: etiqueta do sistema (tags.normalized_name = key; mesma normalização de normalizeTagKey).
export const COOLED_ARCHIVE_TAG = Object.freeze({ name: "Frio arquivado", key: "frio arquivado", color: "#334155" });
export const COOLED_ARCHIVE_REASON = "Cliente frio: transferido e sem resposta há mais de 3 dias";
export const COOLED_ARCHIVE_SOURCE = "cooled_transfer_archive";
export const COOLED_ARCHIVE_CANCELED_REASON = "cliente_frio_arquivado";
export const COOLED_ARCHIVE_BATCH = 30;
// Aba só do dono (statusGroup da tela Clientes). Fora do CLIENT_STATUS_FILTER_GROUPS de propósito: não é um status.
export const COOLED_ARCHIVE_TAB_KEY = "cooled_archive";
export const COOLED_ARCHIVE_SETTING_ID = "cooled_transfer_archive";

function timeOf(value) {
  const at = Date.parse(value || "");
  return Number.isFinite(at) ? at : null;
}

// Caso do FUN-15 que transferiu o cliente: decisão 'transferred' ou `transferred_to` preenchido.
export function isTransferCase(row) {
  return row?.decision === "transferred" || Boolean(row?.transferred_to);
}

function caseDecidedAt(row) {
  return timeOf(row?.decided_at) ?? timeOf(row?.closed_at) ?? timeOf(row?.opened_at);
}

// Caso de transferência mais recente (a "transferência" que vale para os relógios e para o corretor original).
export function latestTransferCase(cases = []) {
  let latest = null;
  for (const row of cases) {
    if (!isTransferCase(row)) continue;
    if (!latest || (caseDecidedAt(row) ?? -Infinity) >= (caseDecidedAt(latest) ?? -Infinity)) latest = row;
  }
  return latest;
}

// Motivo para NÃO arquivar (null = candidato). Entradas pesadas (histórico, atendimento, resposta, atividade) ausentes
// são tratadas como "nada encontrado": a rotina chama primeiro só com o barato (pré-filtro) e de novo, completo, nos
// que sobraram.
//  client: { status, privateContactAt, responsibleUserId, responsibleChangedAt, pendingDistributionAt,
//            lastWhatsappContactAt, createdAt, approvedAt, lastStatusChangeAt, restrictionClosedAt, hasRestrictionTag }
//  cases: linhas de cooled_client_cases do cliente (decision, transferred_to, broker_id, decided_at, reactivation_status)
//  historyRows: client_status_history (no mínimo entradas/saídas de Aprovado/Reunião/Venda)
//  lastAttendanceAt: ISO do último atendimento (lib/client-attendance.js); clientRepliedAt: ISO da última mensagem
//  RECEBIDA do cliente em qualquer conversa; latestActivityAt: ISO da atividade agendada mais distante (pendente).
export function cooledTransferArchiveBlockReason({
  client,
  cases = [],
  historyRows = [],
  lastAttendanceAt = null,
  clientRepliedAt = null,
  latestActivityAt = null,
  now = Date.now()
} = {}) {
  if (!client) return "sem_cliente";
  const transfer = latestTransferCase(cases);
  if (!transfer) return "nunca_transferido";
  if (client.privateContactAt) return "particular";
  const status = normalizeClientStatus(client.status);
  if (NEGATIVE_DECISION_STATUSES.includes(status)) return "arquivado_ou_negativo";
  if (client.hasRestrictionTag || isRestrictionHoldActive(client)) return "restricao";
  if (wasEverApprovedForCooledFlow({ status, approvedAt: client.approvedAt, historyRows })) return "ja_aprovado";
  if (!client.responsibleUserId) return "sem_responsavel";
  if (client.responsibleUserId === transfer.broker_id) return "com_corretor_original";
  // Fila de reativação ativa (aguardando ou entregue e dentro do prazo) e fila de espera da roleta: ainda estão girando.
  if (client.pendingDistributionAt) return "na_fila_da_roleta";
  const inReactivation = cases.some((row) => isTransferCase(row)
    && [REACTIVATION_STATUS.QUEUED, REACTIVATION_STATUS.OFFERED].includes(row.reactivation_status));
  if (inReactivation) return "na_fila_de_reativacao";
  const activityAt = timeOf(latestActivityAt);
  if (activityAt !== null && activityAt > now) return "atividade_futura";
  const transferAt = caseDecidedAt(transfer);
  const repliedAt = timeOf(clientRepliedAt);
  if (repliedAt !== null && (transferAt === null || repliedAt > transferAt)) return "cliente_respondeu";
  // Relógio 1: última troca de responsável (sem o campo, vale a data da decisão de transferir).
  const changedAt = timeOf(client.responsibleChangedAt) ?? transferAt;
  if (changedAt !== null && now - changedAt <= NO_CONTACT_WINDOW_MS) return "troca_recente";
  // Relógio 2: último atendimento (fonte única; contato gravado, cadastro e atendimento calculado).
  const reference = attendanceReferenceAt({ lastWhatsappContactAt: client.lastWhatsappContactAt, createdAt: client.createdAt, lastAttendanceAt });
  if (reference !== null && now - reference <= NO_CONTACT_WINDOW_MS) return "atendimento_recente";
  return null;
}

export function isCooledTransferArchiveCandidate(input) {
  return cooledTransferArchiveBlockReason(input) === null;
}

// Caso ainda aberto do cliente (aguardando motivo/decisão) é encerrado junto com o arquivamento.
export function isOpenCooledCase(row) {
  return [CASE_STATUS.AWAITING_REASON, CASE_STATUS.AWAITING_DECISION].includes(row?.status);
}

// Máscara do telefone para a conferência do dono (preview): só o DDD e os 4 últimos dígitos.
export function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 6) return digits ? "****" : "";
  const national = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  return `(${national.slice(0, 2)}) *****-${national.slice(-4)}`;
}

// Visibilidade: SÓ o dono, na conta REAL (fora de "Alterar conta"). `isOwnerEmail`: resultado de isOwnerAdminEmail.
export function canSeeCooledTransferArchive({ ok = false, accountSwitchMode = false, isOwnerEmail = false } = {}) {
  return Boolean(ok) && !accountSwitchMode && Boolean(isOwnerEmail);
}

// Exclusão dos clientes arquivados por esta regra de TODAS as consultas de Clientes. Só o dono vê esses clientes, na aba
// própria e na pesquisa; para os demais perfis (e para o dono nas outras abas) somem de lista, abas, contadores e cards.
export function applyCooledArchiveExclusion(query, { hiddenIds = [], viewerIsOwner = false, searching = false, onTab = false } = {}) {
  if (!hiddenIds.length) return query;
  if (viewerIsOwner && (searching || onTab)) return query;
  return query.not("id", "in", `(${hiddenIds.join(",")})`);
}

export function intersectIds(first, second) {
  if (!Array.isArray(first)) return [...second];
  const wanted = new Set(second);
  return first.filter((id) => wanted.has(id));
}
