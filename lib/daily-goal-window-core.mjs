// Compensação da janela de envio da Meta Diária por restrição VALIDADA do WhatsApp
// (REGRA OFICIAL — dono, 2026-10-02). Funções PURAS (sem banco, sem "server-only"),
// testadas em tests/daily-goal-window-credit.test.mjs. Persistência/leitura ficam em
// lib/daily-goal-window.js.
//
// Resumo da regra:
//  - Só restrição VALIDADA credita (informada/rejeitada/sem restrição: zero). O intervalo
//    útil de cada restrição é [validated_at, ended_at ?? agora]; a restrição encerrada
//    manualmente ("Restrição resolvida") só conta até o encerramento.
//  - Crédito do dia = UNIÃO dos intervalos ∩ janela BASE de envio do dia (dia de São Paulo,
//    corta na meia-noite; sobreposição nunca conta duas vezes). Dia não útil
//    (business_days_only) não gera crédito.
//  - Janela efetiva = fim BASE + crédito, com TETO 21:00 (nunca passa disso; se o fim base
//    já é depois das 21:00, nada é reduzido nem estendido).
//  - A retomada NÃO aumenta a cadência: o intervalo médio é calculado com a janela BASE
//    (referência congelada no início da última pausa) e só se acrescenta tempo no FIM.
//  - Se mesmo com a extensão for matematicamente impossível concluir a meta com a cadência
//    segura, o dia é "impactado por restrição validada" (sem penalidade na pontuação).
import { isBusinessDay, saoPauloDateMinutes } from "./daily-goal-auto-core.mjs";

export const WINDOW_EFFECTIVE_CAP_MINUTES = 21 * 60; // 21:00

const MINUTE_MS = 60000;

function toMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Início/fim (ms) do dia `date` (AAAA-MM-DD) em São Paulo (-03:00 fixo, sem horário de verão).
export function saoPauloDayBoundsMs(date) {
  const start = new Date(`${date}T00:00:00-03:00`).getTime();
  return { startMs: start, endMs: start + 24 * 60 * MINUTE_MS };
}

// Dia da semana (0=domingo) de uma data AAAA-MM-DD, sem depender do fuso do servidor.
export function weekdayOfPlainDate(date) {
  return new Date(`${date}T12:00:00-03:00`).getUTCDay();
}

// Interseção de [aMs,bMs] com a janela base do dia, em minutos do dia, ou null.
function clipToWindow(startMs, endMs, dayStartMs, windowStartMinutes, windowEndMinutes) {
  const wStart = dayStartMs + windowStartMinutes * MINUTE_MS;
  const wEnd = dayStartMs + windowEndMinutes * MINUTE_MS;
  const from = Math.max(startMs, wStart);
  const to = Math.min(endMs, wEnd);
  if (!(to > from)) return null;
  return { start: (from - dayStartMs) / MINUTE_MS, end: (to - dayStartMs) / MINUTE_MS };
}

function mergeIntervals(list) {
  const sorted = list.slice().sort((a, b) => a.start - b.start);
  const merged = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else merged.push({ start: item.start, end: item.end });
  }
  return merged;
}

// Intervalos de restrição que contam: só VALIDADA (validation_status === "validated") com
// validated_at. Cada um: { validation_status, validated_at, ended_at|null }.
export function validatedIntervals(restrictions, { nowMs = Date.now() } = {}) {
  const result = [];
  for (const row of restrictions || []) {
    if (!row || row.validation_status !== "validated") continue; // informada/rejeitada nunca creditam
    const start = toMs(row.validated_at);
    if (start === null) continue;
    const end = toMs(row.ended_at) ?? nowMs; // em andamento conta até agora
    if (end > start) result.push({ startMs: start, endMs: end });
  }
  return result;
}

// Crédito de tempo do dia para um corretor.
// -> { creditMinutes, merged: [{start,end}] (minutos do dia, dentro da janela base), lastEndMinutes }
export function computeDayWindowCredit({
  date, restrictions = [], windowStartMinutes, windowEndMinutes, businessDaysOnly = true, nowMs = Date.now()
}) {
  const empty = { creditMinutes: 0, merged: [], lastEndMinutes: null, lastRestrictionEndMinutes: null };
  if (!date || !Number.isFinite(windowStartMinutes) || !Number.isFinite(windowEndMinutes) || windowEndMinutes <= windowStartMinutes) return empty;
  if (businessDaysOnly && !isBusinessDay(weekdayOfPlainDate(date))) return empty;
  const { startMs: dayStartMs, endMs: dayEndMs } = saoPauloDayBoundsMs(date);
  const clipped = [];
  let lastRestrictionEndMinutes = null; // fim real da última restrição do dia (só cortado na meia-noite/agora)
  for (const interval of validatedIntervals(restrictions, { nowMs })) {
    const dayFrom = Math.max(interval.startMs, dayStartMs);
    const dayTo = Math.min(interval.endMs, dayEndMs, nowMs);
    if (dayTo > dayFrom) {
      const endMin = (dayTo - dayStartMs) / MINUTE_MS;
      lastRestrictionEndMinutes = lastRestrictionEndMinutes === null ? endMin : Math.max(lastRestrictionEndMinutes, endMin);
    }
    // corta na meia-noite do dia (crédito por dia, nunca vira crédito do seguinte)
    const part = clipToWindow(Math.max(interval.startMs, dayStartMs), Math.min(interval.endMs, dayEndMs, nowMs), dayStartMs, windowStartMinutes, windowEndMinutes);
    if (part) clipped.push(part);
  }
  const merged = mergeIntervals(clipped);
  if (!merged.length) return empty;
  const credit = merged.reduce((sum, item) => sum + (item.end - item.start), 0);
  return { creditMinutes: Math.floor(credit + 1e-9), merged, lastEndMinutes: merged[merged.length - 1].end, lastRestrictionEndMinutes };
}

// EXCECAO TEMPORARIA POR DATA - fim da janela de envio estendido (pedido do dono, 2026-10-03):
// SOMENTE em 03/10/2026 os envios da Meta Diaria vao ate 18:00 (America/Sao_Paulo), em vez do fim
// configurado de cada corretor. Nao muda o inicio nem nenhuma configuracao gravada; em 04/10 a data
// deixa de casar e a janela volta sozinha ao configurado. PARA REMOVER: apague a entrada.
export const TEMPORARY_WINDOW_END_EXTENSIONS = Object.freeze([
  Object.freeze({ date: "2026-10-03", endMinutes: 18 * 60 })
]);

/** Fim de janela temporario para a data (AAAA-MM-DD de Sao Paulo) ou null. */
export function temporaryWindowEndFor(date, list = TEMPORARY_WINDOW_END_EXTENSIONS) {
  const entry = (list || []).find((item) => item && item.date === date);
  const end = Number(entry?.endMinutes);
  return Number.isInteger(end) && end > 0 && end <= 1439 ? end : null;
}

// Fim EFETIVO da janela (minutos do dia): base + crédito, teto 21:00, nunca menor que o base.
export function effectiveWindowEndMinutes(baseEndMinutes, creditMinutes, capMinutes = WINDOW_EFFECTIVE_CAP_MINUTES) {
  const credit = Math.max(0, Number(creditMinutes) || 0);
  if (!credit || baseEndMinutes >= capMinutes) return baseEndMinutes;
  return Math.min(baseEndMinutes + credit, capMinutes);
}

// Referência CONGELADA da cadência (a retomada não aumenta o ritmo): o intervalo médio é
// calculado como se a janela base nunca tivesse sido interrompida — a partir do início da
// ÚLTIMA pausa (nesse instante nada deixou de ser enviado além do que está na fila agora),
// até o fim da janela acrescido só do crédito das pausas ANTERIORES.
// -> null (sem crédito) | { cursorMinutes, endMinutes }
export function cadenceReference({ windowStartMinutes, baseEndMinutes, credit }) {
  if (!credit || !credit.merged?.length) return null;
  const last = credit.merged[credit.merged.length - 1];
  const before = credit.merged.slice(0, -1).reduce((sum, item) => sum + (item.end - item.start), 0);
  return {
    cursorMinutes: Math.max(windowStartMinutes, last.start),
    endMinutes: effectiveWindowEndMinutes(baseEndMinutes, before)
  };
}

// "Janela efetiva do dia" — função ÚNICA usada pelo envio, pelo reparo da fila, pela trava
// final e pelo agendamento. -> { baseEndMinutes, effectiveEndMinutes, creditMinutes, cadence }
export function resolveEffectiveWindow({ date, restrictions = [], windowStartMinutes, windowEndMinutes, businessDaysOnly = true, nowMs = Date.now() }) {
  const credit = computeDayWindowCredit({ date, restrictions, windowStartMinutes, windowEndMinutes, businessDaysOnly, nowMs });
  return {
    baseEndMinutes: windowEndMinutes,
    effectiveEndMinutes: effectiveWindowEndMinutes(windowEndMinutes, credit.creditMinutes),
    creditMinutes: credit.creditMinutes,
    cadence: cadenceReference({ windowStartMinutes, baseEndMinutes: windowEndMinutes, credit }),
    credit
  };
}

// Intervalo mínimo SEGURO entre envios (a cadência configurada pelo dono): nunca menos de 1 min.
export function safeGapMinutes(settings) {
  return Math.max(1, Number(settings?.min_gap_minutes) || 1);
}

// O dia ficou "impactado por restrição validada"? Só se: a meta NÃO foi cumprida, houve tempo
// perdido de verdade dentro da janela base (crédito > 0) e, mesmo com a extensão, o que faltava
// não cabe no tempo que sobrou depois da última pausa com a cadência segura.
// remaining = atividades que faltaram para 100% (obrigatório − feito).
// -> { impacted, impactMinutes }
export function evaluateDayImpact({ goalMet, remaining, windowStartMinutes, baseEndMinutes, credit, safeGapMin }) {
  const impactMinutes = credit?.creditMinutes || 0;
  const none = { impacted: false, impactMinutes: 0 };
  if (goalMet || !(remaining > 0) || impactMinutes <= 0) return none;
  const effectiveEnd = effectiveWindowEndMinutes(baseEndMinutes, impactMinutes);
  const tailStart = Math.max(windowStartMinutes, credit.lastRestrictionEndMinutes ?? credit.lastEndMinutes ?? windowStartMinutes);
  const tailMinutes = Math.max(0, effectiveEnd - tailStart);
  const capacity = tailMinutes > 0 ? Math.floor(tailMinutes / Math.max(1, safeGapMin)) + 1 : 0;
  return remaining > capacity ? { impacted: true, impactMinutes } : none;
}

// Data e minuto "agora" em São Paulo (reexporta o helper existente, para quem só importa este módulo).
export { saoPauloDateMinutes };
