import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { applyResponsibleUserScope, assertCanAccessResponsibleUser } from "./admin-access";
import { isGeneralAdminAuth, isManagerProfile, listVisibleTeamProfiles } from "./admin-profiles";
import { CLIENT_STATUS, CLIENT_FUNNEL_SALE_STATUS_VALUES, CLIENT_FUNNEL_STAGES, getClientFunnelStage, mergeActivitySignal } from "./client-status";
import { listCalendarActivitiesForClients } from "./calendar-activities";
import { computeOpportunityScore, PRIORITY_BANDS } from "./opportunity-scoring";

const EXCLUDED_STATUSES = [CLIENT_STATUS.ARCHIVED, CLIENT_STATUS.DO_NOT_CONTACT, ...CLIENT_FUNNEL_SALE_STATUS_VALUES];
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_TOP_COUNT = 5;
const FETCH_PAGE_SIZE = 1000;
const BATCH_SIZE = 150;

function db() {
  return getSupabaseAdminClient();
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

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

/* --------------------------- carga em lote (única) -------------------------- */

async function listActiveOpportunityClients(auth) {
  return fetchAllRows((from, to) => {
    let query = db()
      .from("simulation_registrations")
      .select("id, full_name, phone_normalized, responsible_user_id, status, created_at, approved_at, last_status_change_at, last_whatsapp_contact_at, scheduled_activity_at, scheduled_activity_completed_at")
      .not("status", "in", `(${EXCLUDED_STATUSES.map((status) => `"${status}"`).join(",")})`)
      .order("id", { ascending: true })
      .range(from, to);
    query = applyResponsibleUserScope(query, auth, "responsible_user_id");
    return query;
  });
}

// Status de documentação em lote: mesma semântica de campos de
// lib/broker-alert.js (document_id/status/extracted_data.expired), só que
// para todos os clientes ativos de uma vez, nunca por cliente. 3 estados —
// ver .claude/rules/crm-clientes-funil.md: ausência de linha NUNCA é
// "completo", é "not_started".
async function loadDocumentationStatusByClient(clientIds) {
  const byClient = new Map();
  if (!clientIds.length) return byClient;

  for (const batch of chunkArray(clientIds, BATCH_SIZE)) {
    const { data, error } = await db()
      .from("client_document_checklist_items")
      .select("client_id, document_id, status, extracted_data")
      .in("client_id", batch);
    if (error) throw error;

    for (const row of data || []) {
      if (!byClient.has(row.client_id)) byClient.set(row.client_id, { hasRows: true, pending: false });
      const entry = byClient.get(row.client_id);
      entry.hasRows = true;
      if (!row.document_id) {
        if (row.status === "ausente" || row.status === "pendencia") entry.pending = true;
      } else if (row.extracted_data?.expired || row.status === "ilegivel" || row.status === "divergencia") {
        entry.pending = true;
      }
    }
  }

  const result = new Map();
  for (const clientId of clientIds) {
    const entry = byClient.get(clientId);
    if (!entry) result.set(clientId, "not_started");
    else result.set(clientId, entry.pending ? "incomplete" : "complete");
  }
  return result;
}

// Última mensagem INBOUND por cliente (related_client_id já resolvido no
// ingest do webhook — ver lib/whatsapp-master.js) — em lote, reduzida em
// memória pro mais recente por cliente (sem GROUP BY via PostgREST).
async function loadLatestInboundWhatsappByClient(clientIds) {
  const byClient = new Map();
  if (!clientIds.length) return byClient;

  for (const batch of chunkArray(clientIds, BATCH_SIZE)) {
    const { data, error } = await db()
      .from("whatsapp_master_events")
      .select("related_client_id, event_at")
      .in("related_client_id", batch)
      .eq("event_type", "message")
      .eq("direction", "inbound");
    if (error) throw error;

    for (const row of data || []) {
      if (!row.related_client_id || !row.event_at) continue;
      const current = byClient.get(row.related_client_id);
      if (!current || row.event_at > current) byClient.set(row.related_client_id, row.event_at);
    }
  }
  return byClient;
}

// Última interação no histórico do cliente (client_journey_events) — só um
// sinal auxiliar de "última movimentação"; best-effort de propósito (a
// pontuação já tem um fallback robusto em lastWhatsappContactAt/createdAt
// via lib/client-status.js caso essa consulta falhe por qualquer motivo).
async function loadLastInteractionByClient(clientIds) {
  const byClient = new Map();
  if (!clientIds.length) return byClient;

  try {
    for (const batch of chunkArray(clientIds, BATCH_SIZE)) {
      const { data, error } = await db()
        .from("client_journey_events")
        .select("client_id, occurred_at")
        .in("client_id", batch);
      if (error) throw error;
      for (const row of data || []) {
        if (!row.client_id || !row.occurred_at) continue;
        const current = byClient.get(row.client_id);
        if (!current || row.occurred_at > current) byClient.set(row.client_id, row.occurred_at);
      }
    }
  } catch {
    return new Map();
  }
  return byClient;
}

// A ÚNICA função desta camada que toca o banco pra montar a base de
// oportunidades — tudo mais (paginação, TOP 5, cards, por-corretor,
// gargalos) deriva deste array em memória, nunca recarrega nada sozinho.
async function loadOpportunityDataset(auth) {
  const rows = await listActiveOpportunityClients(auth);
  const clientIds = rows.map((row) => row.id);

  const [activitiesByClient, documentationByClient, inboundWhatsappByClient, lastInteractionByClient] = await Promise.all([
    listCalendarActivitiesForClients(clientIds, auth),
    loadDocumentationStatusByClient(clientIds),
    loadLatestInboundWhatsappByClient(clientIds),
    loadLastInteractionByClient(clientIds)
  ]);

  return rows.map((row) => {
    const client = mergeActivitySignal(
      {
        id: row.id,
        fullName: row.full_name || "",
        phoneNormalized: row.phone_normalized || "",
        responsibleUserId: row.responsible_user_id || "",
        status: row.status,
        createdAt: row.created_at,
        approvedAt: row.approved_at,
        lastStatusChangeAt: row.last_status_change_at,
        lastWhatsappContactAt: row.last_whatsapp_contact_at,
        scheduledActivityAt: row.scheduled_activity_at,
        scheduledActivityCompletedAt: row.scheduled_activity_completed_at
      },
      activitiesByClient.get(row.id) || []
    );

    const signals = {
      documentationStatus: documentationByClient.get(row.id) || "not_started",
      recentInboundWhatsappAt: inboundWhatsappByClient.get(row.id) || null,
      lastInteractionAt: lastInteractionByClient.get(row.id) || null
    };

    const scored = computeOpportunityScore(client, signals);
    return {
      ...client,
      stage: getClientFunnelStage(client.status),
      documentationStatus: signals.documentationStatus,
      ...scored
    };
  });
}

/* ------------------------- derivações puras (sem I/O) ------------------------ */

function matchesFilters(item, filters = {}) {
  if (filters.category && item.category !== filters.category) return false;
  if (filters.stage && item.stage !== filters.stage) return false;
  if (filters.responsibleUserId && item.responsibleUserId !== filters.responsibleUserId) return false;
  if (filters.minPriority != null && item.priority < filters.minPriority) return false;
  if (filters.tag && !item.tags.includes(filters.tag)) return false;
  if (filters.hasFutureActivity === true && item.recommendedAction.type !== "scheduled") return false;
  if (filters.hasFutureActivity === false && item.recommendedAction.type === "scheduled") return false;
  return true;
}

function matchesSearch(item, search) {
  if (!search) return true;
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const digits = query.replace(/\D/g, "");
  const nameMatch = item.fullName.toLowerCase().includes(query);
  const phoneMatch = digits ? (item.phoneNormalized || "").includes(digits) : false;
  return nameMatch || phoneMatch;
}

const SORTERS = {
  priority: (a, b) => b.priority - a.priority,
  score: (a, b) => b.score - a.score,
  urgency: (a, b) => b.urgency - a.urgency
};

function paginateOpportunities(dataset, { filters = {}, search = "", sort = "priority", page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const filtered = dataset.filter((item) => matchesFilters(item, filters) && matchesSearch(item, search));
  const sorter = SORTERS[sort] || SORTERS.priority;
  const sorted = [...filtered].sort(sorter);

  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));
  const totalPages = Math.max(1, Math.ceil(sorted.length / safePageSize));
  const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
  const start = (safePage - 1) * safePageSize;

  return {
    items: sorted.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    total: sorted.length,
    totalPages
  };
}

function pickTopOpportunities(dataset, topN = DEFAULT_TOP_COUNT) {
  return [...dataset].sort(SORTERS.priority).slice(0, topN);
}

function summarizeOpportunityCards(dataset) {
  return {
    hot: dataset.filter((item) => item.category === "hot").length,
    approvedNoMeeting: dataset.filter((item) => item.tags.includes("approved_no_meeting")).length,
    recentResponse: dataset.filter((item) => item.tags.includes("recent_response")).length,
    noFutureActivity: dataset.filter((item) => item.tags.includes("no_future_activity")).length
  };
}

function summarizeOpportunitiesByBroker(dataset, profiles) {
  const nameById = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const counts = new Map();
  for (const item of dataset) {
    if (!item.responsibleUserId) continue;
    if (!nameById.has(item.responsibleUserId)) continue;
    const bucket = counts.get(item.responsibleUserId) || { brokerId: item.responsibleUserId, brokerName: nameById.get(item.responsibleUserId), critical: 0, total: 0 };
    bucket.total += 1;
    if (item.category === "hot" || item.category === "high") bucket.critical += 1;
    counts.set(item.responsibleUserId, bucket);
  }
  return Array.from(counts.values()).sort((a, b) => b.critical - a.critical || b.total - a.total);
}

const GAP_DEFINITIONS = [
  { key: "approved_no_meeting", label: "Aprovados sem reunião", match: (item) => item.tags.includes("approved_no_meeting") },
  { key: "awaiting_documentation", label: "Simulações sem documentação", match: (item) => item.tags.includes("awaiting_documentation") },
  { key: "meeting_no_follow_up", label: "Reuniões sem follow-up", match: (item) => item.tags.includes("meeting_done") },
  { key: "no_future_activity", label: "Clientes avançados sem atividade futura", match: (item) => item.tags.includes("no_future_activity") }
];

// Nunca devolve a lista de clientId's aqui: a UI já resolve "clique no
// gargalo -> abre a lista filtrada" reaproveitando o mesmo filtro por tag da
// listagem paginada (getOpportunitiesPageData com { filters: { tag } }) —
// enumerar client_id por gargalo chegou a mandar quase a base inteira de
// clientes (centenas de UUIDs) numa única resposta só pra um contador.
function computeOpportunityGaps(dataset) {
  return GAP_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    count: dataset.filter(definition.match).length
  })).filter((gap) => gap.count > 0);
}

/* ------------------------------- orquestrador -------------------------------- */

// Único ponto de entrada da listagem: garante estruturalmente UMA carga do
// dataset por requisição, mesmo devolvendo página + TOP 5 + cards +
// por-corretor + gargalos juntos. Nenhuma outra função deste arquivo (fora
// desta) sabe carregar o dataset sozinha.
export async function getOpportunitiesPageData(auth, { filters, search, sort, page, pageSize } = {}) {
  const dataset = await loadOpportunityDataset(auth);

  const result = {
    page: paginateOpportunities(dataset, { filters, search, sort, page, pageSize }),
    top: pickTopOpportunities(dataset, DEFAULT_TOP_COUNT),
    cards: summarizeOpportunityCards(dataset)
  };

  if (isGeneralAdminAuth(auth) || isManagerProfile(auth?.profile)) {
    const profiles = await listVisibleTeamProfiles(auth);
    result.byBroker = summarizeOpportunitiesByBroker(dataset, profiles);
    result.gaps = computeOpportunityGaps(dataset);
  }

  return result;
}

export async function getOpportunityDetail(clientId, auth) {
  const { data, error } = await db()
    .from("simulation_registrations")
    .select("id, full_name, phone_normalized, responsible_user_id, status, created_at, approved_at, last_status_change_at, last_whatsapp_contact_at, scheduled_activity_at, scheduled_activity_completed_at")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  assertCanAccessResponsibleUser(auth, data.responsible_user_id || "");

  const [activities, documentationByClient, inboundWhatsappByClient, lastInteractionByClient] = await Promise.all([
    listCalendarActivitiesForClients([clientId], auth),
    loadDocumentationStatusByClient([clientId]),
    loadLatestInboundWhatsappByClient([clientId]),
    loadLastInteractionByClient([clientId])
  ]);

  const client = mergeActivitySignal(
    {
      id: data.id,
      fullName: data.full_name || "",
      phoneNormalized: data.phone_normalized || "",
      responsibleUserId: data.responsible_user_id || "",
      status: data.status,
      createdAt: data.created_at,
      approvedAt: data.approved_at,
      lastStatusChangeAt: data.last_status_change_at,
      lastWhatsappContactAt: data.last_whatsapp_contact_at,
      scheduledActivityAt: data.scheduled_activity_at,
      scheduledActivityCompletedAt: data.scheduled_activity_completed_at
    },
    activities.get(clientId) || []
  );

  const signals = {
    documentationStatus: documentationByClient.get(clientId) || "not_started",
    recentInboundWhatsappAt: inboundWhatsappByClient.get(clientId) || null,
    lastInteractionAt: lastInteractionByClient.get(clientId) || null
  };

  const scored = computeOpportunityScore(client, signals);
  return { ...client, stage: getClientFunnelStage(client.status), documentationStatus: signals.documentationStatus, ...scored };
}

export const OPPORTUNITY_STAGES = CLIENT_FUNNEL_STAGES;
export const OPPORTUNITY_PRIORITY_BANDS = PRIORITY_BANDS;
