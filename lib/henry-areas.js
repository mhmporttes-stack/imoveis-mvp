import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { applyResponsibleUserScope } from "./admin-access";
import { listAdminProfiles } from "./admin-profiles";
import { CLIENT_STATUS, CLIENT_STATUS_FILTER_GROUPS, clientStatusLabel } from "./client-status";
import { addDaysToPlainDate, getTodayInSaoPaulo, zonedPlainDateToUtcIso } from "./daily-report";
import { listCalendarActivities } from "./calendar-activities";
import { listScheduledActivityRegistrations } from "./simulation-registrations";
import { getSimulationClientCounters } from "./simulation-list-query";
import { getPrivateJourney } from "./client-journey";
import { journeyEventTitleAndDescription } from "./journey-event-labels.mjs";
import { listTags, normalizeTagKey } from "./client-tags";
import { calculateFinancialTotals, isExpectedReceiptOwner, listFinancialSales } from "./financial";
import { listExpenseOccurrences, listOperatingExpenses } from "./financial-health";
import { buildExpensePanel } from "./financial-health-core.mjs";
import { listCampaigns } from "./campaigns";
import { getAdsBoard } from "./meta-ads-board";
import { listLeadDistributionDashboard } from "./lead-distribution";
import { listMarketplaceListings } from "./marketplace-listings";
import { getMarketplaceExtensionSignal, listMarketplaceConversations } from "./marketplace-chat";
import { isAcademyEnabled } from "./academy-flags";
import { getAcademyManagement } from "./academy-server";
import { listAutomationRules } from "./crm-automations";
import { listWhatsappFlows } from "./whatsapp-flows";
import { listAlertDefinitions, listMyAlertHistory } from "./crm-alerts";
import { getDailyMessageSettings, listDailyMessageDispatchHistory } from "./daily-message";
import { listCurrentScoringRules, listManualAdjustments } from "./scoring-rules";
import { listCaptacoes } from "./captacoes";
import { getAiUsageReport } from "./ai-usage";
import { getAdReentryReport } from "./ad-reentries";
import { listBrokerBasesSummary } from "./prospecting";
import { findHenryClientsByName } from "./henry-reports";
import { decideClientOpen } from "./henry-navigation-core.mjs";
import {
  adsBoardPeriodFor,
  buildHenryAcademyReport,
  buildHenryAgendaReport,
  buildHenryAiCostReport,
  buildHenryAlertsReport,
  buildHenryAutomationsReport,
  buildHenryCampaignsReport,
  buildHenryCaptacoesReport,
  buildHenryClientHistoryReport,
  buildHenryClientTabsReport,
  buildHenryDailyMessageReport,
  buildHenryDocumentationReport,
  buildHenryFinanceDetailReport,
  buildHenryMarketplaceReport,
  buildHenryProspectingBasesReport,
  buildHenryReentriesReport,
  buildHenryRouletteReport,
  buildHenryScoringReport,
  buildHenryTagsReport,
  buildHenryTeamReport,
  buildHenryTrafficReport
} from "./henry-areas-core.mjs";

// Leituras da ferramenta `consultar_area` do Henry (REGRA OFICIAL do dono, 2026-10-26 — HENRY-1 "Leitura ampla": "ele deve ter
// acesso a tudo e todas as informações"). SOMENTE LEITURA e sempre pelas MESMAS funções das telas (Agenda, Clientes,
// Financeiro, Gerador de Links, Anúncios, Roleta, Marketplace, Academia, Automações, Central de Alertas, Mensagem do dia,
// Pontuação, Corretores, Captações, Gastos de IA, Reentradas, Prospecção). Nenhuma métrica nova; nada é gravado (getAdsBoard
// com refreshCreatives: false; Prospecção só pela visão das bases, nunca pela fila — listProspectingContacts grava a
// hibernação da Meta Diária). Escopo = o de quem pergunta (o Henry é só do dono = admin geral). Montagem em henry-areas-core.

const CHUNK = 150;

function brokerNameMap(profiles) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile.name || ""]));
  return (id) => byId.get(id) || "";
}

const dayStartIso = (dateKey) => zonedPlainDateToUtcIso(dateKey);
const dayEndIso = (dateKey) => zonedPlainDateToUtcIso(addDaysToPlainDate(dateKey, 1));

// Nome dos clientes das atividades da Agenda (só os ids pedidos, no escopo de quem pergunta).
async function clientNamesFor(auth, ids) {
  const names = new Map();
  const unique = [...new Set(ids.filter(Boolean))];
  const supabase = getSupabaseAdminClient();
  for (let index = 0; index < unique.length; index += CHUNK) {
    const { data, error } = await applyResponsibleUserScope(supabase.from("simulation_registrations").select("id, full_name").in("id", unique.slice(index, index + CHUNK)), auth);
    if (error) throw error;
    for (const row of data || []) names.set(row.id, row.full_name || "");
  }
  return names;
}

// Agenda: as mesmas duas fontes da tela (visão Equipe do admin geral): calendar_activities + atividade do card.
async function loadAgenda(auth, { range, broker }) {
  const from = dayStartIso(range.startDate);
  const to = dayEndIso(range.endDate);
  const [calendar, legacy, profiles] = await Promise.all([
    listCalendarActivities({ from, to, auth, teamScope: true }),
    listScheduledActivityRegistrations({ from, to, auth, responsibleUserId: broker?.id || "" }),
    listAdminProfiles()
  ]);
  const names = await clientNamesFor(auth, calendar.map((item) => item.clientId));
  const activities = [
    ...calendar.filter((item) => item.status !== "rescheduled" && Date.parse(item.scheduledActivityAt) < Date.parse(to)).map((item) => ({ at: item.scheduledActivityAt, type: item.activityType, title: item.title, status: item.status === "completed" ? "completed" : "pending", clientName: names.get(item.clientId) || "", brokerId: item.responsibleUserId })),
    ...legacy
      .filter((item) => ![CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT].includes(item.status))
      .map((item) => ({ at: item.scheduledActivityAt, type: item.scheduledActivityType, title: item.scheduledActivityNote, status: item.scheduledActivityCompleted ? "completed" : "pending", clientName: item.fullName || "", brokerId: item.responsibleUserId }))
  ].filter((item) => !broker?.id || item.brokerId === broker.id);
  return buildHenryAgendaReport({ activities, range, brokerName: brokerNameMap(profiles), onlyBroker: broker?.name || "" });
}

async function loadCounters(auth, { broker, tagId = "" } = {}) {
  const filters = { ...(broker?.id ? { responsibleUserId: broker.id } : {}), ...(tagId ? { tagId } : {}) };
  const counters = await getSimulationClientCounters({ auth, filters });
  const groups = CLIENT_STATUS_FILTER_GROUPS.map((group) => ({ key: group.key, label: group.label, count: counters.byGroup?.[group.key] || 0 }));
  return { groups, byStatus: counters.byStatus || {} };
}

async function loadClientHistory(auth, { client }) {
  const name = String(client || "").slice(0, 60);
  if (!name) return { spoken: "Diga o nome do cliente.", facts: {}, detail: null };
  const matches = await findHenryClientsByName(auth, name);
  const decision = decideClientOpen(matches, name);
  if (decision.kind === "not_found") return { spoken: decision.reply, facts: {}, detail: null };
  if (decision.kind === "ask") return { spoken: "", facts: { varios_clientes: decision.options }, detail: null, ambiguous: true };
  const journey = await getPrivateJourney(decision.navigate.clientId, auth, { limit: 15 });
  const events = (journey?.events || []).map((event) => {
    const { title, description } = journeyEventTitleAndDescription(event, { origin: journey.origin, registration: journey.registration });
    return { title, description: (description || []).filter(Boolean).join(" · ").slice(0, 200), at: event.occurredAt };
  });
  return buildHenryClientHistoryReport({ clientName: journey?.registration?.fullName || matches[0]?.firstName || name, events });
}

async function loadTags(auth, { query }) {
  const tags = await listTags();
  const key = query ? normalizeTagKey(query) : "";
  const match = key ? tags.find((tag) => tag.normalizedName === key) || tags.find((tag) => tag.normalizedName.includes(key)) || null : null;
  if (!match) return buildHenryTagsReport({ tags, query });
  const { groups } = await loadCounters(auth, { tagId: match.id });
  return buildHenryTagsReport({ tags, query, match, groups });
}

// Financeiro detalhado: SÓ o dono (isExpectedReceiptOwner, igual ao financeiro_resumo). listFinancialSales com repair: false
// (o auto-reparo da tela grava); despesas da aba Saúde (buildExpensePanel) no período.
async function loadFinance(auth, { range, broker }) {
  if (!isExpectedReceiptOwner(auth)) return { spoken: "O financeiro detalhado é só do Matheus.", facts: {}, detail: null };
  const [sales, expenses, occurrences] = await Promise.all([
    listFinancialSales(auth, { repair: false }),
    broker ? Promise.resolve(null) : listOperatingExpenses().catch(() => null),
    broker ? Promise.resolve(null) : listExpenseOccurrences().catch(() => null)
  ]);
  const rows = sales
    .filter((sale) => !broker?.id || sale.brokerId === broker.id)
    .map((sale) => ({ ...sale, ...calculateFinancialTotals(sale), saleDate: sale.saleDate, brokerName: sale.brokerName, clientName: sale.clientName }));
  const panel = expenses ? buildExpensePanel({ expenses, overrides: occurrences || [], today: getTodayInSaoPaulo(), range: { start: range.startDate, end: range.endDate } }) : null;
  return buildHenryFinanceDetailReport({ sales: rows, expenses: panel, range, onlyBroker: broker?.name || "" });
}

async function loadTraffic(auth, { range }) {
  const { period, spoken } = adsBoardPeriodFor(range);
  const board = await getAdsBoard({ period, refreshCreatives: false });
  return buildHenryTrafficReport({ board, periodSpoken: spoken, ownerMoney: isExpectedReceiptOwner(auth) });
}

async function loadMarketplace(auth, { broker }) {
  const [listings, conversations, extension] = await Promise.all([listMarketplaceListings(), listMarketplaceConversations(auth, { view: "all" }), getMarketplaceExtensionSignal()]);
  return buildHenryMarketplaceReport({ listings: listings.listings || [], conversations: conversations.conversations || [], extension, onlyBroker: broker?.name || "" });
}

async function loadAcademy(auth, { broker }) {
  const management = isAcademyEnabled() ? getAcademyManagement() : null;
  if (!management) return buildHenryAcademyReport({ enabled: false });
  const team = await management.listTeam({ admin: true }, {});
  return buildHenryAcademyReport({ team, onlyBroker: broker?.name || "" });
}

const LOADERS = {
  agenda: loadAgenda,
  documentacao: async (auth, { broker }) => buildHenryDocumentationReport({ ...(await loadCounters(auth, { broker })), statusLabel: clientStatusLabel, onlyBroker: broker?.name || "" }),
  clientes_situacao: async (auth, { broker }) => buildHenryClientTabsReport({ ...(await loadCounters(auth, { broker })), statusLabel: clientStatusLabel, onlyBroker: broker?.name || "" }),
  historico_cliente: loadClientHistory,
  etiquetas: loadTags,
  financeiro: loadFinance,
  campanhas: async (auth, { range }) => buildHenryCampaignsReport({ ...(await listCampaigns({ period: "custom", startDate: range.startDate, endDate: range.endDate })), range }),
  trafego: loadTraffic,
  roleta: async (auth, { range, broker }) => buildHenryRouletteReport({ dashboard: await listLeadDistributionDashboard(), range, onlyBroker: broker?.name || "" }),
  marketplace: loadMarketplace,
  academia: loadAcademy,
  automacoes: async () => {
    const [rules, flows] = await Promise.all([listAutomationRules(), listWhatsappFlows()]);
    return buildHenryAutomationsReport({ rules, flows });
  },
  alertas: async (auth) => {
    const [definitions, mine] = await Promise.all([listAlertDefinitions(auth), listMyAlertHistory(auth)]);
    return buildHenryAlertsReport({ definitions, mine });
  },
  mensagem_do_dia: async (auth) => {
    const [settings, dispatches] = await Promise.all([getDailyMessageSettings(), listDailyMessageDispatchHistory(auth)]);
    return buildHenryDailyMessageReport({ settings, dispatches });
  },
  pontuacao: async (auth, { range, broker }) => {
    const [rules, adjustments] = await Promise.all([
      listCurrentScoringRules(auth),
      listManualAdjustments(auth, { brokerIds: broker?.id ? [broker.id] : null, startIso: dayStartIso(range.startDate), endIso: dayEndIso(range.endDate) })
    ]);
    return buildHenryScoringReport({ rules, adjustments, range });
  },
  equipe: async (auth, { broker }) => buildHenryTeamReport({ profiles: await listAdminProfiles(), onlyBroker: broker?.name || "" }),
  captacoes: async (auth, { range }) => buildHenryCaptacoesReport({ captacoes: await listCaptacoes(auth), range }),
  gastos_ia: async (auth, { range }) => buildHenryAiCostReport({ entries: (await getAiUsageReport(auth)).entries || [], range, ownerMoney: isExpectedReceiptOwner(auth) }),
  reentradas: async (auth, { range }) => buildHenryReentriesReport({ report: await getAdReentryReport({ days: Math.max(range.days, 1) }, auth), range }),
  prospeccao_bases: async (auth) => buildHenryProspectingBasesReport({ bases: await listBrokerBasesSummary(auth) })
};

// area → { spoken, facts, detail, ambiguous? }. Área desconhecida = null.
export async function loadHenryArea(area, auth, { range, broker = null, query = "", client = "" } = {}) {
  const loader = LOADERS[area];
  if (!loader) return null;
  return loader(auth, { range, broker, query, client });
}
