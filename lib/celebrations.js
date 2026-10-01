import "server-only";
import { randomUUID } from "crypto";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { getBrokerDailyGoal } from "./daily-goal";
import { getCachedTodayOverviewForRanking } from "./performance-overview";
import { dailyRankingLeader } from "./ranking-display.mjs";
import { zonedPlainDateToUtcIso, addDaysToPlainDate } from "./daily-report";

// Mensagens de reconhecimento com animação (pedido do dono, 2026-09-29):
// popup privado, só para o corretor que gerou o evento — nunca anunciado pro
// time. Reaproveita o padrão já usado na Mensagem do Dia (banco de textos
// editável + log com constraint única contra duplicidade), a Meta Diária
// (percent ao vivo) e o Ranking (cache de 90s) em vez de inventar mecanismo
// novo de detecção.

const TIME_ZONE = "America/Sao_Paulo";
const ANIMATIONS = ["confete", "fogos", "moedas", "coroa"];
const AUTOMATED_CHANGED_BY = new Set(["sistema", "automacao", "automação", "cron", "automation"]);
const SALE_STATUS_LIST = [
  "sale_forms", "sale_reservation", "sale_compliance", "sale_contract", "sale_caixa_signature",
  "sale_itbi", "sale_registry", "sale_payment", "sale_completed"
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
  { key: "goal_streak", label: "Sequência de dias batendo a meta", description: "Dias seguidos com a Meta Diária concluída.", configFields: [{ key: "thresholds", label: "Marcos (dias seguidos)", type: "list", default: [3, 5, 10] }] },
  { key: "personal_record", label: "Melhor dia pessoal (recorde)", description: "Produção de hoje superou o melhor dia anterior." },
  { key: "first_of_day", label: "Primeira ação do dia", description: "Primeiro atendimento/avanço de status do dia." },
  { key: "sales_month_milestone", label: "Marcos de vendas no mês", description: "Número de clientes que entraram em venda neste mês.", configFields: [{ key: "thresholds", label: "Marcos (vendas no mês)", type: "list", default: [5, 10, 15, 20] }] },
  { key: "weekly_goal_met", label: "Meta semanal batida", description: "Soma das metas diárias da semana (segunda a hoje) atingida." },
  { key: "monthly_goal_met", label: "Meta mensal batida", description: "Soma das metas diárias do mês atingida." },
  { key: "mcmv_approved", label: "Crédito aprovado", description: "Cliente passou para o status 'Cliente aprovado' hoje." },
  { key: "mcmv_contract", label: "Contrato assinado", description: "Cliente passou para o status 'Contrato' hoje." },
  { key: "mcmv_keys", label: "Chaves entregues", description: "Cliente marcado com chaves entregues hoje (marcação manual, sem botão dedicado ainda)." },
  { key: "rank_climb", label: "Superou a média do time", description: "Pontuação do dia acima da média do time (só depois do horário configurado).", configFields: [{ key: "startHour", label: "Horário de início (0-23)", type: "number", default: 12 }] },
  { key: "birthday", label: "Aniversário do corretor", description: "Depende de 'Data de nascimento' preenchida no cadastro do corretor." },
  { key: "work_anniversary", label: "Tempo de casa", description: "Depende de 'Data de admissão' preenchida no cadastro do corretor." }
];

const TRIGGER_KEYS = new Set(CELEBRATION_TRIGGER_DEFINITIONS.map((d) => d.key));
const LABEL_BY_KEY = new Map(CELEBRATION_TRIGGER_DEFINITIONS.map((d) => [d.key, d.label]));
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

function mondayOfWeek(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dow = date.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + diff);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
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

function resolveMessage(template, { name, n }) {
  let message = String(template || "").replace(/\[nome\]/g, name || "Corretor");
  if (n !== undefined && n !== null) message = message.replace(/\[N\]/g, String(n));
  return message;
}

// Insere o evento; devolve true se foi um disparo NOVO, null se já existia
// (mesmo marco, mesmo dia — inclusive reload/outro dispositivo) ou se o
// gatilho está desligado.
async function logEvent(supabase, triggersMap, { brokerId, triggerKey, eventKey, name, n, forcedAnimation }) {
  const trigger = triggersMap.get(triggerKey);
  if (!trigger?.enabled) return null;

  const template = await pickTemplate(supabase, triggerKey, brokerId);
  const animation = forcedAnimation || (await pickAnimation(supabase, trigger, brokerId, triggerKey));
  const message = template ? resolveMessage(template.template, { name, n }) : `Parabéns, ${name}! 🎉`;

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

async function detectDailyGoalMilestones(supabase, triggers, { brokerId, name, auth, today }) {
  const goal = await getBrokerDailyGoal(auth);
  const percent = Number(goal?.percent) || 0;
  const order = [
    ["daily_goal_200", 200, "combo_200"],
    ["daily_goal_150", 150, null],
    ["daily_goal_100", 100, null]
  ];
  for (const [key, defaultThreshold, forcedAnimation] of order) {
    const trigger = triggers.get(key);
    if (!trigger?.enabled) continue;
    const threshold = Number(trigger.config?.threshold) || defaultThreshold;
    if (percent < threshold) continue;
    const logged = await logEvent(supabase, triggers, { brokerId, triggerKey: key, eventKey: `${key}:${today}`, name, forcedAnimation });
    if (logged) break; // pulou marcos de uma vez: mostra só o mais alto
  }
  return goal;
}

async function detectGoalStreak(supabase, triggers, { brokerId, name }) {
  const trigger = triggers.get("goal_streak");
  if (!trigger?.enabled) return;
  const { data: rows } = await supabase
    .from("daily_goals")
    .select("goal_date, goal_met, closed_at")
    .eq("broker_id", brokerId)
    .not("closed_at", "is", null)
    .order("goal_date", { ascending: false })
    .limit(30);
  let streak = 0;
  for (const row of rows || []) {
    if (row.goal_met) streak += 1;
    else break;
  }
  const streakEndDate = rows?.[0]?.goal_date;
  if (!streakEndDate || streak <= 0) return;
  const thresholds = (Array.isArray(trigger.config?.thresholds) ? trigger.config.thresholds : [3, 5, 10]).slice().sort((a, b) => b - a);
  for (const threshold of thresholds) {
    if (streak < threshold) continue;
    const logged = await logEvent(supabase, triggers, { brokerId, triggerKey: "goal_streak", eventKey: `goal_streak:${threshold}:${streakEndDate}`, name, n: threshold });
    if (logged) break;
  }
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

async function detectPeriodGoalMet(supabase, triggers, { brokerId, name, today }) {
  const weeklyTrigger = triggers.get("weekly_goal_met");
  const monthlyTrigger = triggers.get("monthly_goal_met");
  if (!weeklyTrigger?.enabled && !monthlyTrigger?.enabled) return;

  const monthStart = `${yearMonthOf(today)}-01`;
  const periodStart = weeklyTrigger?.enabled ? mondayOfWeek(today) : monthStart;
  const rangeStart = monthlyTrigger?.enabled && periodStart > monthStart ? monthStart : periodStart;

  const { data: rows } = await supabase
    .from("daily_goals")
    .select("goal_date, done_count, total_due, closed_at")
    .eq("broker_id", brokerId)
    .gte("goal_date", rangeStart)
    .lte("goal_date", today)
    .not("closed_at", "is", null);

  if (weeklyTrigger?.enabled) {
    const weekStart = mondayOfWeek(today);
    const weekRows = (rows || []).filter((row) => row.goal_date >= weekStart);
    const sumDone = weekRows.reduce((a, r) => a + (r.done_count || 0), 0);
    const sumQuota = weekRows.reduce((a, r) => a + (r.total_due || 0), 0);
    if (sumQuota > 0 && sumDone >= sumQuota) {
      await logEvent(supabase, triggers, { brokerId, triggerKey: "weekly_goal_met", eventKey: `weekly_goal_met:${weekStart}`, name });
    }
  }

  if (monthlyTrigger?.enabled) {
    const monthRows = (rows || []).filter((row) => row.goal_date >= monthStart);
    const sumDone = monthRows.reduce((a, r) => a + (r.done_count || 0), 0);
    const sumQuota = monthRows.reduce((a, r) => a + (r.total_due || 0), 0);
    if (sumQuota > 0 && sumDone >= sumQuota) {
      await logEvent(supabase, triggers, { brokerId, triggerKey: "monthly_goal_met", eventKey: `monthly_goal_met:${yearMonthOf(today)}`, name });
    }
  }
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
    safeRun(() => detectGoalStreak(supabase, triggers, context)),
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
    .select("id, trigger_key, message, animation, created_at")
    .eq("broker_id", brokerId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) throw error;

  return (pending || [])
    .map((row) => ({ ...row, priority: PRIORITY_BY_KEY[row.trigger_key] ?? 3 }))
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

export async function runCelebrationRankingTick() {
  if (!hasSupabaseAdminConfig) return { skipped: true, reason: "no-supabase" };
  const supabase = db();
  const triggers = await loadTriggersMap(supabase);
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

  let leadingSince = state?.leading_since;
  if (state?.leader_broker_id !== leaderId) {
    leadingSince = nowIso;
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
