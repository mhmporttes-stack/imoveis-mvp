import "server-only";
import { randomUUID } from "crypto";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { getBrokerDailyGoal, computeDailyGoalDayProgress } from "./daily-goal";
import { getCachedTodayOverviewForRanking } from "./performance-overview";
import { dailyRankingLeader } from "./ranking-display.mjs";
import { resolveLeadingSince, rankingLeaderStreak } from "./celebrations-ranking-core.mjs";
import { fallbackMessageFor, highestDailyGoalMilestone, isRecognitionDayAllowed, recognitionEventDate, resolveMessageText } from "./celebrations-core.mjs";
import { closedPeriodRange, goalStreakFromRows, isMissingSchemaError, pickStreakMilestone, streakMilestones, summarizePeriodGoal } from "./celebrations-sequences-core.mjs";
import { zonedPlainDateToUtcIso, addDaysToPlainDate } from "./daily-report";

// Mensagens de reconhecimento com animação (pedido do dono, 2026-09-29):
// popup privado, só para o corretor que gerou o evento — nunca anunciado pro
// time. Reaproveita o padrão já usado na Mensagem do Dia (banco de textos
// editável + log com constraint única contra duplicidade), a Meta Diária
// (percent ao vivo) e o Ranking (cache de 180s, RANKING_CACHE_MS) em vez de inventar mecanismo
// novo de detecção.

const TIME_ZONE = "America/Sao_Paulo";
const ANIMATIONS = ["confete", "fogos", "moedas", "coroa"];
const AUTOMATED_CHANGED_BY = new Set(["sistema", "automacao", "automação", "cron", "automation"]);
const SALE_STATUS_LIST = [
  "sale_forms", "sale_reservation", "sale_compliance", "sale_contract", "sale_caixa_signature",
  "sale_itbi", "sale_registry", "sale_payment", "sale_paid", "sale_completed"
];
const PROGRESS_STATUS_LIST = [
  "in_service", "completed", "simulation_sent", "documentation_pending", "documents_pending",
  "approval_pending", "approved", ...SALE_STATUS_LIST
];

// definições dos 16 gatilhos pedidos (a chave 'manual' existe só no banco,
// como referência para disparos avulsos, e nunca aparece aqui).
export const CELEBRATION_TRIGGER_DEFINITIONS = [
  { key: "daily_goal_100", label: "Meta batida (100%)", description: "Bateu o marco de 100% da Meta Diária.", configFields: [{ key: "threshold", label: "Marco (%)", type: "number", default: 100 }] },
  { key: "daily_goal_150", label: "150% da meta", description: "Bateu o marco de 150% da Meta Diária.", configFields: [{ key: "threshold", label: "Marco (%)", type: "number", default: 150 }] },
  { key: "daily_goal_200", label: "200% da meta (combo especial)", description: "Bateu o marco de 200% — animação exclusiva, não configurável.", configFields: [{ key: "threshold", label: "Marco (%)", type: "number", default: 200 }], animationLocked: true },
  { key: "ranking_no1", label: "Assumiu o 1º lugar do dia", description: "Segurou a liderança do ranking pelo tempo mínimo configurado.", configFields: [
    { key: "startHour", label: "Horário de início (0-23)", type: "number", default: 12 },
    { key: "holdMinutes", label: "Minutos seguros de liderança", type: "number", default: 10 },
    { key: "minResult", label: "Resultado mínimo (pontos)", type: "number", default: 1 }
  ] },
  { key: "goal_streak", label: "Sequência de dias batendo a meta", description: "Dias seguidos com a Meta Diária concluída (\"esse é o 3º dia seguido\"), uma vez por marco.", configFields: [{ key: "thresholds", label: "Marcos (dias seguidos)", type: "list", default: [2, 3, 5, 7, 10, 15, 20, 30] }] },
  { key: "personal_record", label: "Melhor dia pessoal (recorde)", description: "Produção de hoje superou o melhor dia anterior." },
  { key: "first_of_day", label: "Primeira ação do dia", description: "Primeiro atendimento/avanço de status do dia." },
  { key: "sales_month_milestone", label: "Marcos de vendas no mês", description: "Número de clientes que entraram em venda neste mês.", configFields: [{ key: "thresholds", label: "Marcos (vendas no mês)", type: "list", default: [5, 10, 15, 20] }] },
  { key: "weekly_goal_met", label: "Meta semanal batida", description: "Soma da semana fechada (segunda a domingo) atingida: prospecção + pendentes, como a meta diária. Avisa na segunda-feira." },
  { key: "monthly_goal_met", label: "Meta mensal batida", description: "Soma do mês fechado atingida: prospecção + pendentes, como a meta diária. Avisa no dia 1." },
  { key: "mcmv_approved", label: "Crédito aprovado", description: "Cliente passou para o status 'Cliente aprovado' hoje." },
  { key: "mcmv_contract", label: "Contrato assinado", description: "Cliente passou para o status 'Contrato' hoje." },
  { key: "mcmv_keys", label: "Chaves entregues", description: "Cliente marcado com chaves entregues hoje (marcação manual, sem botão dedicado ainda)." },
  { key: "ranking_streak", label: "Liderança diária em sequência", description: "Fechou 2 ou mais dias seguidos em 1º no ranking do dia — aviso no primeiro acesso do dia seguinte." },
  { key: "rank_climb", label: "Superou a média do time", description: "Pontuação do dia acima da média do time (só depois do horário configurado).", configFields: [{ key: "startHour", label: "Horário de início (0-23)", type: "number", default: 12 }] },
  { key: "birthday", label: "Aniversário do corretor", description: "Depende de 'Data de nascimento' preenchida no cadastro do corretor." },
  { key: "work_anniversary", label: "Tempo de casa", description: "Depende de 'Data de admissão' preenchida no cadastro do corretor." }
];

const TRIGGER_KEYS = new Set(CELEBRATION_TRIGGER_DEFINITIONS.map((d) => d.key));
const LABEL_BY_KEY = new Map(CELEBRATION_TRIGGER_DEFINITIONS.map((d) => [d.key, d.label]));
const DAILY_GOAL_TRIGGER_KEYS = ["daily_goal_100", "daily_goal_150", "daily_goal_200"];
const PRIORITY_BY_KEY = { daily_goal_100: 1, daily_goal_150: 1, daily_goal_200: 1, ranking_no1: 2 };
const FULL_VISIBILITY_AUTH = { ok: true, user: { email: "" }, profile: { id: "", role: "admin" } };

export function canLoadCelebrations() {
  return hasSupabaseAdminConfig;
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export function formatCelebrationsError(error) {
  const message = error?.message || String(error || "");
  if (message.toLowerCase().includes("celebration_") || message.toLowerCase().includes("broker_celebration_events")) {
    return "As tabelas de reconhecimentos ainda não existem no Supabase. Execute as migrations supabase/migrations/20260929170000_broker_celebrations.sql e 20260929171500_broker_celebrations_admin_panel.sql.";
  }
  return message || "Não foi possível concluir a operação de reconhecimentos.";
}

// ---------- tempo (America/Sao_Paulo) ----------

function getSaoPauloParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = values.hour === "24" ? 0 : Number(values.hour);
  return { date: `${values.year}-${values.month}-${values.day}`, hour, minute: Number(values.minute) };
}

function todaySP() {
  return getSaoPauloParts().date;
}

function nowMinutesSP() {
  const parts = getSaoPauloParts();
  return parts.hour * 60 + parts.minute;
}

function yearMonthOf(dateStr) {
  return dateStr.slice(0, 7);
}

function computeTurnKey(dateStr, minutesNow, boundaryHours) {
  const sorted = (Array.isArray(boundaryHours) ? boundaryHours : [12, 18]).map(Number).sort((a, b) => a - b);
  let index = 0;
  for (const hour of sorted) {
    if (minutesNow >= hour * 60) index += 1;
  }
  return `${dateStr}-turn${index}`;
}

function firstName(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "Corretor";
}

function isAutomatedChangedBy(value) {
  return AUTOMATED_CHANGED_BY.has(String(value || "").trim().toLowerCase());
}

// ---------- motor: textos, animação, log ----------

async function loadTriggersMap(supabase) {
  const { data, error } = await supabase.from("celebration_triggers").select("key, enabled, config, animation_mode");
  if (error) throw error;
  return new Map((data || []).map((row) => [row.key, row]));
}

async function pickTemplate(supabase, triggerKey, brokerId) {
  const { data: templates, error } = await supabase
    .from("celebration_message_templates")
    .select("id, template")
    .eq("trigger_key", triggerKey)
    .eq("active", true);
  if (error) throw error;
  if (!templates?.length) return null;
  if (templates.length === 1) return templates[0];

  const { data: lastRows } = await supabase
    .from("broker_celebration_events")
    .select("template_id")
    .eq("broker_id", brokerId)
    .eq("trigger_key", triggerKey)
    .order("created_at", { ascending: false })
    .limit(1);
  const lastId = lastRows?.[0]?.template_id;
  const pool = lastId ? templates.filter((t) => t.id !== lastId) : templates;
  const options = pool.length ? pool : templates;
  return options[Math.floor(Math.random() * options.length)];
}

async function pickAnimation(supabase, trigger, brokerId, triggerKey) {
  if (trigger.animation_mode !== "random") return trigger.animation_mode;
  const { data: lastRows } = await supabase
    .from("broker_celebration_events")
    .select("animation")
    .eq("broker_id", brokerId)
    .eq("trigger_key", triggerKey)
    .order("created_at", { ascending: false })
    .limit(1);
  const last = lastRows?.[0]?.animation;
  const pool = ANIMATIONS.filter((a) => a !== last);
  const options = pool.length ? pool : ANIMATIONS;
  return options[Math.floor(Math.random() * options.length)];
}

const resolveMessage = resolveMessageText;

// Insere o evento; devolve true se foi um disparo NOVO, null se já existia
// (mesmo marco, mesmo dia — inclusive reload/outro dispositivo) ou se o
// gatilho está desligado.
async function logEvent(supabase, triggersMap, { brokerId, triggerKey, eventKey, name, n, forcedAnimation }) {
  const trigger = triggersMap.get(triggerKey);
  if (!trigger?.enabled) return null;

  const template = await pickTemplate(supabase, triggerKey, brokerId);
  const animation = forcedAnimation || (await pickAnimation(supabase, trigger, brokerId, triggerKey));
  const message = template ? resolveMessage(template.template, { name, n }) : fallbackMessageFor(triggerKey, { name, n });

  const { error } = await supabase.from("broker_celebration_events").insert({
    broker_id: brokerId,
    trigger_key: triggerKey,
    event_key: eventKey,
    template_id: template?.id || null,
    message,
    animation,
    source: "auto"
  });
  if (error) {
    if (error.code === "23505") return null;
    throw error;
  }
  return true;
}

// ---------- detecção (roda a cada poll do próprio corretor) ----------

// Registra só o marco mais alto alcançado no dia (highestDailyGoalMilestone). A chave `<gatilho>:<dia>` é a mesma no
// poll do corretor e no servidor — a constraint única (broker_id, event_key) garante uma vez por dia/marco.
async function logDailyGoalMilestone(supabase, triggers, { brokerId, name, day, percent }) {
  const milestone = highestDailyGoalMilestone(percent, triggers);
  if (!milestone) return null;
  return logEvent(supabase, triggers, { brokerId, triggerKey: milestone.key, eventKey: `${milestone.key}:${day}`, name, forcedAnimation: milestone.forcedAnimation });
}

async function detectDailyGoalMilestones(supabase, triggers, { brokerId, name, auth, today }) {
  const goal = await getBrokerDailyGoal(auth);
  await logDailyGoalMilestone(supabase, triggers, { brokerId, name, day: today, percent: goal?.percent });
  return goal;
}

// [Decisão do dono, 2026-10-29] Meta batida também detectada no SERVIDOR: com o corretor fora do CRM (disparo
// automático, fechamento do dia), o evento fica pendente e a cena aparece na próxima vez que ele abrir o CRM. Só para
// hoje ou ontem (isRecognitionDayAllowed) — nunca dias antigos. `percent` opcional: sem ele, calcula pela MESMA fórmula
// do fechamento do dia (computeDailyGoalDayProgress).
export async function recordDailyGoalMilestoneFromServer({ brokerId, day = todaySP(), percent = null }) {
  if (!hasSupabaseAdminConfig || !brokerId) return { skipped: true, reason: "no-broker" };
  const today = todaySP();
  if (!isRecognitionDayAllowed(day, today)) return { skipped: true, reason: "day-too-old" };
  const supabase = db();
  const triggers = await loadTriggersMap(supabase);
  const dailyOn = DAILY_GOAL_TRIGGER_KEYS.some((key) => triggers.get(key)?.enabled);
  const streakOn = Boolean(triggers.get("goal_streak")?.enabled);
  if (!dailyOn && !streakOn) return { skipped: true, reason: "disabled" };

  const value = percent ?? (await computeDailyGoalDayProgress(brokerId, day)).percent;
  const hasMilestone = Boolean(highestDailyGoalMilestone(value, triggers));
  const met = value >= 100;
  if (!hasMilestone && !(met && streakOn)) return { skipped: true, reason: "below-threshold", percent: value };

  const { data: profile, error } = await supabase.from("admin_users").select("name").eq("id", brokerId).maybeSingle();
  if (error) throw error;
  const name = firstName(profile?.name);
  const logged = hasMilestone ? await logDailyGoalMilestone(supabase, triggers, { brokerId, name, day, percent: value }) : null;
  // Dias seguidos de meta (RAN-9c): a meta batida de hoje (ainda aberta) entra na conta; a de ontem já está fechada.
  const streakLogged = met && streakOn ? await logGoalStreak(supabase, triggers, { brokerId, name, today, todayMet: day === today }) : null;
  return { ok: true, percent: value, logged: Boolean(logged), streakLogged: Boolean(streakLogged) };
}

// Fechamento do dia (cron daily-goal-close, 03:01): meta de ONTEM batida (goal_met, mesma fórmula) vira reconhecimento
// pendente para quem ainda não o tem — cobre a meta completada pelo disparo automático depois que o corretor saiu.
export async function recordClosedDayGoalMilestones() {
  if (!hasSupabaseAdminConfig) return { skipped: true, reason: "no-supabase" };
  const supabase = db();
  const day = addDaysToPlainDate(todaySP(), -1);
  const { data: rows, error } = await supabase
    .from("daily_goals")
    .select("broker_id, percent")
    .eq("goal_date", day)
    .eq("goal_met", true)
    .not("closed_at", "is", null);
  if (error) throw error;
  let logged = 0;
  for (const row of rows || []) {
    const result = await recordDailyGoalMilestoneFromServer({ brokerId: row.broker_id, day, percent: Number(row.percent) || 0 });
    if (result?.logged) logged += 1;
  }
  return { day, met: rows?.length || 0, logged };
}

// Dias seguidos de meta batida (dono, 2026-10-30): "esse é o 3º dia seguido". UMA vez por marco e por sequência — a
// chave leva o dia em que a sequência começou, então o mesmo marco não repete a cada dia e um marco menor nunca sai
// depois de um maior (bug anterior: "3 dias" depois do "5"). Quebrou a sequência → recomeça do zero, sem aviso.
async function logGoalStreak(supabase, triggers, { brokerId, name, today, todayMet = false }) {
  const trigger = triggers.get("goal_streak");
  if (!trigger?.enabled) return null;
  const { data: rows, error } = await supabase
    .from("daily_goals")
    .select("goal_date, goal_met")
    .eq("broker_id", brokerId)
    .not("closed_at", "is", null)
    .order("goal_date", { ascending: false })
    .limit(60);
  if (error) throw error;
  const { streak, startDate } = goalStreakFromRows(rows, { today, todayMet });
  const milestone = pickStreakMilestone(streak, streakMilestones(trigger.config));
  if (!milestone) return null;
  return logEvent(supabase, triggers, { brokerId, triggerKey: "goal_streak", eventKey: `goal_streak:${milestone}:${startDate}`, name, n: streak });
}

async function detectGoalStreak(supabase, triggers, { brokerId, name, today, goal }) {
  await logGoalStreak(supabase, triggers, { brokerId, name, today, todayMet: (Number(goal?.percent) || 0) >= 100 });
}

// Liderança diária em sequência (dono, 2026-10-30): quem fechou N (>= 2) dias seguidos em 1º no ranking do dia recebe,
// no primeiro acesso do dia seguinte, "você manteve a liderança por N dias — vamos buscar o N+1". A fonte do 1º lugar
// de cada dia é `celebration_daily_leaders` (gravada pelo cron do ranking). Sem a tabela (migration não aplicada):
// nada a avisar, sem erro.
async function detectRankingStreak(supabase, triggers, { brokerId, name, today }) {
  const trigger = triggers.get("ranking_streak");
  if (!trigger?.enabled) return;
  const { data, error } = await supabase
    .from("celebration_daily_leaders")
    .select("day, leader_broker_id")
    .gte("day", addDaysToPlainDate(today, -60))
    .lt("day", today);
  if (error) {
    if (isMissingSchemaError(error)) return;
    throw error;
  }
  const { leaderId, days } = rankingLeaderStreak(data, today);
  if (leaderId !== brokerId || days < 2) return;
  await logEvent(supabase, triggers, { brokerId, triggerKey: "ranking_streak", eventKey: `ranking_streak:${today}`, name, n: days });
}

async function detectPersonalRecord(supabase, triggers, { brokerId, name, today, goal }) {
  const trigger = triggers.get("personal_record");
  if (!trigger?.enabled || !goal) return;
  const { data: rows } = await supabase
    .from("daily_goals")
    .select("done_count")
    .eq("broker_id", brokerId)
    .not("closed_at", "is", null);
  const historicalMax = (rows || []).reduce((max, row) => Math.max(max, row.done_count || 0), 0);
  const doneToday = Number(goal.done) || 0;
  if (historicalMax > 0 && doneToday > historicalMax) {
    await logEvent(supabase, triggers, { brokerId, triggerKey: "personal_record", eventKey: `personal_record:${today}`, name });
  }
}

async function detectFirstOfDay(supabase, triggers, { brokerId, name, today, myEmail }) {
  const trigger = triggers.get("first_of_day");
  if (!trigger?.enabled) return;
  const startIso = zonedPlainDateToUtcIso(today);
  const { data: rows } = await supabase
    .from("client_status_history")
    .select("id, changed_at, changed_by, new_status")
    .gte("changed_at", startIso)
    .order("changed_at", { ascending: true })
    .limit(200);
  const mine = (rows || []).find((row) =>
    !isAutomatedChangedBy(row.changed_by) &&
    String(row.changed_by || "").toLowerCase() === myEmail &&
    PROGRESS_STATUS_LIST.includes(row.new_status)
  );
  if (mine) {
    await logEvent(supabase, triggers, { brokerId, triggerKey: "first_of_day", eventKey: `first_of_day:${today}`, name });
  }
}

async function detectSalesMonthMilestone(supabase, triggers, { brokerId, name, today, myEmail }) {
  const trigger = triggers.get("sales_month_milestone");
  if (!trigger?.enabled) return;
  const ym = yearMonthOf(today);
  const monthStart = `${ym}-01`;
  const startIso = zonedPlainDateToUtcIso(monthStart);
  const { data: rows } = await supabase
    .from("client_status_history")
    .select("client_id, changed_by")
    .gte("changed_at", startIso)
    .in("new_status", SALE_STATUS_LIST);
  const clientIds = new Set((rows || []).filter((row) => String(row.changed_by || "").toLowerCase() === myEmail).map((row) => row.client_id));
  const count = clientIds.size;
  if (!count) return;
  const thresholds = (Array.isArray(trigger.config?.thresholds) ? trigger.config.thresholds : [5, 10, 15, 20]).slice().sort((a, b) => b - a);
  for (const threshold of thresholds) {
    if (count < threshold) continue;
    const logged = await logEvent(supabase, triggers, { brokerId, triggerKey: "sales_month_milestone", eventKey: `sales_month_milestone:${threshold}:${ym}`, name, n: threshold });
    if (logged) break;
  }
}

// Meta semanal e mensal (dono, 2026-10-30, opção B): soma do período FECHADO como a meta diária — prospecção e
// pendentes, cada um no seu teto, com compensação entre os dias (summarizePeriodGoal). Avaliada no 1º dia depois do
// período (segunda-feira / dia 1): pelo fechamento do dia (recordClosedPeriodGoals) e, por garantia, no acesso do
// corretor. Os pendentes de cada dia ficam em daily_goals.pending_done/pending_total (migration
// 20261030120000); sem ela, ou em dia anterior a ela, só a prospecção entra — nunca quebra.
async function loadClosedGoalRows(supabase, range, brokerId = null) {
  const run = (columns) => {
    let query = supabase
      .from("daily_goals")
      .select(columns)
      .gte("goal_date", range.start)
      .lte("goal_date", range.end)
      .not("closed_at", "is", null);
    if (brokerId) query = query.eq("broker_id", brokerId);
    return query;
  };
  const withPending = await run("broker_id, goal_date, done_count, total_due, pending_done, pending_total");
  if (!withPending.error) return withPending.data || [];
  if (!isMissingSchemaError(withPending.error)) throw withPending.error;
  const legacy = await run("broker_id, goal_date, done_count, total_due");
  if (legacy.error) throw legacy.error;
  return legacy.data || [];
}

async function detectPeriodGoalMet(supabase, triggers, { brokerId, name, today }) {
  for (const kind of ["week", "month"]) {
    const range = closedPeriodRange(kind, today);
    if (!range || !triggers.get(range.triggerKey)?.enabled) continue;
    const rows = await loadClosedGoalRows(supabase, range, brokerId);
    if (summarizePeriodGoal(rows).met) {
      await logEvent(supabase, triggers, { brokerId, triggerKey: range.triggerKey, eventKey: range.eventKey, name });
    }
  }
}

// Fechamento do dia (cron daily-goal-close, 03:01 de segunda / dia 1): avalia o período que acabou de fechar para
// TODOS os corretores ativos; o evento fica pendente até a próxima abertura do CRM de cada um.
export async function recordClosedPeriodGoals() {
  if (!hasSupabaseAdminConfig) return { skipped: true, reason: "no-supabase" };
  const supabase = db();
  const triggers = await loadTriggersMap(supabase);
  const today = todaySP();
  const result = {};
  for (const kind of ["week", "month"]) {
    const range = closedPeriodRange(kind, today);
    if (!range || !triggers.get(range.triggerKey)?.enabled) continue;
    const rows = await loadClosedGoalRows(supabase, range);
    const byBroker = new Map();
    for (const row of rows) {
      if (!byBroker.has(row.broker_id)) byBroker.set(row.broker_id, []);
      byBroker.get(row.broker_id).push(row);
    }
    const metIds = [...byBroker.entries()].filter(([, brokerRows]) => summarizePeriodGoal(brokerRows).met).map(([id]) => id);
    let logged = 0;
    if (metIds.length) {
      const { data: profiles, error } = await supabase.from("admin_users").select("id, name").in("id", metIds).eq("status", "active");
      if (error) throw error;
      for (const profile of profiles || []) {
        if (await logEvent(supabase, triggers, { brokerId: profile.id, triggerKey: range.triggerKey, eventKey: range.eventKey, name: firstName(profile.name) })) logged += 1;
      }
    }
    result[kind] = { start: range.start, end: range.end, met: metIds.length, logged };
  }
  return result;
}

async function detectMcmvStages(supabase, triggers, { brokerId, name, today, myEmail }) {
  const startIso = zonedPlainDateToUtcIso(today);
  for (const [triggerKey, status] of [["mcmv_approved", "approved"], ["mcmv_contract", "sale_contract"]]) {
    const trigger = triggers.get(triggerKey);
    if (!trigger?.enabled) continue;
    const { data: rows } = await supabase
      .from("client_status_history")
      .select("id, changed_by")
      .eq("new_status", status)
      .gte("changed_at", startIso);
    for (const row of rows || []) {
      if (String(row.changed_by || "").toLowerCase() !== myEmail) continue;
      await logEvent(supabase, triggers, { brokerId, triggerKey, eventKey: `${triggerKey}:${row.id}`, name });
    }
  }

  const keysTrigger = triggers.get("mcmv_keys");
  if (keysTrigger?.enabled) {
    const { data: rows } = await supabase
      .from("simulation_registrations")
      .select("id, keys_delivered_at")
      .eq("responsible_user_id", brokerId)
      .gte("keys_delivered_at", startIso);
    for (const row of rows || []) {
      await logEvent(supabase, triggers, { brokerId, triggerKey: "mcmv_keys", eventKey: `mcmv_keys:${row.id}`, name });
    }
  }
}

async function detectRankClimb(supabase, triggers, { brokerId, name, today }) {
  const trigger = triggers.get("rank_climb");
  if (!trigger?.enabled) return;
  const startHour = Number(trigger.config?.startHour ?? 12);
  if (nowMinutesSP() < startHour * 60) return;

  const overview = await getCachedTodayOverviewForRanking();
  const ranking = overview?.ranking || [];
  const me = ranking.find((row) => row.profile.id === brokerId);
  if (!me || ranking.length < 2) return;
  const average = ranking.reduce((sum, row) => sum + (row.points || 0), 0) / ranking.length;
  if (me.points > average) {
    await logEvent(supabase, triggers, { brokerId, triggerKey: "rank_climb", eventKey: `rank_climb:${today}`, name });
  }
}

async function detectBirthdayAndAnniversary(supabase, triggers, { brokerId, name, today }) {
  const birthdayTrigger = triggers.get("birthday");
  const anniversaryTrigger = triggers.get("work_anniversary");
  if (!birthdayTrigger?.enabled && !anniversaryTrigger?.enabled) return;

  const { data: profile } = await supabase.from("admin_users").select("birth_date, hired_at").eq("id", brokerId).maybeSingle();
  if (!profile) return;
  const [, month, day] = today.split("-");
  const year = today.slice(0, 4);

  if (birthdayTrigger?.enabled && profile.birth_date) {
    const [, bMonth, bDay] = profile.birth_date.split("-");
    if (bMonth === month && bDay === day) {
      await logEvent(supabase, triggers, { brokerId, triggerKey: "birthday", eventKey: `birthday:${year}`, name });
    }
  }

  if (anniversaryTrigger?.enabled && profile.hired_at) {
    const [hYear, hMonth, hDay] = profile.hired_at.split("-");
    if (hMonth === month && hDay === day && Number(year) > Number(hYear)) {
      await logEvent(supabase, triggers, { brokerId, triggerKey: "work_anniversary", eventKey: `work_anniversary:${year}`, name });
    }
  }
}

// Roda todos os detectores do próprio corretor (cada um isolado — um erro
// num gatilho não derruba os demais) e devolve os eventos ainda não vistos,
// em ordem de prioridade (meta > ranking > demais).
export async function evaluateAndListPendingCelebrations(auth) {
  if (!auth?.ok || !auth?.profile?.id) throw new Error("Usuário sem perfil ativo.");
  if (!hasSupabaseAdminConfig) return [];

  const supabase = db();
  const brokerId = auth.profile.id;
  const name = firstName(auth.profile.name);
  const myEmail = String(auth.user?.email || "").toLowerCase();
  const today = todaySP();
  const triggers = await loadTriggersMap(supabase);

  const context = { brokerId, name, auth, today, myEmail };
  const safeRun = async (fn) => {
    try {
      return await fn();
    } catch (error) {
      console.error("Reconhecimentos: falha num detector.", error);
      return null;
    }
  };

  const goal = await safeRun(() => detectDailyGoalMilestones(supabase, triggers, context));
  await Promise.all([
    safeRun(() => detectGoalStreak(supabase, triggers, { ...context, goal })),
    safeRun(() => detectRankingStreak(supabase, triggers, context)),
    safeRun(() => detectPersonalRecord(supabase, triggers, { ...context, goal })),
    safeRun(() => detectFirstOfDay(supabase, triggers, context)),
    safeRun(() => detectSalesMonthMilestone(supabase, triggers, context)),
    safeRun(() => detectPeriodGoalMet(supabase, triggers, context)),
    safeRun(() => detectMcmvStages(supabase, triggers, context)),
    safeRun(() => detectRankClimb(supabase, triggers, context)),
    safeRun(() => detectBirthdayAndAnniversary(supabase, triggers, context))
  ]);

  const { data: pending, error } = await supabase
    .from("broker_celebration_events")
    .select("id, trigger_key, event_key, message, animation, created_at")
    .eq("broker_id", brokerId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) throw error;

  // event_date: data real do reconhecimento (a cena mostra "Hoje" só se for de hoje); event_key não sai do servidor.
  return (pending || [])
    .map(({ event_key: eventKey, ...row }) => ({ ...row, event_date: recognitionEventDate({ ...row, event_key: eventKey }), priority: PRIORITY_BY_KEY[row.trigger_key] ?? 3 }))
    .sort((a, b) => a.priority - b.priority || new Date(a.created_at) - new Date(b.created_at));
}

export async function markCelebrationShown(auth, eventId) {
  if (!auth?.ok || !auth?.profile?.id) throw new Error("Usuário sem perfil ativo.");
  const supabase = db();
  const { error } = await supabase
    .from("broker_celebration_events")
    .update({ status: "shown", shown_at: new Date().toISOString() })
    .eq("id", eventId)
    .eq("broker_id", auth.profile.id);
  if (error) throw error;
  return true;
}

// ---------- cron: 1º lugar do ranking (acompanha continuidade no tempo) ----------

// Líder do ranking do dia (o MESMO `dailyRankingLeader` do "assumiu o 1º lugar"), regravado a cada tick: o último
// registro de cada dia é o fechamento. Dia sem líder qualificado grava null (a sequência quebra). Tabela ausente
// (migration não aplicada): ignora.
async function recordDailyLeader(supabase, triggers) {
  if (!triggers.get("ranking_streak")?.enabled) return;
  const overview = await getCachedTodayOverviewForRanking();
  const leader = dailyRankingLeader(overview?.ranking || []);
  const minResult = Number(triggers.get("ranking_no1")?.config?.minResult ?? 1);
  const leaderId = leader && leader.points >= minResult ? leader.profile.id : null;
  const { error } = await supabase.from("celebration_daily_leaders").upsert(
    { day: todaySP(), leader_broker_id: leaderId, points: leader?.points ?? 0, recorded_at: new Date().toISOString() },
    { onConflict: "day" }
  );
  if (error && !isMissingSchemaError(error)) throw error;
}

export async function runCelebrationRankingTick() {
  if (!hasSupabaseAdminConfig) return { skipped: true, reason: "no-supabase" };
  const supabase = db();
  const triggers = await loadTriggersMap(supabase);
  // Grava o líder do dia (base da "liderança em sequência"); o último registro do dia é o fechamento. Nunca derruba o tick.
  try {
    await recordDailyLeader(supabase, triggers);
  } catch (error) {
    console.error("Falha ao registrar o líder do dia.", error?.message || error);
  }
  const trigger = triggers.get("ranking_no1");
  if (!trigger?.enabled) return { skipped: true, reason: "disabled" };

  const today = todaySP();
  const minutesNow = nowMinutesSP();
  const startHour = Number(trigger.config?.startHour ?? 12);
  if (minutesNow < startHour * 60) return { skipped: true, reason: "before-start-hour" };

  const overview = await getCachedTodayOverviewForRanking();
  const leader = dailyRankingLeader(overview?.ranking || []);
  const minResult = Number(trigger.config?.minResult ?? 1);
  const leaderId = leader && leader.points >= minResult ? leader.profile.id : null;

  const { data: state } = await supabase.from("celebration_ranking_lead_state").select("*").eq("id", 1).maybeSingle();
  const nowIso = new Date().toISOString();

  if (!leaderId) {
    await supabase.from("celebration_ranking_lead_state").update({ leader_broker_id: null, leading_since: null, updated_at: nowIso }).eq("id", 1);
    return { skipped: true, reason: "no-qualifying-leader" };
  }

  // Liderança de um dia anterior não conta para o tempo mínimo de hoje (lib/celebrations-ranking-core.mjs).
  const { leadingSince, changed } = resolveLeadingSince({ state, leaderId, nowIso, today });
  if (changed) {
    await supabase.from("celebration_ranking_lead_state").update({ leader_broker_id: leaderId, leading_since: leadingSince, updated_at: nowIso }).eq("id", 1);
  }

  const holdMinutes = Number(trigger.config?.holdMinutes ?? 10);
  const heldMs = Date.now() - new Date(leadingSince).getTime();
  if (heldMs < holdMinutes * 60000) return { skipped: true, reason: "not-long-enough", heldMinutes: Math.floor(heldMs / 60000) };

  const turnKey = computeTurnKey(today, minutesNow, trigger.config?.turnBoundaries);
  if (state?.notified_broker_id === leaderId && state?.notified_turn_key === turnKey) {
    return { skipped: true, reason: "already-notified-this-turn" };
  }

  const logged = await logEvent(supabase, triggers, {
    brokerId: leaderId,
    triggerKey: "ranking_no1",
    eventKey: `ranking_no1:${turnKey}`,
    name: firstName(leader.profile.name)
  });
  if (logged) {
    await supabase.from("celebration_ranking_lead_state").update({ notified_broker_id: leaderId, notified_turn_key: turnKey, updated_at: nowIso }).eq("id", 1);
  }
  return { ok: true, leaderId, turnKey, logged: Boolean(logged) };
}

// ---------- painel admin (Automações > Incentivo) ----------

export async function listCelebrationTriggers(auth) {
  assertGeneralAdminOrManager(auth);
  const supabase = db();
  const { data, error } = await supabase.from("celebration_triggers").select("*").neq("key", "manual").order("key");
  if (error) throw error;
  const byKey = new Map((data || []).map((row) => [row.key, row]));
  return CELEBRATION_TRIGGER_DEFINITIONS.map((def) => {
    const row = byKey.get(def.key);
    return { ...def, enabled: row?.enabled ?? true, config: row?.config ?? {}, animationMode: row?.animation_mode ?? "random" };
  });
}

export async function updateCelebrationTrigger(key, { enabled, config, animationMode } = {}, auth) {
  assertGeneralAdminOrManager(auth);
  if (!TRIGGER_KEYS.has(key)) throw new Error("Gatilho inválido.");
  const patch = { updated_at: new Date().toISOString(), updated_by: auth?.profile?.id || null };
  if (enabled !== undefined) patch.enabled = Boolean(enabled);
  if (config !== undefined) patch.config = config;
  if (animationMode !== undefined) {
    if (!["random", "confete", "fogos", "moedas", "coroa"].includes(animationMode)) throw new Error("Animação inválida.");
    patch.animation_mode = animationMode;
  }
  const supabase = db();
  const { error } = await supabase.from("celebration_triggers").update(patch).eq("key", key);
  if (error) throw error;
  return listCelebrationTriggers(auth);
}

function validateTemplateText(template) {
  const trimmed = String(template || "").trim();
  if (!trimmed) throw new Error("O texto não pode ficar vazio.");
  if (trimmed.length > 140) throw new Error("O texto deve ter no máximo 140 caracteres.");
  return trimmed;
}

export async function listMessageTemplates(auth) {
  assertGeneralAdminOrManager(auth);
  const supabase = db();
  const { data, error } = await supabase
    .from("celebration_message_templates")
    .select("*")
    .neq("trigger_key", "manual")
    .order("trigger_key")
    .order("created_at");
  if (error) throw error;
  return data || [];
}

export async function createMessageTemplate(auth, { triggerKey, template }) {
  assertGeneralAdminOrManager(auth);
  if (!TRIGGER_KEYS.has(triggerKey)) throw new Error("Gatilho inválido.");
  const text = validateTemplateText(template);
  const supabase = db();
  const { data, error } = await supabase
    .from("celebration_message_templates")
    .insert({ trigger_key: triggerKey, template: text, active: true, is_default: false })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMessageTemplate(auth, id, { template, active } = {}) {
  assertGeneralAdminOrManager(auth);
  const patch = { updated_at: new Date().toISOString() };
  if (template !== undefined) patch.template = validateTemplateText(template);
  if (active !== undefined) patch.active = Boolean(active);
  const supabase = db();
  const { data, error } = await supabase.from("celebration_message_templates").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteMessageTemplate(auth, id) {
  assertGeneralAdminOrManager(auth);
  const supabase = db();
  const { data: row } = await supabase.from("celebration_message_templates").select("is_default").eq("id", id).maybeSingle();
  if (row?.is_default) throw new Error("Textos padrão não podem ser excluídos — use desativar ou 'Restaurar padrão'.");
  const { error } = await supabase.from("celebration_message_templates").delete().eq("id", id);
  if (error) throw error;
  return true;
}

export async function restoreDefaultTemplates(auth, triggerKey) {
  assertGeneralAdminOrManager(auth);
  if (!TRIGGER_KEYS.has(triggerKey)) throw new Error("Gatilho inválido.");
  const supabase = db();
  const { error: deactivateError } = await supabase
    .from("celebration_message_templates")
    .update({ active: false })
    .eq("trigger_key", triggerKey)
    .eq("is_default", false);
  if (deactivateError) throw deactivateError;
  const { error: restoreError } = await supabase
    .from("celebration_message_templates")
    .update({ active: true })
    .eq("trigger_key", triggerKey)
    .eq("is_default", true);
  if (restoreError) throw restoreError;
  return listMessageTemplates(auth);
}

export async function createManualCelebration(auth, { brokerId, templateId, freeText, animation } = {}) {
  assertGeneralAdminOrManager(auth);
  if (!brokerId) throw new Error("Selecione um corretor.");
  const supabase = db();

  let triggerKey = "manual";
  let resolvedTemplateId = null;
  let message = "";

  if (templateId) {
    const { data: tmpl, error } = await supabase
      .from("celebration_message_templates")
      .select("id, trigger_key, template")
      .eq("id", templateId)
      .maybeSingle();
    if (error) throw error;
    if (!tmpl) throw new Error("Mensagem não encontrada.");
    triggerKey = tmpl.trigger_key;
    resolvedTemplateId = tmpl.id;
    message = tmpl.template;
  } else {
    message = validateTemplateText(freeText);
  }

  const { data: broker, error: brokerError } = await supabase.from("admin_users").select("id, name").eq("id", brokerId).maybeSingle();
  if (brokerError) throw brokerError;
  if (!broker) throw new Error("Corretor não encontrado.");
  message = resolveMessage(message, { name: firstName(broker.name) });

  const animationValue = triggerKey === "daily_goal_200" ? "combo_200" : (animation || "confete");
  if (!["confete", "fogos", "moedas", "coroa", "combo_200"].includes(animationValue)) throw new Error("Animação inválida.");

  const { error } = await supabase.from("broker_celebration_events").insert({
    broker_id: brokerId,
    trigger_key: triggerKey,
    event_key: `manual:${randomUUID()}`,
    template_id: resolvedTemplateId,
    message,
    animation: animationValue,
    source: "manual",
    created_by: auth?.profile?.id || null
  });
  if (error) throw error;
  return true;
}

export async function listCelebrationHistory(auth, { brokerId, startDate, endDate, limit = 100 } = {}) {
  assertGeneralAdminOrManager(auth);
  const supabase = db();
  let query = supabase
    .from("broker_celebration_events")
    .select("id, broker_id, trigger_key, message, animation, source, status, created_at, shown_at, broker:admin_users!broker_celebration_events_broker_id_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (brokerId) query = query.eq("broker_id", brokerId);
  if (startDate) query = query.gte("created_at", zonedPlainDateToUtcIso(startDate));
  if (endDate) query = query.lt("created_at", zonedPlainDateToUtcIso(addDaysToPlainDate(endDate, 1)));

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => ({
    ...row,
    brokerName: row.broker?.name || "Corretor",
    triggerLabel: LABEL_BY_KEY.get(row.trigger_key) || (row.trigger_key === "manual" ? "Disparo manual" : row.trigger_key)
  }));
}
