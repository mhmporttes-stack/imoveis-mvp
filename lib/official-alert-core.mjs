// ALERTA PELO NÚMERO OFICIAL (genérico e reaproveitável — dono, 2026-11-10). PURO, testado em
// tests/official-alert-core.test.mjs. Envio/banco em lib/official-alert.js.
//
// O aviso sai como mensagem de TEXTO LIVRE pelo Oficial ao WhatsApp do corretor (sem modelo da Meta, por decisão do dono):
// só vale com a janela de 24 h do corretor aberta (ele escreveu ao Oficial nas últimas 24 h — é para isso que a rotina das
// 08:00 existe). Janela fechada, sem telefone ou Oficial sem credencial → push + sino do CRM.

export const OFFICIAL_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OFFICIAL_ALERT_WINDOW_SAFETY_MS = 5 * 60 * 1000;

export function isRecipientWindowOpen(lastInboundAt, nowMs = Date.now()) {
  const at = lastInboundAt ? new Date(lastInboundAt).getTime() : 0;
  return Boolean(at) && nowMs < at + OFFICIAL_ALERT_WINDOW_MS - OFFICIAL_ALERT_WINDOW_SAFETY_MS;
}

/** { channel: "official" | "push", reason } */
export function decideAlertChannel({ hasPhone = false, windowOpen = false, officialConfigured = true } = {}) {
  if (!officialConfigured) return { channel: "push", reason: "oficial_sem_credencial" };
  if (!hasPhone) return { channel: "push", reason: "sem_telefone" };
  if (!windowOpen) return { channel: "push", reason: "janela_fechada" };
  return { channel: "official", reason: "janela_aberta" };
}

const digits = (value) => String(value || "").replace(/\D/g, "");

/** Telefone para exibir: 5514999998888 → (14) 99999-8888. Fora do formato: devolve só os dígitos. */
export function formatPhoneForAlert(phone) {
  const all = digits(phone);
  const national = all.startsWith("55") && all.length >= 12 ? all.slice(2) : all;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return all;
}

/** Texto do aviso ao corretor transferido pelo fluxo do anúncio: cliente, telefone, etapa e link do card. */
export function buildTransferAlertText({ clientName = "", phone = "", stepLabel = "", reasonLabel = "", cardUrl = "" } = {}) {
  const lines = [
    "Novo cliente do anúncio para você",
    `Cliente: ${String(clientName || "").trim() || "Cliente WhatsApp"}`,
    phone ? `Telefone: ${formatPhoneForAlert(phone)}` : "",
    stepLabel ? `Parou em: ${stepLabel}` : "",
    reasonLabel ? `Motivo da transferência: ${reasonLabel}` : "",
    cardUrl ? `Card: ${cardUrl}` : ""
  ];
  return lines.filter(Boolean).join("\n");
}
