// "Recebi documentos por fora" no card do cliente (Mesa "Atendimento depois da simulação", lote A item 5; REGRA OFICIAL do
// dono, 2026-10-19). Regras PURAS (sem banco), testadas em tests/document-received-offline.test.mjs.
//  - só aparece em "Aguardando documentação" sem NENHUM lote de documentos salvo no CRM;
//  - marca o 1º documento recebido fora do CRM (celular do corretor) — nunca "documentos recebidos" (não é pasta completa);
//  - NÃO conta como atendimento (fora de ATTENDANCE_JOURNEY_EVENTS), nem como ponto: não muda status, não grava
//    last_whatsapp_contact_at, não mexe em atividade; é só um evento na linha do tempo;
//  - "Desfazer" por 10 s grava um evento de cancelamento (a linha do tempo só recebe gravações novas); vale o último dos dois.
import { CLIENT_STATUS, normalizeClientStatus } from "./client-status.js";

export const DOCUMENT_RECEIVED_OFFLINE_EVENT = "document_received_offline";
export const DOCUMENT_RECEIVED_OFFLINE_UNDONE_EVENT = "document_received_offline_undone";
export const DOCUMENT_RECEIVED_OFFLINE_EVENTS = Object.freeze([DOCUMENT_RECEIVED_OFFLINE_EVENT, DOCUMENT_RECEIVED_OFFLINE_UNDONE_EVENT]);

export const OFFLINE_ACTION_LABEL = "Recebi documentos por fora";
export const OFFLINE_CONFIRM_TITLE = "Marcar que você recebeu o 1º documento fora do CRM?";
export const OFFLINE_CONFIRM_DESCRIPTION = "Não conta como atendimento nem como ponto.";
export const OFFLINE_JOURNEY_TEXT = "1º documento recebido fora do CRM (marcado pelo corretor)";
export const OFFLINE_UNDONE_JOURNEY_TEXT = "Marca de 1º documento recebido por fora desfeita";
export const OFFLINE_UNDO_MS = 10_000;
// O servidor aceita o desfazer com folga para a rede (a tela só oferece por 10 s).
export const OFFLINE_UNDO_SERVER_MS = OFFLINE_UNDO_MS + 20_000;

/** O card oferece a ação? Só "Aguardando documentação" e nenhum lote salvo no CRM. */
export function canOfferDocumentReceivedOffline({ status, hasBatch } = {}) {
  return normalizeClientStatus(status) === CLIENT_STATUS.DOCUMENTATION && hasBatch !== true;
}

/** Marca vigente a partir dos eventos do cliente (qualquer ordem): o mais recente dos dois tipos vence. */
export function offlineMarkFromEvents(rows = []) {
  const latest = (rows || [])
    .filter((row) => DOCUMENT_RECEIVED_OFFLINE_EVENTS.includes(row?.event_type))
    .sort((a, b) => String(b.occurred_at || "").localeCompare(String(a.occurred_at || "")))[0];
  if (!latest || latest.event_type !== DOCUMENT_RECEIVED_OFFLINE_EVENT) return null;
  return { receivedAt: latest.occurred_at || "" };
}

/** Desfazer só vale logo depois de marcar (a marca vigente existe e é recente). */
export function canUndoOfflineMark(mark, now = Date.now()) {
  const at = Date.parse(mark?.receivedAt || "");
  return Number.isFinite(at) && now - at <= OFFLINE_UNDO_SERVER_MS;
}

/** Etiqueta neutra do card: "1º documento recebido por fora · dd/mm". */
export function offlineMarkLabel(receivedAt, formatDay = (value) => value) {
  return `1º documento recebido por fora · ${formatDay(receivedAt)}`;
}
