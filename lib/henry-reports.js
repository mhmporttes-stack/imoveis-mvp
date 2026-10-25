import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { applyResponsibleUserScope } from "./admin-access";
import { listAdminProfiles } from "./admin-profiles";
import { clientStatusLabel } from "./client-status";
import { getPerformanceOverview } from "./performance-overview";
import { getOwnerTeamDailyOverview } from "./daily-goal";
import { zonedPlainDateToUtcIso, addDaysToPlainDate, getTodayInSaoPaulo } from "./daily-report";
import { readOverview } from "./crm-metrics/overview";
import { readTeamGoal } from "./crm-metrics/team-goal";
import { ROLLING_OVERVIEW_IDS, previousOverviewIdFor, slimOverview } from "./crm-metrics/overview-core.mjs";
import { slimTeamGoal } from "./crm-metrics/team-goal-core.mjs";
import { leadOriginBreakdown } from "./painel-inicio-core.mjs";
import { clientFirstNameOf } from "./alexa-v2/text.mjs";
import {
  HENRY_CACHE_MAX_AGE_MINUTES,
  HENRY_CLIENT_ROWS_PER_QUERY,
  HENRY_SPOKEN_NAMES_MAX,
  buildHenryAwaitingReport,
  buildHenryClientsReport,
  buildHenryConversationReport,
  buildHenryFinanceReport,
  buildHenryPresenceReport,
  buildHenryPropertiesReport,
  describeCca,
  describeChatChannels,
  describeDocuments,
  describeSimulation,
  pickClientMatches,
  sanitizeClientSearchTerm
} from "./henry-reports-core.mjs";
import { phoneLookupCandidates } from "./phone-utils";
import { loadRecentAttendanceByClient } from "./client-attendance";
import { attendanceReferenceAt } from "./client-attendance-core.mjs";
import { listCalendarActivitiesForClients } from "./calendar-activities";
import { loadSimulationSentEvidence } from "./simulation-sent-evidence";
import { getCurrentCcaStatus } from "./client-cca-status";
import { getPrivateJourney } from "./client-journey";
import { journeyEventTitleAndDescription } from "./journey-event-labels.mjs";
import { getChatSummary, listClientChatChannels } from "./whatsapp-chat";
import { isExpectedReceiptOwner, listFinancialSales, calculateFinancialTotals } from "./financial";
import { calculateReceivableMetrics, flattenReceivableEntries } from "./financial-expected-receipt-core.mjs";
import { getTeamPresence } from "./admin-presence";
import { isOwnerAtOffice } from "./presence-wifi";
import { listProperties } from "./properties";
import { ETAPA_STATUSES } from "./alexa-v2/providers/funil";

// Leituras do Henry para períodos longos (pedido do dono, 2026-10-22 — HENRY-1). SOMENTE LEITURA e sempre pelas MESMAS
// funções das telas: Desempenho/Ranking/Funil = getPerformanceOverview; Meta Diária da equipe = getOwnerTeamDailyOverview;
// leads por origem = leadOriginBreakdown do Início. Períodos que o CRM já pré-calcula (hoje, ontem, esta semana, semana
// passada, este mês, mês passado e, só o Desempenho, últimos 30 dias — crm_metric_cache) saem do cache quando ele está em dia; os demais são calculados na
// hora, como a tela faz com o filtro de datas. O cache curto (45 s) fica em henry-voice.js (createHenryReadCache).

const CACHED_PERIODS = new Set(["hoje", "ontem", "esta_semana", "semana_passada", "este_mes", "mes_passado"]);

function screenParams(range) {
  if (range.id === "hoje") return { period: "today" };
  if (range.id === "ontem") return { period: "yesterday" };
  return { period: "custom", startDate: range.startDate, endDate: range.endDate };
}

const usableCache = (entry) => Boolean(entry) && (Number(entry.staleMinutes) || 0) <= HENRY_CACHE_MAX_AGE_MINUTES;

function sameRange(payload, range) {
  return payload?.range?.startDate === range.startDate && payload?.range?.endDate === range.endDate;
}

// Desempenho do período (slimOverview: funil, equipe, ranking, atenção).
// O período anterior de "este mês"/"esta semana" (comparação) também vem do cache, se for o mesmo intervalo.
export async function loadHenryOverview(auth, range) {
  // "Últimos 30 dias" também tem pré-cálculo do Desempenho (Treino 7); sameRange garante que é a janela de hoje.
  const cacheId = CACHED_PERIODS.has(range.id) || ROLLING_OVERVIEW_IDS.includes(range.id) ? range.id : previousOverviewIdFor(range, getTodayInSaoPaulo());
  if (cacheId) {
    const entry = await readOverview(cacheId).catch(() => null);
    if (usableCache(entry) && sameRange(entry.payload, range)) return entry.payload;
  }
  return slimOverview(await getPerformanceOverview(screenParams(range), auth));
}

// Meta Diária da equipe no período (slimTeamGoal: % da equipe e de cada corretor = realizadas ÷ previstas).
export async function loadHenryTeamGoal(auth, range) {
  if (CACHED_PERIODS.has(range.id)) {
    const entry = await readTeamGoal(range.id).catch(() => null);
    if (usableCache(entry) && sameRange(entry.payload, range)) return entry.payload;
  }
  return slimTeamGoal(await getOwnerTeamDailyOverview(screenParams(range), auth));
}

// Meta do dia por corretor para o resumo do dono do relatório do dia (getPainelInicioDono loadMeta — Treino 4, 2026-10-25:
// relatorio_do_dia levava 6,4–7,5 s esperando getOwnerTeamDailyOverview). Pré-cálculo recente (a MESMA função, com a visão
// do dono) no formato que buildOwnerTeamRows lê; sem ele, a conta na hora como a tela.
export async function loadHenryOwnerMetaToday(auth) {
  const entry = await readTeamGoal("hoje").catch(() => null);
  if (usableCache(entry) && Array.isArray(entry.payload?.brokers)) {
    return { brokers: entry.payload.brokers.map((broker) => ({ brokerId: broker.id, meta: { percent: broker.percent, pending: broker.pending } })) };
  }
  return getOwnerTeamDailyOverview({ period: "today" }, auth);
}

// Leads (cadastros novos) do período por origem, no escopo de quem pergunta (o dono = todos). Paginado: período longo
// pode passar das 1.000 linhas de uma consulta.
const LEADS_PAGE = 1000;
const LEADS_MAX_PAGES = 20;
export async function loadHenryLeadOrigins(auth, range) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  const startIso = zonedPlainDateToUtcIso(range.startDate);
  const endIso = zonedPlainDateToUtcIso(addDaysToPlainDate(range.endDate, 1));
  const rows = [];
  for (let page = 0; page < LEADS_MAX_PAGES; page += 1) {
    const { data, error } = await applyResponsibleUserScope(
      supabase.from("simulation_registrations").select("id, full_name, acquisition_context").gte("created_at", startIso).lt("created_at", endIso).order("created_at", { ascending: true }),
      auth
    ).range(page * LEADS_PAGE, page * LEADS_PAGE + LEADS_PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < LEADS_PAGE) break;
  }
  // Primeiros nomes só quando dá para falar (Treino 4: "me passa o nome deles"); cliente sem nome real = "" (clientFirstNameOf).
  return { ...leadOriginBreakdown(rows), ...(rows.length <= HENRY_SPOKEN_NAMES_MAX ? { names: rows.map((row) => clientFirstNameOf(row.full_name)) } : {}) };
}

// Foto e primeiro nome dos corretores (a mesma photo_url que o painel já mostra) para o cardzinho da cena.
export async function loadHenryBrokerCards() {
  const profiles = await listAdminProfiles();
  return new Map(profiles.filter((profile) => profile.id).map((profile) => [profile.id, { id: profile.id, name: profile.name || "", photoUrl: profile.photoUrl || "", gender: profile.gender || "" }]));
}

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
function describeDate(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const days = Math.floor((Date.now() - time) / 86400000);
  const when = days <= 0 ? (time > Date.now() ? "" : "hoje") : days === 1 ? "ontem" : `há ${days} dias`;
  return when ? `${DATE_FORMAT.format(new Date(time))} (${when})` : DATE_FORMAT.format(new Date(time));
}

// --- Clientes (dono, 2026-10-23 — HENRY-1 "Leitura ampla") ---------------------------------------------------------------
// VÁRIOS clientes por pedido, cada um com etapa, responsável, último atendimento (lib/client-attendance — a mesma régua dos
// 3 dias), próxima atividade (Agenda), simulação e prova de envio (FUN-13), documentos (último lote), CCA (passagem aberta),
// origem e as 3 últimas movimentações (linha do tempo da ficha). SOMENTE LEITURA, escopo de quem pergunta (o dono = tudo),
// sem contatos Particulares (mesmo filtro da lista de Clientes). Consultas em paralelo; cada parte que falhar vira "não
// conferido" (nunca um dado inventado) e o motivo vai ao log. Nunca CPF/documento; telefone só com withPhone.
const ATTENDANCE_LOOKBACK_MS = 365 * 86400000;
const CLIENT_PART_TIMEOUT_MS = 5000;

function soft(label, promise) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), CLIENT_PART_TIMEOUT_MS); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)).catch((error) => {
    console.warn(`[henry] cliente: ${label} indisponível (${error?.message === "timeout" ? "timeout" : error?.name || "erro"}).`);
    return null;
  });
}

const WHEN_FORMAT = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const TIME_FORMAT = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
// Passado: "20/10 (há 2 dias)"; futuro: "24/10 às 14:00".
function describeWhen(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  if (time > Date.now()) return WHEN_FORMAT.format(new Date(time)).replace(", ", " às ");
  return describeDate(iso);
}

async function findClientRows(supabase, auth, query, columns) {
  let builder = supabase.from("simulation_registrations").select(columns).is("private_contact_at", null);
  if (query.kind === "phone") {
    const candidates = phoneLookupCandidates(query.term);
    if (!candidates.length) return [];
    builder = builder.in("phone_normalized", candidates);
  } else {
    builder = builder.ilike("full_name", `%${query.term}%`);
  }
  const { data, error } = await applyResponsibleUserScope(builder, auth)
    .order("last_status_change_at", { ascending: false, nullsFirst: false })
    .limit(HENRY_CLIENT_ROWS_PER_QUERY);
  if (error) throw error;
  return data || [];
}

function nextActivityOf(activities = [], row) {
  const now = Date.now();
  const pending = activities.filter((item) => item.status === "pending" && item.scheduledActivityAt && !item.financialSaleId);
  const legacy = row.scheduled_activity_at && !row.scheduled_activity_completed_at ? [{ title: "Atividade do card", scheduledActivityAt: row.scheduled_activity_at }] : [];
  const sorted = [...pending, ...legacy].sort((a, b) => Date.parse(a.scheduledActivityAt) - Date.parse(b.scheduledActivityAt));
  const next = sorted.find((item) => Date.parse(item.scheduledActivityAt) >= now) || sorted.at(-1);
  if (!next) return null;
  return { title: next.title || "Atividade", at: next.scheduledActivityAt, overdue: Date.parse(next.scheduledActivityAt) < now };
}

async function loadClientDetails(supabase, auth, rows) {
  const ids = rows.map((row) => row.id);
  if (!ids.length) return new Map();
  const [attendance, activities, simulations, batches, channels] = await Promise.all([
    soft("último atendimento", loadRecentAttendanceByClient(supabase, { sinceIso: new Date(Date.now() - ATTENDANCE_LOOKBACK_MS).toISOString(), clientIds: ids })),
    soft("agenda", listCalendarActivitiesForClients(ids, auth)),
    soft("simulações", supabase.from("simulations").select("registration_id, financing_value, subsidy_value, created_by").in("registration_id", ids).then(({ data, error }) => { if (error) throw error; return data || []; })),
    soft("documentos", supabase.from("client_document_batches")
      .select("client_id, status, total_files, created_at, analysisSkipped:summary->analysisSkipped, conform:summary->conform, pending:summary->pending, illegible:summary->illegible, divergence:summary->divergence, needsConfirmation:summary->needsConfirmation")
      .in("client_id", ids).order("created_at", { ascending: false })
      .then(({ data, error }) => { if (error) throw error; return data || []; })),
    // Em qual WhatsApp está a conversa (oficial / pessoal de quem, Número 1 ou 2) — a mesma leitura e escopo do Chat.
    soft("WhatsApp", listClientChatChannels(ids, auth))
  ]);
  const perClient = await Promise.all(rows.map((row) => Promise.all([
    soft("prova de envio", loadSimulationSentEvidence(row.id)),
    soft("CCA", getCurrentCcaStatus(row.id).then((entry) => ({ entry }))),
    soft("linha do tempo", getPrivateJourney(row.id, auth, { limit: 3 }))
  ])));
  const details = new Map();
  rows.forEach((row, index) => {
    const [evidence, cca, journey] = perClient[index];
    const lastAttendanceAt = attendance?.get(row.id) || null;
    const lastContactMs = attendanceReferenceAt({ lastWhatsappContactAt: row.last_whatsapp_contact_at, createdAt: null, lastAttendanceAt });
    details.set(row.id, {
      lastContactAt: Number.isFinite(lastContactMs) ? new Date(lastContactMs).toISOString() : "",
      nextActivity: activities ? nextActivityOf(activities.get(row.id) || [], row) : null,
      simulation: simulations ? describeSimulation({ rows: simulations.filter((item) => item.registration_id === row.id), sent: evidence ? evidence.sent === true : null }) : "",
      documents: batches ? describeDocuments(batches.find((item) => item.client_id === row.id)) : "",
      cca: cca ? describeCca(cca.entry, describeWhen) : "",
      origin: journey?.origin?.source_label || "",
      chat: describeChatChannels(channels ? channels.get(row.id) || [] : null, { viewerId: auth?.profile?.id || "", formatDate: describeWhen }),
      events: (journey?.events || []).slice(0, 3).map((event) => {
        const { title, description } = journeyEventTitleAndDescription(event, { origin: journey.origin, registration: journey.registration });
        return { title, description: (description || []).filter(Boolean).join(" · ").slice(0, 160), at: event.occurredAt };
      })
    });
  });
  return details;
}

// recentText = o que o Henry falou há pouco (desempate de nome repetido pela conversa, clientFromConversation).
export async function searchHenryClientsMany(auth, queries = [], { withPhone = false, recentText = "" } = {}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  const columns = `id, full_name, status, responsible_user_id, created_at, last_whatsapp_contact_at, last_status_change_at, scheduled_activity_at, scheduled_activity_completed_at${withPhone ? ", phone" : ""}`;
  const [found, cards] = await Promise.all([
    Promise.all(queries.map((query) => findClientRows(supabase, auth, query, columns))),
    loadHenryBrokerCards().catch(() => new Map())
  ]);
  const brokerName = (id) => cards.get(id)?.name || "";
  const picked = queries.map((query, index) => ({ query, rows: pickClientMatches(query, found[index], brokerName, { recentText, statusLabel: clientStatusLabel }) }));
  const singles = picked.filter((item) => item.rows.length === 1).map((item) => item.rows[0]);
  const unique = [...new Map(singles.map((row) => [row.id, row])).values()];
  const details = await loadClientDetails(supabase, auth, unique);
  return buildHenryClientsReport({
    results: picked.map((item) => ({ ...item, details })),
    statusLabel: clientStatusLabel,
    brokerName,
    formatDate: describeWhen,
    withPhone
  });
}

// Clientes numa etapa AGORA (Treino 5, 2026-10-25: "e os vinte esperando?" = os aprovados aguardando): os MESMOS status da
// etapa que a Alexa/Henry contam (ETAPA_STATUSES, rótulos da tela Clientes), escopo de quem pergunta, fora Particular
// (como a lista de Clientes), mais antigos na etapa primeiro (last_status_change_at). Só leitura.
const STAGE_ROWS_MAX = 30;
export async function loadHenryStageClients(auth, etapa) {
  const statuses = ETAPA_STATUSES[etapa];
  if (!statuses) return null;
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  const base = () => applyResponsibleUserScope(supabase.from("simulation_registrations").select("id", { count: "exact", head: true }).in("status", statuses).is("private_contact_at", null), auth);
  const [counted, listed, cards] = await Promise.all([
    base(),
    applyResponsibleUserScope(
      supabase.from("simulation_registrations").select("full_name, responsible_user_id, last_status_change_at, created_at").in("status", statuses).is("private_contact_at", null),
      auth
    )
      .order("last_status_change_at", { ascending: true, nullsFirst: false })
      .limit(STAGE_ROWS_MAX),
    loadHenryBrokerCards().catch(() => new Map())
  ]);
  if (counted.error) throw counted.error;
  if (listed.error) throw listed.error;
  const rows = (listed.data || []).map((row) => ({
    full_name: row.full_name,
    since: row.last_status_change_at || row.created_at,
    broker: firstNameOfCard(cards.get(row.responsible_user_id)?.name)
  }));
  return { total: counted.count ?? rows.length, rows };
}
const firstNameOfCard = (name) => String(name || "").trim().split(/\s+/)[0] || "";

// --- Chat (WA-24/INI-5): aguardando resposta por corretor e a conversa de um cliente --------------------------------------
// Mesma conta do Início do dono (getChatSummary byBroker). A conversa de UM cliente: só contagens, datas e o resumo da IA
// que JÁ existe em cache (whatsapp_conversations.ai_summary) — nunca gera resumo novo. Particular e excluída ficam fora.
export async function loadHenryAwaiting(auth, { brokerId = "" } = {}) {
  const [summary, cards] = await Promise.all([getChatSummary(auth, { byBroker: true }), loadHenryBrokerCards().catch(() => new Map())]);
  return buildHenryAwaitingReport({ total: summary.awaitingReply, late: summary.awaitingLate, groups: summary.awaitingByBroker || [], brokerName: (id) => cards.get(id)?.name || "", onlyBrokerId: brokerId });
}

export async function loadHenryClientConversation(auth, rawName) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  const query = { kind: "name", term: sanitizeClientSearchTerm(rawName), label: sanitizeClientSearchTerm(rawName), broker: "" };
  if (query.term.length < 2) return null;
  const cards = await loadHenryBrokerCards().catch(() => new Map());
  const rows = pickClientMatches(query, await findClientRows(supabase, auth, query, "id, full_name, status, responsible_user_id"), (id) => cards.get(id)?.name || "");
  if (rows.length !== 1) {
    return buildHenryClientsReport({ results: [{ query, rows }], statusLabel: clientStatusLabel, brokerName: (id) => cards.get(id)?.name || "" });
  }
  const { data, error } = await supabase.from("whatsapp_conversations")
    .select("id, last_message_at, last_inbound_at, last_human_reply_at, unread_count, ai_summary")
    .eq("client_id", rows[0].id).is("deleted_at", null).is("private_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false }).limit(5);
  if (error) throw error;
  const channels = await soft("WhatsApp", listClientChatChannels([rows[0].id], auth));
  const chat = channels ? describeChatChannels(channels.get(rows[0].id) || [], { viewerId: auth?.profile?.id || "", formatDate: describeWhen }) : null;
  return buildHenryConversationReport({ clientName: rows[0].full_name, conversations: data || [], formatDate: describeWhen, chat });
}

// --- Financeiro resumido (SÓ o dono): mesma conta dos indicadores da tela (calculateReceivableMetrics) --------------------
// repair: false = leitura pura (o auto-reparo da tela grava; o Henry nunca grava — HENRY-1).
export async function loadHenryFinance(auth) {
  if (!isExpectedReceiptOwner(auth)) return null;
  const sales = await listFinancialSales(auth, { repair: false });
  return buildHenryFinanceReport(calculateReceivableMetrics(flattenReceivableEntries(sales, (sale) => calculateFinancialTotals(sale).grossCommission)));
}

// --- Presença hoje (ROL-2f + PRES-WIFI): o painel Supervisão › Online e "o dono está na imobiliária" ---------------------
export async function loadHenryPresence(auth) {
  const [team, ownerAtOffice] = await Promise.all([getTeamPresence(auth), isOwnerAtOffice()]);
  return buildHenryPresenceReport({ members: team.members || [], ownerAtOffice, ownerId: auth?.profile?.id || "", formatTime: (iso) => TIME_FORMAT.format(new Date(iso)) });
}

// Abrir a ficha de um cliente pelo nome (navegação guiada): só id, primeiro nome, inicial do sobrenome, etapa e
// responsável — nada de telefone/CPF. Mesmo escopo e filtro da lista de Clientes (sem contatos Particulares).
export async function findHenryClientsByName(auth, rawName) {
  const term = sanitizeClientSearchTerm(rawName);
  if (term.length < 2) return [];
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  const [{ data, error }, cards] = await Promise.all([
    applyResponsibleUserScope(supabase.from("simulation_registrations").select("id, full_name, status, responsible_user_id").is("private_contact_at", null).ilike("full_name", `%${term}%`), auth)
      .order("last_status_change_at", { ascending: false, nullsFirst: false })
      .limit(6),
    loadHenryBrokerCards().catch(() => new Map())
  ]);
  if (error) throw error;
  return (data || []).map((row) => {
    const parts = String(row.full_name || "").trim().split(/\s+/);
    return {
      id: row.id,
      firstName: parts[0] || "Cliente",
      lastInitial: parts.length > 1 ? `${parts[parts.length - 1].charAt(0).toUpperCase()}.` : "",
      stage: clientStatusLabel(row.status) || "",
      responsible: String(cards.get(row.responsible_user_id)?.name || "sem responsável").split(/\s+/)[0]
    };
  });
}

// Imóveis e empreendimentos (Treino 2, 2026-10-25 — HENRY-1 "Leitura ampla"): a MESMA lista das telas Imóveis e
// Empreendimentos (listProperties, cache de 30 s), só leitura; a montagem fica em buildHenryPropertiesReport.
export async function loadHenryProperties({ query = "", tipo = "" } = {}) {
  return buildHenryPropertiesReport({ properties: await listProperties(), query, tipo });
}
