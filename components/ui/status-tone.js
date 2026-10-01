import { CLIENT_STATUS, normalizeClientStatus } from "@/lib/client-status";

// Significado visual de cada status do cliente no sistema novo
// (sistema-visual.md §3 — cores semânticas). É só apresentação: rótulos e
// regras continuam em lib/client-status.js. Adotado quando a Lista de
// clientes for redesenhada (até lá CLIENT_STATUS_META continua valendo).
//   warning = espera ação do corretor · danger = bloqueio/risco
//   success = avanço conquistado · info = em andamento · neutral = fora do fluxo
const TONE_BY_STATUS = {
  [CLIENT_STATUS.AUTOMATED_SERVICE]: "info",
  [CLIENT_STATUS.PENDING]: "warning",
  [CLIENT_STATUS.COMPLETED]: "info",
  [CLIENT_STATUS.SIMULATION_SENT]: "info",
  [CLIENT_STATUS.IN_SERVICE]: "info",
  [CLIENT_STATUS.AWAITING_RETURN]: "warning",
  [CLIENT_STATUS.DOCUMENTATION]: "warning",
  [CLIENT_STATUS.DOCUMENTS_PENDING]: "warning",
  [CLIENT_STATUS.APPROVAL_PENDING]: "neutral",
  [CLIENT_STATUS.INCOME_COMMITMENT]: "danger",
  [CLIENT_STATUS.CANCELLATION_LETTER]: "danger",
  [CLIENT_STATUS.RESEARCH_MO]: "neutral",
  [CLIENT_STATUS.RESTRICTION]: "danger",
  [CLIENT_STATUS.SHIELDING]: "neutral",
  [CLIENT_STATUS.APPROVED]: "success",
  [CLIENT_STATUS.REJECTED]: "danger",
  [CLIENT_STATUS.MEETING_PENDING]: "info",
  [CLIENT_STATUS.MEETING_DONE]: "success",
  [CLIENT_STATUS.ARCHIVED]: "neutral",
  [CLIENT_STATUS.DO_NOT_CONTACT]: "danger"
};

export function clientStatusTone(status) {
  const normalized = normalizeClientStatus(status);
  if (TONE_BY_STATUS[normalized]) return TONE_BY_STATUS[normalized];
  return normalized.startsWith("sale_") ? "success" : "neutral";
}
