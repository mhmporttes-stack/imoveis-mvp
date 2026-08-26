import { CLIENT_STATUS, clientStatusLabel, normalizeClientStatus } from "./client-status";
import { isClientStatusHistorySchemaError, statusHistoryEventLabel } from "./client-status-history";
import { applyResponsibleUserScope } from "./admin-access";
import { isBrokerProfile, isGeneralAdminAuth } from "./admin-profiles";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";

const TIME_ZONE = "America/Sao_Paulo";
const STATUS_HISTORY_MIGRATION = "supabase/migrations/20260814_client_status_history.sql";
const DEFAULT_EVENT_LIMIT = 90;

const DOCUMENTATION_RECEIVED_STATUSES = new Set([
  CLIENT_STATUS.DOCUMENTS_PENDING,
  CLIENT_STATUS.APPROVAL_PENDING,
  CLIENT_STATUS.APPROVED,
  CLIENT_STATUS.REJECTED,
  CLIENT_STATUS.SALE_COMPLETED
]);

export const REPORT_PERIODS = {
  TODAY: "today",
  YESTERDAY: "yesterday",
  LAST_7_DAYS: "last7",
  LAST_30_DAYS: "last30",
  CUSTOM: "custom"
};

export function canLoadDailyReport() {
  return hasSupabaseAdminConfig;
}

export async function getDailyReport(params = {}, auth = null) {
  if (!hasSupabaseAdminConfig) {
    throw new Error("Supabase administrativo não configurado para carregar o relatório diário.");
  }

  const range = resolveReportRange(params);
  const supabase = getSupabaseAdminClient();
  const brokerIds = normalizeBrokerIds(params.brokerIds);
  const scopedClientIds = await loadScopedClientIds(supabase, auth, brokerIds);

  const registrations = await loadRegistrationsInRange(supabase, range, auth, brokerIds);
  const history = await loadStatusHistoryInRange(supabase, range, scopedClientIds);
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
    timeline: buildTimeline(registrations, history, clientNames)
  };
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

async function loadRegistrationsInRange(supabase, range, auth = null, brokerIds = []) {
  let query = supabase
    .from("simulation_registrations")
    .select("id, full_name, status, created_at")
    .gte("created_at", range.startIso)
    .lt("created_at", range.endIso)
    .order("created_at", { ascending: false });

  query = applyReportResponsibleScope(query, auth, "responsible_user_id", brokerIds);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadStatusHistoryInRange(supabase, range, scopedClientIds = null) {
  if (Array.isArray(scopedClientIds) && !scopedClientIds.length) return [];

  let query = supabase
    .from("client_status_history")
    .select("id, client_id, previous_status, new_status, changed_at, changed_by")
    .gte("changed_at", range.startIso)
    .lt("changed_at", range.endIso)
    .order("changed_at", { ascending: false });

  if (Array.isArray(scopedClientIds)) query = query.in("client_id", scopedClientIds);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadScopedClientIds(supabase, auth = null, brokerIds = []) {
  if (isGeneralAdminAuth(auth)) {
    if (!brokerIds.length) return null;

    const { data, error } = await supabase
      .from("simulation_registrations")
      .select("id")
      .in("responsible_user_id", brokerIds);

    if (error) throw error;
    return (data || []).map((row) => row.id).filter(Boolean);
  }

  if (!isBrokerProfile(auth?.profile) || !auth.profile.id) return null;

  const { data, error } = await supabase
    .from("simulation_registrations")
    .select("id")
    .eq("responsible_user_id", auth.profile.id);

  if (error) throw error;
  return (data || []).map((row) => row.id).filter(Boolean);
}

function normalizeBrokerIds(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "").split(",");

  return Array.from(new Set(rawValues
    .map((item) => String(item || "").trim())
    .filter((item) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item))));
}

function applyReportResponsibleScope(query, auth = null, column = "responsible_user_id", brokerIds = []) {
  if (isGeneralAdminAuth(auth)) {
    return brokerIds.length ? query.in(column, brokerIds) : query;
  }

  return applyResponsibleUserScope(query, auth, column);
}

async function loadClientNamesForHistory(supabase, history) {
  const clientIds = Array.from(new Set(history.map((event) => event.client_id).filter(Boolean)));
  if (!clientIds.length) return new Map();

  const { data, error } = await supabase
    .from("simulation_registrations")
    .select("id, full_name")
    .in("id", clientIds);

  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, row.full_name || "Cliente"]));
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

export function resolveReportRange(params = {}) {
  const today = getTodayInSaoPaulo();
  const period = Object.values(REPORT_PERIODS).includes(params.period) ? params.period : REPORT_PERIODS.TODAY;
  let startDate = today;
  let endDate = today;

  if (period === REPORT_PERIODS.YESTERDAY) {
    startDate = addDaysToPlainDate(today, -1);
    endDate = startDate;
  } else if (period === REPORT_PERIODS.LAST_7_DAYS) {
    startDate = addDaysToPlainDate(today, -6);
  } else if (period === REPORT_PERIODS.LAST_30_DAYS) {
    startDate = addDaysToPlainDate(today, -29);
  } else if (period === REPORT_PERIODS.CUSTOM) {
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
    title: buildRangeTitle(period, startDate, endDate),
    primaryLabel: buildPrimaryLabel(period, startDate, endDate)
  };
}

function buildRangeTitle(period, startDate, endDate) {
  if (period === REPORT_PERIODS.TODAY) return "Relatório de hoje";
  if (period === REPORT_PERIODS.YESTERDAY) return `Relatório de ${formatPlainDateBR(startDate)}`;
  if (startDate === endDate) return `Relatório de ${formatPlainDateBR(startDate)}`;
  return `Relatório de ${formatPlainDateBR(startDate)} a ${formatPlainDateBR(endDate)}`;
}

function buildPrimaryLabel(period, startDate, endDate) {
  if (period === REPORT_PERIODS.TODAY) return "Hoje";
  if (period === REPORT_PERIODS.YESTERDAY) return "Ontem";
  if (startDate === endDate) return formatPlainDateBR(startDate);
  return `${formatPlainDateBR(startDate)} - ${formatPlainDateBR(endDate)}`;
}

function getTodayInSaoPaulo() {
  return partsToPlainDate(getDatePartsInTimeZone(new Date(), TIME_ZONE));
}

function getDatePartsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

function partsToPlainDate(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function normalizePlainDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function addDaysToPlainDate(plainDate, amount) {
  const [year, month, day] = plainDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function zonedPlainDateToUtcIso(plainDate) {
  const [year, month, day] = plainDate.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offset = getTimeZoneOffsetMs(utcGuess, TIME_ZONE);
  const firstPass = new Date(utcGuess.getTime() - offset);
  const secondOffset = getTimeZoneOffsetMs(firstPass, TIME_ZONE);
  const result = secondOffset === offset
    ? firstPass
    : new Date(utcGuess.getTime() - secondOffset);

  return result.toISOString();
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = values.hour === "24" ? "00" : values.hour;
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUtc - date.getTime();
}

function formatPlainDateBR(plainDate) {
  const [year, month, day] = plainDate.split("-");
  return `${day}/${month}/${year}`;
}
