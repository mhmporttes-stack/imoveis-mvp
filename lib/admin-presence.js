import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assertGeneralAdminOrManager } from "./admin-access";
import { listVisibleTeamProfiles } from "./admin-profiles";
import {
  addDaysToPlainDate,
  getTodayInSaoPaulo,
  normalizePlainDate,
  zonedPlainDateToUtcIso
} from "./daily-report";

export const PRESENCE_STATUS = { ONLINE: "online", AWAY: "away", OFFLINE: "offline" };

// Janelas de status — sempre DERIVADAS da idade de last_activity_at na hora
// da leitura, nunca de um evento de login/logout (fechar o navegador/PWA sem
// logout não pode manter alguém "online" para sempre). "Ausente" cobre quem
// ainda tem presença conhecida mas parou de interagir; depois da janela de
// ausência, cai para offline sozinho, sem depender de nenhum evento externo.
// Só INTERAÇÃO real (clique, tecla, rolagem, toque — ver
// components/AdminPresenceHeartbeat.jsx) gera heartbeat, então "online" =
// interagiu nos últimos 5 min; de 5 a 30 min = ausente; depois disso offline.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const AWAY_WINDOW_MS = 30 * 60 * 1000;
// Tolerância extra depois de clicar em WhatsApp / registrar um contato: o
// corretor sai do CRM para trabalhar no WhatsApp. last_activity_at é gravado
// 5 min NO FUTURO, o que estende o "online" para 10 min no total.
const GRACE_FUTURE_MS = 5 * 60 * 1000;

const STATUS_ORDER = { [PRESENCE_STATUS.ONLINE]: 0, [PRESENCE_STATUS.AWAY]: 1, [PRESENCE_STATUS.OFFLINE]: 2 };

export function canLoadAdminPresence() {
  return hasSupabaseAdminConfig;
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

function requireProfileId(auth) {
  const id = auth?.profile?.id;
  if (!auth?.ok || !id) throw new Error("Usuário sem perfil ativo.");
  return id;
}

export function deriveStatus(lastActivityAt, now) {
  if (!lastActivityAt) return PRESENCE_STATUS.OFFLINE;
  const elapsed = now - new Date(lastActivityAt).getTime();
  if (!Number.isFinite(elapsed)) return PRESENCE_STATUS.OFFLINE;
  if (elapsed < 0) return PRESENCE_STATUS.ONLINE;
  if (elapsed <= ONLINE_WINDOW_MS) return PRESENCE_STATUS.ONLINE;
  if (elapsed <= AWAY_WINDOW_MS) return PRESENCE_STATUS.AWAY;
  return PRESENCE_STATUS.OFFLINE;
}

// Chamado pelo heartbeat do navegador (components/AdminPresenceHeartbeat.jsx)
// SOMENTE quando houve interação real (nunca por timer ocioso). Atualiza a
// presença atual (1 linha por usuário, nunca retrocede um "grace" já gravado
// no futuro) e grava a marca do minuto no histórico usado pelo relatório de
// horas. Com grace=true (clique em WhatsApp / contato registrado) estende a
// tolerância de inatividade. A marca de histórico é best-effort: se a tabela
// ainda não existir, a presença continua funcionando normalmente.
export async function recordAdminHeartbeat(auth, { grace = false } = {}) {
  const userId = requireProfileId(auth);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const candidateMs = nowMs + (grace ? GRACE_FUTURE_MS : 0);

  const { data: current } = await db().from("admin_presence").select("last_activity_at").eq("user_id", userId).maybeSingle();
  const currentMs = current?.last_activity_at ? new Date(current.last_activity_at).getTime() : 0;
  const nextMs = Math.max(candidateMs, Number.isFinite(currentMs) ? currentMs : 0);

  const { error } = await db()
    .from("admin_presence")
    .upsert({ user_id: userId, last_activity_at: new Date(nextMs).toISOString(), updated_at: now }, { onConflict: "user_id" });
  if (error) throw error;

  try {
    const minuteAt = new Date(Math.floor(nowMs / 60000) * 60000).toISOString();
    const { error: activityError } = await db()
      .from("admin_presence_activity")
      .upsert(
        { user_id: userId, minute_at: minuteAt, kind: grace ? "grace" : "interaction" },
        grace ? { onConflict: "user_id,minute_at" } : { onConflict: "user_id,minute_at", ignoreDuplicates: true }
      );
    if (activityError) console.warn("Histórico de presença indisponível:", activityError.message);
  } catch (activityError) {
    console.warn("Histórico de presença indisponível:", activityError?.message || activityError);
  }
}

// Versão "à prova de falha" para rotas de negócio (WhatsApp, Meta Diária,
// prospecção): nunca pode quebrar a ação principal por causa da presença.
export async function recordAdminGrace(auth) {
  try {
    await recordAdminHeartbeat(auth, { grace: true });
  } catch (error) {
    console.warn("Falha ao registrar tolerância de presença:", error?.message || error);
  }
}

// Presença da equipe visível para quem pergunta — MESMA regra de
// visibilidade já usada no Ranking/Desempenho (listVisibleTeamProfiles):
// administrador geral vê todo mundo, gestor só a própria equipe. A lista de
// quem pode aparecer já sai filtrada antes de qualquer busca de presença —
// não há como pedir a presença de alguém fora desse escopo, mesmo chamando a
// API diretamente.
export async function getTeamPresence(auth) {
  assertGeneralAdminOrManager(auth);
  const profiles = await listVisibleTeamProfiles(auth);
  const ids = profiles.map((profile) => profile.id);
  if (!ids.length) return { online: 0, away: 0, offline: 0, members: [] };

  const { data, error } = await db().from("admin_presence").select("user_id, last_activity_at").in("user_id", ids);
  if (error) throw error;
  const lastActivityByUser = new Map((data || []).map((row) => [row.user_id, row.last_activity_at]));

  const now = Date.now();
  const members = profiles
    .map((profile) => {
      const lastActivityAt = lastActivityByUser.get(profile.id) || null;
      return {
        id: profile.id,
        name: profile.name || profile.email || "Usuário",
        photoUrl: profile.photoUrl || "",
        status: deriveStatus(lastActivityAt, now),
        lastActivityAt
      };
    })
    .sort((a, b) => {
      const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (orderDiff !== 0) return orderDiff;
      const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return bTime - aTime;
    });

  const counts = { online: 0, away: 0, offline: 0 };
  for (const member of members) counts[member.status] += 1;

  return { ...counts, members, generatedAt: new Date(now).toISOString() };
}

export function formatAdminPresenceError(error) {
  const message = error?.message || String(error || "");
  if (message.toLowerCase().includes("admin_presence")) {
    return "A tabela public.admin_presence ainda não existe no Supabase. Execute a migration supabase/migrations/20260916_admin_presence.sql.";
  }
  return message || "Não foi possível carregar a presença da equipe.";
}

// ---------------------------------------------------------------------------
// Relatório de horas no CRM
// ---------------------------------------------------------------------------

const IDLE_LIMIT_MIN = 5;
const GRACE_IDLE_LIMIT_MIN = 10;
const OFFLINE_GAP_MIN = 30;
const TIME_ZONE = "America/Sao_Paulo";
const DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
const FETCH_PAGE_SIZE = 1000;

async function fetchAllRows(buildQuery) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + FETCH_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < FETCH_PAGE_SIZE) break;
    from += FETCH_PAGE_SIZE;
  }
  return rows;
}

function isMissingTableError(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return text.includes("admin_presence_activity") || error?.code === "42P01" || error?.code === "PGRST205";
}

function weekdayOfPlainDate(plainDate) {
  const [year, month, day] = plainDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export const PRESENCE_REPORT_PERIODS = ["today", "yesterday", "week", "month", "custom"];

export function resolvePresenceRange(params = {}) {
  const today = getTodayInSaoPaulo();
  const period = PRESENCE_REPORT_PERIODS.includes(params.period) ? params.period : "today";
  let startDate = today;
  let endDate = today;

  if (period === "yesterday") {
    startDate = addDaysToPlainDate(today, -1);
    endDate = startDate;
  } else if (period === "week") {
    // Semana de trabalho: segunda a sábado (sábado meio período).
    const weekday = weekdayOfPlainDate(today);
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    startDate = addDaysToPlainDate(today, mondayOffset);
    endDate = addDaysToPlainDate(startDate, 5);
  } else if (period === "month") {
    startDate = `${today.slice(0, 8)}01`;
  } else if (period === "custom") {
    startDate = normalizePlainDate(params.startDate) || today;
    endDate = normalizePlainDate(params.endDate) || startDate;
    if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  }

  return {
    period,
    startDate,
    endDate,
    startIso: zonedPlainDateToUtcIso(startDate),
    endIso: zonedPlainDateToUtcIso(addDaysToPlainDate(endDate, 1))
  };
}

// Tempo online/ausente de UM usuário, por dia, a partir das marcas de minuto.
// Regra: entre duas marcas seguidas do mesmo dia, até 5 min de lacuna (10 após
// um "grace") conta como online contínuo; o excedente até 30 min de lacuna
// conta como ausente; acima de 30 min é pausa/offline e não conta. Depois da
// última marca do dia entra só a tolerância de inatividade (limitada ao
// "agora"). Os tempos são em minutos.
function computeDailyPresence(rows, nowMs) {
  const byDay = new Map();
  for (const row of rows) {
    const day = DAY_FORMATTER.format(new Date(row.minute_at));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ ms: new Date(row.minute_at).getTime(), kind: row.kind });
  }

  const days = [];
  for (const [date, marks] of byDay) {
    marks.sort((a, b) => a.ms - b.ms);
    let active = 0;
    let away = 0;
    for (let index = 0; index < marks.length; index += 1) {
      const current = marks[index];
      const allowed = current.kind === "grace" ? GRACE_IDLE_LIMIT_MIN : IDLE_LIMIT_MIN;
      const next = marks[index + 1];
      if (next) {
        const gap = Math.round((next.ms - current.ms) / 60000);
        active += Math.min(gap, allowed);
        if (gap > allowed) away += Math.min(gap, OFFLINE_GAP_MIN) - allowed;
      } else {
        const sinceMark = Math.max(0, Math.floor((nowMs - current.ms) / 60000));
        active += Math.min(allowed, sinceMark);
      }
    }
    days.push({
      date,
      activeMinutes: active,
      awayMinutes: away,
      firstAt: new Date(marks[0].ms).toISOString(),
      lastAt: new Date(marks[marks.length - 1].ms).toISOString()
    });
  }

  return days.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function getPresenceReport(params = {}, auth) {
  assertGeneralAdminOrManager(auth);
  const range = resolvePresenceRange(params);
  const profiles = await listVisibleTeamProfiles(auth);
  const ids = profiles.map((profile) => profile.id);
  if (!ids.length) return { ready: true, range, members: [] };

  let activityRows;
  try {
    activityRows = await fetchAllRows((from, to) => db()
      .from("admin_presence_activity")
      .select("user_id, minute_at, kind")
      .in("user_id", ids)
      .gte("minute_at", range.startIso)
      .lt("minute_at", range.endIso)
      .order("minute_at", { ascending: true })
      .range(from, to));
  } catch (error) {
    if (isMissingTableError(error)) return { ready: false, range, members: [] };
    throw error;
  }

  // Contatos realizados na Meta Diária no período (cruzamento com atividade
  // real: horas online sem contato nenhum é um sinal importante).
  let attemptRows = [];
  try {
    attemptRows = await fetchAllRows((from, to) => db()
      .from("daily_goal_attempts")
      .select("broker_id, goal_date")
      .in("broker_id", ids)
      .gte("goal_date", range.startDate)
      .lte("goal_date", range.endDate)
      .order("created_at", { ascending: true })
      .range(from, to));
  } catch {
    attemptRows = [];
  }

  const activityByUser = new Map();
  for (const row of activityRows) {
    if (!activityByUser.has(row.user_id)) activityByUser.set(row.user_id, []);
    activityByUser.get(row.user_id).push(row);
  }
  const contactsByUserDay = new Map();
  for (const row of attemptRows) {
    const key = `${row.broker_id}|${row.goal_date}`;
    contactsByUserDay.set(key, (contactsByUserDay.get(key) || 0) + 1);
  }

  const nowMs = Date.now();
  const members = profiles.map((profile) => {
    const days = computeDailyPresence(activityByUser.get(profile.id) || [], nowMs);
    const knownDates = new Set(days.map((day) => day.date));
    // Dias com contatos mas sem marca de presença também aparecem.
    for (const key of contactsByUserDay.keys()) {
      const [userId, date] = key.split("|");
      if (userId === profile.id && !knownDates.has(date)) {
        days.push({ date, activeMinutes: 0, awayMinutes: 0, firstAt: null, lastAt: null });
        knownDates.add(date);
      }
    }
    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const day of days) day.contacts = contactsByUserDay.get(`${profile.id}|${day.date}`) || 0;

    const activeMinutes = days.reduce((sum, day) => sum + day.activeMinutes, 0);
    const awayMinutes = days.reduce((sum, day) => sum + day.awayMinutes, 0);
    const contacts = days.reduce((sum, day) => sum + day.contacts, 0);
    const daysWithPresence = days.filter((day) => day.activeMinutes > 0).length;

    return {
      id: profile.id,
      name: profile.name || profile.email || "Usuário",
      photoUrl: profile.photoUrl || "",
      activeMinutes,
      awayMinutes,
      contacts,
      daysWithPresence,
      averageActiveMinutesPerDay: daysWithPresence ? Math.round(activeMinutes / daysWithPresence) : 0,
      days
    };
  }).sort((a, b) => b.activeMinutes - a.activeMinutes);

  return { ready: true, range: { period: range.period, startDate: range.startDate, endDate: range.endDate }, members };
}
