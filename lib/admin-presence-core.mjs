// Puro (sem banco, sem "server-only") — regras de presença testáveis em
// tests/admin-presence-core.test.mjs.
//
// Duas leituras da mesma atividade, de propósito separadas (regra do dono,
// 2026-10-01, ROL-2b em docs/BUSINESS_RULES.md):
//   - ROLETA (elegibilidade): `admin_presence.last_activity_at` = hora REAL da
//     última atividade no CRM (clique, tecla, clique no WhatsApp, envio pelo
//     Chat). On-line = até 5 min depois disso, sem nenhuma extensão.
//     pick_round_robin_broker (SQL) lê essa coluna direto.
//   - VISUAL (painel Online, seletor 🟢 do Chat, painel da roleta): mantém a
//     tolerância que já existia depois de uma ação de WhatsApp — uma marca
//     `kind='grace'` em admin_presence_activity conta como atividade até
//     GRACE_EXTENSION_MS depois do minuto em que aconteceu. Isso preserva o
//     comportamento visual de antes sem gravar hora no futuro na coluna que a
//     roleta usa.

export const PRESENCE_STATUS = { ONLINE: "online", AWAY: "away", OFFLINE: "offline" };
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;
export const AWAY_WINDOW_MS = 30 * 60 * 1000;
export const GRACE_EXTENSION_MS = 5 * 60 * 1000;

function toMs(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
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

// Referência usada SÓ para o status visual: a mais recente entre a atividade
// real e (última marca de tolerância + extensão). Devolve ISO ou null.
export function visualActivityReference(lastActivityAt, lastGraceMinuteAt) {
  const realMs = toMs(lastActivityAt);
  const graceMs = toMs(lastGraceMinuteAt);
  const best = Math.max(realMs, graceMs ? graceMs + GRACE_EXTENSION_MS : 0);
  return best ? new Date(best).toISOString() : null;
}

export function deriveVisualStatus(lastActivityAt, lastGraceMinuteAt, now) {
  return deriveStatus(visualActivityReference(lastActivityAt, lastGraceMinuteAt), now);
}

// ---------------------------------------------------------------------------
// Presença pertence SÓ ao usuário REAL da sessão (regra do dono, 2026-10-04).
// Durante "Alterar conta" (auth.accountSwitchMode) o perfil efetivo
// (auth.profile) é o do corretor EMULADO; ele não pode receber presença, tempo
// online/pontos nem ficar elegível na roleta por causa do navegador do admin.
// Nesse modo o sinal é carimbado no admin REAL (auth.realProfile) — quem de
// fato está na frente da tela. Ações operacionais (tentativa, atendimento)
// continuam atribuídas ao emulado por outros caminhos; isto vale só para o
// carimbo de presença. Devolve "" quando não há perfil real com id.
export function resolvePresenceProfileId(auth) {
  if (!auth?.ok) return "";
  const profile = auth.accountSwitchMode ? auth.realProfile : auth.profile;
  return profile?.id || "";
}

// Grava presença (admin_presence + marca do minuto em admin_presence_activity)
// com um cliente Supabase injetado — separado de lib/admin-presence.js (que é
// "server-only") para ser testável sem banco. `warn` recebe falhas do
// histórico (best-effort: a presença em si nunca depende da tabela de minutos).
export async function writePresenceSignal(client, userId, { grace = false, nowMs = Date.now(), warn = () => {} } = {}) {
  const now = new Date(nowMs).toISOString();

  const { error } = await client
    .from("admin_presence")
    .upsert({ user_id: userId, last_activity_at: now, updated_at: now }, { onConflict: "user_id" });
  if (error) throw error;

  try {
    const minuteAt = new Date(Math.floor(nowMs / 60000) * 60000).toISOString();
    const { error: activityError } = await client
      .from("admin_presence_activity")
      .upsert(
        { user_id: userId, minute_at: minuteAt, kind: grace ? "grace" : "interaction" },
        grace ? { onConflict: "user_id,minute_at" } : { onConflict: "user_id,minute_at", ignoreDuplicates: true }
      );
    if (activityError) warn("Histórico de presença indisponível:", activityError.message);
  } catch (activityError) {
    warn("Histórico de presença indisponível:", activityError?.message || activityError);
  }
}

// Texto relativo da última atividade ("Última atividade há 5 min / 1h / 1 dia").
// Sempre PISO (nunca arredonda para cima): 90 min = "há 1h"; 36 h = "há 1 dia".
export function formatRelativeActivityText(status, lastActivityAt, now = Date.now()) {
  if (!lastActivityAt) return "Sem atividade registrada";
  if (status === PRESENCE_STATUS.ONLINE) return "Ativo agora";

  const elapsedMs = now - new Date(lastActivityAt).getTime();
  const minutes = Math.max(1, Math.floor(elapsedMs / 60000));
  if (minutes < 60) return `Última atividade há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Última atividade há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Última atividade há ${days} dia${days > 1 ? "s" : ""}`;
}

// ---------------------------------------------------------------------------
// Relatório "Horas no CRM" (Desempenho > Online) — regras puras, testadas em
// tests/admin-presence-report.test.mjs. lib/admin-presence.js só busca o
// banco e converte as datas em limites UTC (zonedPlainDateToUtcIso).
// ---------------------------------------------------------------------------

const IDLE_LIMIT_MIN = 5;
const GRACE_IDLE_LIMIT_MIN = 10;
const OFFLINE_GAP_MIN = 30;
const REPORT_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

export const PRESENCE_REPORT_PERIODS = ["today", "yesterday", "last_week", "month", "custom"];

const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function shiftPlainDate(plainDate, amount) {
  const [year, month, day] = plainDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

// Período em datas de calendário de São Paulo (inclusive nas duas pontas).
// `today` = data de hoje em São Paulo (getTodayInSaoPaulo).
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-12] "Semana passada" = a última
// semana FECHADA, de segunda a domingo (hoje, seg 12/10 → 05/10 a 11/10; num
// domingo, a semana que terminou no domingo anterior). Substituiu "Esta
// semana" (segunda a SÁBADO da semana corrente: na segunda de manhã mostrava
// tudo zerado e o domingo nunca entrava em semana nenhuma).
export function resolvePresencePeriodDates(today, params = {}) {
  const period = PRESENCE_REPORT_PERIODS.includes(params.period) ? params.period : "today";
  let startDate = today;
  let endDate = today;

  if (period === "yesterday") {
    startDate = shiftPlainDate(today, -1);
    endDate = startDate;
  } else if (period === "last_week") {
    const [year, month, day] = today.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const thisMonday = shiftPlainDate(today, weekday === 0 ? -6 : 1 - weekday);
    startDate = shiftPlainDate(thisMonday, -7);
    endDate = shiftPlainDate(thisMonday, -1);
  } else if (period === "month") {
    startDate = `${today.slice(0, 8)}01`;
  } else if (period === "custom") {
    const start = String(params.startDate || "").trim();
    const end = String(params.endDate || "").trim();
    startDate = PLAIN_DATE_RE.test(start) ? start : today;
    endDate = PLAIN_DATE_RE.test(end) ? end : startDate;
    if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  }

  return { period, startDate, endDate };
}

// Tempo online/ausente de UM usuário, por dia (São Paulo), a partir das marcas
// de minuto. Regra: entre duas marcas seguidas do mesmo dia, até 5 min de
// lacuna (10 após um "grace") conta como online contínuo; o excedente até 30
// min de lacuna conta como ausente; acima de 30 min é pausa/offline e não
// conta. Depois da última marca do dia entra só a tolerância de inatividade
// (limitada ao "agora"). Os tempos são em minutos.
export function computeDailyPresence(rows, nowMs) {
  const byDay = new Map();
  for (const row of rows) {
    const day = REPORT_DAY_FORMATTER.format(new Date(row.minute_at));
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

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-12] Contatos do relatório
// separados em MANUAIS (feitos pelo corretor) e AUTOMÁTICOS (envios da
// automação da Meta Diária), mantendo o total. Fonte: daily_goal_attempts
// (`origin = 'auto'` = automação; qualquer outro valor = manual, o padrão da
// coluna). Devolve Map "userId|AAAA-MM-DD" -> { total, manual, auto }.
export function tallyAttemptContacts(rows) {
  const byUserDay = new Map();
  for (const row of rows || []) {
    const key = `${row.broker_id}|${row.goal_date}`;
    const entry = byUserDay.get(key) || { total: 0, manual: 0, auto: 0 };
    entry.total += 1;
    if (row.origin === "auto") entry.auto += 1;
    else entry.manual += 1;
    byUserDay.set(key, entry);
  }
  return byUserDay;
}

// Ordem da lista: mais tempo online primeiro; empate (ex.: "Hoje" cedo, todos
// com 0) por contatos e depois por nome — nunca a ordem acidental do cadastro.
export function compareReportMembers(a, b) {
  return (b.activeMinutes - a.activeMinutes)
    || ((b.contacts || 0) - (a.contacts || 0))
    || String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
}

// Monta a lista do relatório (um item por perfil visível). `attemptRows`
// null = a busca de contatos FALHOU: contatos ficam null (nunca 0) para a
// tela mostrar o aviso em vez de um zero falso.
export function buildPresenceReportMembers(profiles, activityRows, attemptRows, nowMs) {
  const activityByUser = new Map();
  for (const row of activityRows || []) {
    if (!activityByUser.has(row.user_id)) activityByUser.set(row.user_id, []);
    activityByUser.get(row.user_id).push(row);
  }
  const contactsAvailable = Array.isArray(attemptRows);
  const contactsByUserDay = contactsAvailable ? tallyAttemptContacts(attemptRows) : new Map();
  const empty = { total: 0, manual: 0, auto: 0 };

  return profiles.map((profile) => {
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
    for (const day of days) {
      const tally = contactsAvailable ? contactsByUserDay.get(`${profile.id}|${day.date}`) || empty : null;
      day.contacts = tally ? tally.total : null;
      day.manualContacts = tally ? tally.manual : null;
      day.autoContacts = tally ? tally.auto : null;
    }

    const activeMinutes = days.reduce((sum, day) => sum + day.activeMinutes, 0);
    const awayMinutes = days.reduce((sum, day) => sum + day.awayMinutes, 0);
    const sumOf = (field) => (contactsAvailable ? days.reduce((sum, day) => sum + day[field], 0) : null);
    const daysWithPresence = days.filter((day) => day.activeMinutes > 0).length;

    return {
      id: profile.id,
      name: profile.name || profile.email || "Usuário",
      photoUrl: profile.photoUrl || "",
      activeMinutes,
      awayMinutes,
      contacts: sumOf("contacts"),
      manualContacts: sumOf("manualContacts"),
      autoContacts: sumOf("autoContacts"),
      daysWithPresence,
      averageActiveMinutesPerDay: daysWithPresence ? Math.round(activeMinutes / daysWithPresence) : 0,
      days
    };
  }).sort(compareReportMembers);
}
