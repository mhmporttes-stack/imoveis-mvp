import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { applyResponsibleUserScope } from "./admin-access";
import {
  applyDoNotContactScope,
  rowToSimulationRegistration
} from "./simulation-registrations";
import { rowToSimulation } from "./simulation-mapper";
import { getSimulationListSummary, resolveClientStatus } from "./simulation-list-utils";
import {
  CLIENT_STATUS,
  CLIENT_STATUS_FILTER_GROUPS,
  CLIENT_STATUS_VALUES,
  ACTIVE_CLIENT_STATUS_VALUES,
  normalizeClientStatus
} from "./client-status";

const NO_CONTACT_ALERT_MS = 3 * 24 * 60 * 60 * 1000;
export const DEFAULT_PAGE_SIZE = 5;
export const PAGE_SIZE_OPTIONS = [5, 10, 20];

// Lista completa de status "ativos" (usada por noFutureActivityOnly), como
// array simples — reaproveita o Set já canônico de lib/client-status.js.
const ACTIVE_STATUS_LIST = Array.from(ACTIVE_CLIENT_STATUS_VALUES);

function getClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado para listar clientes.");
  return supabase;
}

// O PostgREST devolve no máximo 1000 linhas por requisição por padrão —
// qualquer consulta que precise da lista COMPLETA de IDs correspondentes
// (não uma página) tem que paginar em blocos, senão trunca silenciosamente
// acima de 1000 linhas. Mesmo padrão já usado em outras libs do projeto
// (ex.: lib/performance-overview.js).
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

// Sanitiza um termo de busca livre para uso seguro dentro do mini-linguajar
// de filtros do PostgREST (.or()), onde vírgulas, parênteses e * têm
// significado especial — nunca passar o texto do usuário sem tratar.
function sanitizeFilterTerm(value) {
  return String(value || "")
    .replace(/[,()*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function escapeIlikeValue(value) {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`);
}

function applySearchFilter(query, rawQuery) {
  const term = sanitizeFilterTerm(rawQuery);
  if (!term) return query;

  const escaped = escapeIlikeValue(term);
  const digits = term.replace(/\D/g, "");
  const ors = [`full_name.ilike.%${escaped}%`, `client_code.ilike.%${escaped}%`];
  if (digits) ors.push(`phone_normalized.ilike.%${digits}%`);

  return query.or(ors.join(","));
}

function statusesForGroup(groupKey) {
  return CLIENT_STATUS_FILTER_GROUPS.find((group) => group.key === groupKey)?.statuses || [];
}

// IDs de simulation_registrations com algum sinal de atividade futura ainda
// válida: o campo legado (scheduled_activity_at) OU uma linha pendente em
// calendar_activities (lib/calendar-activities.js) — mesma fusão de fontes
// que mergeActivitySignal fazia no navegador (lib/client-status.js), só que
// aqui buscamos apenas os IDs (conjunto pequeno, não o cliente inteiro) para
// aplicar como exclusão nas consultas paginadas.
async function getRegistrationIdsWithFutureCalendarActivity(supabase, nowIso) {
  const rows = await fetchAllRows((from, to) => supabase
    .from("calendar_activities")
    .select("client_id")
    .eq("status", "pending")
    .gte("scheduled_at", nowIso)
    .order("id", { ascending: true })
    .range(from, to));

  return Array.from(new Set(rows.map((row) => row.client_id).filter(Boolean)));
}

function applyNoOwnFutureActivityFilter(query, nowIso) {
  // scheduled_activity_at (campo legado) não é futura/pendente:
  // nula, no passado, ou já concluída.
  return query.or(`scheduled_activity_at.is.null,scheduled_activity_at.lt.${nowIso},scheduled_activity_completed_at.not.is.null`);
}

function applyNotInFutureActivityIds(query, ids) {
  if (!ids.length) return query;
  return query.not("id", "in", `(${ids.join(",")})`);
}

function applyStaleContactFilter(query, cutoffIso) {
  return query
    .not("status", "in", `(${CLIENT_STATUS.ARCHIVED},${CLIENT_STATUS.DO_NOT_CONTACT})`)
    .or(`and(last_whatsapp_contact_at.not.is.null,last_whatsapp_contact_at.lt.${cutoffIso}),and(last_whatsapp_contact_at.is.null,created_at.lt.${cutoffIso})`);
}

async function resolveTagRegistrationIds(supabase, tagId) {
  if (!tagId || tagId === "all") return null;
  const rows = await fetchAllRows((from, to) => supabase
    .from("client_tags")
    .select("client_id")
    .eq("tag_id", tagId)
    .range(from, to));

  return Array.from(new Set(rows.map((row) => row.client_id).filter(Boolean)));
}

// Aplica, numa query já criada, todos os filtros que não dependem do status
// (busca, corretor, tag, pendentes, sem contato, sem atividade futura) — é a
// base tanto da página pedida quanto dos contadores por aba, que precisam
// dos MESMOS filtros "menos status" para os números baterem com o que está
// selecionado (igual ao comportamento antigo de scopedClients no navegador).
function applyScopedFilters(query, { auth, filters, nowIso, cutoffIso, futureActivityIds, tagRegistrationIds }) {
  query = applyResponsibleUserScope(query, auth, "responsible_user_id", filters.responsibleUserId);
  query = applyDoNotContactScope(query, auth);
  query = applySearchFilter(query, filters.query);

  if (tagRegistrationIds) {
    query = tagRegistrationIds.length ? query.in("id", tagRegistrationIds) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  if (filters.pendingOnly) {
    query = query.not("status", "in", `(${CLIENT_STATUS.ARCHIVED},${CLIENT_STATUS.DO_NOT_CONTACT})`);
    query = applyNoOwnFutureActivityFilter(query, nowIso);
    query = applyNotInFutureActivityIds(query, futureActivityIds);
    query = query.or(`and(last_whatsapp_contact_at.not.is.null,last_whatsapp_contact_at.lt.${cutoffIso}),and(last_whatsapp_contact_at.is.null,created_at.lt.${cutoffIso})`);
  } else {
    if (filters.staleContactOnly) query = applyStaleContactFilter(query, cutoffIso);
    if (filters.noFutureActivityOnly) {
      query = query.in("status", ACTIVE_STATUS_LIST);
      query = applyNoOwnFutureActivityFilter(query, nowIso);
      query = applyNotInFutureActivityIds(query, futureActivityIds);
    }
  }

  return query;
}

function pickBestSimulationRow(rows = []) {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];

  // Um cadastro raramente tem mais de uma simulação, mas quando tem
  // (re-simulação), preferimos a mais completa (com valores preenchidos) e,
  // empatado, a mais recente — mesmo critério informal que o merge antigo no
  // navegador usava (getClientScore), só que aplicado a um punhado de linhas
  // por cliente, nunca à base inteira.
  return rows.slice().sort((a, b) => {
    const scoreA = (Number(a.financing_value || 0) > 0 || Number(a.subsidy_value || 0) > 0) ? 1 : 0;
    const scoreB = (Number(b.financing_value || 0) > 0 || Number(b.subsidy_value || 0) > 0) ? 1 : 0;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  })[0];
}

// Formato do item devolvido para o componente — mesmo formato que
// buildClientItem() montava no navegador (menos os rótulos relativos de
// data, que continuam calculados no componente a partir dos campos brutos).
function rowToClientItem(row) {
  const registration = rowToSimulationRegistration(row);
  const bestSimulationRow = pickBestSimulationRow(row.simulations || []);
  const simulation = bestSimulationRow ? rowToSimulation(bestSimulationRow) : null;
  const summary = getSimulationListSummary(simulation || {});
  const status = resolveClientStatus(registration, summary);

  return {
    id: registration.id,
    completed: summary.completed || false,
    lastAdminLabel: registration.lastAdminName || "",
    lastWhatsappContactAt: registration.lastWhatsappContactAt || "",
    name: registration.fullName || "Cliente sem nome",
    registration,
    simulation,
    sortDate: registration.createdAt || "",
    createdAt: registration.createdAt || "",
    status,
    summary,
    scheduledActivityAt: registration.scheduledActivityAt || "",
    scheduledActivityType: registration.scheduledActivityType || "follow_up",
    scheduledActivityNote: registration.scheduledActivityNote || "",
    tags: registration.tags || []
  };
}

const SELECT_COLUMNS = "*, client_tags(tag:tags(*)), simulations(*)";

// Busca uma única página já filtrada, ordenada e paginada no banco — nunca
// carrega a base inteira de clientes. Reproduz o comportamento antigo de
// "Tentando contato" (awaiting_return) sempre por último dentro da aba
// "Todos": como o PostgREST não ordena por expressão calculada, fazemos duas
// consultas (não-awaiting_return e awaiting_return) e montamos a página
// certa a partir dos dois totais — só entra em jogo quando a aba "Todos"
// está selecionada, que é o único lugar onde awaiting_return convive com
// outros status (nas demais abas, ou é 100% awaiting_return, ou nunca
// aparece — a ordem entre eles não muda visualmente).
export async function listSimulationClientsPage({ auth, filters = {}, page = 1, pageSize = DEFAULT_PAGE_SIZE }) {
  const supabase = getClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - NO_CONTACT_ALERT_MS).toISOString();
  const safePageSize = PAGE_SIZE_OPTIONS.includes(Number(pageSize)) ? Number(pageSize) : DEFAULT_PAGE_SIZE;
  const safePage = Math.max(1, Number(page) || 1);

  const needsFutureActivityIds = filters.pendingOnly || filters.noFutureActivityOnly;
  const [futureActivityIds, tagRegistrationIds] = await Promise.all([
    needsFutureActivityIds ? getRegistrationIdsWithFutureCalendarActivity(supabase, nowIso) : Promise.resolve([]),
    resolveTagRegistrationIds(supabase, filters.tagId)
  ]);

  const groupStatuses = statusesForGroup(filters.statusGroup);
  const isAllTab = !filters.statusGroup || filters.statusGroup === "all";

  function buildFiltered(extraStatusValues, selectColumns = SELECT_COLUMNS, selectOptions = { count: "exact" }) {
    let query = supabase.from("simulation_registrations").select(selectColumns, selectOptions);
    query = applyScopedFilters(query, { auth, filters, nowIso, cutoffIso, futureActivityIds, tagRegistrationIds });

    if (isAllTab) {
      query = query.neq("status", CLIENT_STATUS.DO_NOT_CONTACT);
    } else if (groupStatuses.length) {
      query = query.in("status", groupStatuses);
    }

    if (filters.status && filters.status !== "all") {
      query = query.eq("status", filters.status);
    }

    if (extraStatusValues === "exclude-awaiting-return") {
      query = query.neq("status", CLIENT_STATUS.AWAITING_RETURN);
    } else if (extraStatusValues === "only-awaiting-return") {
      query = query.eq("status", CLIENT_STATUS.AWAITING_RETURN);
    }

    return query;
  }

  // Só a aba "Todos" sem substatus específico precisa do split — fora dela,
  // uma única consulta ordenada resolve exatamente igual ao comportamento
  // anterior (awaiting_return nunca aparece misturado com outro status).
  const needsTrailingSplit = isAllTab && (!filters.status || filters.status === "all");

  if (!needsTrailingSplit) {
    const offset = (safePage - 1) * safePageSize;
    const { data, error, count } = await buildFiltered(null)
      .order("created_at", { ascending: false })
      .range(offset, offset + safePageSize - 1);
    if (error) throw error;

    const total = count || 0;
    return {
      items: (data || []).map(rowToClientItem),
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, Math.ceil(total / safePageSize))
    };
  }

  const { count: nonTrailingTotal, error: nonTrailingCountError } = await buildFiltered(
    "exclude-awaiting-return", "id", { count: "exact", head: true }
  );
  if (nonTrailingCountError) throw nonTrailingCountError;

  const { count: trailingTotal, error: trailingCountError } = await buildFiltered(
    "only-awaiting-return", "id", { count: "exact", head: true }
  );
  if (trailingCountError) throw trailingCountError;

  const safeNonTrailingTotal = nonTrailingTotal || 0;
  const safeTrailingTotal = trailingTotal || 0;
  const total = safeNonTrailingTotal + safeTrailingTotal;
  const offset = (safePage - 1) * safePageSize;

  const rows = [];

  if (offset < safeNonTrailingTotal) {
    const end = Math.min(offset + safePageSize, safeNonTrailingTotal);
    const { data, error } = await buildFiltered("exclude-awaiting-return")
      .order("created_at", { ascending: false })
      .range(offset, end - 1);
    if (error) throw error;
    rows.push(...(data || []));
  }

  if (rows.length < safePageSize && offset + rows.length < total) {
    const trailingOffset = Math.max(0, offset - safeNonTrailingTotal);
    const remaining = safePageSize - rows.length;
    const { data, error } = await buildFiltered("only-awaiting-return")
      .order("created_at", { ascending: false })
      .range(trailingOffset, trailingOffset + remaining - 1);
    if (error) throw error;
    rows.push(...(data || []));
  }

  return {
    items: rows.map(rowToClientItem),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize))
  };
}

// Contadores por aba/substatus — sempre calculados sob os MESMOS filtros
// "menos status" da aba (busca, corretor, tag, pendentes, etc.), igual ao
// scopedClients de antes: os números batem com o que está filtrado, não com
// a base inteira. Uma contagem HEAD (count exact, sem corpo) por status, em
// paralelo — nunca busca as linhas em si, então não tem o limite padrão de
// 1000 linhas por requisição do PostgREST que uma consulta sem `.range()]
// teria ao ultrapassar esse tamanho (caso real: mais de 1986 cadastros).
//
// Exceção deliberada, preservando o comportamento original: o número na aba
// "Todos" NUNCA foi calculado sobre scopedClients no componente antigo — vinha
// de `clients` (só com escopo de permissão, ignorando busca/filtros), e por
// isso não se move junto com os outros quando o usuário busca ou filtra.
export async function getSimulationClientCounters({ auth, filters = {} }) {
  const supabase = getClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - NO_CONTACT_ALERT_MS).toISOString();

  let allTotalQuery = supabase.from("simulation_registrations").select("id", { count: "exact", head: true });
  allTotalQuery = applyResponsibleUserScope(allTotalQuery, auth, "responsible_user_id", "");
  allTotalQuery = applyDoNotContactScope(allTotalQuery, auth);
  allTotalQuery = allTotalQuery.neq("status", CLIENT_STATUS.DO_NOT_CONTACT);

  const needsFutureActivityIds = filters.pendingOnly || filters.noFutureActivityOnly;
  const [futureActivityIds, tagRegistrationIds, allTotalResult] = await Promise.all([
    needsFutureActivityIds ? getRegistrationIdsWithFutureCalendarActivity(supabase, nowIso) : Promise.resolve([]),
    resolveTagRegistrationIds(supabase, filters.tagId),
    allTotalQuery
  ]);
  if (allTotalResult.error) throw allTotalResult.error;
  const allTotal = allTotalResult.count || 0;

  const statusCountEntries = await Promise.all(CLIENT_STATUS_VALUES.map(async (status) => {
    let query = supabase.from("simulation_registrations").select("id", { count: "exact", head: true });
    query = applyScopedFilters(query, { auth, filters, nowIso, cutoffIso, futureActivityIds, tagRegistrationIds });
    query = query.eq("status", status);
    const { count, error } = await query;
    if (error) throw error;
    return [status, count || 0];
  }));

  const byStatus = Object.fromEntries(statusCountEntries.map(([status, count]) => [normalizeClientStatus(status), count]));

  const byGroup = {};
  for (const group of CLIENT_STATUS_FILTER_GROUPS) {
    byGroup[group.key] = group.key === "all"
      ? allTotal
      : group.statuses.reduce((total, status) => total + (byStatus[status] || 0), 0);
  }

  return { all: allTotal, byStatus, byGroup };
}

// Selo vermelho "clientes pendentes" no topo da lista: sempre GLOBAL (só
// escopado por permissão, nunca pelos filtros de busca/aba selecionados no
// momento) — mesmo comportamento de antes (pendingClientsCount vinha de
// `clients`, a lista completa, não de scopedClients).
export async function getPendingClientsCount({ auth }) {
  const supabase = getClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - NO_CONTACT_ALERT_MS).toISOString();

  const futureActivityIds = await getRegistrationIdsWithFutureCalendarActivity(supabase, nowIso);

  let query = supabase.from("simulation_registrations").select("id", { count: "exact", head: true });
  query = applyResponsibleUserScope(query, auth, "responsible_user_id", "");
  query = applyDoNotContactScope(query, auth);
  query = query.not("status", "in", `(${CLIENT_STATUS.ARCHIVED},${CLIENT_STATUS.DO_NOT_CONTACT})`);
  query = applyNoOwnFutureActivityFilter(query, nowIso);
  query = applyNotInFutureActivityIds(query, futureActivityIds);
  query = query.or(`and(last_whatsapp_contact_at.not.is.null,last_whatsapp_contact_at.lt.${cutoffIso}),and(last_whatsapp_contact_at.is.null,created_at.lt.${cutoffIso})`);

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}
