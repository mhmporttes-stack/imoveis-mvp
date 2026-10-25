// Status do cliente TRANSFERIDO — regra PURA (testes: tests/transfer-status.test.mjs). Servidor: lib/transfer-status.js.
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-25] "Os clientes transferidos devem ir com status de tentando contato. E deve
// ser criada uma tag com o status anterior." Vale para toda troca de responsável de uma pessoa para outra (manual na
// ficha/Chat/Marketplace, do próprio corretor, roleta/fila de espera, "Devolver para a roleta", fila de reativação do
// cliente frio, exclusão de usuário, Prospecção). Todo caminho chama o MESMO ponto (`applyTransferStatusRule`); não
// crie outra mudança de status por transferência.
//
// Decisões técnicas (a confirmar com o dono — ver docs/BUSINESS_RULES.md CLI-7c):
//  - Já em "Tentando contato": status não muda e a etiqueta "Status anterior" que já existe fica (é a relevante).
//  - Situação negativa (Arquivado, Não contactar, Restrição, Reprovado, Comprometimento de renda — fonte única
//    NEGATIVE_CLIENT_STATUS_VALUES) e "Cliente aprovado" em diante (Reunião, Venda — PRESENTATION_APPROVAL_STATUS_VALUES):
//    status preservado (etapa encerrada/negócio aprovado não volta a "Tentando contato").
//  - Lead ainda não atendido (Atendimento automático, Aguardando simulação, Simulação automática): status preservado —
//    a roleta (REDISTRIBUIÇÃO de 10 min, prazo da simulação ROL-4b, trava ROL-4c, WA-18, SIM-AUTO-ENVIO) depende dele.
//
// A mudança é AUTOMÁTICA: gravada com `source = TRANSFER_STATUS_SOURCE` (fora do "último atendimento",
// AUTOMATIC_STATUS_SOURCES em lib/client-attendance-core.mjs) e "Tentando contato" não tem pontuação
// (STATUS_TO_SCORING_KEY, lib/scoring-rules.js) nem entra no funil do período.
import {
  CLIENT_STATUS,
  NEGATIVE_CLIENT_STATUS_VALUES,
  PRESENTATION_APPROVAL_STATUS_VALUES,
  clientStatusLabel,
  normalizeClientStatus
} from "./client-status.js";

export const TRANSFER_TARGET_STATUS = CLIENT_STATUS.AWAITING_RETURN;
export const TRANSFER_STATUS_SOURCE = "transfer_auto";
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

// { change, reason, tagName }: change = muda para "Tentando contato" e aplica a etiqueta tagName.
export function planTransferStatus(status) {
  const current = normalizeClientStatus(status);
  if (!current) return { change: false, reason: "sem_status", tagName: null };
  if (current === TRANSFER_TARGET_STATUS) return { change: false, reason: "ja_tentando_contato", tagName: null };
  if (TRANSFER_PRESERVED_STATUSES.includes(current)) return { change: false, reason: "etapa_preservada", tagName: null };
  if (TRANSFER_LEAD_STAGE_STATUSES.includes(current)) return { change: false, reason: "lead_sem_atendimento", tagName: null };
  return { change: true, reason: "tentando_contato", tagName: previousStatusTagName(current) };
}

// Uma etiqueta "Status anterior" por cliente: as outras do mesmo tipo saem. currentTags: [{ id, normalizedName }].
export function planPreviousStatusTags({ currentTags = [], targetTagId = "" } = {}) {
  const previous = (currentTags || []).filter((tag) => tag?.id && isPreviousStatusTagKey(tag.normalizedName));
  return {
    removeIds: previous.filter((tag) => tag.id !== targetTagId).map((tag) => tag.id),
    alreadyHas: previous.some((tag) => tag.id === targetTagId)
  };
}

// Troca REAL de responsável entre duas pessoas (de ninguém para alguém = 1ª atribuição, não é transferência).
export function isResponsibleTransfer(fromUserId, toUserId) {
  return Boolean(fromUserId && toUserId && fromUserId !== toUserId);
}
