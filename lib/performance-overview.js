import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { isGeneralAdminAuth, isManagerProfile, isOwnerAdminEmail, listAdminProfiles } from "./admin-profiles";
import { applyResponsibleUserScope, assertCanAccessResponsibleUser } from "./admin-access";
import {
  CLIENT_FUNNEL_STAGES,
  isAwaitingFutureActivityClient,
  isClientAwaitingAction,
  isOverdueActivityClient,
  isStaleContactClient,
  mergeActivitySignal,
  normalizeClientStatus
} from "./client-status";
import { isClientStatusHistorySchemaError } from "./client-status-history";
import { listCalendarActivitiesForClients } from "./calendar-activities";
import {
  addDaysToPlainDate,
  formatPlainDateBR,
  getTodayInSaoPaulo,
  normalizePlainDate,
  zonedPlainDateToUtcIso
} from "./daily-report";
import { SCORING_RULE_DEFINITIONS, getRulePointsAt, getScoringKeyForStatus, listManualAdjustments, loadScoringRulesTimeline } from "./scoring-rules";

const STATUS_HISTORY_MIGRATION = "supabase/migrations/20260814_client_status_history.sql";

export const OVERVIEW_PERIODS = {
  TODAY: "today",
  YESTERDAY: "yesterday",
  LAST_7_DAYS: "last7",
  LAST_30_DAYS: "last30",
  THIS_MONTH: "month",
  CUSTOM: "custom"
};
const OVERVIEW_PERIOD_VALUES = Object.values(OVERVIEW_PERIODS);

export function canLoadPerformanceOverview() {
  return hasSupabaseAdminConfig;
}

export function resolveOverviewRange(params = {}) {
  const today = getTodayInSaoPaulo();
  const period = OVERVIEW_PERIOD_VALUES.includes(params.period) ? params.period : OVERVIEW_PERIODS.TODAY;
  let startDate = today;
  let endDate = today;

  if (period === OVERVIEW_PERIODS.YESTERDAY) {
    startDate = addDaysToPlainDate(today, -1);
    endDate = startDate;
  } else if (period === OVERVIEW_PERIODS.LAST_7_DAYS) {
    startDate = addDaysToPlainDate(today, -6);
  } else if (period === OVERVIEW_PERIODS.LAST_30_DAYS) {
    startDate = addDaysToPlainDate(today, -29);
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
  if (period === OVERVIEW_PERIODS.YESTERDAY) return "Ontem";
  if (period === OVERVIEW_PERIODS.LAST_7_DAYS) return "Últimos 7 dias";
  if (period === OVERVIEW_PERIODS.LAST_30_DAYS) return "Últimos 30 dias";
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
  // Filtro do bloco "Funil comercial" (Todos / um corretor / um conjunto
  // arbitrário de corretores) — independente do brokerId da visão individual.
  const brokerIds = normalizeBrokerIdList(params.brokerIds);

  if (brokerId) assertCanAccessResponsibleUser(auth, brokerId);
  if (brokerIds) for (const id of brokerIds) assertCanAccessResponsibleUser(auth, id);

  const [teamRegistrations, profiles, rulesTimeline, dailyGoalBonusByBroker] = await Promise.all([
    loadTeamRegistrations(supabase, auth, brokerId, brokerIds),
    loadTeamProfiles(scope, brokerIds),
    loadScoringRulesTimeline(),
    loadDailyGoalBonusByBroker(supabase, range)
  ]);

  const clientIds = teamRegistrations.map((row) => row.id);
  const clientBrokerMap = new Map(teamRegistrations.map((row) => [row.id, row.responsible_user_id || ""]));
  const explicitBrokerIds = brokerId ? [brokerId] : brokerIds;
  const adjustmentBrokerIds = explicitBrokerIds || scope.ids;
  const hasExplicitScope = Boolean(brokerId) || Boolean(brokerIds);

  const cohortClientIds = teamRegistrations
    .filter((row) => withinRange(row.created_at, range))
    .map((row) => row.id);

  // listCalendarActivitiesForClients só depende de clientIds/auth (já
  // disponíveis) — roda junto com as outras consultas do período em vez de
  // esperar por elas, evitando um round-trip sequencial extra a cada carga
  // do painel.
  const [history, prospectingEvents, manualAdjustments, cohortFullHistory, extraActivitiesByClient] = await Promise.all([
    loadStatusHistoryInRange(supabase, range, scope.admin && !hasExplicitScope ? null : clientIds),
    loadProspectingEventsInRange(supabase, range, scope, brokerId, brokerIds),
    listManualAdjustments(auth, { brokerIds: adjustmentBrokerIds, startIso: range.startIso, endIso: range.endIso }),
    loadFullStatusHistoryForClients(supabase, cohortClientIds),
    listCalendarActivitiesForClients(clientIds, auth)
  ]);

  const newClients = countNewClientsByBroker(teamRegistrations, range);
  const prospecting = countProspectingByBroker(prospectingEvents);
  const completedActivities = countCompletedActivitiesByBroker(teamRegistrations, range);
  const currentStatusByClientId = new Map(teamRegistrations.map((row) => [row.id, row.status]));
  // Cliente que entrou pelo link pessoal de simulação de um corretor
  // (simulation_registrations.direct_broker_link) já chega diretamente
  // atribuído a ele, sem passar pela fila manual de prospecção — conta
  // automaticamente em "Atendimentos" (e, por acumulação, em "Prospecção").
  const directBrokerLinkClientIds = new Set(
    teamRegistrations.filter((row) => row.direct_broker_link).map((row) => row.id)
  );
  // Funil acumulativo: um cliente que já alcançou "Aprovações" também conta em
  // "Atendimentos"/"Simulações"/"Documentação", mesmo que o evento específico
  // dessa etapa intermediária não tenha um registro próprio no período — olha
  // o histórico completo (sem limite de data) de cada cliente do período para
  // achar a etapa mais avançada já alcançada, e soma 1 a ela e a todas as
  // anteriores. Isso garante que o funil seja sempre decrescente (etapa N
  // nunca maior que a etapa N-1), como um funil de verdade.
  const funnel = computeCumulativeFunnel(cohortClientIds, cohortFullHistory, currentStatusByClientId, clientBrokerMap, directBrokerLinkClientIds);

  // Um cliente pode ter várias atividades futuras simultâneas (calendar_activities,
  // além da única legada) — "sem atividade futura"/"atrasada" precisa olhar as
  // duas fontes juntas (mergeActivitySignal), nunca só a coluna legada isolada.
  const stock = computeStockMetricsByBroker(teamRegistrations, extraActivitiesByClient);

  const metrics = {
    newClients: newClients.total,
    prospecting: prospecting.total,
    service: getStageValue(funnel, "service"),
    simulation: getStageValue(funnel, "simulation"),
    // Card "Aprovações" continua representando clientes que chegaram a
    // "Cliente aprovado" (etapa key "approved"); "Aguardando aprovação"
    // (key "approval") virou uma etapa própria do funil de 8 camadas.
    approval: getStageValue(funnel, "approved"),
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

  // Pontuação: sempre recalculada a partir dos eventos reais (nunca armazenada
  // por evento), aplicando a regra vigente no instante exato de cada evento
  // (vigência) — nada de peso fixo no código. Ajustes manuais são lançamentos
  // próprios, somados por cima, sem tocar nos eventos de produção.
  const newClientScoring = computeScoringByBroker(
    teamRegistrations.filter((row) => withinRange(row.created_at, range)),
    (row) => row.created_at,
    () => "new_client",
    (row) => row.responsible_user_id,
    rulesTimeline
  );
  const prospectingScoring = computeScoringByBroker(
    prospectingEvents,
    (event) => event.created_at,
    () => "prospecting",
    (event) => event.user_id,
    rulesTimeline
  );
  // Pontos de mudança de status pertencem a quem REALMENTE mudou o status
  // (client_status_history.changed_by, já gravado em todo update de status —
  // e-mail do usuário autenticado), não ao responsável atual pelo cliente:
  // um gestor/associado pode agir num cliente que está sob responsabilidade
  // de outra pessoa. changed_by nulo/não reconhecido (ex.: "sistema", dados
  // anteriores a esse campo existir) cai de volta no responsável atual, único
  // sinal disponível nesse caso.
  const emailToBrokerId = new Map(profiles.filter((profile) => profile.email).map((profile) => [profile.email.toLowerCase(), profile.id]));
  const statusScoring = computeScoringByBroker(
    history,
    (row) => row.changed_at,
    (row) => getScoringKeyForStatus(row.new_status),
    (row) => emailToBrokerId.get(String(row.changed_by || "").toLowerCase()) || clientBrokerMap.get(row.client_id),
    rulesTimeline
  );
  // Cliente que entrou pelo link pessoal do corretor também gera a pontuação
  // de "Prospecção" (regra explícita) — idempotente por construção: deriva
  // sempre do próprio registro (direct_broker_link + created_at), nunca de um
  // log mutável, então recalcular o período não duplica o evento.
  const directLinkProspectingScoring = computeScoringByBroker(
    teamRegistrations.filter((row) => row.direct_broker_link && withinRange(row.created_at, range)),
    (row) => row.created_at,
    () => "prospecting",
    (row) => row.responsible_user_id,
    rulesTimeline
  );
  const adjustmentPoints = computeManualAdjustmentPointsByBroker(manualAdjustments);

  const team = buildTeamBreakdown({
    profiles,
    newClientsPerBroker: newClients.perBroker,
    prospectingPerBroker: prospecting.perBroker,
    scoringByBroker: [newClientScoring, prospectingScoring, directLinkProspectingScoring, statusScoring],
    completedActivitiesPerBroker: completedActivities.perBroker,
    funnel,
    stockPerBroker: stock.perBroker,
    adjustmentPoints,
    manualAdjustments,
    dailyGoalBonusByBroker
  });

  const ranking = [...team].sort(compareRankingRows);

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

function withinRange(value, range) {
  const ms = new Date(value || "").getTime();
  if (!Number.isFinite(ms)) return false;
  return ms >= new Date(range.startIso).getTime() && ms < new Date(range.endIso).getTime();
}

// Some pontos de eventos individuais (cada um com seu próprio timestamp),
// aplicando a regra vigente naquele instante — usado para novos clientes,
// prospecções e transições de status do cliente. Mantém contagem + pontos por
// atividade (não só o total), para o detalhamento "de onde veio a pontuação"
// (contagem aparece mesmo quando a regra está desativada/0 pontos).
function computeScoringByBroker(rows, getTimestamp, getRuleKey, getBrokerId, rulesTimeline) {
  const perBroker = new Map();

  for (const row of rows) {
    const ruleKey = getRuleKey(row);
    if (!ruleKey) continue;
    const brokerId = getBrokerId(row) || "";
    if (!brokerId) continue;
    const timestampMs = new Date(getTimestamp(row) || "").getTime();
    const points = getRulePointsAt(rulesTimeline, ruleKey, timestampMs);

    if (!perBroker.has(brokerId)) perBroker.set(brokerId, new Map());
    const bucket = perBroker.get(brokerId);
    const entry = bucket.get(ruleKey) || { count: 0, points: 0 };
    entry.count += 1;
    entry.points += points;
    bucket.set(ruleKey, entry);
  }

  return perBroker;
}

// Bônus do Ranking do dia: +20 pontos a cada múltiplo de 100% da Meta Diária
// INDIVIDUAL batido (nunca a Meta da Equipe). Só existe no período "hoje" —
// filtros de visualização (7/30 dias) nunca devem gerar bônus retroativo, e
// como este painel de Ranking não guarda um "extrato" por dia passado, a
// forma segura de cumprir essa regra é simplesmente não calcular o termo fora
// de "hoje". Mesma fonte (daily_goals.total_due + daily_goal_attempts +
// prospecting_history claimed) já usada pela Meta Diária do corretor/dono —
// nunca um segundo cálculo de meta. Recalculado do zero a cada leitura deste
// painel (nunca persistido como "concedido"), então é idempotente por
// construção: refresh, logout/login ou outro dispositivo sempre recalculam o
// mesmo valor a partir do estado atual, nunca somam de novo.
async function loadDailyGoalBonusByBroker(supabase, range) {
  const bonusByBroker = new Map();
  if (range.period !== OVERVIEW_PERIODS.TODAY) return bonusByBroker;

  const today = range.startDate;
  const [{ data: goals, error: goalsError }, { data: attempts, error: attemptsError }, { data: claims, error: claimsError }] = await Promise.all([
    supabase.from("daily_goals").select("broker_id, total_due").eq("goal_date", today),
    supabase.from("daily_goal_attempts").select("broker_id").eq("goal_date", today),
    supabase.from("prospecting_history").select("user_id, details").eq("event_type", "claimed").gte("created_at", range.startIso).lt("created_at", range.endIso)
  ]);
  if (goalsError) throw goalsError;
  if (attemptsError) throw attemptsError;
  if (claimsError) throw claimsError;

  const previstasByBroker = new Map();
  for (const row of goals || []) previstasByBroker.set(row.broker_id, (previstasByBroker.get(row.broker_id) || 0) + (row.total_due || 0));

  const realizadasByBroker = new Map();
  for (const row of attempts || []) realizadasByBroker.set(row.broker_id, (realizadasByBroker.get(row.broker_id) || 0) + 1);
  // "claimed" com details.source="daily_goal" é a própria cadência da Meta
  // Diária (já contada via daily_goal_attempts acima) — não soma de novo aqui,
  // mesma exclusão já usada em getDailyGoalPerformance.
  for (const row of claims || []) {
    if (!row.user_id || row.details?.source === "daily_goal") continue;
    realizadasByBroker.set(row.user_id, (realizadasByBroker.get(row.user_id) || 0) + 1);
  }

  for (const [brokerId, previstas] of previstasByBroker) {
    if (!previstas) continue;
    const realizadas = realizadasByBroker.get(brokerId) || 0;
    const multiplicadorMeta = Math.floor(realizadas / previstas);
    if (multiplicadorMeta > 0) bonusByBroker.set(brokerId, multiplicadorMeta * 20);
  }
  return bonusByBroker;
}

function computeManualAdjustmentPointsByBroker(adjustments) {
  const perBroker = new Map();
  let total = 0;
  for (const adjustment of adjustments) {
    total += adjustment.points;
    perBroker.set(adjustment.brokerId, (perBroker.get(adjustment.brokerId) || 0) + adjustment.points);
  }
  return { total, perBroker };
}

// Desempate do ranking (mesmo período): total de pontos > vendas > aprovados
// > prospecções > ordem alfabética.
function compareRankingRows(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.sale !== a.sale) return b.sale - a.sale;
  if (b.approval !== a.approval) return b.approval - a.approval;
  if (b.prospecting !== a.prospecting) return b.prospecting - a.prospecting;
  return a.profile.name.localeCompare(b.profile.name, "pt-BR");
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

// Fonte única do ranking diário: chama exatamente getPerformanceOverview
// (a mesma função por trás de "Ranking da Equipe"), com period="today" — não
// existe um segundo cálculo de pontuação/ordem/desempate para o widget
// global de Top 1. O auth interno pede visibilidade completa da equipe
// (equivalente ao administrador geral) só para esta leitura — nunca grava
// nada e nunca é exposto ao chamador; qualquer usuário autenticado pode
// pedir o resultado, que vem reduzido a Top 1 + a posição de quem perguntou.
export async function getDailyTeamRankingSnapshot(auth) {
  if (!auth?.ok || !auth?.profile?.id) throw new Error("Usuário sem perfil ativo.");

  const fullVisibilityAuth = { ok: true, user: { email: "" }, profile: { id: "", role: "admin" } };
  const overview = await getPerformanceOverview({ period: "today" }, fullVisibilityAuth);
  const ranking = overview.ranking;
  if (!ranking.length) return null;

  const myIndex = ranking.findIndex((row) => row.profile.id === auth.profile.id);
  const top1 = ranking[0];

  return {
    top1: { brokerId: top1.profile.id, name: top1.profile.name, photoUrl: top1.profile.photoUrl || "", points: top1.points },
    myRank: myIndex === -1 ? null : myIndex + 1,
    isMeTop1: myIndex === 0,
    totalBrokers: ranking.length
  };
}

async function loadTeamRegistrations(supabase, auth, brokerId, brokerIds) {
  let query = supabase
    .from("simulation_registrations")
    .select("id, responsible_user_id, status, created_at, scheduled_activity_at, scheduled_activity_completed_at, last_whatsapp_contact_at, direct_broker_link");

  // brokerIds (filtro do Funil comercial) já foi validado id a id contra o
  // escopo do usuário logo na entrada de getPerformanceOverview — aqui só
  // aplica o .in(); sem ele, cai na mesma regra de escopo de sempre.
  if (brokerIds) query = query.in("responsible_user_id", brokerIds);
  else query = applyResponsibleUserScope(query, auth, "responsible_user_id", brokerId || "");

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Elegibilidade oficial do ranking/equipe: perfil ativo, com id, e nunca o
// administrador principal/dono da operação (ele não é "corretor da equipe" —
// mesma identificação segura usada em todo o app, nunca nome/texto).
async function loadTeamProfiles(scope, brokerIds) {
  const profiles = await listAdminProfiles();
  const active = profiles.filter((profile) => profile.id && profile.status !== "inactive" && !isOwnerAdminEmail(profile.email));
  if (brokerIds) {
    const ids = new Set(brokerIds);
    return active.filter((profile) => ids.has(profile.id));
  }
  if (scope.admin) return active;
  const ids = new Set(scope.ids || []);
  return active.filter((profile) => ids.has(profile.id));
}

// Normaliza o parâmetro brokerIds (string "id1,id2" ou array) para uma lista de
// UUIDs válidos; retorna null quando não há filtro (equivale a "Todos").
function normalizeBrokerIdList(value) {
  const rawValues = Array.isArray(value) ? value : String(value || "").split(",");
  const ids = Array.from(new Set(
    rawValues
      .map((item) => String(item || "").trim())
      .filter((item) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item))
  ));
  return ids.length ? ids : null;
}

// Sem filtro de data de propósito: usada só para descobrir a etapa mais
// avançada que cada cliente do período (coorte) já alcançou, mesmo que essa
// etapa tenha sido atingida antes ou depois do intervalo do período em si.
// Em lotes: com um período longo (ex. "Este mês") a coorte pode ter centenas
// de clientes, e um .in() único estoura o limite de tamanho da URL/headers do
// PostgREST.
async function loadFullStatusHistoryForClients(supabase, clientIds) {
  if (!clientIds.length) return [];

  const batches = chunkArray(clientIds, 150);
  const results = [];
  for (const group of chunkArray(batches, 5)) {
    const groupResults = await Promise.all(group.map(async (batch) => {
      const { data, error } = await supabase
        .from("client_status_history")
        .select("client_id, new_status")
        .in("client_id", batch);
      if (error) throw error;
      return data || [];
    }));
    results.push(...groupResults.flat());
  }
  return results;
}

function chunkArray(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function loadStatusHistoryInRange(supabase, range, clientIds) {
  if (Array.isArray(clientIds) && !clientIds.length) return [];

  let query = supabase
    .from("client_status_history")
    .select("client_id, previous_status, new_status, changed_at, changed_by")
    .gte("changed_at", range.startIso)
    .lt("changed_at", range.endIso);

  if (Array.isArray(clientIds)) query = query.in("client_id", clientIds);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadProspectingEventsInRange(supabase, range, scope, brokerId, brokerIds) {
  let query = supabase
    .from("prospecting_history")
    .select("user_id, event_type, created_at")
    .in("event_type", ["claimed", "prospecting_started"])
    .gte("created_at", range.startIso)
    .lt("created_at", range.endIso);

  if (brokerId) query = query.eq("user_id", brokerId);
  else if (brokerIds) query = query.in("user_id", brokerIds);
  else if (scope.ids) query = query.in("user_id", scope.ids);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
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

// Índice (posição) de cada status dentro da ordem do funil — usado para achar
// a etapa mais avançada que um cliente já alcançou (ex.: "approved" -> 3).
const FUNNEL_STAGE_INDEX_BY_STATUS = new Map(
  CLIENT_FUNNEL_STAGES.flatMap((stage, index) => stage.statuses.map((status) => [status, index]))
);

function getFunnelStageIndexForStatus(status) {
  const index = FUNNEL_STAGE_INDEX_BY_STATUS.get(normalizeClientStatus(status));
  return index === undefined ? -1 : index;
}

// Funil acumulativo: para cada cliente da coorte, descobre a etapa mais
// avançada já alcançada (olhando o status atual + todo o histórico, sem
// limite de data) e soma 1 a essa etapa e a TODAS as anteriores — garante que
// a etapa N nunca tenha mais clientes que a etapa N-1 (funil de verdade).
// Clientes que entraram pelo link pessoal do corretor (directBrokerLinkClientIds)
// já contam no mínimo em "Atendimentos" (índice 0), mesmo sem nenhum evento de
// status registrado ainda.
function computeCumulativeFunnel(cohortClientIds, fullHistory, currentStatusByClientId, clientBrokerMap, directBrokerLinkClientIds = new Set()) {
  const furthestIndexByClient = new Map();

  for (const clientId of cohortClientIds) {
    const currentIndex = getFunnelStageIndexForStatus(currentStatusByClientId.get(clientId));
    const floorIndex = directBrokerLinkClientIds.has(clientId) ? 0 : -1;
    const initialIndex = Math.max(currentIndex, floorIndex);
    if (initialIndex >= 0) furthestIndexByClient.set(clientId, initialIndex);
  }

  for (const row of fullHistory) {
    const index = getFunnelStageIndexForStatus(row.new_status);
    if (index < 0) continue;
    const existing = furthestIndexByClient.get(row.client_id) ?? -1;
    if (index > existing) furthestIndexByClient.set(row.client_id, index);
  }

  const stageTotals = CLIENT_FUNNEL_STAGES.map(() => 0);
  const stagePerBroker = CLIENT_FUNNEL_STAGES.map(() => new Map());

  for (const [clientId, furthestIndex] of furthestIndexByClient) {
    const brokerId = clientBrokerMap.get(clientId) || "";
    for (let stageIndex = 0; stageIndex <= furthestIndex; stageIndex += 1) {
      stageTotals[stageIndex] += 1;
      if (brokerId) {
        const map = stagePerBroker[stageIndex];
        map.set(brokerId, (map.get(brokerId) || 0) + 1);
      }
    }
  }

  return CLIENT_FUNNEL_STAGES.map((stage, index) => ({
    key: stage.key,
    label: stage.label,
    value: stageTotals[index],
    perBroker: stagePerBroker[index]
  }));
}

function getStageValue(funnel, key) {
  return funnel.find((stage) => stage.key === key)?.value || 0;
}

function buildFunnelWithConversions(totalClients, stages) {
  // Somente key/label/value seguem para a resposta (perBroker é um Map interno,
  // usado só para montar "team"/"ranking" — Maps não são serializáveis como prop
  // de Client Component nem em JSON).
  const withClients = [
    { key: "clients", label: "Prospecção", value: totalClients },
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

function computeStockMetricsByBroker(registrations, extraActivitiesByClient, now = Date.now()) {
  const perBroker = new Map();
  const totals = { awaitingAction: 0, overdue: 0, staleContact: 0, noFutureActivity: 0 };

  for (const row of registrations) {
    const client = mergeActivitySignal({
      status: row.status,
      scheduledActivityAt: row.scheduled_activity_at,
      scheduledActivityCompletedAt: row.scheduled_activity_completed_at,
      lastWhatsappContactAt: row.last_whatsapp_contact_at,
      createdAt: row.created_at
    }, extraActivitiesByClient.get(row.id) || []);

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

function buildTeamBreakdown({
  profiles,
  newClientsPerBroker,
  prospectingPerBroker,
  completedActivitiesPerBroker,
  funnel,
  stockPerBroker,
  scoringByBroker,
  adjustmentPoints,
  manualAdjustments,
  dailyGoalBonusByBroker = new Map()
}) {
  return profiles.map((profile) => {
    const stock = stockPerBroker.get(profile.id) || { awaitingAction: 0, overdue: 0, staleContact: 0, noFutureActivity: 0 };
    const manualAdjustmentPoints = adjustmentPoints.perBroker.get(profile.id) || 0;
    const dailyGoalBonusPoints = dailyGoalBonusByBroker.get(profile.id) || 0;

    // Cada fonte (novos clientes, prospecções via fila, prospecções via link
    // direto do corretor, transições de status) guarda contagem+pontos por
    // rule_key para este corretor; soma tudo num único breakdown — mais de uma
    // fonte pode contribuir para a MESMA atividade (ex.: "prospecting" via fila
    // manual + via link direto), por isso soma em vez de sobrescrever.
    const brokerRuleEntries = new Map();
    for (const source of scoringByBroker) {
      const rules = source.get(profile.id);
      if (!rules) continue;
      for (const [ruleKey, entry] of rules) {
        const existing = brokerRuleEntries.get(ruleKey) || { count: 0, points: 0 };
        brokerRuleEntries.set(ruleKey, { count: existing.count + entry.count, points: existing.points + entry.points });
      }
    }

    const pointsBreakdown = SCORING_RULE_DEFINITIONS.map((rule) => ({
      key: rule.key,
      label: rule.label,
      count: brokerRuleEntries.get(rule.key)?.count || 0,
      points: brokerRuleEntries.get(rule.key)?.points || 0
    }));

    const activityPoints = pointsBreakdown.reduce((total, entry) => total + entry.points, 0);

    return {
      profile: { id: profile.id, name: profile.name || profile.email || "Usuário", role: profile.role, photoUrl: profile.photoUrl || "" },
      newClients: newClientsPerBroker.get(profile.id) || 0,
      prospecting: prospectingPerBroker.get(profile.id) || 0,
      service: funnel.find((stage) => stage.key === "service")?.perBroker.get(profile.id) || 0,
      simulation: funnel.find((stage) => stage.key === "simulation")?.perBroker.get(profile.id) || 0,
      documentation: funnel.find((stage) => stage.key === "documentation")?.perBroker.get(profile.id) || 0,
      // "approval" aqui preserva o significado antigo do card/KPI "Aprovações"
      // (clientes que chegaram a "Cliente aprovado"); a nova etapa "Aguardando
      // aprovação" fica disponível à parte como "approvalPending".
      approval: funnel.find((stage) => stage.key === "approved")?.perBroker.get(profile.id) || 0,
      approvalPending: funnel.find((stage) => stage.key === "approval")?.perBroker.get(profile.id) || 0,
      meeting: funnel.find((stage) => stage.key === "meeting")?.perBroker.get(profile.id) || 0,
      sale: funnel.find((stage) => stage.key === "sale")?.perBroker.get(profile.id) || 0,
      completedActivities: completedActivitiesPerBroker.get(profile.id) || 0,
      awaitingAction: stock.awaitingAction,
      overdueActivities: stock.overdue,
      staleContact: stock.staleContact,
      noFutureActivity: stock.noFutureActivity,
      pointsBreakdown,
      manualAdjustmentPoints,
      manualAdjustments: manualAdjustments.filter((adjustment) => adjustment.brokerId === profile.id),
      // Bônus da Meta Diária individual (+20 a cada 100% batido) — nunca da
      // Meta da Equipe. Termo à parte, somado por cima, sem alterar nenhuma
      // regra de pontuação já existente em pointsBreakdown.
      dailyGoalBonusPoints,
      points: activityPoints + manualAdjustmentPoints + dailyGoalBonusPoints
    };
  });
}
