// Status do cliente TRANSFERIDO — regra PURA (testes: tests/transfer-status.test.mjs). Servidor: lib/transfer-status.js.
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-25, CLI-7c] "deve ser criada uma tag com o status atual, antes dele ser
// transferido. Depois que ele é transferido, ele vai para o status ... AGUARDANDO CONTATO, porque o corretor ainda não
// tentou o contato. Aí, depois que o corretor clicar no WhatsApp, ele muda para TENTANDO CONTATO. E fica a tagzinha com o
// status anterior, que era de outro corretor, só para o corretor atual entender em que parte ele parou."
// Vale para toda troca de responsável entre duas pessoas; todo caminho chama o MESMO ponto (`applyTransferStatusRule`).
//
// Decisões do dono (2026-10-25):
//  - (a) Lead ainda não atendido (Atendimento automático, Aguardando simulação, Simulação automática) fica FORA — a
//    roleta (REDISTRIBUIÇÃO, ROL-4b/4c, WA-18, SIM-AUTO-ENVIO) depende desses status.
//  - (b) Etapa de aprovação não negativa (Aguardando aprovação, Blindagem, Carta de cancelamento, M.O de pesquisa) ENTRA;
//    "Cliente aprovado" em diante (Reunião, Venda) e os 5 negativos ficam fora.
//  - Já em "Aguardando contato" (transferido de novo antes de alguém tentar): não muda e mantém a etiqueta que já tem.
//
// A mudança é AUTOMÁTICA: `source = TRANSFER_STATUS_SOURCE` (fora do "último atendimento", AUTOMATIC_STATUS_SOURCES em
// lib/client-attendance-core.mjs); "Aguardando contato" não pontua (STATUS_TO_SCORING_KEY) nem é etapa do funil.
import {
  CLIENT_STATUS,
  NEGATIVE_CLIENT_STATUS_VALUES,
  PRESENTATION_APPROVAL_STATUS_VALUES,
  clientStatusLabel,
  normalizeClientStatus
} from "./client-status.js";

export const TRANSFER_TARGET_STATUS = CLIENT_STATUS.AWAITING_CONTACT;
export const CONTACT_ATTEMPT_STATUS = CLIENT_STATUS.AWAITING_RETURN;
export const TRANSFER_STATUS_SOURCE = "transfer_auto";
export const CONTACT_ATTEMPT_SOURCE = "whatsapp_click";
export const TRANSFER_STATUS_REASON = "Transferência de responsável";
export const PREVIOUS_STATUS_TAG_PREFIX = "Status anterior:";
// Mesmo formato de tags.normalized_name (normalizeTagKey, lib/client-tags.js: sem acento, minúsculo).
export const PREVIOUS_STATUS_TAG_KEY_PREFIX = "status anterior:";
export const PREVIOUS_STATUS_TAG_COLOR = "#475569";

export const TRANSFER_LEAD_STAGE_STATUSES = Object.freeze([
  CLIENT_STATUS.AUTOMATED_SERVICE,
  CLIENT_STATUS.PENDING,
  CLIENT_STATUS.AUTO_SIMULATION
]);

export const TRANSFER_PRESERVED_STATUSES = Object.freeze([
  ...NEGATIVE_CLIENT_STATUS_VALUES,
  ...PRESENTATION_APPROVAL_STATUS_VALUES
]);

export function previousStatusTagName(status) {
  return `${PREVIOUS_STATUS_TAG_PREFIX} ${clientStatusLabel(status)}`;
}

export function isPreviousStatusTagKey(normalizedName) {
  return String(normalizedName || "").startsWith(PREVIOUS_STATUS_TAG_KEY_PREFIX);
}

// { change, tagName, tagOnlyIfMissing, reason }: change = vai para "Aguardando contato"; tagName = etiqueta do status
// anterior (substitui a que houver, ou só se não houver nenhuma com `tagOnlyIfMissing`).
// `keepTryingContact` (só na rotina dos atuais, pedido do dono): quem já está em "Tentando contato" ganha só a etiqueta.
export function planTransferStatus(status, { keepTryingContact = false } = {}) {
  const current = normalizeClientStatus(status);
  const none = (reason) => ({ change: false, tagName: null, tagOnlyIfMissing: false, reason });
  if (!current) return none("sem_status");
  if (current === TRANSFER_TARGET_STATUS) return none("ja_aguardando_contato");
  if (TRANSFER_PRESERVED_STATUSES.includes(current)) return none("etapa_preservada");
  if (TRANSFER_LEAD_STAGE_STATUSES.includes(current)) return none("lead_sem_atendimento");
  if (keepTryingContact && current === CONTACT_ATTEMPT_STATUS) {
    return { change: false, tagName: previousStatusTagName(current), tagOnlyIfMissing: true, reason: "so_etiqueta" };
  }
  return { change: true, tagName: previousStatusTagName(current), tagOnlyIfMissing: false, reason: "aguardando_contato" };
}

// Uma etiqueta "Status anterior" por cliente: as outras do mesmo tipo saem. currentTags: [{ id, normalizedName }].
export function planPreviousStatusTags({ currentTags = [], targetTagId = "" } = {}) {
  const previous = (currentTags || []).filter((tag) => tag?.id && isPreviousStatusTagKey(tag.normalizedName));
  return {
    removeIds: previous.filter((tag) => tag.id !== targetTagId).map((tag) => tag.id),
    alreadyHas: previous.some((tag) => tag.id === targetTagId),
    hasAny: previous.length > 0
  };
}

// Clique no WhatsApp / mensagem do corretor: só "Aguardando contato" anda (para "Tentando contato").
export function nextStatusOnContactAttempt(status) {
  return normalizeClientStatus(status) === TRANSFER_TARGET_STATUS ? CONTACT_ATTEMPT_STATUS : null;
}

// Troca REAL de responsável entre duas pessoas (de ninguém para alguém = 1ª atribuição, não é transferência).
export function isResponsibleTransfer(fromUserId, toUserId) {
  return Boolean(fromUserId && toUserId && fromUserId !== toUserId);
}
