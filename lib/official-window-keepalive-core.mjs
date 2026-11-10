// ROTINA DAS 08:00 — janela de 24 h do corretor com o número Oficial (dono, 2026-11-10). PURO, testado em
// tests/official-window-keepalive-core.test.mjs. Banco/envio em lib/official-window-keepalive.js.
//
// Todo dia, cada corretor ativo com WhatsApp individual CONECTADO manda, pelo número pessoal, "Bom dia, já estou disponível
// para atender" ao número Oficial — mantém aberta a janela de 24 h para o CRM avisá-lo pelo Oficial (official-alert-core).
// A mensagem recebida no Oficial vinda de número da equipe NUNCA vira cliente/card (WA-12) nem dispara fluxo.

export const KEEPALIVE_TEXT = "Bom dia, já estou disponível para atender";
export const KEEPALIVE_START_HOUR = 8; // nunca antes das 08:00 (America/Sao_Paulo)
export const KEEPALIVE_END_HOUR = 12; // cron atrasado demais: não manda mais depois do meio-dia
export const KEEPALIVE_MAX_PER_RUN = 4; // 4 envios + intervalos de 3 a 9 s cabem nos 55 s da rota
export const KEEPALIVE_MIN_GAP_MS = 3_000;
export const KEEPALIVE_MAX_GAP_MS = 9_000;
export const KEEPALIVE_KEY_PREFIX = "official_keepalive:";

const TZ = "America/Sao_Paulo";

export function saoPauloDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function saoPauloHour(now) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now));
}

export function isKeepaliveTime(now = new Date()) {
  const hour = saoPauloHour(now);
  return hour >= KEEPALIVE_START_HOUR && hour < KEEPALIVE_END_HOUR;
}

/** Chave de idempotência por dia + corretor (linha em crm_settings; o índice único impede o 2º envio). */
export function keepaliveKey(day, userId) {
  return `${KEEPALIVE_KEY_PREFIX}${day}:${userId}`;
}

/** Intervalo aleatório entre envios (rng injetável nos testes). */
export function randomGapMs(rng = Math.random) {
  return Math.round(KEEPALIVE_MIN_GAP_MS + rng() * (KEEPALIVE_MAX_GAP_MS - KEEPALIVE_MIN_GAP_MS));
}

/**
 * Um corretor entra na rotina? Ativo, com WhatsApp conectado (nunca envia com a sessão caída) e ainda sem envio hoje.
 * `user` = { status }, `sessionStatus` = "connected" | ..., `claimedToday` = já tem a chave do dia.
 */
export function keepaliveSkipReason({ user = null, sessionStatus = "", claimedToday = false, officialDigits = "", userPhones = [] } = {}) {
  if (!user || user.status !== "active") return "inativo";
  if (sessionStatus !== "connected") return "whatsapp_nao_conectado";
  if (claimedToday) return "ja_enviado_hoje";
  if (officialDigits && userPhones.some((phone) => String(phone || "").replace(/\D/g, "") === officialDigits)) return "numero_e_o_oficial";
  return null;
}

/**
 * Plano de UMA rodada do cron: fora do horário → nada; senão os primeiros `max` elegíveis, em ordem estável, com o intervalo
 * aleatório antes de cada envio (menos o 1º). `candidates` = [{ userId, user, sessionStatus, claimedToday, userPhones }].
 */
export function planKeepaliveRun({ candidates = [], now = new Date(), max = KEEPALIVE_MAX_PER_RUN, officialDigits = "", rng = Math.random } = {}) {
  if (!isKeepaliveTime(now)) return { reason: "fora_do_horario", send: [], skipped: [] };
  const send = [];
  const skipped = [];
  for (const candidate of candidates) {
    const reason = keepaliveSkipReason({ ...candidate, officialDigits });
    if (reason) {
      skipped.push({ userId: candidate.userId, reason });
      continue;
    }
    if (send.length >= max) continue; // fica para a próxima rodada (idempotente)
    send.push({ userId: candidate.userId, delayMs: send.length ? randomGapMs(rng) : 0 });
  }
  return { reason: "ok", send, skipped };
}

// Conferência depois do envio (dono, 2026-11-10): ~10 min depois confere se a mensagem CHEGOU ao Oficial (conversa do telefone dele com
// entrada de hoje). Não chegou → reenvia só "👋" para manter a janela aberta, até 2 vezes (10 min entre elas); ainda falhando →
// "failed" e alerta ao dono. Estado por corretor/dia: sent → confirmed | resent → confirmed | failed.
export const KEEPALIVE_RESEND_TEXT = "👋";
export const KEEPALIVE_STATES = Object.freeze({ sent: "sent", confirmed: "confirmed", resent: "resent", failed: "failed" });
export const KEEPALIVE_VERIFY_AFTER_MS = 10 * 60 * 1000;
export const KEEPALIVE_MAX_RESENDS = 2;

/**
 * `row` = { state, sentAt, lastAttemptAt, resendCount }; `confirmed` = o Oficial recebeu mensagem dele desde o envio.
 * → { action: "confirm" | "resend" | "fail" | "none" }
 */
export function decideKeepaliveVerify({ row = null, confirmed = false, now = new Date() } = {}) {
  if (!row || row.state === KEEPALIVE_STATES.confirmed || row.state === KEEPALIVE_STATES.failed) return { action: "none" };
  if (confirmed) return { action: "confirm" };
  const last = new Date(row.lastAttemptAt || row.sentAt || 0).getTime();
  if (!last || now.getTime() - last < KEEPALIVE_VERIFY_AFTER_MS) return { action: "none" };
  return (row.resendCount || 0) < KEEPALIVE_MAX_RESENDS ? { action: "resend" } : { action: "fail" };
}

const normalize = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** A mensagem recebida é a da rotina das 08:00? (o webhook a tira de TODA automação quando vem de número da equipe) */
export function isKeepaliveMessage(text) {
  const raw = String(text || "").trim();
  if (raw === KEEPALIVE_RESEND_TEXT) return true;
  const clean = normalize(raw);
  return clean === normalize(KEEPALIVE_TEXT) || clean === "oi";
}
