// Motivo obrigatório ao arquivar / "Não contactar" (regra do dono, 2026-10-14 — FUN-14).
// Toda mudança FEITA POR UMA PESSOA para Arquivado ou Não contactar exige um motivo
// escrito (mínimo STATUS_REASON_MIN_LENGTH letras/números). Automação sem usuário
// (opt-out do WhatsApp, regras do cron) não é travada. Módulo puro: usado pelo
// servidor (lib/simulation-registrations.js, lib/daily-goal-wallet.js) e pela tela.

export const STATUS_REASON_MIN_LENGTH = 5;
export const STATUS_REASON_MAX_LENGTH = 300;
export const STATUS_REASON_REQUIRED_MESSAGE = `Escreva o motivo (pelo menos ${STATUS_REASON_MIN_LENGTH} letras).`;

const REQUIRED_STATUSES = new Set(["archived", "do_not_contact"]);

export function statusRequiresReason(status) {
  return REQUIRED_STATUSES.has(String(status || ""));
}

export function normalizeStatusReason(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, STATUS_REASON_MAX_LENGTH);
}

// Conta só letras/números: "....." ou "   " não valem como motivo.
export function isValidStatusReason(text) {
  const meaningful = normalizeStatusReason(text).replace(/[^\p{L}\p{N}]/gu, "");
  return meaningful.length >= STATUS_REASON_MIN_LENGTH;
}

export function assertStatusReason(text) {
  if (!isValidStatusReason(text)) throw new Error(STATUS_REASON_REQUIRED_MESSAGE);
  return normalizeStatusReason(text);
}
