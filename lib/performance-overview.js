import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { isGeneralAdminAuth, isManagerProfile, listAdminProfiles } from "./admin-profiles";
import { applyResponsibleUserScope, assertCanAccessResponsibleUser } from "./admin-access";
import {
  CLIENT_FUNNEL_STAGES,
  isAwaitingFutureActivityClient,
  isClientAwaitingAction,
  isOverdueActivityClient,
  isStaleContactClient,
  normalizeClientStatus
} from "./client-status";
import { isClientStatusHistorySchemaError } from "./client-status-history";
import {
  addDaysToPlainDate,
  formatPlainDateBR,
  getTodayInSaoPaulo,
  normalizePlainDate,
  zonedPlainDateToUtcIso
} from "./daily-report";

const STATUS_HISTORY_MIGRATION = "supabase/migrations/20260814_client_status_history.sql";

export const OVERVIEW_PERIODS = {
  TODAY: "today",
  LAST_7_DAYS: "last7",
  THIS_MONTH: "month",
  CUSTOM: "custom"
};
const OVERVIEW_PERIOD_VALUES = Object.values(OVERVIEW_PERIODS);

// Pontuação do ranking da equipe. Não havia nenhum sistema de pontos pré-existente
// no projeto (nem por atividade, nem configurável) — pesos definidos aqui de forma
// simples e transparente: quanto mais perto da venda, mais pontos o evento vale.
export const RANKING_POINTS = {
  newClient: 5,
  prospecting: 2,
  service: 5,
  simulation: 10,
  approval: 25,
  sale: 100
};

export function canLoadPerformanceOverview() {
  return hasSupabaseAdminConfig;
}

export function resolveOverviewRange(params = {}) {
  const today = getTodayInSaoPaulo();
  const period = OVERVIEW_PERIOD_VALUES.includes(params.period) ? params.period : OVERVIEW_PERIODS.TODAY;
  let startDate = today;
  let endDate = today;

  if (period === OVERVIEW_PERIODS.LAST_7_DAYS) {
    startDate = addDaysToPlainDate(today, -6);
  } else if (period === OVERVIEW_PERIODS.THIS_MONTH) {
    startDate = `${today.slice(0, 7)}-01`;
  } else if (period === OVERVIEW_PERIODS.CUSTOM) {
    startDate = normalizePlainDate(params.startDate) || today;
    endDate = normalizePlainDate(params.endDate) || startDate;
    if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  }

  const endExclusiveDate = addDaysToPlainDate(endDate, 1);
  return {
    period,
    startDate,
    endDate,
    startIso: zonedPlainDateToUtcIso(startDate),
    endIso: zonedPlainDateToUtcIso(endExclusiveDate),
    label: buildRangeLabel(period, startDate, endDate)
  };
}

function buildRangeLabel(period, startDate, endDate) {
  if (period === OVERVIEW_PERIODS.TODAY) return "Hoje";
  if (period === OVERVIEW_PERIODS.LAST_7_DAYS) return "Últimos 7 dias";
  if (period === OVERVIEW_PERIODS.THIS_MONTH) return "Este mês";
  if (startDate === endDate) return formatPlainDateBR(startDate);
  return `${formatPlainDateBR(startDate)} a ${formatPlainDateBR(endDate)}`;
}

export function formatPerformanceOverviewError(error) {
  if (isClientStatusHistorySchemaError(error)) {
    return `A tabela public.client_status_history ainda não existe no Supabase. Execute a migration ${STATUS_HISTORY_MIGRATION} no SQL Editor do Supabase.`;
  }

  const message = error?.message || String(error || "");
  if (message.toLowerCase().includes("simulation_registrations")) {
    return "A tabela public.simulation_registrations ainda não existe ou não está acessível no Supabase.";
  }

  return message || "Não foi possível carregar o painel de desempenho.";
}

// Escopo de visualização: administrador geral vê tudo, gestor vê sua equipe
// (managedUserIds já exclui o administrador geral, calculado em attachDataAccessScope).
function resolveTeamScope(auth) {
  if (isGeneralAdminAuth(auth)) return { admin: true, ids: null };
  if (isManagerProfile(auth?.profile)) return { admin: false, ids: auth.profile.managedUserIds || [auth.profile.id] };
  return { admin: false, ids: [auth?.profile?.id].filter(Boolean) };
}

export async function getPerformanceOverview(params = {}, auth = null) {
  if (!hasSupabaseAdminConfig) {
    throw new Error("Supabase administrativo não configurado para carregar o painel de desempenho.");
  }

  const range = resolveOverviewRange(params);
  const supabase = getSupabaseAdminClient();
  const scope = resolveTeamScope(auth);
  const brokerId = String(params.brokerId || "").trim();

  if (brokerId) {
    assertCanAccessResponsibleUser(auth, brokerId);
  }

  const [teamRegistrations, profiles] = await Promise.all([
    loadTeamRegistrations(supabase, auth, brokerId),
    loadTeamProfiles(scope)
  ]);

  const clientIds = teamRegistrations.map((row) => row.id);
  const clientBrokerMap = new Map(teamRegistrations.map((row) => [row.id, row.responsible_user_id || ""]));

  const [history, prospectingEvents] = await Promise.all([
    loadStatusHistoryInRange(supabase, range, scope.admin && !brokerId ? null : clientIds),
    loadProspectingEventsInRange(supabase, range, scope, brokerId)
  ]);

  const newClients = countNewClientsByBroker(teamRegistrations, range);
  const completedActivities = countCompletedActivitiesByBroker(teamRegistrations, range);
  const funnel = CLIENT_FUNNEL_STAGES.map((stage) => {
    const perBroker = countClientsByStatusesAndBroker(history, stage.statuses, clientBrokerMap);
    return {
      key: stage.key,
      label: stage.label,
      value: sumMapValues(perBroker),
      perBroker
    };
  });

  const stock = computeStockMetricsByBroker(teamRegistrations);

  const metrics = {
    newClients: newClients.total,
    prospecting: prospectingEvents.total,
    service: getStageValue(funnel, "service"),
    simulation: getStageValue(funnel, "simulation"),
    approval: getStageValue(funnel, "approval"),
    sale: getStageValue(funnel, "sale")
  };

  // A base do funil é "Novos clientes" do período selecionado (mesma métrica do
  // card principal), não o total histórico de clientes da carteira — senão a
  // conversão ficaria artificialmente baixa ao comparar um período curto com
  // uma base de clientes acumulada ao longo de meses.
  const funnelWithConversions = buildFunnelWithConversions(newClients.total, funnel);

  const attention = {
    overdueActivities: stock.totals.overdue,
    awaitingAction: stock.totals.awaitingAction,
    staleContact: stock.totals.staleContact,
    noFutureActivity: stock.totals.noFutureActivity
  };

  const team = buildTeamBreakdown({
    profiles,
    newClientsPerBroker: newClients.perBroker,
    prospectingPerBroker: prospectingEvents.perBroker,
    completedActivitiesPerBroker: completedActivities.perBroker,
    funnel,
    stockPerBroker: stock.perBroker
  });

  const ranking = [...team]
    .map((row) => ({ ...row, points: computeRankingPoints(row) }))
    .sort((a, b) => b.points - a.points);

  return {
    range,
    generatedAt: new Date().toISOString(),
    metrics,
    funnel: funnelWithConversions,
    attention,
    team,
    ranking
  };
}

export async function getBrokerPerformanceOverview(brokerId, params = {}, auth = null) {
  const overview = await getPerformanceOverview({ ...params, brokerId }, auth);
  const row = overview.team.find((item) => item.profile.id === brokerId) || null;
  return {
    range: overview.range,
    generatedAt: overview.generatedAt,
    broker: row,
    funnel: overview.funnel,
    attention: overview.attention
  };
}

async function loadTeamRegistrations(supabase, auth, brokerId) {
  let query = supabase
    .from("simulation_registrations")
    .select("id, responsible_user_id, status, created_at, scheduled_activity_at, scheduled_activity_completed_at, last_whatsapp_contact_at");

  query = applyResponsibleUserScope(query, auth, "responsible_user_id", brokerId || "");

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadTeamProfiles(scope) {
  const profiles = await listAdminProfiles();
  const active = profiles.filter((profile) => profile.id && profile.status !== "inactive");
  if (scope.admin) return active;
  const ids = new Set(scope.ids || []);
  return active.filter((profile) => ids.has(profile.id));
}

async function loadStatusHistoryInRange(supabase, range, clientIds) {
  if (Array.isArray(clientIds) && !clientIds.length) return [];

  let query = supabase
    .from("client_status_history")
    .select("client_id, previous_status, new_status, changed_at")
    .gte("changed_at", range.startIso)
    .lt("changed_at", range.endIso);

  if (Array.isArray(clientIds)) query = query.in("client_id", clientIds);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadProspectingEventsInRange(supabase, range, scope, brokerId) {
  let query = supabase
    .from("prospecting_history")
    .select("user_id, event_type, created_at")
    .in("event_type", ["claimed", "prospecting_started"])
    .gte("created_at", range.startIso)
    .lt("created_at", range.endIso);

  if (brokerId) query = query.eq("user_id", brokerId);
  else if (scope.ids) query = query.in("user_id", scope.ids);

  const { data, error } = await query;
  if (error) throw error;
  return countProspectingByBroker(data || []);
}

function countProspectingByBroker(events) {
  const perBroker = new Map();
  let total = 0;
  for (const event of events) {
    total += 1;
    const userId = event.user_id || "";
    if (userId) perBroker.set(userId, (perBroker.get(userId) || 0) + 1);
  }
  return { total, perBroker };
}

function countNewClientsByBroker(registrations, range) {
  const startMs = new Date(range.startIso).getTime();
  const endMs = new Date(range.endIso).getTime();
  const perBroker = new Map();
  let total = 0;

  for (const row of registrations) {
    const createdMs = new Date(row.created_at || "").getTime();
    if (!Number.isFinite(createdMs) || createdMs < startMs || createdMs >= endMs) continue;
    total += 1;
    const brokerId = row.responsible_user_id || "";
    if (brokerId) perBroker.set(brokerId, (perBroker.get(brokerId) || 0) + 1);
  }

  return { total, perBroker };
}

function countCompletedActivitiesByBroker(registrations, range) {
  const startMs = new Date(range.startIso).getTime();
  const endMs = new Date(range.endIso).getTime();
  const perBroker = new Map();
  let total = 0;

  for (const row of registrations) {
    if (!row.scheduled_activity_completed_at) continue;
    const completedMs = new Date(row.scheduled_activity_completed_at).getTime();
    if (!Number.isFinite(completedMs) || completedMs < startMs || completedMs >= endMs) continue;
    total += 1;
    const brokerId = row.responsible_user_id || "";
    if (brokerId) perBroker.set(brokerId, (perBroker.get(brokerId) || 0) + 1);
  }

  return { total, perBroker };
}

function countClientsByStatusesAndBroker(historyRows, statuses, clientBrokerMap) {
  const perBrokerSets = new Map();

  for (const row of historyRows) {
    if (!statuses.includes(normalizeClientStatus(row.new_status))) continue;
    const brokerId = clientBrokerMap.get(row.client_id) || "";
    if (!brokerId) continue;
    if (!perBrokerSets.has(brokerId)) perBrokerSets.set(brokerId, new Set());
    perBrokerSets.get(brokerId).add(row.client_id);
  }

  const result = new Map();
  for (const [brokerId, set] of perBrokerSets) result.set(brokerId, set.size);
  return result;
}

function sumMapValues(map) {
  let total = 0;
  for (const value of map.values()) total += value;
  return total;
}

function getStageValue(funnel, key) {
  return funnel.find((stage) => stage.key === key)?.value || 0;
}

function buildFunnelWithConversions(totalClients, stages) {
  // Somente key/label/value seguem para a resposta (perBroker é um Map interno,
  // usado só para montar "team"/"ranking" — Maps não são serializáveis como prop
  // de Client Component nem em JSON).
  const withClients = [
    { key: "clients", label: "Clientes", value: totalClients },
    ...stages.map((stage) => ({ key: stage.key, label: stage.label, value: stage.value }))
  ];

  return withClients.map((stage, index) => {
    if (index === 0) return { ...stage, conversion: null };
    const previous = withClients[index - 1].value;
    return { ...stage, conversion: divideOrNull(stage.value, previous) };
  });
}

function divideOrNull(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

function computeStockMetricsByBroker(registrations, now = Date.now()) {
  const perBroker = new Map();
  const totals = { awaitingAction: 0, overdue: 0, staleContact: 0, noFutureActivity: 0 };

  for (const row of registrations) {
    const client = {
      status: row.status,
      scheduledActivityAt: row.scheduled_activity_at,
      scheduledActivityCompletedAt: row.scheduled_activity_completed_at,
      lastWhatsappContactAt: row.last_whatsapp_contact_at,
      createdAt: row.created_at
    };

    const brokerId = row.responsible_user_id || "";
    const bucket = getOrCreateBrokerStockBucket(perBroker, brokerId);

    if (isClientAwaitingAction(client, now)) { bucket.awaitingAction += 1; totals.awaitingAction += 1; }
    if (isOverdueActivityClient(client, now)) { bucket.overdue += 1; totals.overdue += 1; }
    if (isStaleContactClient(client, now)) { bucket.staleContact += 1; totals.staleContact += 1; }
    if (isAwaitingFutureActivityClient(client, now)) { bucket.noFutureActivity += 1; totals.noFutureActivity += 1; }
  }

  return { perBroker, totals };
}

function getOrCreateBrokerStockBucket(map, brokerId) {
  if (!map.has(brokerId)) map.set(brokerId, { awaitingAction: 0, overdue: 0, staleContact: 0, noFutureActivity: 0 });
  return map.get(brokerId);
}

function buildTeamBreakdown({ profiles, newClientsPerBroker, prospectingPerBroker, completedActivitiesPerBroker, funnel, stockPerBroker }) {
  return profiles.map((profile) => {
    const stock = stockPerBroker.get(profile.id) || { awaitingAction: 0, overdue: 0, staleContact: 0, noFutureActivity: 0 };

    return {
      profile: { id: profile.id, name: profile.name || profile.email || "Usuário", role: profile.role },
      newClients: newClientsPerBroker.get(profile.id) || 0,
      prospecting: prospectingPerBroker.get(profile.id) || 0,
      service: funnel.find((stage) => stage.key === "service")?.perBroker.get(profile.id) || 0,
      simulation: funnel.find((stage) => stage.key === "simulation")?.perBroker.get(profile.id) || 0,
      documentation: funnel.find((stage) => stage.key === "documentation")?.perBroker.get(profile.id) || 0,
      approval: funnel.find((stage) => stage.key === "approval")?.perBroker.get(profile.id) || 0,
      sale: funnel.find((stage) => stage.key === "sale")?.perBroker.get(profile.id) || 0,
      completedActivities: completedActivitiesPerBroker.get(profile.id) || 0,
      awaitingAction: stock.awaitingAction,
      overdueActivities: stock.overdue,
      staleContact: stock.staleContact,
      noFutureActivity: stock.noFutureActivity
    };
  });
}

function computeRankingPoints(row) {
  return (
    row.newClients * RANKING_POINTS.newClient +
    row.prospecting * RANKING_POINTS.prospecting +
    row.service * RANKING_POINTS.service +
    row.simulation * RANKING_POINTS.simulation +
    row.approval * RANKING_POINTS.approval +
    row.sale * RANKING_POINTS.sale
  );
}
