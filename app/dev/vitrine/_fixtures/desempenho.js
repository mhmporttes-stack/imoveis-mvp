// Desempenho — fixtures 100% fictícias para a vitrine (somente `next dev`).
// Formato exato de getPerformanceOverview / getPerformanceTrend
// (lib/performance-overview.js), respostas de /api/performance-overview
// ({ overview }) e /api/performance-overview/trend ({ trend }).
// Nenhum dado vem do banco: os números saem de um gerador determinístico por
// corretor/dia, então qualquer período (hoje, 7 dias, este mês, personalizado)
// e o gráfico histórico ficam coerentes entre si.
//
// Mesma equipe fictícia da fixture de Meta Diária (Marília/SP):
// Ana (adiantada), Bruno (no ritmo), Carla (offline hoje), Diego (muito atrás),
// Elisa (nova, zero atividade).

const TZ = "America/Sao_Paulo";

function todayInSaoPaulo(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(plainDate, amount) {
  const [y, m, d] = plainDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + amount)).toISOString().slice(0, 10);
}

function addMonths(plainDate, amount) {
  const [y, m] = plainDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + amount, 1)).toISOString().slice(0, 10);
}

function lastDayOfMonth(plainDate) {
  const [y, m] = plainDate.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function weekday(plainDate) {
  const [y, m, d] = plainDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function formatBR(plainDate) {
  const [y, m, d] = plainDate.split("-");
  return `${d}/${m}/${y}`;
}

function zonedIso(plainDate) {
  return new Date(`${plainDate}T00:00:00-03:00`).toISOString();
}

function noise(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function divideOrNull(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

const TODAY = todayInSaoPaulo();
// Hoje ainda está em andamento: só uma parte do dia "aconteceu". Fixo (e não
// baseado na hora atual) para o render do servidor e do cliente baterem.
const TODAY_FRACTION = 0.6;

/* ------------------------------- Corretores ------------------------------ */

const PROFILES = [
  { id: "vitrine-corretor-ana", name: "Ana Paula Ribeiro", role: "broker", gender: "female", photoUrl: "" },
  { id: "vitrine-corretor-bruno", name: "Bruno Henrique Lopes", role: "broker", gender: "male", photoUrl: "" },
  { id: "vitrine-corretor-carla", name: "Carla Mendes", role: "broker", gender: "female", photoUrl: "" },
  { id: "vitrine-corretor-diego", name: "Diego Fernandes", role: "broker", gender: "male", photoUrl: "" },
  { id: "vitrine-corretor-elisa", name: "Elisa Martins", role: "associate", gender: "female", photoUrl: "" }
];

// Ritmo médio por dia útil. `cohort` = clientes que passam pelo funil no dia;
// `rates` = conversão entre etapas consecutivas do funil (service → sale).
// `presence` = intervalos de presença online pontuados; `missRate` = chance
// de fechar o dia sem bater a Meta Diária (gera o desconto de pontos).
const PACE = {
  "vitrine-corretor-ana": { prospecting: 38, newClients: 4, cohort: 9, rates: [0.55, 0.6, 0.55, 0.75, 0.65, 0.75, 0.6], presence: 42, missRate: 0, completed: 6 },
  "vitrine-corretor-bruno": { prospecting: 24, newClients: 3, cohort: 6, rates: [0.45, 0.55, 0.45, 0.65, 0.55, 0.6, 0.5], presence: 34, missRate: 0.25, completed: 4 },
  "vitrine-corretor-carla": { prospecting: 15, newClients: 2, cohort: 4, rates: [0.4, 0.5, 0.4, 0.6, 0.5, 0.55, 0.5], presence: 22, missRate: 0.55, completed: 3 },
  "vitrine-corretor-diego": { prospecting: 5, newClients: 1, cohort: 1.6, rates: [0.3, 0.4, 0.3, 0.5, 0.5, 0.5, 0.4], presence: 12, missRate: 1, completed: 1 },
  "vitrine-corretor-elisa": { prospecting: 0, newClients: 0, cohort: 0, rates: [0, 0, 0, 0, 0, 0, 0], presence: 0, missRate: 0, completed: 0 }
};

// Estoque ATUAL (independe do período, como em computeStockMetricsByBroker).
const STOCK = {
  "vitrine-corretor-ana": { awaitingAction: 2, overdue: 0, staleContact: 1, noFutureActivity: 3 },
  "vitrine-corretor-bruno": { awaitingAction: 5, overdue: 2, staleContact: 5, noFutureActivity: 7 },
  "vitrine-corretor-carla": { awaitingAction: 6, overdue: 3, staleContact: 6, noFutureActivity: 9 },
  "vitrine-corretor-diego": { awaitingAction: 11, overdue: 7, staleContact: 9, noFutureActivity: 14 },
  "vitrine-corretor-elisa": { awaitingAction: 0, overdue: 0, staleContact: 0, noFutureActivity: 0 }
};

// Ajustes manuais fictícios (lançamentos próprios, somados por cima).
const MANUAL_ADJUSTMENTS = [
  { id: "vitrine-ajuste-1", brokerId: "vitrine-corretor-bruno", brokerName: "Bruno Henrique Lopes", points: 15, reason: "Venda indicada fechada fora do CRM (ajuste aprovado pela gestão)", daysAgo: 2, createdByName: "Administrador" },
  { id: "vitrine-ajuste-2", brokerId: "vitrine-corretor-diego", brokerName: "Diego Fernandes", points: -5, reason: "Cadastro duplicado removido", daysAgo: 4, createdByName: "Administrador" }
];

// Pontos por regra (valores fictícios; em produção vêm de scoring_rules).
const RULES = [
  { key: "new_client", label: "Novo cliente", points: 2 },
  { key: "prospecting", label: "Prospecção", points: 1 },
  { key: "service", label: "Cliente em atendimento", points: 3 },
  { key: "simulation", label: "Simulação realizada", points: 5 },
  { key: "documentation", label: "Documentação recebida", points: 8 },
  { key: "sent_for_approval", label: "Cliente enviado para aprovação", points: 10 },
  { key: "approval", label: "Cliente aprovado", points: 15 },
  { key: "sale", label: "Venda realizada", points: 40 },
  { key: "presence_10min", label: "Tempo online", points: 1 },
  { key: "presence_interval_minutes", label: "Intervalo online", points: 0 },
  { key: "presence_top_bonus", label: "Mais tempo online no dia", points: 5 },
  { key: "daily_goal_penalty", label: "Meta Diária não concluída", points: -10 }
];

const FUNNEL_STAGES = [
  { key: "service", label: "Atendimento" },
  { key: "simulation", label: "Simulação" },
  { key: "documentation", label: "Aguardando documentação" },
  { key: "approval", label: "Aguardando aprovação" },
  { key: "approved", label: "Cliente aprovado" },
  { key: "meeting", label: "Reunião" },
  { key: "sale", label: "Venda" }
];

/* ------------------------------ Gerador por dia ------------------------------ */

const dayCache = new Map();

// Atividade de um corretor num dia (determinística). Domingo parado, sábado
// meio período, dia de hoje parcial, dias futuros vazios.
function dayActivity(brokerId, day) {
  const cacheKey = `${brokerId}|${day}`;
  if (dayCache.has(cacheKey)) return dayCache.get(cacheKey);

  const pace = PACE[brokerId];
  const brokerIndex = PROFILES.findIndex((profile) => profile.id === brokerId);
  const dow = weekday(day);
  let factor = dow === 0 ? 0 : dow === 6 ? 0.5 : 1;
  if (day > TODAY) factor = 0;
  if (day === TODAY) factor *= TODAY_FRACTION;
  const seed = (brokerIndex + 1) * 7919 + (Number(day.replaceAll("-", "")) % 10007);
  const jitter = (offset) => 0.7 + noise(seed + offset) * 0.6;

  const cohortRaw = pace.cohort * factor * jitter(1);
  const result = {
    prospecting: Math.round(pace.prospecting * factor * jitter(2)),
    newClients: Math.round(pace.newClients * factor * jitter(3)),
    cohort: cohortRaw,
    presence: Math.round(pace.presence * factor * jitter(4)),
    completed: Math.round(pace.completed * factor * jitter(5)),
    // Fechamento da Meta Diária: só dias já encerrados (antes de hoje) com expediente.
    missedGoal: day < TODAY && factor > 0 && noise(seed + 6) < pace.missRate ? 1 : 0
  };
  dayCache.set(cacheKey, result);
  return result;
}

function daysBetween(startDate, endDate) {
  const days = [];
  for (let day = startDate; day <= endDate; day = addDays(day, 1)) days.push(day);
  return days;
}

/* ------------------------------ Overview ------------------------------ */

const PERIODS = ["today", "yesterday", "last7", "last30", "month", "custom"];

function resolveRange({ period, startDate, endDate }) {
  const valid = PERIODS.includes(period) ? period : "today";
  let start = TODAY;
  let end = TODAY;
  if (valid === "yesterday") { start = addDays(TODAY, -1); end = start; }
  else if (valid === "last7") start = addDays(TODAY, -6);
  else if (valid === "last30") start = addDays(TODAY, -29);
  else if (valid === "month") start = `${TODAY.slice(0, 7)}-01`;
  else if (valid === "custom") {
    start = /^\d{4}-\d{2}-\d{2}$/.test(startDate || "") ? startDate : TODAY;
    end = /^\d{4}-\d{2}-\d{2}$/.test(endDate || "") ? endDate : start;
    if (start > end) [start, end] = [end, start];
  }
  const labels = { today: "Hoje", yesterday: "Ontem", last7: "Últimos 7 dias", last30: "Últimos 30 dias", month: "Este mês" };
  const label = labels[valid] || (start === end ? formatBR(start) : `${formatBR(start)} a ${formatBR(end)}`);
  return { period: valid, startDate: start, endDate: end, startIso: zonedIso(start), endIso: zonedIso(addDays(end, 1)), label };
}

// Bônus da Meta Diária (+20 por múltiplo de 100%) só existe no período "Hoje"
// (loadDailyGoalBonusByBroker). Mesmo cenário da fixture de Meta Diária.
const TODAY_GOAL_BONUS = { "vitrine-corretor-ana": 20 };

function buildBrokerRow(profile, range, days) {
  const totals = { prospecting: 0, newClients: 0, cohort: 0, presence: 0, completed: 0, missedGoal: 0 };
  for (const day of days) {
    const activity = dayActivity(profile.id, day);
    for (const key of Object.keys(totals)) totals[key] += activity[key];
  }
  // Mais tempo online no dia: Ana na maioria dos dias úteis, Bruno nos demais.
  let presenceTop = 0;
  for (const day of days) {
    const ana = dayActivity("vitrine-corretor-ana", day).presence;
    const bruno = dayActivity("vitrine-corretor-bruno", day).presence;
    const winner = ana === 0 && bruno === 0 ? "" : ana >= bruno ? "vitrine-corretor-ana" : "vitrine-corretor-bruno";
    if (day < TODAY && winner === profile.id) presenceTop += 1;
  }

  // Funil acumulativo do período (cada etapa ≤ a anterior).
  const pace = PACE[profile.id];
  const base = Math.round(totals.cohort);
  const stageValues = [];
  let previous = base;
  for (const rate of pace.rates) {
    const value = Math.min(previous, Math.round(previous * rate));
    stageValues.push(value);
    previous = value;
  }
  const stage = Object.fromEntries(FUNNEL_STAGES.map((item, index) => [item.key, stageValues[index]]));

  const counts = {
    new_client: totals.newClients,
    prospecting: totals.prospecting,
    service: stage.service,
    simulation: stage.simulation,
    documentation: stage.documentation,
    sent_for_approval: stage.approval,
    approval: stage.approved,
    sale: stage.sale,
    presence_10min: totals.presence,
    presence_interval_minutes: 0,
    presence_top_bonus: presenceTop,
    daily_goal_penalty: totals.missedGoal
  };
  const pointsBreakdown = RULES.map((rule) => ({ key: rule.key, label: rule.label, count: counts[rule.key] || 0, points: (counts[rule.key] || 0) * rule.points }));
  const activityPoints = pointsBreakdown.reduce((sum, entry) => sum + entry.points, 0);

  const adjustments = MANUAL_ADJUSTMENTS
    .filter((item) => item.brokerId === profile.id)
    .map((item) => ({ ...item, createdAt: new Date(`${addDays(TODAY, -item.daysAgo)}T14:30:00-03:00`).toISOString() }))
    .filter((item) => item.createdAt >= range.startIso && item.createdAt < range.endIso)
    .map(({ daysAgo, ...item }) => item);
  const manualAdjustmentPoints = adjustments.reduce((sum, item) => sum + item.points, 0);
  const dailyGoalBonusPoints = range.period === "today" ? TODAY_GOAL_BONUS[profile.id] || 0 : 0;
  const stock = STOCK[profile.id];

  return {
    row: {
      profile: { ...profile },
      newClients: totals.newClients,
      prospecting: totals.prospecting,
      service: stage.service,
      simulation: stage.simulation,
      documentation: stage.documentation,
      approval: stage.approved,
      approvalPending: stage.approval,
      meeting: stage.meeting,
      sale: stage.sale,
      completedActivities: totals.completed,
      awaitingAction: stock.awaitingAction,
      overdueActivities: stock.overdue,
      staleContact: stock.staleContact,
      noFutureActivity: stock.noFutureActivity,
      pointsBreakdown,
      manualAdjustmentPoints,
      manualAdjustments: adjustments,
      dailyGoalBonusPoints,
      points: activityPoints + manualAdjustmentPoints + dailyGoalBonusPoints
    },
    cohort: base
  };
}

function compareRankingRows(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.sale !== a.sale) return b.sale - a.sale;
  if (b.approval !== a.approval) return b.approval - a.approval;
  if (b.prospecting !== a.prospecting) return b.prospecting - a.prospecting;
  return a.profile.name.localeCompare(b.profile.name, "pt-BR");
}

function parseBrokerIds(value) {
  const ids = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return ids.length ? ids : null;
}

function buildOverview(params = {}) {
  const range = resolveRange(params);
  const days = daysBetween(range.startDate, range.endDate);
  const brokerIds = parseBrokerIds(params.brokerIds);
  const profiles = brokerIds ? PROFILES.filter((profile) => brokerIds.includes(profile.id)) : PROFILES;
  const built = profiles.map((profile) => buildBrokerRow(profile, range, days));
  const team = built.map((item) => item.row);

  const sumTeam = (key) => team.reduce((sum, row) => sum + row[key], 0);
  const cohortTotal = built.reduce((sum, item) => sum + item.cohort, 0);
  const stageTotals = {
    service: sumTeam("service"),
    simulation: sumTeam("simulation"),
    documentation: sumTeam("documentation"),
    approval: sumTeam("approvalPending"),
    approved: sumTeam("approval"),
    meeting: sumTeam("meeting"),
    sale: sumTeam("sale")
  };
  const withClients = [
    { key: "clients", label: "Prospecção", value: cohortTotal },
    ...FUNNEL_STAGES.map((item) => ({ key: item.key, label: item.label, value: stageTotals[item.key] }))
  ];
  const funnel = withClients.map((item, index) => ({ ...item, conversion: index === 0 ? null : divideOrNull(item.value, withClients[index - 1].value) }));

  return {
    range,
    generatedAt: new Date().toISOString(),
    metrics: {
      newClients: sumTeam("newClients"),
      prospecting: sumTeam("prospecting"),
      service: stageTotals.service,
      simulation: stageTotals.simulation,
      approvalPending: stageTotals.approval,
      approval: stageTotals.approved,
      sale: stageTotals.sale
    },
    funnel,
    attention: {
      overdueActivities: sumTeam("overdueActivities"),
      awaitingAction: sumTeam("awaitingAction"),
      staleContact: sumTeam("staleContact"),
      noFutureActivity: sumTeam("noFutureActivity")
    },
    team,
    ranking: team.filter((row) => row.profile.role !== "manager").slice().sort(compareRankingRows)
  };
}

export const overview = buildOverview({ period: "month" });

/* ------------------------------ Tendência ------------------------------ */

const TREND_BUCKET_COUNT = { day: 14, week: 8, month: 6 };
const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function dayLabel(plainDate) {
  const [, month, day] = plainDate.split("-");
  return `${day}/${month}`;
}

function buildTrendBuckets(granularity) {
  const total = TREND_BUCKET_COUNT[granularity];
  if (granularity === "day") {
    return Array.from({ length: total }, (_, index) => {
      const day = addDays(TODAY, -(total - 1 - index));
      return { startDate: day, endDate: day, label: dayLabel(day) };
    });
  }
  if (granularity === "week") {
    const dow = weekday(TODAY);
    const monday = addDays(TODAY, dow === 0 ? -6 : 1 - dow);
    return Array.from({ length: total }, (_, index) => {
      const start = addDays(monday, -7 * (total - 1 - index));
      return { startDate: start, endDate: addDays(start, 6), label: dayLabel(start) };
    });
  }
  const monthStart = `${TODAY.slice(0, 7)}-01`;
  return Array.from({ length: total }, (_, index) => {
    const start = addMonths(monthStart, -(total - 1 - index));
    const [year, month] = start.split("-");
    return { startDate: start, endDate: lastDayOfMonth(start), label: `${MONTH_LABELS[Number(month) - 1]}/${year.slice(2)}` };
  });
}

function buildTrend(params = {}) {
  const granularity = ["day", "week", "month"].includes(params.granularity) ? params.granularity : "month";
  const buckets = buildTrendBuckets(granularity);
  const brokerIds = parseBrokerIds(params.brokerIds);
  const seriesByBroker = new Map();
  buckets.forEach((bucket, bucketIndex) => {
    const bucketOverview = buildOverview({ period: "custom", startDate: bucket.startDate, endDate: bucket.endDate, brokerIds: brokerIds ? brokerIds.join(",") : "" });
    for (const row of bucketOverview.team) {
      if (!seriesByBroker.has(row.profile.id)) {
        seriesByBroker.set(row.profile.id, { brokerId: row.profile.id, name: row.profile.name, photoUrl: row.profile.photoUrl || "", points: new Array(buckets.length).fill(0) });
      }
      seriesByBroker.get(row.profile.id).points[bucketIndex] = row.points;
    }
  });
  return {
    granularity,
    buckets,
    series: [...seriesByBroker.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  };
}

/* --------------------------------- Rotas --------------------------------- */

function paramsOf(url) {
  return Object.fromEntries(url.searchParams.entries());
}

export const routes = [
  { match: /^\/api\/performance-overview\/trend(\?|$)/, delay: 420, response: ({ url }) => ({ trend: buildTrend(paramsOf(url)) }) },
  {
    match: /^\/api\/performance-overview(\?|$)/,
    delay: 380,
    response: ({ url }) => {
      const params = paramsOf(url);
      // ?brokerId= (visão individual, getBrokerPerformanceOverview).
      if (params.brokerId) {
        const scoped = buildOverview({ ...params, brokerIds: params.brokerId });
        return { overview: { range: scoped.range, generatedAt: scoped.generatedAt, broker: scoped.team[0] || null, funnel: scoped.funnel, attention: scoped.attention } };
      }
      return { overview: buildOverview(params) };
    }
  }
];

export const propsFor = () => ({});
