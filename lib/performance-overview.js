import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { listVisibleTeamProfiles } from "./admin-profiles";
import { assertCanAccessResponsibleUser } from "./admin-access";
import {
  CLIENT_FUNNEL_STAGES,
  getClientFunnelStage,
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

export async function getPerformanceOverview(params = {}, auth = null) {
  if (!hasSupabaseAdminConfig) {
    throw new Error("Supabase administrativo não configurado para carregar o painel de desempenho.");
  }

  const range = resolveOverviewRange(params);
  const supabase = getSupabaseAdminClient();
  const brokerId = String(params.brokerId || "").trim();
  // Filtro do bloco "Funil comercial" (Todos / um corretor / um conjunto
  // arbitrário de corretores) — independente do brokerId da visão individual.
  const brokerIds = normalizeBrokerIdList(params.brokerIds);

  if (brokerId) assertCanAccessResponsibleUser(auth, brokerId);
  if (brokerIds) for (const id of brokerIds) assertCanAccessResponsibleUser(auth, id);

  const explicitBrokerIds = brokerId ? [brokerId] : brokerIds;

  // ARQUITETURA: evento → regra de pontuação → corretor responsável →
  // registro de pontos → ranking → PERMISSÃO DE VISUALIZAÇÃO. A permissão
  // (escopo do gestor/admin) só pode decidir QUEM aparece na lista
  // (loadTeamProfiles, abaixo) — nunca quais eventos entram na conta de um
  // corretor específico. Por isso os eventos brutos (registrations, status
  // history, prospecção, ajustes manuais) são sempre carregados da mesma
  // forma, com ou sem filtro de "um corretor específico" pedido
  // explicitamente (explicitBrokerIds) — NUNCA filtrados pelo escopo de
  // quem está perguntando. Sem isso, o mesmo corretor no mesmo período podia
  // somar pontos diferentes dependendo de quem abriu a tela (ex.: uma
  // mudança de status feita num cliente que hoje não pertence mais à equipe
  // de quem está olhando entrava na conta do admin geral — que não tem
  // filtro nenhum — e sumia da conta do próprio gestor).
  const [teamRegistrations, profiles, rulesTimeline, dailyGoalBonusByBroker] = await Promise.all([
    loadTeamRegistrations(supabase, explicitBrokerIds),
    listVisibleTeamProfiles(auth, brokerIds),
    loadScoringRulesTimeline(),
    loadDailyGoalBonusByBroker(supabase, range)
  ]);

  const clientIds = teamRegistrations.map((row) => row.id);
  const clientBrokerMap = new Map(teamRegistrations.map((row) => [row.id, row.responsible_user_id || ""]));

  // listCalendarActivitiesForClients só depende de clientIds/auth (já
  // disponíveis) — roda junto com as outras consultas do período em vez de
  // esperar por elas, evitando um round-trip sequencial extra a cada carga
  // do painel.
  const [history, prospectingEvents, manualAdjustments, extraActivitiesByClient] = await Promise.all([
    loadStatusHistoryInRange(supabase, range, explicitBrokerIds ? clientIds : null),
    loadProspectingEventsInRange(supabase, range, explicitBrokerIds),
    listManualAdjustments(auth, { brokerIds: explicitBrokerIds, startIso: range.startIso, endIso: range.endIso }),
    listCalendarActivitiesForClients(clientIds, auth)
  ]);

  const newClients = countNewClientsByBroker(teamRegistrations, range);
  const prospecting = countProspectingByBroker(prospectingEvents);
  // O funil representa todo cliente que "passou pelo período": criado no
  // período (mesma regra de "Novos clientes"), OU com evento de prospecção
  // no período, OU com mudança de status registrada no período. Antes só
  // olhava eventos de prospecção formal (fila manual/Meta Diária) — um
  // cliente cadastrado direto pelo corretor (sem passar pela fila) podia
  // nascer, avançar e até FECHAR VENDA inteiramente dentro do período e
  // nunca aparecer em etapa nenhuma do funil, porque nunca tinha o evento de
  // prospecção que o fazia entrar na coorte. Confirmado em produção: 7
  // clientes com venda registrada no período, zero deles com qualquer
  // evento de prospecção nesse mesmo período.
  const prospectingClientIds = getProspectingClientIds(teamRegistrations, prospectingEvents, range, history);
  const cohortFullHistory = await loadFullStatusHistoryForClients(supabase, prospectingClientIds);
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
  const funnel = computeCumulativeFunnel(prospectingClientIds, cohortFullHistory, currentStatusByClientId, clientBrokerMap, directBrokerLinkClientIds);

  // Um cliente pode ter várias atividades futuras simultâneas (calendar_activities,
  // além da única legada) — "sem atividade futura"/"atrasada" precisa olhar as
  // duas fontes juntas (mergeActivitySignal), nunca só a coluna legada isolada.
  const stock = computeStockMetricsByBroker(teamRegistrations, extraActivitiesByClient);

  const metrics = {
    newClients: newClients.total,
    prospecting: prospecting.total,
    service: getStageValue(funnel, "service"),
    simulation: getStageValue(funnel, "simulation"),
    // Card "Documentações completas / Aguardando aprovação": clientes que
    // chegaram à etapa "Aguardando aprovação" (documentação já reunida e
    // enviada à CCA) — mesma etapa cumulativa do funil (key "approval").
    approvalPending: getStageValue(funnel, "approval"),
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
  const funnelWithConversions = buildFunnelWithConversions(prospectingClientIds.length, funnel);

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
  const scoringHistory = await filterFirstTimeScoringEvents(supabase, history, range);
  const statusScoring = computeScoringByBroker(
    scoringHistory,
    (row) => row.changed_at,
    (row) => getScoringKeyForStatus(row.new_status),
    // "sistema" é a marca explícita de uma alteração 100% automática (ex.:
    // marco de "Reunião realizada" criado sozinho antes de uma Venda sem
    // reunião prévia registrada — ver ensureMeetingMilestoneBeforeSale em
    // simulation-registrations.js). Isso NUNCA pode gerar pontos para
    // ninguém — cair de volta no responsável atual (como o changed_by nulo
    // legado abaixo faz) atribuiria produtividade humana a um evento que o
    // corretor não realizou, violando a regra explícita "automações não
    // devem se passar por produtividade humana". changed_by nulo (dado
    // legado, anterior a esse campo existir) continua caindo no responsável
    // atual — único sinal disponível nesse caso, e não é uma automação
    // conhecida.
    (row) => (isAutomatedChangedBy(row.changed_by) ? "" : emailToBrokerId.get(String(row.changed_by || "").toLowerCase()) || clientBrokerMap.get(row.client_id)),
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

// Lista fechada de identidades usadas pelo próprio backend para marcar uma
// mudança como automática (nunca um e-mail de usuário real) — ver
// simulation-registrations.js (ensureMeetingMilestoneBeforeSale) e
// crm-automations.js. Qualquer novo caminho automático precisa usar um desses
// marcadores (nunca deixar `changedBy` vazio nem reaproveitar o e-mail do
// último humano que tocou o cliente) para continuar valendo 0 pontos aqui.
const AUTOMATED_CHANGED_BY_VALUES = new Set(["sistema", "automacao", "automação", "cron", "automation"]);
function isAutomatedChangedBy(value) {
  return AUTOMATED_CHANGED_BY_VALUES.has(String(value || "").trim().toLowerCase());
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
// de "hoje". "previstas" é SEMPRE a cota congelada do dia (daily_goals.
// new_quota) — nunca total_due (que mistura a cota com o tamanho ao vivo da
// carteira de 2º/3º contato, inflando o denominador e escondendo bônus que o
// corretor já teria ganhado). Essa era exatamente a confusão meta×capacidade
// que fazia o bônus de +20/100% nunca bater com o que a tela de Meta Diária
// do próprio corretor mostrava. Recalculado do zero a cada leitura deste
// painel (nunca persistido como "concedido"), então é idempotente por
// construção: refresh, logout/login ou outro dispositivo sempre recalculam o
// mesmo valor a partir do estado atual, nunca somam de novo.
async function loadDailyGoalBonusByBroker(supabase, range) {
  const bonusByBroker = new Map();
  if (range.period !== OVERVIEW_PERIODS.TODAY) return bonusByBroker;

  const today = range.startDate;
  const [{ data: goals, error: goalsError }, { data: attempts, error: attemptsError }, { data: claims, error: claimsError }] = await Promise.all([
    supabase.from("daily_goals").select("broker_id, new_quota").eq("goal_date", today),
    supabase.from("daily_goal_attempts").select("broker_id").eq("goal_date", today),
    supabase.from("prospecting_history").select("user_id, details").eq("event_type", "claimed").gte("created_at", range.startIso).lt("created_at", range.endIso)
  ]);
  if (goalsError) throw goalsError;
  if (attemptsError) throw attemptsError;
  if (claimsError) throw claimsError;

  const previstasByBroker = new Map();
  for (const row of goals || []) previstasByBroker.set(row.broker_id, (previstasByBroker.get(row.broker_id) || 0) + (row.new_quota || 0));

  const realizadasByBroker = new Map();
  for (const row of attempts || []) realizadasByBroker.set(row.broker_id, (realizadasByBroker.get(row.broker_id) || 0) + 1);
  // "claimed" com details.source="daily_goal" é a RESERVA automática da
  // própria Meta Diária (já contada via daily_goal_attempts acima quando
  // efetivamente trabalhada) — nunca conta como ação por si só, mesma
  // exclusão já usada em getDailyGoalPerformance/computeDailyGoalRealizedToday.
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

// EXTRATO DE PONTOS — Gestão > Meta Diária > Desempenho. Regra estrutural do
// pente-fino: "nenhum ponto sem evento de origem". Em vez de uma tabela nova
// de "eventos de pontuação" (que poderia divergir do ranking com o tempo),
// o extrato é gerado dos MESMOS eventos brutos que alimentam
// getPerformanceOverview — cada linha aqui é um evento individual, cada
// grupo de linhas de um corretor soma exatamente o total que o ranking
// mostra para ele no mesmo período (por construção, não por sincronização
// manual). O campo `reconciled` confirma isso na prática a cada leitura.
export async function getPointsLedger(params = {}, auth = null) {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  const range = resolveOverviewRange(params);
  const supabase = getSupabaseAdminClient();
  const brokerId = String(params.brokerId || "").trim();
  if (brokerId) assertCanAccessResponsibleUser(auth, brokerId);
  const explicitBrokerIds = brokerId ? [brokerId] : null;

  const [teamRegistrations, profiles, rulesTimeline, dailyGoalBonusByBroker, prospectingEvents, manualAdjustments] = await Promise.all([
    loadTeamRegistrations(supabase, explicitBrokerIds),
    listVisibleTeamProfiles(auth, explicitBrokerIds),
    loadScoringRulesTimeline(),
    loadDailyGoalBonusByBroker(supabase, range),
    loadProspectingEventsInRange(supabase, range, explicitBrokerIds),
    listManualAdjustments(auth, { brokerIds: explicitBrokerIds, startIso: range.startIso, endIso: range.endIso })
  ]);
  const history = await loadStatusHistoryInRange(supabase, range, explicitBrokerIds ? teamRegistrations.map((row) => row.id) : null);

  const visibleIds = new Set(profiles.map((profile) => profile.id));
  const clientNameById = new Map(teamRegistrations.map((row) => [row.id, row.full_name || "Cliente"]));
  const nameByBrokerId = new Map(profiles.map((profile) => [profile.id, profile.name || profile.email || "Usuário"]));
  const emailToBrokerId = new Map(profiles.filter((profile) => profile.email).map((profile) => [profile.email.toLowerCase(), profile.id]));
  const clientBrokerMap = new Map(teamRegistrations.map((row) => [row.id, row.responsible_user_id || ""]));

  const rows = [];
  function push(brokerId, entry) {
    if (!brokerId || !visibleIds.has(brokerId)) return;
    rows.push({ brokerId, brokerName: nameByBrokerId.get(brokerId) || "Corretor", ...entry });
  }

  for (const registration of teamRegistrations) {
    if (!withinRange(registration.created_at, range)) continue;
    const points = getRulePointsAt(rulesTimeline, "new_client", new Date(registration.created_at).getTime());
    push(registration.responsible_user_id, { clientName: registration.full_name || "Cliente", action: "Novo cliente cadastrado", points, occurredAt: registration.created_at, origin: registration.direct_broker_link ? "Link pessoal do corretor" : "Cadastro" });
    if (registration.direct_broker_link) {
      const linkPoints = getRulePointsAt(rulesTimeline, "prospecting", new Date(registration.created_at).getTime());
      push(registration.responsible_user_id, { clientName: registration.full_name || "Cliente", action: "Prospecção — link pessoal", points: linkPoints, occurredAt: registration.created_at, origin: "Link pessoal do corretor" });
    }
  }

  for (const event of prospectingEvents) {
    const points = getRulePointsAt(rulesTimeline, "prospecting", new Date(event.created_at).getTime());
    const action = event.source === "attempt" ? `Prospecção — ${["1ª", "2ª", "3ª"][Math.max((event.attemptNumber || 1) - 1, 0)] || "N"} tentativa` : "Prospecção — contato assumido";
    push(event.user_id, { clientName: clientNameById.get(event.client_id) || "Cliente", action, points, occurredAt: event.created_at, origin: event.source === "attempt" ? "Meta Diária" : "Prospecção manual" });
  }

  for (const row of history) {
    const ruleKey = getScoringKeyForStatus(row.new_status);
    if (!ruleKey) continue;
    const isAutomated = isAutomatedChangedBy(row.changed_by);
    const attributedBrokerId = isAutomated ? "" : (emailToBrokerId.get(String(row.changed_by || "").toLowerCase()) || clientBrokerMap.get(row.client_id));
    if (!attributedBrokerId) continue; // sem responsável identificável (ou automação explícita) — nunca aparece no extrato de ninguém, mesma regra do ranking
    const points = getRulePointsAt(rulesTimeline, ruleKey, new Date(row.changed_at).getTime());
    push(attributedBrokerId, { clientName: clientNameById.get(row.client_id) || "Cliente", action: statusEventLabel(ruleKey), points, occurredAt: row.changed_at, origin: "Mudança de status" });
  }

  for (const adjustment of manualAdjustments) {
    push(adjustment.brokerId, { clientName: "—", action: `Ajuste manual — ${adjustment.reason || "sem motivo informado"}`, points: adjustment.points, occurredAt: adjustment.createdAt, origin: "Ajuste manual" });
  }

  for (const [brokerId, bonusPoints] of dailyGoalBonusByBroker) {
    push(brokerId, { clientName: "—", action: `Bônus de Meta Diária batida (múltiplo de 100%)`, points: bonusPoints, occurredAt: zonedPlainDateToUtcIso(range.startDate), origin: "Meta Diária" });
  }

  rows.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const sumByBroker = new Map();
  for (const row of rows) sumByBroker.set(row.brokerId, (sumByBroker.get(row.brokerId) || 0) + row.points);

  let reconciliation = [];
  if (params.withReconciliation) {
    const overview = await getPerformanceOverview(params, auth);
    reconciliation = overview.team.map((entry) => {
      const ledgerTotal = sumByBroker.get(entry.profile.id) || 0;
      return { brokerId: entry.profile.id, brokerName: entry.profile.name, rankingPoints: entry.points, ledgerPoints: ledgerTotal, reconciled: ledgerTotal === entry.points };
    });
  }

  return { range, rows, totalsByBroker: Object.fromEntries(sumByBroker), reconciliation };
}

function statusEventLabel(ruleKey) {
  const definition = SCORING_RULE_DEFINITIONS.find((rule) => rule.key === ruleKey);
  return definition ? definition.label : `Status alterado (${ruleKey})`;
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

// Sempre a mesma base de dados para QUALQUER chamador (nunca escopada por
// quem está perguntando — ver comentário em getPerformanceOverview). O único
// filtro possível aqui é um pedido EXPLÍCITO de um corretor específico
// (explicitBrokerIds), já validado contra a permissão do chamador em
// getPerformanceOverview (assertCanAccessResponsibleUser).
// PostgREST devolve no máximo 1000 linhas por padrão sem `.range()` — como a
// pontuação passou a ser calculada sempre a partir da base inteira (nunca
// escopada pelo pedido do gestor, ver getPerformanceOverview), qualquer uma
// destas 3 consultas pode facilmente passar de 1000 linhas numa imobiliária
// ativa (confirmado em produção: >1300 linhas de client_status_history só no
// mês corrente). Sem paginação explícita, o corte agia de forma silenciosa e
// não-determinística (a ordem implícita do banco pode variar entre chamadas
// iguais), fazendo o MESMO corretor somar pontos diferentes a cada consulta —
// exatamente o tipo de inconsistência que esta correção existe para eliminar.
// `.order("id")` garante que a paginação por páginas de 1000 nunca pule nem
// repita uma linha.
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

async function loadTeamRegistrations(supabase, explicitBrokerIds) {
  return fetchAllRows((from, to) => {
    let query = supabase
      .from("simulation_registrations")
      .select("id, full_name, responsible_user_id, status, created_at, scheduled_activity_at, scheduled_activity_completed_at, last_whatsapp_contact_at, direct_broker_link")
      .order("id", { ascending: true })
      .range(from, to);
    if (explicitBrokerIds) query = query.in("responsible_user_id", explicitBrokerIds);
    return query;
  });
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
    const groupResults = await Promise.all(group.map((batch) => fetchAllRows((from, to) =>
      supabase
        .from("client_status_history")
        .select("client_id, new_status")
        .in("client_id", batch)
        .order("id", { ascending: true })
        .range(from, to)
    )));
    results.push(...groupResults.flat());
  }
  return results;
}

// [REGRA OFICIAL 2026-09-24] Cada marco de pontuação vale UMA vez por cliente
// (a primeira vez que ele é alcançado, em qualquer data) — ir e voltar de etapa
// ou marcar "Simulação enviada" depois de "Simulação realizada" não pontua de
// novo. E "Simulação realizada" só pontua se o cliente tem uma simulação com
// valor de financiamento ou subsídio (simulação vazia/autosave não conta).
// Recalculado do zero a cada leitura (nada é gravado), então segue idempotente.
async function filterFirstTimeScoringEvents(supabase, history, range) {
  const scored = history.filter((row) => row.client_id && getScoringKeyForStatus(row.new_status));
  if (!scored.length) return [];

  const clientIds = [...new Set(scored.map((row) => row.client_id))];
  const achievedBefore = new Map();
  const withSimulationValues = new Set();

  for (const group of chunkArray(chunkArray(clientIds, 150), 5)) {
    const results = await Promise.all(group.map(async (batch) => {
      const [prior, simulations] = await Promise.all([
        fetchAllRows((from, to) => supabase
          .from("client_status_history")
          .select("client_id, new_status")
          .in("client_id", batch)
          .lt("changed_at", range.startIso)
          .order("id", { ascending: true })
          .range(from, to)),
        fetchAllRows((from, to) => supabase
          .from("simulations")
          .select("registration_id, financing_value, subsidy_value")
          .in("registration_id", batch)
          .order("id", { ascending: true })
          .range(from, to))
      ]);
      return { prior, simulations };
    }));
    for (const { prior, simulations } of results) {
      for (const row of prior) {
        const key = getScoringKeyForStatus(row.new_status);
        if (!key) continue;
        if (!achievedBefore.has(row.client_id)) achievedBefore.set(row.client_id, new Set());
        achievedBefore.get(row.client_id).add(key);
      }
      for (const row of simulations) {
        if (Number(row.financing_value) > 0 || Number(row.subsidy_value) > 0) withSimulationValues.add(row.registration_id);
      }
    }
  }

  const seenInRange = new Set();
  return scored
    .slice()
    .sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)))
    .filter((row) => {
      const key = getScoringKeyForStatus(row.new_status);
      const marker = `${row.client_id}|${key}`;
      if (seenInRange.has(marker)) return false;
      seenInRange.add(marker);
      if (achievedBefore.get(row.client_id)?.has(key)) return false;
      if (key === "simulation" && !withSimulationValues.has(row.client_id)) return false;
      return true;
    });
}

function chunkArray(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function loadStatusHistoryInRange(supabase, range, clientIds) {
  if (Array.isArray(clientIds) && !clientIds.length) return [];

  return fetchAllRows((from, to) => {
    let query = supabase
      .from("client_status_history")
      .select("client_id, previous_status, new_status, changed_at, changed_by")
      .gte("changed_at", range.startIso)
      .lt("changed_at", range.endIso)
      .order("id", { ascending: true })
      .range(from, to);
    if (Array.isArray(clientIds)) query = query.in("client_id", clientIds);
    return query;
  });
}

// Idem loadTeamRegistrations: nunca escopado por quem pergunta, só pelo
// pedido explícito de um corretor específico.
//
// Duas fontes de "prospecção real" combinadas em uma lista só, ambas
// contando igual (regra explícita do pente-fino — 1ª/2ª/3ª tentativa nunca
// se diferenciam):
//   1) prospecting_history "claimed"/"prospecting_started" — reivindicação
//      MANUAL de um contato (Base da Imobiliária/Minha Base) ou o clique de
//      "Prospectar" num cliente já atribuído. EXCLUI explicitamente
//      "claimed" com details.source="daily_goal": esse evento é a RESERVA
//      automática de contatos pela própria geração diária da Meta Diária —
//      não é uma ação do corretor, é o sistema separando os contatos do dia.
//      Antes desta correção, cada reserva (até "quota" por corretor por dia,
//      hoje 20) gerava pontos de Prospecção sozinha, sem nenhum atendimento
//      real — a causa raiz confirmada de pontos aparecendo sem ação humana.
//   2) daily_goal_attempts — cada tentativa real (1ª/2ª/3ª) da cadência da
//      Meta Diária, identificada pelo clique real de enviar a mensagem.
async function loadProspectingEventsInRange(supabase, range, explicitBrokerIds) {
  const [manualEvents, attemptEvents] = await Promise.all([
    fetchAllRows((from, to) => {
      let query = supabase
        .from("prospecting_history")
        .select("user_id, event_type, details, created_at, registration_id")
        .in("event_type", ["claimed", "prospecting_started"])
        .gte("created_at", range.startIso)
        .lt("created_at", range.endIso)
        .order("id", { ascending: true })
        .range(from, to);
      if (explicitBrokerIds) query = query.in("user_id", explicitBrokerIds);
      return query;
    }),
    fetchAllRows((from, to) => {
      let query = supabase
        .from("daily_goal_attempts")
        .select("broker_id, created_at, client_id, attempt_number")
        .gte("created_at", range.startIso)
        .lt("created_at", range.endIso)
        .order("id", { ascending: true })
        .range(from, to);
      if (explicitBrokerIds) query = query.in("broker_id", explicitBrokerIds);
      return query;
    })
  ]);

  const realManualEvents = manualEvents
    .filter((event) => !(event.event_type === "claimed" && event.details?.source === "daily_goal"))
    .map((event) => ({ user_id: event.user_id, created_at: event.created_at, client_id: event.registration_id || "", source: "manual" }));
  const attemptAsEvents = attemptEvents.map((row) => ({ user_id: row.broker_id, created_at: row.created_at, client_id: row.client_id || "", source: "attempt", attemptNumber: row.attempt_number }));

  return [...realManualEvents, ...attemptAsEvents];
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

function getProspectingClientIds(registrations, events, range, statusHistory = []) {
  const ids = new Set();
  for (const event of events) if (event.client_id) ids.add(event.client_id);
  // Todo cliente CRIADO no período conta — não só quem tem link direto.
  // Um cadastro manual do corretor (sem passar pela fila de prospecção)
  // nunca gera evento de prospecção e ficava fora do funil mesmo nascendo
  // dentro do período (e podendo avançar até Venda sem nunca aparecer).
  for (const row of registrations) {
    if (withinRange(row.created_at, range)) ids.add(row.id);
  }
  // Cliente mais antigo que AVANÇOU de etapa dentro do período (entrou numa
  // etapa do funil agora, mesmo sem evento de prospecção formal nem ter sido
  // criado neste período) também conta. Só avanço real: mudança para
  // "Não contactar"/"Arquivado"/"Aguardando retorno" (fora do funil) não
  // coloca ninguém aqui — antes um cliente de teste aprovado dias atrás e
  // marcado "Não contactar" hoje aparecia como "Aprovações: 1" do dia.
  for (const row of statusHistory) if (row.client_id && getClientFunnelStage(row.new_status)) ids.add(row.client_id);
  return Array.from(ids);
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
