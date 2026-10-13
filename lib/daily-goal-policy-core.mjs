// Política de disparos v2 do WhatsApp individual (Meta Diária automática + fila extra "Disparar").
// Puro (sem banco, sem "server-only"), testado em tests/daily-goal-policy-v2.test.mjs.
//
// [REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-04] Cada corretor envia ISOLADO (sem coordenação
// entre corretores), no máximo 30 mensagens por dia (soma dos números dele — WA-15, 2026-10-08) (10 de 1ª tentativa, 10 de 2ª e 10 de 3ª), só de segunda a
// sábado (America/Sao_Paulo), nunca duas mensagens no mesmo momento (mínimo INEGOCIÁVEL de 5 min entre elas). Quem não foi
// enviado hoje passa ao dia seguinte.
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-13, substitui "06:30–15:30" e "5 a 8 min"] A janela vai das 06:30 às 18:00 e as
// mensagens são ESPALHADAS ao longo dela, bem devagar: intervalo médio = tempo restante da janela ÷ mensagens que faltam
// (ex.: 15 no dia = ~46 min; 30 = ~23 min), cada intervalo sorteado ± `oscillate_percent` % (padrão 40) — nunca o mesmo
// horário nem horário redondo. O antigo "máximo de 8 min" deixou de existir. Pausas de 15–30 min a cada 8–12 envios só
// valem quando o intervalo médio do dia é menor que 15 min (com a janela de 11 h 30 e teto de até 30/dia nunca é).
//
// A política é a VIGENTE por padrão (coluna policy_v2_enabled ausente/NULL = ligada); só `false` explícito a desliga.
// Vale para o corretor com a automação ligada. Janela e intervalo vêm destas constantes/da regra, não do banco.

import { normalizeSlot } from "./whatsapp-session-slots.mjs";
import { spreadScheduleMinutes } from "./daily-goal-auto-core.mjs";

export const DAILY_CAP = 30;
export const CAP_BY_ATTEMPT = Object.freeze({ 1: 10, 2: 10, 3: 10 });
export const WINDOW_START_MINUTES = 6 * 60 + 30; // 06:30
export const WINDOW_END_MINUTES = 18 * 60; // 18:00 (dono, 2026-10-13; era 15:30)
// [REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-04] Intervalo MÍNIMO entre dois envios do mesmo número
// (qualquer fila): 5 min, INEGOCIÁVEL — checado na hora do envio (v2SendBlockReason). O "máximo de 8 min" deixou de ser regra
// em 2026-10-13: o intervalo agora é o espalhamento ao longo da janela (planV2Schedule).
export const MIN_GAP_SECONDS = 5 * 60;
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-13] Oscilação padrão do intervalo (± %) quando o corretor não tem valor gravado.
export const DEFAULT_OSCILLATE_PERCENT = 40;
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-13] Pausas programadas só fazem sentido com intervalos curtos: com intervalo
// médio do dia a partir de 15 min elas ficam desligadas.
export const PAUSES_OFF_FROM_AVERAGE_GAP_MINUTES = 15;
// Itens da fila acima de 10 por tentativa são retirados (cancelados) com este motivo e NUNCA recriados.
export const TRIM_SKIP_REASON = "policy_v2_trim_excess";
export const TRIM_POLICY_NAME = "policy_v2";
export const PAUSE_EVERY_MIN = 8;
export const PAUSE_EVERY_MAX = 12;
export const PAUSE_MIN_MINUTES = 15;
export const PAUSE_MAX_MINUTES = 30;
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-13] ESPERA PÓS-CONEXÃO: TODO número que acabou de (re)conectar espera pelo
// menos 2 horas antes da 1ª mensagem automática (Meta Diária e fila "Disparar"), contadas de
// `whatsapp_individual_sessions.last_connected_at` DAQUELE número (substitui o atraso de 5 min de 2026-10-04). Os atrasados
// continuam sendo REPROGRAMADOS (nunca cancelados) e o que não saiu no dia passa ao dia seguinte. Só a automação espera:
// o envio manual do corretor nunca é afetado. Constante única — não repita o 120 em outro lugar.
export const RECONNECT_SETTLE_MINUTES = 120;
// Item pendente atrasado além disto (ou preso por reconexão) é REPROGRAMADO, nunca enviado "para recuperar".
export const OVERDUE_TOLERANCE_MINUTES = 5;

const MINUTE_MS = 60 * 1000;

/* ---------------- Espera pós-conexão por NÚMERO (dono, 2026-10-13) ---------------- */

// Instante (ms) da última conexão de uma linha de whatsapp_individual_sessions; null se nunca conectou/inválido.
// É o MESMO campo da "reconexão sem rajada" de 2026-10-04 (`last_connected_at`, gravado em cada conexão real pelo
// webhook do microsserviço) — nada aqui o reinicia: só uma nova conexão muda esse valor.
function connectedMsOf(row) {
  const ms = new Date(row?.last_connected_at || "").getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sessionRowOfSlot(rows, slot) {
  return (rows || []).find((row) => row && (normalizeSlot(row.slot) || 1) === slot) || null;
}

// A partir de quando um número conectado em `connectedAtMs` pode enviar (conexão + 2 h). null = sem dado: não segura.
export function reconnectReadyAtMs(connectedAtMs) {
  return Number.isFinite(connectedAtMs) ? connectedAtMs + RECONNECT_SETTLE_MINUTES * MINUTE_MS : null;
}

// Entre os números aptos (`slots`: conectados, com "Usar para disparo" ligado e sem pausa), os que JÁ cumpriram a espera.
// Número sem `last_connected_at` não é segurado (nunca bloqueia por falta de dado). O outro número segue enviando
// mesmo que um deles tenha acabado de reconectar: a espera é por número.
export function slotsPastReconnectWait({ rows = [], slots = [], nowMs = Date.now() } = {}) {
  return (slots || []).filter((slot) => {
    const readyAt = reconnectReadyAtMs(connectedMsOf(sessionRowOfSlot(rows, slot)));
    return readyAt === null || nowMs >= readyAt;
  });
}

// Conexão de referência do CORRETOR para agendar/segurar a fila: a MAIS ANTIGA entre os números aptos — basta um número
// fora da espera para o corretor poder enviar. Sem número apto cai no Número 1. Algum número sem dado = sem espera (null).
export function brokerReconnectReferenceMs({ rows = [], slots = [] } = {}) {
  const list = (slots || []).length ? slots : [1];
  const times = list.map((slot) => connectedMsOf(sessionRowOfSlot(rows, slot)));
  if (!times.length || times.some((ms) => ms === null)) return null;
  return Math.min(...times);
}

// Até quando o corretor inteiro está em espera pós-conexão (TODOS os números aptos ainda esperando). null = pode enviar.
// Para o cartão da Automação ("aguardando 2 h após reconectar (envia a partir de HH:MM)").
export function reconnectHoldUntilMs({ rows = [], slots = [], nowMs = Date.now() } = {}) {
  if (!(slots || []).length) return null;
  const readyAt = reconnectReadyAtMs(brokerReconnectReferenceMs({ rows, slots }));
  return readyAt !== null && nowMs < readyAt ? readyAt : null;
}

// Texto do cartão (uma linha). `untilMs` = horário real de saída (o maior entre o fim da espera e o próximo disparo).
export function formatReconnectHoldLine(untilMs) {
  if (!Number.isFinite(untilMs)) return "";
  const hours = RECONNECT_SETTLE_MINUTES / 60;
  const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(untilMs));
  return `aguardando ${hours} h após reconectar (envia a partir de ${clock})`;
}

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-04] A política v2 é a VIGENTE por padrão para todo corretor que tem linha
// de configuração: coluna ausente (migration não aplicada) ou NULL = ligada; só `false` explícito (interruptor do
// corretor na tela) desliga. Sem linha de configuração (corretor sem automação) = false (nada a regular).
export function isPolicyV2Enabled(settingsRow) {
  if (!settingsRow) return false;
  return settingsRow.policy_v2_enabled !== false;
}


// Intervalo entre envios: SÓ o mínimo (5 min, constante da política) é regra fixa. Os valores antigos de
// min_gap_minutes/max_gap_minutes do banco NÃO prevalecem na v2 (decisão 2026-10-04). O espaçamento de verdade é o
// espalhamento ao longo da janela (planV2Schedule); `maxSeconds` só existe na exceção por data abaixo (faixa fixa).
export function effectiveGapSeconds() {
  return { minSeconds: MIN_GAP_SECONDS };
}

// Oscilação do intervalo na v2 (± %): o valor gravado do corretor (`oscillate_percent`, 0–100) ou 40 quando ausente.
export function v2OscillatePercent(settingsRow) {
  const raw = settingsRow?.oscillate_percent;
  const value = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : DEFAULT_OSCILLATE_PERCENT;
}

// Intervalo médio do DIA (minutos) = janela ÷ teto do dia (ex.: 06:30–18:00 com teto 15 = 46 min; teto 30 = 23 min). Decide
// se as pausas programadas valem (só abaixo de 15 min) e é a média da fila extra ("Disparar").
export function dayAverageGapMinutes({ windowStartMinutes, windowEndMinutes, dailyCap }) {
  return (windowEndMinutes - windowStartMinutes) / Math.max(1, Number(dailyCap) || 1);
}

// [REGRA OFICIAL — dono, 2026-10-13] Pausas de 15–30 min a cada 8–12 envios ficam DESLIGADAS quando o intervalo médio do
// dia é de 15 min ou mais.
export function pausesOffForAverageGap(averageGapMinutes) {
  return averageGapMinutes >= PAUSES_OFF_FROM_AVERAGE_GAP_MINUTES;
}

export function dailyCapFor(settingsRow) {
  const override = Number(settingsRow?.daily_cap_override);
  return Number.isInteger(override) && override > 0 ? Math.min(DAILY_CAP, override) : DAILY_CAP;
}


// EXCEÇÃO POR DATA E POR CORRETOR (dono, 2026-10-05): "dia de teste lento" — janela até 18:00, intervalo longo
// (17–21 min, média 19 ±~10%), sem pausas programadas e teto do dia de 15, só para Izabela, Caroline e Jennyfer, SÓ
// em 05/10/2026 (a data não casa em outro dia e tudo volta ao normal sozinho). Para remover: apagar a entrada.
// Desde 2026-10-13 a janela até 18:00 e o intervalo longo são a regra de todos; a entrada ficou inerte (só roda a
// faixa fixa 17–21 min no dia dela) e permanece apenas como registro.
export const TEMPORARY_POLICY_OVERRIDES = Object.freeze([
  {
    date: "2026-10-05",
    brokerIds: Object.freeze([
      "8cb63e68-7bb8-4df1-b4bc-35a53e8c2064", // Izabela Silverio
      "aa4ef978-007d-439a-9f2e-5682df9a6781", // Caroline Mayumi
      "3fdc31e6-9c4c-4e8a-a50f-95567fc022ec" // Jennyfer Zorzato
    ]),
    windowEndMinutes: 18 * 60,
    minGapSeconds: 17 * 60,
    maxGapSeconds: 21 * 60,
    dailyCap: 15,
    noPauses: true
  }
]);

export function temporaryPolicyOverrideFor(brokerId, nowMs = Date.now()) {
  if (!brokerId) return null;
  const today = new Date(nowMs - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // São Paulo (-03:00 fixo)
  return TEMPORARY_POLICY_OVERRIDES.find((item) => item.date === today && item.brokerIds.includes(brokerId)) || null;
}

// AQUECIMENTO (warm-up) de número novo ou reconectado após bloqueio — [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-10].
// Teto diário escalonado por NÚMERO ao longo de ~7 dias: dias 1–2 = 10, 3–4 = 15, 5–6 = 20, do dia 7 em diante = 30.
// O teto de 30 e o 10/10/10 da v2 continuam sendo o MÁXIMO (o aquecimento só pode reduzir, nunca aumentar). Dia 1 =
// dia em que o número passou a valer: 1ª conexão de um número novo (ou número trocado) ou a RETOMADA MANUAL depois de
// uma intervenção 403 (não conta o tempo parado). Estado por número em `daily_goal_auto_settings.slot_controls`
// (`warmupStart`, AAAA-MM-DD, America/Sao_Paulo); sem `warmupStart` = número já estabelecido (teto normal).
export const WARMUP_STEPS = Object.freeze([
  Object.freeze({ fromDay: 1, cap: 10 }),
  Object.freeze({ fromDay: 3, cap: 15 }),
  Object.freeze({ fromDay: 5, cap: 20 }),
  Object.freeze({ fromDay: 7, cap: DAILY_CAP })
]);

// Hoje em São Paulo (AAAA-MM-DD; -03:00 fixo, o Brasil não tem horário de verão desde 2019).
export function saoPauloDateStr(nowMs = Date.now()) {
  return new Date(nowMs - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Dia do aquecimento (1 = dia de início). null se não há início válido (= número estabelecido).
export function warmupDayNumber(startDate, todayDate) {
  if (!startDate) return null;
  const start = Date.parse(`${String(startDate).slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${String(todayDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(today)) return null;
  return Math.max(1, Math.floor((today - start) / 86400000) + 1);
}

export function warmupCapForDay(day) {
  if (!Number.isInteger(day) || day < 1) return DAILY_CAP;
  let cap = WARMUP_STEPS[0].cap;
  for (const step of WARMUP_STEPS) if (day >= step.fromDay) cap = step.cap;
  return cap;
}

// Teto de UM número hoje (entrada de slot_controls). Sem entrada ou sem `warmupStart` = 30.
export function slotDailyCap(entry, todayDate = saoPauloDateStr()) {
  const day = warmupDayNumber(entry?.warmupStart, todayDate);
  return day === null ? DAILY_CAP : warmupCapForDay(day);
}

// Teto do CORRETOR hoje = soma dos tetos dos números aptos ao disparo (usar-para-disparo ligado e não pausados),
// limitada a 30. Sem nenhuma entrada apta (dado ainda não observado) = 30: nunca restringe por falta de informação.
export function brokerWarmupCap(slotControls, todayDate = saoPauloDateStr()) {
  const entries = Object.values(slotControls && typeof slotControls === "object" ? slotControls : {})
    // `phone === null` = número que nunca chegou a parear (QR sem leitura): não envia nada e não pode inflar o teto.
    .filter((entry) => entry && entry.dispatch !== false && entry.paused !== true && entry.phone !== null);
  if (!entries.length) return DAILY_CAP;
  return Math.min(DAILY_CAP, entries.reduce((sum, entry) => sum + slotDailyCap(entry, todayDate), 0));
}

// Com DOIS números aptos, o teto de cada um vale separado: tira os que já bateram o teto de hoje (envios iniciados
// hoje em `sentTodayBySlot`). Número sem entrada = estabelecido (30). Com um só candidato não filtra: o teto do
// corretor (`brokerWarmupCap`, aplicado em applyPolicyV2) já é o desse número.
export function filterSlotsByWarmupCap({ slots = [], sentTodayBySlot = {}, slotControls = null, todayDate = saoPauloDateStr() } = {}) {
  if (slots.length <= 1) return slots;
  return slots.filter((slot) => (Number(sentTodayBySlot?.[slot]) || 0) < slotDailyCap(slotControls?.[slot], todayDate));
}

// Cópia da linha de configuração com a política v2 aplicada: janela SEMPRE 06:30–18:00 (a janela antiga do banco,
// ex.: 07–14, e a compensação por restrição NÃO prevalecem), domingo sempre bloqueado, intervalo ESPALHADO ao longo da
// janela com oscilação (`oscillate_enabled` ligado, `oscillate_percent` do corretor ou 40, sem `max_avg_gap_minutes`) e
// teto efetivo (o teto manual do corretor só pode ser menor que 30). Pausas programadas desligadas quando o intervalo
// médio do dia (janela ÷ teto) é de 15 min ou mais.
export function applyPolicyV2(settingsRow, nowMs = Date.now()) {
  const row = settingsRow || {};
  const override = temporaryPolicyOverrideFor(row.broker_id, nowMs);
  const gap = override ? { minSeconds: override.minGapSeconds, maxSeconds: override.maxGapSeconds } : effectiveGapSeconds();
  // Aquecimento (2026-10-10): número novo/reconectado após bloqueio só pode REDUZIR o teto, nunca passar de 30.
  const warmupCap = brokerWarmupCap(row.slot_controls, saoPauloDateStr(nowMs));
  const dailyCap = Math.min(warmupCap, override ? Math.min(dailyCapFor(row), override.dailyCap) : dailyCapFor(row));
  const windowEndMinutes = override ? override.windowEndMinutes : WINDOW_END_MINUTES;
  const dayGapMinutes = dayAverageGapMinutes({ windowStartMinutes: WINDOW_START_MINUTES, windowEndMinutes, dailyCap });
  return {
    ...row,
    window_start_minutes: WINDOW_START_MINUTES,
    window_end_minutes: windowEndMinutes,
    min_gap_minutes: gap.minSeconds / 60,
    max_gap_minutes: Number.isFinite(gap.maxSeconds) ? gap.maxSeconds / 60 : null,
    oscillate_enabled: true,
    oscillate_percent: v2OscillatePercent(row),
    max_avg_gap_minutes: null,
    business_days_only: true,
    daily_cap_override: dailyCap,
    policy_gap_seconds: gap,
    policy_day_gap_minutes: dayGapMinutes,
    policy_no_pauses: Boolean(override?.noPauses) || pausesOffForAverageGap(dayGapMinutes),
    policy_warmup_cap: warmupCap < DAILY_CAP ? warmupCap : null,
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
  const readyAtMs = reconnectReadyAtMs(connectedAtMs);
  if (readyAtMs !== null && nowMs < readyAtMs) return "aguardando_apos_reconexao";
  const gap = settings?.policy_gap_seconds || effectiveGapSeconds(settings);
  if (usage.lastSendMs !== null && nowMs < usage.lastSendMs + gap.minSeconds * 1000) return "intervalo_minimo_politica";
  if (!settings?.policy_no_pauses && usage.lastSendMs !== null && sendsSinceLastPause(usage.sendTimesMs) >= PAUSE_EVERY_MAX && nowMs < usage.lastSendMs + PAUSE_MIN_MINUTES * MINUTE_MS) {
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

// ESPALHAMENTO (REGRA OFICIAL — dono, 2026-10-13): `total` horários entre `cursor` e o fim da janela, "bem devagar" e
// ALEATÓRIOS. Intervalo médio = tempo restante ÷ mensagens que faltam, SEM teto de média máxima; cada intervalo sorteado
// ± `oscillate_percent` % (padrão 40) pela MESMA função da oscilação da Meta Diária (spreadScheduleMinutes). O 1º envio
// ganha um atraso aleatório de até 1 intervalo médio (nada de 06:30:00 nem de "agora" redondo) e os segundos são o que
// sair do sorteio. Mínimo de 5 min entre dois horários garantido aqui (e de novo na hora do envio); o que passar do fim
// da janela sai da lista (o chamador deixa para o próximo dia de disparo). Pausas de 15–30 min a cada 8–12 envios só
// entram se `policy_no_pauses` estiver desligado (intervalo médio do dia < 15 min).
function planSpreadSchedule({ total, cursor, endMs, settings, lastSendMs, sendsSinceLastPauseCount, random }) {
  if (cursor > endMs) return [];
  const minGapMs = (settings?.policy_gap_seconds?.minSeconds ?? MIN_GAP_SECONDS) * 1000;
  const start = cursor + Math.floor((random() * (endMs - cursor)) / total / 1000) * 1000;
  const offsets = spreadScheduleMinutes({
    count: total,
    windowStartMinutes: 0,
    windowEndMinutes: (endMs - start) / MINUTE_MS,
    nowMinutes: 0,
    oscillateEnabled: true,
    oscillatePercent: v2OscillatePercent(settings),
    maxAverageGapMinutes: null,
    random
  });

  const result = [];
  let sinceBreak = Math.max(0, Math.floor(Number(sendsSinceLastPauseCount) || 0));
  const nextPauseTarget = () => (settings?.policy_no_pauses ? Infinity : pickPauseEvery(random));
  let target = nextPauseTarget();
  let previous = Number.isFinite(lastSendMs) ? lastSendMs : null;
  for (const offset of offsets) {
    let at = start + offset * MINUTE_MS;
    if (previous !== null) {
      let spacing = minGapMs;
      if (sinceBreak >= target) {
        spacing = pickPauseMs(random);
        sinceBreak = 0;
        target = nextPauseTarget();
      }
      at = Math.max(at, previous + spacing);
    }
    at = Math.ceil(at / 1000) * 1000; // para cima: arredondar nunca encurta o mínimo de 5 min
    if (at > endMs) break;
    result.push(at);
    previous = at;
    sinceBreak += 1;
  }
  return result;
}

// Planeja `count` horários de envio (ms) dentro da janela do dia `dateStr` (espalhamento acima), nunca abaixo de 5 min
// entre dois. Nunca antes de `nowMs`, do último envio + 5 min, nem de `conexão + 2 h` (RECONNECT_SETTLE_MINUTES). O que
// não couber na janela sai da lista (o chamador deixa para o próximo dia). Determinístico com `random` injetado.
// Exceção por data (TEMPORARY_POLICY_OVERRIDES, `policy_gap_seconds.maxSeconds` presente): faixa fixa uniforme, como antes.
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
  const connectReadyMs = reconnectReadyAtMs(connectedAtMs);
  if (connectReadyMs !== null) cursor = Math.max(cursor, connectReadyMs);
  if (!Number.isFinite(gap.maxSeconds)) {
    return planSpreadSchedule({ total, cursor, endMs, settings, lastSendMs, sendsSinceLastPauseCount, random });
  }
  // Abertura do dia: um pequeno atraso aleatório, para o número não "bater o ponto" sempre no mesmo segundo.
  if (cursor === startMs) cursor += Math.floor(random() * gap.maxSeconds) * 1000;

  let sinceBreak = Math.max(0, Math.floor(Number(sendsSinceLastPauseCount) || 0));
  const nextPauseTarget = () => (settings?.policy_no_pauses ? Infinity : pickPauseEvery(random)); // exceção de data: sem pausas programadas
  let target = nextPauseTarget();
  if (sinceBreak >= target && Number.isFinite(lastSendMs)) {
    cursor = Math.max(cursor, lastSendMs + pickPauseMs(random));
    sinceBreak = 0;
    target = nextPauseTarget();
  }
  for (let i = 0; i < total; i += 1) {
    if (cursor > endMs) break;
    const at = Math.round(cursor / 1000) * 1000;
    result.push(at);
    sinceBreak += 1;
    if (sinceBreak >= target) {
      cursor = at + pickPauseMs(random);
      sinceBreak = 0;
      target = nextPauseTarget();
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
// agendados em dia anterior, fora da janela de hoje, atrasados além da tolerância, antes do fim da espera
// pós-conexão (2 h) ou — uma única vez, na publicação do espalhamento de 2026-10-13 — de HOJE e gravados antes dela
// (`legacyBeforeMs` = instante em que o espalhamento novo começou a valer; item mexido depois disso não é "antigo").
// Itens de dia FUTURO não são tocados (ficam esperando o dia).
export function findStaleV2Items(items, { nowMs, dateStr, settings, connectedAtMs = null, legacyBeforeMs = null }) {
  const stale = [];
  for (const item of items || []) {
    const ms = new Date(item.scheduled_for || "").getTime();
    if (Number.isNaN(ms)) { stale.push(item.id); continue; }
    const parts = saoPauloParts(ms);
    if (parts.date < dateStr) { stale.push(item.id); continue; }
    if (parts.date > dateStr) continue;
    if (parts.minutes < settings.window_start_minutes || parts.minutes > settings.window_end_minutes) { stale.push(item.id); continue; }
    if (ms < nowMs - OVERDUE_TOLERANCE_MINUTES * MINUTE_MS) { stale.push(item.id); continue; }
    if (Number.isFinite(legacyBeforeMs)) {
      const updatedMs = new Date(item.updated_at || "").getTime();
      if (Number.isFinite(updatedMs) && updatedMs < legacyBeforeMs) { stale.push(item.id); continue; }
    }
    // Espera pós-conexão (2 h): enquanto o corretor ainda espera, TODO horário de hoje antes do fim da espera é
    // reprogramado para depois dela (os de dia futuro já foram deixados para trás acima).
    const readyAtMs = reconnectReadyAtMs(connectedAtMs);
    if (readyAtMs !== null && nowMs < readyAtMs && ms < readyAtMs) stale.push(item.id);
  }
  return stale;
}

// Reprograma TODOS os pendentes da Meta Diária (nunca cancela): cada um recebe o próximo horário livre de HOJE
// (espaçado, com pausas, depois da reconexão + 2 h) enquanto houver teto do dia (30 e 10/10/10, já descontado o que
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

// Intervalo da fila extra sob a v2 (segundos), estável por item (mesma semente = mesmo valor entre ciclos do cron).
// [REGRA OFICIAL — dono, 2026-10-13] Mesmo espaçamento "bem devagar" da Meta Diária: o intervalo médio do dia (janela ÷ teto,
// `policy_day_gap_minutes`) ± `oscillate_percent` %, sorteado por item — nunca abaixo do mínimo de 5 min. Exceção por data
// (`maxSeconds` presente): faixa fixa, como antes.
export function extraGapSecondsV2(seed, settings) {
  const gap = settings?.policy_gap_seconds || effectiveGapSeconds(settings);
  let hash = 0;
  for (const char of String(seed || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  if (Number.isFinite(gap.maxSeconds)) return gap.minSeconds + (hash % (gap.maxSeconds - gap.minSeconds + 1));
  const averageSeconds = Number(settings?.policy_day_gap_minutes) * 60;
  if (!(averageSeconds > gap.minSeconds)) return gap.minSeconds;
  const spread = v2OscillatePercent(settings) / 100;
  const fraction = (hash % 1000) / 999; // 0..1, fixo para o mesmo item
  return Math.max(gap.minSeconds, Math.round(averageSeconds * (1 - spread + 2 * spread * fraction)));
}

// Limpeza do excesso da fila (REGRA OFICIAL — dono, 2026-10-04): cada tentativa (1ª/2ª/3ª) mantém no MÁXIMO 10 itens
// pendentes da Meta Diária. Os 10 que ficam são os PRIORITÁRIOS na ordem normal da fila (a mesma do envio:
// scheduled_for crescente, depois created_at, depois id). Só os excedentes saem (cancelados com TRIM_SKIP_REASON).
// Idempotente: com ≤ 10 por tentativa não retira nada. `items` = [{ id, attempt_number, scheduled_for, created_at }].
// Devolve { trimIds, byAttempt: { 1: { kept, trimmed }, 2: ..., 3: ... } }.
export function planV2Trim(items) {
  const byAttempt = { 1: { kept: 0, trimmed: 0 }, 2: { kept: 0, trimmed: 0 }, 3: { kept: 0, trimmed: 0 } };
  const trimIds = [];
  const time = (value) => {
    const ms = new Date(value || "").getTime();
    return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
  };
  const sorted = (items || []).slice().sort((a, b) =>
    time(a.scheduled_for) - time(b.scheduled_for) || time(a.created_at) - time(b.created_at) || String(a.id).localeCompare(String(b.id)));
  for (const item of sorted) {
    const attempt = item.attempt_number;
    if (!byAttempt[attempt]) continue;
    if (byAttempt[attempt].kept < CAP_BY_ATTEMPT[attempt]) byAttempt[attempt].kept += 1;
    else {
      byAttempt[attempt].trimmed += 1;
      trimIds.push(item.id);
    }
  }
  return { trimIds, byAttempt };
}

// Fila automática do dia para o CARD da Meta Diária (só exibição; nada aqui decide envio).
// Mostra o que a política v2 realmente envia (10/10/10 da Meta + extra no total de 30), e NÃO a carteira
// ativa nem as pendências acumuladas (essas são "atividades da meta", outra coisa).
//  - sentTodayRows: itens `sent` com sent_at de HOJE ({ attempt_number, source });
//  - openRows: itens `pending`/`sending` de QUALQUER dia ({ attempt_number, source }) — atrasados contam, pois
//    são reprogramados e saem na próxima janela (planV2Trim também conta pendentes de qualquer dia).
// Por tentativa: planned = min(10, enviadas hoje + na fila). `total` = planned das 3 + fila extra, até 30.
export function summarizeAutoQueueForCard({ sentTodayRows = [], openRows = [], settings = null } = {}) {
  const byAttempt = {};
  for (const attempt of [1, 2, 3]) byAttempt[attempt] = { sent: 0, queued: 0, planned: 0, cap: CAP_BY_ATTEMPT[attempt] };
  let extra = 0;
  const add = (row, field) => {
    if ((row.source || "meta") !== "meta") { extra += 1; return; }
    if (byAttempt[row.attempt_number]) byAttempt[row.attempt_number][field] += 1;
  };
  for (const row of sentTodayRows || []) add(row, "sent");
  for (const row of openRows || []) add(row, "queued");
  let planned = 0;
  for (const attempt of [1, 2, 3]) {
    const cell = byAttempt[attempt];
    cell.planned = Math.min(cell.cap, cell.sent + cell.queued);
    planned += cell.planned;
  }
  const cap = dailyCapFor(settings);
  return { cap, total: Math.min(cap, planned + extra), extra, byAttempt };
}

// Texto do card para o resumo acima (ex.: "Fila automática de hoje: 29 de 30 (1ª 10/10 · 2ª 9/10 · 3ª 10/10)").
export function formatAutoQueueCardLine(queue) {
  if (!queue || !queue.byAttempt) return "";
  const part = (attempt) => `${attempt}ª ${queue.byAttempt[attempt].planned}/${queue.byAttempt[attempt].cap}`;
  return `Fila automática de hoje: ${queue.total} de ${queue.cap} (${part(1)} · ${part(2)} · ${part(3)})`;
}
