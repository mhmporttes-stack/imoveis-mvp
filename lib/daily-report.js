import { CLIENT_STATUS, clientStatusLabel, normalizeClientStatus } from "./client-status";
import { isClientStatusHistorySchemaError, statusHistoryEventLabel } from "./client-status-history";
import { canUseProfileDatabaseScope, isBrokerProfile, isGeneralAdminAuth, isManagerProfile, listAdminProfiles } from "./admin-profiles";
import { REPORT_PERIODS, TIME_ZONE, resolveReportRange } from "./daily-report-range.mjs";
import { applyDailyReportScope, breakdownBrokerIds, resolveDailyReportScope } from "./daily-report-scope.mjs";
import { calculateCrmMetrics } from "./crm";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";

const STATUS_HISTORY_MIGRATION = "supabase/migrations/20260814_client_status_history.sql";
const DEFAULT_EVENT_LIMIT = 90;

const DOCUMENTATION_RECEIVED_STATUSES = new Set([
  CLIENT_STATUS.DOCUMENTS_PENDING,
  CLIENT_STATUS.APPROVAL_PENDING,
  CLIENT_STATUS.APPROVED,
  CLIENT_STATUS.REJECTED,
  CLIENT_STATUS.SALE_COMPLETED
]);


// Mesmos nomes de sempre para quem importa daqui (Meta Diária, Marketplace, tela, testes).
export { REPORT_PERIODS, addDaysToPlainDate, formatPlainDateBR, getTodayInSaoPaulo, normalizePlainDate, resolveReportRange, zonedPlainDateToUtcIso } from "./daily-report-range.mjs";

export function canLoadDailyReport() {
  return hasSupabaseAdminConfig;
}

export async function getDailyReport(params = {}, auth = null) {
  if (!hasSupabaseAdminConfig) {
    throw new Error("Supabase administrativo não configurado para carregar o relatório diário.");
  }

  const range = resolveReportRange(params);
  const supabase = getSupabaseAdminClient();
  // Uma única decisão de escopo (permissão + corretor selecionado) para TODOS os blocos.
  const scope = buildReportScope(auth, normalizeBrokerIds(params.brokerIds));

  const [registrations, history, brokerBreakdown] = await Promise.all([
    loadRegistrationsInRange(supabase, range, scope),
    loadStatusHistoryInRange(supabase, range, scope),
    loadBrokerBreakdown(supabase, auth, scope)
  ]);
  const clientNames = await loadClientNamesForHistory(supabase, history);

  const metrics = buildMetrics(registrations, history);
  const funnel = [
    { key: "registrations", label: "Cadastros", value: metrics.newRegistrations },
    { key: "documentation", label: "Documentação", value: metrics.documentationReceived },
    { key: "approval", label: "Aprovação", value: metrics.sentForApproval },
    { key: "approved", label: "Aprovados", value: metrics.approved }
  ];

  return {
    range,
    generatedAt: new Date().toISOString(),
    metrics,
    funnel,
    conversions: {
      documentation: divideOrNull(metrics.documentationReceived, metrics.newRegistrations),
      approvalSubmission: divideOrNull(metrics.sentForApproval, metrics.documentationReceived),
      approval: divideOrNull(metrics.approved, metrics.sentForApproval)
    },
    timeline: buildTimeline(registrations, history, clientNames),
    // A lista mostra só os mais recentes (DEFAULT_EVENT_LIMIT); o total diz quantos movimentos houve de fato.
    timelineTotal: registrations.length + history.length,
    brokerBreakdown
  };
}

function buildReportScope(auth, requestedBrokerIds) {
  const profile = auth?.profile;
  return resolveDailyReportScope({
    isGeneralAdmin: isGeneralAdminAuth(auth),
    isManager: isManagerProfile(profile),
    isBroker: isBrokerProfile(profile),
    profileId: profile?.id || "",
    linkedBrokerId: profile?.linkedBrokerId || "",
    managedUserIds: profile?.managedUserIds || null,
    hasDatabaseScope: canUseProfileDatabaseScope(profile),
    requestedBrokerIds
  });
}

// PostgREST devolve no máximo 1000 linhas por consulta: sem paginar, um período longo
// (30 dias) ou uma equipe inteira era cortado em silêncio e os números saíam menores.
async function fetchAllRows(buildQuery) {
  const PAGE_SIZE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

// Detalhamento por corretor (Corretor / Clientes hoje / Aguardando ação / Atividades
// hoje / Atrasadas / Concluídas): mesma lógica da antiga tabela de
// Desempenho > Visão geral (calculateCrmMetrics de lib/crm.js), agora reaproveitada
// aqui para não perder essa visão detalhada quando a Visão geral virou um dashboard.
async function loadBrokerBreakdown(supabase, auth, scope) {
  if (!isGeneralAdminAuth(auth) && !isManagerProfile(auth?.profile)) return [];

  const profiles = await listAdminProfiles();
  const activeProfiles = profiles.filter((profile) => profile.id && profile.status !== "inactive");
  const allowedIds = new Set(breakdownBrokerIds(scope, activeProfiles.map((profile) => profile.id)));
  const scopedProfiles = activeProfiles.filter((profile) => allowedIds.has(profile.id));

  if (!scopedProfiles.length) return [];

  const ids = scopedProfiles.map((profile) => profile.id);
  const data = await fetchAllRows((from, to) => supabase
    .from("simulation_registrations")
    .select("id, responsible_user_id, status, created_at, scheduled_activity_at, scheduled_activity_completed_at")
    .in("responsible_user_id", ids)
    .order("id", { ascending: true })
    .range(from, to));

  const byBroker = new Map();
  for (const row of data || []) {
    const brokerId = row.responsible_user_id || "";
    if (!brokerId) continue;
    if (!byBroker.has(brokerId)) byBroker.set(brokerId, []);
    byBroker.get(brokerId).push({
      createdAt: row.created_at,
      scheduledActivityAt: row.scheduled_activity_at,
      scheduledActivityCompletedAt: row.scheduled_activity_completed_at,
      status: row.status
    });
  }

  return scopedProfiles.map((profile) => ({
    brokerId: profile.id,
    brokerName: profile.name || profile.email || "Usuário",
    metrics: calculateCrmMetrics(byBroker.get(profile.id) || [])
  }));
}

export function formatDailyReportError(error) {
  if (isClientStatusHistorySchemaError(error)) {
    return `A tabela public.client_status_history ainda não existe no Supabase. Execute a migration ${STATUS_HISTORY_MIGRATION} no SQL Editor do Supabase.`;
  }

  const message = error?.message || String(error || "");
  const normalized = message.toLowerCase();
  if (normalized.includes("simulation_registrations")) {
    return "A tabela public.simulation_registrations ainda não existe ou não está acessível no Supabase.";
  }

  return message || "Não foi possível carregar o relatório diário.";
}

async function loadRegistrationsInRange(supabase, range, scope) {
  return fetchAllRows((from, to) => applyDailyReportScope(supabase
    .from("simulation_registrations")
    .select("id, full_name, status, created_at")
    .gte("created_at", range.startIso)
    .lt("created_at", range.endIso), scope, "responsible_user_id")
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to));
}

// O escopo vai pelo corretor responsável do cliente (junção com simulation_registrations),
// em vez de uma lista de ids de clientes — a lista estourava a URL e era cortada em 1000.
async function loadStatusHistoryInRange(supabase, range, scope) {
  return fetchAllRows((from, to) => applyDailyReportScope(supabase
    .from("client_status_history")
    .select("id, client_id, previous_status, new_status, changed_at, changed_by, scope:simulation_registrations!client_id!inner(responsible_user_id)")
    .gte("changed_at", range.startIso)
    .lt("changed_at", range.endIso), scope, "scope.responsible_user_id", "scope")
    .order("changed_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, to));
}

function normalizeBrokerIds(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "").split(",");

  return Array.from(new Set(rawValues
    .map((item) => String(item || "").trim())
    .filter((item) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item))));
}

async function loadClientNamesForHistory(supabase, history) {
  const clientIds = Array.from(new Set(history.map((event) => event.client_id).filter(Boolean)));
  const names = new Map();
  const CHUNK = 150; // .in() com muitos ids estoura a URL
  for (let i = 0; i < clientIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("simulation_registrations")
      .select("id, full_name")
      .in("id", clientIds.slice(i, i + CHUNK));
    if (error) throw error;
    for (const row of data || []) names.set(row.id, row.full_name || "Cliente");
  }
  return names;
}

function buildMetrics(registrations, history) {
  const documentationEvents = countUniqueClients(history.filter((event) => (
    DOCUMENTATION_RECEIVED_STATUSES.has(normalizeClientStatus(event.new_status))
  )));
  const approvalEvents = countUniqueClients(history.filter((event) => normalizeClientStatus(event.new_status) === CLIENT_STATUS.APPROVAL_PENDING));
  const approvedEvents = countUniqueClients(history.filter((event) => normalizeClientStatus(event.new_status) === CLIENT_STATUS.APPROVED));
  const rejectedEvents = countUniqueClients(history.filter((event) => normalizeClientStatus(event.new_status) === CLIENT_STATUS.REJECTED));
  const salesCompletedEvents = countUniqueClients(history.filter((event) => normalizeClientStatus(event.new_status) === CLIENT_STATUS.SALE_COMPLETED));

  return {
    newRegistrations: registrations.length,
    documentationReceived: documentationEvents,
    awaitingDocumentation: registrations.filter((registration) => normalizeClientStatus(registration.status) === CLIENT_STATUS.DOCUMENTATION).length,
    documentsPending: registrations.filter((registration) => normalizeClientStatus(registration.status) === CLIENT_STATUS.DOCUMENTS_PENDING).length,
    sentForApproval: approvalEvents,
    approved: approvedEvents,
    rejected: rejectedEvents,
    salesCompleted: salesCompletedEvents
  };
}

function buildTimeline(registrations, history, clientNames) {
  const registrationEvents = registrations.map((registration) => ({
    id: `created-${registration.id}`,
    type: "registration",
    title: "Novo cadastro recebido",
    clientName: registration.full_name || "Cliente",
    occurredAt: registration.created_at
  }));

  const statusEvents = history.map((event) => ({
    id: event.id,
    type: "status",
    title: statusHistoryEventLabel(event.new_status),
    clientName: clientNames.get(event.client_id) || "Cliente",
    status: normalizeClientStatus(event.new_status),
    statusLabel: clientStatusLabel(event.new_status),
    changedBy: event.changed_by || "",
    occurredAt: event.changed_at
  }));

  return [...registrationEvents, ...statusEvents]
    .filter((event) => event.occurredAt)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, DEFAULT_EVENT_LIMIT);
}

function countUniqueClients(events) {
  return new Set(events.map((event) => event.client_id).filter(Boolean)).size;
}

function divideOrNull(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

// Fonte única da saudação por horário (bom dia/boa tarde/boa noite) usada nas
// mensagens de WhatsApp da Prospecção manual e da Meta Diária — as duas
// tinham cada uma sua própria cópia, com o mesmo erro (corte de "boa tarde"
// em 18h40 em vez de 18h00).
// `now` opcional (resposta automática do Marketplace calcula na hora do envio real); sem ele, agora.
export function getTimeGreeting(now = new Date()) {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const { hour, minute } = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(hour) * 60 + Number(minute);
  if (minutes >= 360 && minutes < 720) return "Bom dia";
  if (minutes >= 720 && minutes < 1080) return "Boa tarde";
  return "Boa noite";
}

