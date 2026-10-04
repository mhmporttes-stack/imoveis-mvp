// Política de disparos v2 do WhatsApp individual (Meta Diária automática + fila extra "Disparar").
// Puro (sem banco, sem "server-only"), testado em tests/daily-goal-policy-v2.test.mjs.
//
// [REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-04] Cada número envia ISOLADO (sem coordenação
// entre corretores), no máximo 30 mensagens por dia (10 de 1ª tentativa, 10 de 2ª e 10 de 3ª), só de segunda a
// sábado entre 06:30 e 15:30 (America/Sao_Paulo), nunca duas mensagens no mesmo momento (mínimo 90 s, máximo
// 8 min entre elas, com pausa de 15 a 30 min a cada ~10 envios). Quem não foi enviado hoje passa ao dia seguinte.
//
// A política vale SÓ para o corretor com a chave `daily_goal_auto_settings.policy_v2_enabled = true` (padrão
// desligado). Coluna ausente (migration não aplicada) = desligada = comportamento antigo, idêntico.

export const DAILY_CAP = 30;
export const CAP_BY_ATTEMPT = Object.freeze({ 1: 10, 2: 10, 3: 10 });
export const WINDOW_START_MINUTES = 6 * 60 + 30; // 06:30
export const WINDOW_END_MINUTES = 15 * 60 + 30; // 15:30
export const MIN_GAP_SECONDS = 90;
export const MAX_GAP_SECONDS = 8 * 60;
export const PAUSE_EVERY_MIN = 8;
export const PAUSE_EVERY_MAX = 12;
export const PAUSE_MIN_MINUTES = 15;
export const PAUSE_MAX_MINUTES = 30;
// Depois que a sessão reconecta, o 1º envio só sai ≥ 5 min depois (nunca logo após conectar, nunca rajada).
export const RECONNECT_DELAY_MINUTES = 5;
// Item pendente atrasado além disto (ou preso por reconexão) é REPROGRAMADO, nunca enviado "para recuperar".
export const OVERDUE_TOLERANCE_MINUTES = 5;

const MINUTE_MS = 60 * 1000;

export function isPolicyV2Enabled(settingsRow) {
  return settingsRow?.policy_v2_enabled === true;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Intervalo entre envios (em segundos) de UM corretor. A política define o piso (90 s) e o teto (8 min); o valor
// do banco só pode ser MAIS restritivo: mínimo maior que 90 s sobe o piso; máximo menor que 8 min desce o teto.
// Se o banco pedir um mínimo acima do teto (ex.: 20 min), vale o mínimo do banco (intervalo fixo) — nunca mais frouxo.
export function effectiveGapSeconds(settingsRow) {
  const dbMin = numberOr(settingsRow?.min_gap_minutes, 0) * 60;
  const dbMax = numberOr(settingsRow?.max_gap_minutes, 0) * 60;
  const min = Math.max(MIN_GAP_SECONDS, dbMin);
  const maxCandidate = dbMax > 0 ? Math.min(MAX_GAP_SECONDS, dbMax) : MAX_GAP_SECONDS;
  return { minSeconds: min, maxSeconds: Math.max(min, maxCandidate) };
}

export function dailyCapFor(settingsRow) {
  const override = Number(settingsRow?.daily_cap_override);
  return Number.isInteger(override) && override > 0 ? Math.min(DAILY_CAP, override) : DAILY_CAP;
}

// Cópia da linha de configuração com a política v2 aplicada: janela cortada em 06:30–15:30 (a do banco só pode
// ser mais estreita; a compensação por restrição NÃO estende além de 15:30), oscilação antiga desligada, domingo
// sempre bloqueado, intervalo efetivo e teto efetivo.
export function applyPolicyV2(settingsRow) {
  const row = settingsRow || {};
  const gap = effectiveGapSeconds(row);
  return {
    ...row,
    window_start_minutes: Math.max(WINDOW_START_MINUTES, numberOr(row.window_start_minutes, WINDOW_START_MINUTES)),
    window_end_minutes: Math.min(WINDOW_END_MINUTES, numberOr(row.window_end_minutes, WINDOW_END_MINUTES)),
    oscillate_enabled: false,
    business_days_only: true,
    daily_cap_override: dailyCapFor(row),
    policy_gap_seconds: gap,
    policy_v2_applied: true
  };
}

export function pickGapSeconds(gap, random = Math.random) {
  const span = Math.max(0, gap.maxSeconds - gap.minSeconds);
  return gap.minSeconds + Math.floor(random() * (span + 1));
}

export function pickPauseEvery(random = Math.random) {
  return PAUSE_EVERY_MIN + Math.floor(random() * (PAUSE_EVERY_MAX - PAUSE_EVERY_MIN + 1));
}

export function pickPauseMs(random = Math.random) {
  const minutes = PAUSE_MIN_MINUTES + random() * (PAUSE_MAX_MINUTES - PAUSE_MIN_MINUTES);
  return Math.round(minutes * 60) * 1000;
}

// Quantos envios seguidos o corretor fez desde a última pausa (intervalo >= 15 min entre dois envios = pausa).
export function sendsSinceLastPause(sendTimesMs) {
  const times = (sendTimesMs || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  let count = 0;
  for (let i = times.length - 1; i >= 0; i -= 1) {
    count += 1;
    if (i > 0 && times[i] - times[i - 1] >= PAUSE_MIN_MINUTES * MINUTE_MS) break;
  }
  return count;
}

function messageWasSent(row) {
  return row.status === "sent" || row.status === "sending" || Boolean(row.wa_message_id);
}

function sendTimeMs(row) {
  const ms = new Date(row.send_started_at || row.sent_at || "").getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Uso do dia do corretor (qualquer fila: Meta Diária e fila extra) a partir das linhas de daily_goal_auto_queue
// de HOJE. `excludeItemId` tira o item que acabou de ser reivindicado (rechecagem pós-claim).
//  - total: mensagens que saíram/estão saindo (conta no teto de 30);
//  - metaByAttempt: só da Meta Diária, por tentativa (teto 10/10/10);
//  - lastSendMs: último envio INICIADO (inclui tentativa que falhou — conservador no intervalo);
//  - sendTimesMs: horários dos envios (para contar a pausa).
export function summarizeV2Usage(rows, { excludeItemId = null } = {}) {
  const usage = { total: 0, metaByAttempt: { 1: 0, 2: 0, 3: 0 }, lastSendMs: null, sendTimesMs: [] };
  for (const row of rows || []) {
    if (excludeItemId && row.id === excludeItemId) continue;
    const started = sendTimeMs(row);
    if (started !== null && (usage.lastSendMs === null || started > usage.lastSendMs)) usage.lastSendMs = started;
    if (!messageWasSent(row)) continue;
    usage.total += 1;
    if (started !== null) usage.sendTimesMs.push(started);
    if ((row.source || "meta") === "meta" && usage.metaByAttempt[row.attempt_number] !== undefined) usage.metaByAttempt[row.attempt_number] += 1;
  }
  usage.sendTimesMs.sort((a, b) => a - b);
  return usage;
}

// Trava de envio da política v2, relida NO MOMENTO do envio (nenhum horário gravado a ultrapassa). null = pode.
// A janela/dia/pausa-manual/automação-ligada seguem em sendBlockReason/extraSendBlockReason (com a janela v2 aplicada);
// aqui ficam teto, intervalo, pausa e reconexão.
export function v2SendBlockReason({ nowMs, usage, settings, connectedAtMs = null, attemptNumber = null, source = "meta" }) {
  const cap = dailyCapFor(settings);
  if (usage.total >= cap) return "teto_diario_politica";
  if (source === "meta" && attemptNumber && CAP_BY_ATTEMPT[attemptNumber] !== undefined && usage.metaByAttempt[attemptNumber] >= CAP_BY_ATTEMPT[attemptNumber]) {
    return "teto_por_tentativa_politica";
  }
  if (Number.isFinite(connectedAtMs) && nowMs < connectedAtMs + RECONNECT_DELAY_MINUTES * MINUTE_MS) return "aguardando_apos_reconexao";
  const gap = settings?.policy_gap_seconds || effectiveGapSeconds(settings);
  if (usage.lastSendMs !== null && nowMs < usage.lastSendMs + gap.minSeconds * 1000) return "intervalo_minimo_politica";
  if (usage.lastSendMs !== null && sendsSinceLastPause(usage.sendTimesMs) >= PAUSE_EVERY_MAX && nowMs < usage.lastSendMs + PAUSE_MIN_MINUTES * MINUTE_MS) {
    return "pausa_programada_politica";
  }
  return null;
}

// Instante (ms) de hh:mm de um dia AAAA-MM-DD em São Paulo (-03:00 fixo; o Brasil não tem horário de verão desde 2019).
export function saoPauloInstantMs(dateStr, minutes) {
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(Math.floor(minutes % 60)).padStart(2, "0");
  return Date.parse(`${dateStr}T${hour}:${minute}:00-03:00`);
}

// Próximo dia de disparo (segunda a sábado) depois de `dateStr`.
export function nextSendingDate(dateStr) {
  let ms = Date.parse(`${dateStr}T12:00:00-03:00`);
  for (let i = 0; i < 8; i += 1) {
    ms += 24 * 60 * MINUTE_MS;
    const weekday = new Date(ms - 3 * 60 * MINUTE_MS).getUTCDay();
    if (weekday !== 0) return new Date(ms - 3 * 60 * MINUTE_MS).toISOString().slice(0, 10);
  }
  return dateStr;
}

// Planeja `count` horários de envio (ms) dentro da janela do dia `dateStr`, SEMPRE espaçados (gap aleatório entre o
// mínimo e o máximo efetivos, nunca abaixo de 90 s), com pausa de 15–30 min a cada 8–12 envios. Nunca antes de
// `nowMs`, do último envio + intervalo, nem de `conexão + 5 min`. O que não couber na janela sai da lista (o chamador
// deixa para o próximo dia). Determinístico com `random` injetado.
export function planV2Schedule({
  count,
  nowMs,
  dateStr,
  settings,
  lastSendMs = null,
  sendsSinceLastPauseCount = 0,
  connectedAtMs = null,
  random = Math.random
}) {
  const result = [];
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (!total) return result;
  const gap = settings?.policy_gap_seconds || effectiveGapSeconds(settings);
  const startMs = saoPauloInstantMs(dateStr, settings.window_start_minutes);
  const endMs = saoPauloInstantMs(dateStr, settings.window_end_minutes);
  let cursor = Math.max(startMs, nowMs);
  if (Number.isFinite(lastSendMs)) cursor = Math.max(cursor, lastSendMs + gap.minSeconds * 1000);
  if (Number.isFinite(connectedAtMs)) cursor = Math.max(cursor, connectedAtMs + RECONNECT_DELAY_MINUTES * MINUTE_MS);
  // Abertura do dia: um pequeno atraso aleatório, para o número não "bater o ponto" sempre no mesmo segundo.
  if (cursor === startMs) cursor += Math.floor(random() * gap.maxSeconds) * 1000;

  let sinceBreak = Math.max(0, Math.floor(Number(sendsSinceLastPauseCount) || 0));
  let target = pickPauseEvery(random);
  if (sinceBreak >= target && Number.isFinite(lastSendMs)) {
    cursor = Math.max(cursor, lastSendMs + pickPauseMs(random));
    sinceBreak = 0;
    target = pickPauseEvery(random);
  }
  for (let i = 0; i < total; i += 1) {
    if (cursor > endMs) break;
    const at = Math.round(cursor / 1000) * 1000;
    result.push(at);
    sinceBreak += 1;
    if (sinceBreak >= target) {
      cursor = at + pickPauseMs(random);
      sinceBreak = 0;
      target = pickPauseEvery(random);
    } else {
      cursor = at + pickGapSeconds(gap, random) * 1000;
    }
  }
  return result;
}

function saoPauloParts(ms) {
  const shifted = new Date(ms - 3 * 60 * MINUTE_MS);
  return { date: shifted.toISOString().slice(0, 10), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

// Itens pendentes da Meta Diária que a política manda REPROGRAMAR (nunca enviar de imediato, nunca cancelar):
// agendados em dia anterior, fora da janela de hoje, atrasados além da tolerância, ou "vencidos" enquanto a
// sessão estava reconectando. Itens de dia FUTURO não são tocados (ficam esperando o dia).
export function findStaleV2Items(items, { nowMs, dateStr, settings, connectedAtMs = null }) {
  const stale = [];
  for (const item of items || []) {
    const ms = new Date(item.scheduled_for || "").getTime();
    if (Number.isNaN(ms)) { stale.push(item.id); continue; }
    const parts = saoPauloParts(ms);
    if (parts.date < dateStr) { stale.push(item.id); continue; }
    if (parts.date > dateStr) continue;
    if (parts.minutes < settings.window_start_minutes || parts.minutes > settings.window_end_minutes) { stale.push(item.id); continue; }
    if (ms < nowMs - OVERDUE_TOLERANCE_MINUTES * MINUTE_MS) { stale.push(item.id); continue; }
    const reconnectGate = Number.isFinite(connectedAtMs) && connectedAtMs > nowMs - 60 * MINUTE_MS
      && ms <= nowMs && ms < connectedAtMs + RECONNECT_DELAY_MINUTES * MINUTE_MS;
    if (reconnectGate) stale.push(item.id);
  }
  return stale;
}

// Reprograma TODOS os pendentes da Meta Diária (nunca cancela): cada um recebe o próximo horário livre de HOJE
// (espaçado, com pausas, depois da reconexão + 5 min) enquanto houver teto do dia (30 e 10/10/10, já descontado o que
// saiu hoje) e janela; o que não couber vai para o próximo dia de disparo (segunda a sábado), também respeitando os
// tetos, e assim por diante. `items` = [{ id, attempt_number, scheduled_for }]; `usage` = summarizeV2Usage de hoje.
// `todayAllowed = false` (domingo): nada para hoje. Devolve [{ id, scheduledMs }] (item sem vaga em 14 dias não entra).
export function rescheduleV2Items(items, { nowMs, dateStr, settings, usage, connectedAtMs = null, todayAllowed = true, random = Math.random }) {
  const used = usage || { total: 0, metaByAttempt: { 1: 0, 2: 0, 3: 0 }, lastSendMs: null, sendTimesMs: [] };
  const cap = dailyCapFor(settings);
  let remaining = (items || []).slice().sort((a, b) => new Date(a.scheduled_for || 0) - new Date(b.scheduled_for || 0));
  const updates = [];
  let dayStr = dateStr;
  for (let step = 0; step < 14 && remaining.length; step += 1) {
    const today = step === 0;
    if (!today) dayStr = nextSendingDate(dayStr);
    const allowed = today ? todayAllowed : true;
    const totalLeft = allowed ? (today ? Math.max(0, cap - used.total) : cap) : 0;
    const attemptLeft = {};
    for (const a of [1, 2, 3]) attemptLeft[a] = today ? Math.max(0, CAP_BY_ATTEMPT[a] - (used.metaByAttempt[a] || 0)) : CAP_BY_ATTEMPT[a];
    const dayItems = [];
    const rest = [];
    for (const item of remaining) {
      if (dayItems.length < totalLeft && (attemptLeft[item.attempt_number] || 0) > 0) {
        dayItems.push(item);
        attemptLeft[item.attempt_number] -= 1;
      } else rest.push(item);
    }
    const times = dayItems.length
      ? planV2Schedule({
        count: dayItems.length,
        nowMs: today ? nowMs : 0,
        dateStr: dayStr,
        settings,
        lastSendMs: today ? used.lastSendMs : null,
        sendsSinceLastPauseCount: today ? sendsSinceLastPause(used.sendTimesMs) : 0,
        connectedAtMs: today ? connectedAtMs : null,
        random
      })
      : [];
    dayItems.forEach((item, index) => {
      if (index < times.length) updates.push({ id: item.id, scheduledMs: times[index] });
      else rest.push(item);
    });
    remaining = rest;
  }
  return updates;
}

// Quantos itens novos da Meta Diária podem entrar na fila de hoje, por tentativa (1/2/3): respeita 10/10/10 e o
// teto total de 30 (já enviados hoje por qualquer fila + pendentes de hoje da Meta Diária).
// `usage` = summarizeV2Usage de hoje; `pendingTodayByAttempt` = pendentes da Meta agendados para hoje, por tentativa.
export function v2EnqueueAllowance({ usage, pendingTodayByAttempt = {}, settings }) {
  const pendingTotal = [1, 2, 3].reduce((sum, a) => sum + (pendingTodayByAttempt[a] || 0), 0);
  const totalLeft = Math.max(0, dailyCapFor(settings) - usage.total - pendingTotal);
  const byAttempt = {};
  for (const a of [1, 2, 3]) {
    byAttempt[a] = Math.max(0, CAP_BY_ATTEMPT[a] - (usage.metaByAttempt[a] || 0) - (pendingTodayByAttempt[a] || 0));
  }
  return { totalLeft, byAttempt };
}

// Escolhe, entre candidatos já embaralhados ({ attempt }), os que entram hoje respeitando 10/10/10 e o total.
export function pickV2EnqueueCandidates(candidates, allowance) {
  const taken = { 1: 0, 2: 0, 3: 0 };
  const picked = [];
  for (const candidate of candidates || []) {
    if (picked.length >= allowance.totalLeft) break;
    const a = candidate.attempt;
    if (taken[a] === undefined || taken[a] >= (allowance.byAttempt[a] || 0)) continue;
    taken[a] += 1;
    picked.push(candidate);
  }
  return picked;
}

// Intervalo da fila extra sob a v2 (segundos), estável por item (mesma semente = mesmo valor entre ciclos do cron),
// sempre dentro [mínimo, máximo] efetivos.
export function extraGapSecondsV2(seed, settings) {
  const gap = settings?.policy_gap_seconds || effectiveGapSeconds(settings);
  let hash = 0;
  for (const char of String(seed || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return gap.minSeconds + (hash % (gap.maxSeconds - gap.minSeconds + 1));
}
