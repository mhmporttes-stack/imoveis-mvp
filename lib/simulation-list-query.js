import "server-only";
import { cache } from "react";
import { getSupabaseAdminClient } from "./supabase";
import { listClientIdsWithHumanAttendance } from "./whatsapp-attendance";
import { loadInboundChatAtByClient } from "./chat-contact-signal";
import { applyDocumentsOfflineSignal } from "./document-received-offline";
import { listAttendanceExclusionIds, loadRecentAttendanceByClient } from "./client-attendance";
import { laterContactAt } from "./chat-contact-signal-core.mjs";
import { applyResponsibleUserScope } from "./admin-access";
import {
  applyDoNotContactScope,
  rowToSimulationRegistration
} from "./simulation-registrations";
import { rowToSimulation } from "./simulation-mapper";
import { isGeneralAdminAuth } from "./admin-profiles";
import { addDaysToPlainDate, zonedPlainDateToUtcIso } from "./daily-report";
import { sponsoredCostOfClient, summarizeSponsoredCost, teamFallbackSponsoredCost, teamSponsoredCost } from "./sponsored-cost-core.mjs";
import { getSimulationListSummary, resolveClientStatus } from "./simulation-list-utils";
import { resolveSimulationResources } from "./simulation-resources-core.mjs";
import { loadRouletteQueueEntries } from "./lead-distribution";
import { compareRouletteQueueEntries, rouletteQueueLabel } from "./pending-roulette-core.mjs";
import { isTransferredCandidate, TRANSFERRED_AWAITING_EXCLUDED_STATUSES } from "./transferred-awaiting-core.mjs";

// Filtro "Corretor responsável" = Roleta (dono, 2026-10-22): todos que estão na fila da roleta (pending_distribution_at),
// dentro do escopo de sempre do perfil, ordenados pela posição real de entrega.
export const ROULETTE_RESPONSIBLE_FILTER = "roulette";

function pickResources({ downPaymentValue, fgtsValue, source }) {
  return { downPaymentValue, fgtsValue, resourcesSource: source };
}
import {
  CLIENT_STATUS,
  CLIENT_STATUS_FILTER_GROUPS,
  ACTIVE_CLIENT_STATUS_VALUES,
  normalizeClientStatus
} from "./client-status";
import { applyAllTabExclusions } from "./client-all-tab-core.mjs";
import { loadAllTabExcludedTagClientIds } from "./client-all-tab";

// Clientes com etiqueta negativa da aba Todos (CLI-12a): lidos uma vez por requisição (lista + contadores).
const loadAllTabTagClientIds = cache((supabase) => loadAllTabExcludedTagClientIds(supabase));

const NO_CONTACT_ALERT_MS = 3 * 24 * 60 * 60 * 1000;

// Aba "Patrocinado" (pedido do dono, 2026-10-08): todos os clientes que entraram por mídia PAGA, qualquer que seja a
// campanha/anúncio. Mesma evidência de lib/lead-origin.js (hasPaidMediaEvidence), avaliada no banco sobre client_origins:
// kind paid_link ou whatsapp_ad (anúncio Click to WhatsApp), marca paid_media, ID de anúncio ou utm_medium pago. Nunca por
// texto livre. Não é um grupo de status: mostra o cliente em QUALQUER status (menos "Não contactar"), como a aba Todos.
export const SPONSORED_TAB_KEY = "sponsored";
const SPONSORED_PAID_MEDIUMS = ["cpc", "ppc", "paid", "paid_social", "paid_search", "anuncio", "anúncio"];
export const SPONSORED_ORIGIN_FILTER = [
  "source_kind.in.(paid_link,whatsapp_ad)",
  "source_metadata->>paid_media.eq.true",
  "source_metadata->>ad_id.not.is.null",
  ...SPONSORED_PAID_MEDIUMS.map((medium) => `source_metadata->>utm_medium.ilike.${medium}`)
].join(",");

// O cliente tem ao menos uma origem paga? (junção interna com client_origins filtrada no banco; sem lista de ids na URL)
function sponsoredSelect(columns) {
  return `${columns}, client_origins!inner(id)`;
}

function applySponsoredOriginFilter(query) {
  return query.or(SPONSORED_ORIGIN_FILTER, { foreignTable: "client_origins" }).neq("status", CLIENT_STATUS.DO_NOT_CONTACT);
}
export const DEFAULT_PAGE_SIZE = 5;
export const PAGE_SIZE_OPTIONS = [5, 10, 20];

// Lista completa de status "ativos" (usada por noFutureActivityOnly), como
// array simples — reaproveita o Set já canônico de lib/client-status.js.
// "Tentando contato" fica de fora: segue regras próprias (regra do dono, 2026-10-02).
const ACTIVE_STATUS_LIST = Array.from(ACTIVE_CLIENT_STATUS_VALUES).filter((status) => status !== CLIENT_STATUS.AWAITING_RETURN);

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

// Atendimento humano é resposta/assunção no Chat; abrir WhatsApp por si só
// não confirma atendimento. Aguardando simulação tem categoria própria.
// Card "Novos atendimentos" = clientes novos (Atendimento automático nunca atendidos) + transferidos ainda não atendidos
// por quem recebeu (CLI-7b, lib/transferred-awaiting-core.mjs).
export const getUnattendedClientIds = cache(async (auth) => {
  const clients = await fetchAllRows((from, to) => {
    let query = getClient().from("simulation_registrations")
      .select("id, created_at, responsible_changed_at")
      .eq("status", CLIENT_STATUS.AUTOMATED_SERVICE)
      .order("id").range(from, to);
    return applyResponsibleUserScope(query.is("private_contact_at", null), auth);
  });
  const attended = new Set();
  for (let index = 0; index < clients.length; index += 150) {
    for (const id of await listClientIdsWithHumanAttendance(clients.slice(index, index + 150), { ever: true })) attended.add(id);
  }
  const newIds = clients.map((client) => client.id).filter((id) => !attended.has(id));
  // Transferidos (REGRA OFICIAL — dono, 2026-10-23, CLI-7b): entram no card de quem RECEBEU (escopo de sempre) até
  // serem atendidos por ele; trocou de responsável de novo → saem de quem perdeu e entram para quem recebeu.
  const transferred = (await fetchAllRows((from, to) => {
    const query = getClient().from("simulation_registrations")
      .select("id, status, responsible_user_id, previous_responsible_user_id, responsible_changed_at, pending_distribution_at, private_contact_at, created_at")
      .not("previous_responsible_user_id", "is", null)
      .not("responsible_changed_at", "is", null)
      .is("pending_distribution_at", null)
      .is("private_contact_at", null)
      .not("status", "in", `(${TRANSFERRED_AWAITING_EXCLUDED_STATUSES.join(",")})`)
      .order("id").range(from, to);
    return applyResponsibleUserScope(query, auth);
  })).filter(isTransferredCandidate);
  const ids = new Set(newIds);
  for (let index = 0; index < transferred.length; index += 150) {
    const chunk = transferred.slice(index, index + 150);
    const attendedSinceReceipt = await listClientIdsWithHumanAttendance(chunk);
    for (const client of chunk) if (!attendedSinceReceipt.has(client.id)) ids.add(client.id);
  }
  return [...ids];
});

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

// Arredonda pro minuto — usado só como chave do cache() abaixo (nunca pra
// filtrar dado de verdade): listSimulationClientsPage/getSimulationClientCounters/
// getPendingClientsCount cada um gera seu próprio `new Date()` com
// milissegundos diferentes, o que quebraria o cache() (chave diferente a
// cada chamada) mesmo rodando dentro da MESMA requisição — achado de
// performance, pente-fino 2026-09-30: sem isso, a varredura de atividades
// futuras rodava até 3x por carregamento da lista de Clientes.
function currentMinuteBucket(now) {
  const rounded = new Date(now);
  rounded.setSeconds(0, 0);
  return rounded.toISOString();
}

// IDs de simulation_registrations com algum sinal de atividade futura ainda
// válida: o campo legado (scheduled_activity_at) OU uma linha pendente em
// calendar_activities (lib/calendar-activities.js) — mesma fusão de fontes
// que mergeActivitySignal fazia no navegador (lib/client-status.js), só que
// aqui buscamos apenas os IDs (conjunto pequeno, não o cliente inteiro) para
// aplicar como exclusão nas consultas paginadas. cache() (React) deduplica
// dentro da mesma requisição — recebe o minuto arredondado (currentMinuteBucket),
// não o nowIso preciso usado no resto da consulta.
const getRegistrationIdsWithFutureCalendarActivity = cache(async (supabase, minuteBucketIso) => {
  const rows = await fetchAllRows((from, to) => supabase
    .from("calendar_activities")
    .select("client_id")
    .eq("status", "pending")
    .gte("scheduled_at", minuteBucketIso)
    .order("id", { ascending: true })
    .range(from, to));

  return Array.from(new Set(rows.map((row) => row.client_id).filter(Boolean)));
});

function applyNoOwnFutureActivityFilter(query, nowIso) {
  // scheduled_activity_at (campo legado) não é futura/pendente:
  // nula, no passado, ou já concluída.
  return query.or(`scheduled_activity_at.is.null,scheduled_activity_at.lt.${nowIso},scheduled_activity_completed_at.not.is.null`);
}

function applyNotInFutureActivityIds(query, ids) {
  if (!ids.length) return query;
  return query.not("id", "in", `(${ids.join(",")})`);
}

// Filtros que contam os 3 dias ("Pendentes" e "Sem contato há +3 dias") também olham o último atendimento.
function needsAttendanceExclusion(filters) {
  return Boolean(filters.pendingOnly || filters.staleContactOnly);
}

function applyStaleContactFilter(query, cutoffIso) {
  return query
    .not("status", "in", `(${CLIENT_STATUS.ARCHIVED},${CLIENT_STATUS.DO_NOT_CONTACT})`)
    .or(`and(last_whatsapp_contact_at.not.is.null,last_whatsapp_contact_at.lt.${cutoffIso}),and(last_whatsapp_contact_at.is.null,created_at.lt.${cutoffIso})`);
}

// cache() (React) deduplica dentro da mesma requisição — a mesma tag filtrada
// podia rodar até 2x por carregamento da lista de Clientes (pente-fino
// 2026-09-30).
const resolveTagRegistrationIds = cache(async (supabase, tagId) => {
  if (!tagId || tagId === "all") return null;
  const rows = await fetchAllRows((from, to) => supabase
    .from("client_tags")
    .select("client_id")
    .eq("tag_id", tagId)
    .range(from, to));

  return Array.from(new Set(rows.map((row) => row.client_id).filter(Boolean)));
});

// Aplica, numa query já criada, todos os filtros que não dependem do status
// (busca, corretor, tag, pendentes, sem contato, sem atividade futura) — é a
// base tanto da página pedida quanto dos contadores por aba, que precisam
// dos MESMOS filtros "menos status" para os números baterem com o que está
// selecionado (igual ao comportamento antigo de scopedClients no navegador).
function applyScopedFilters(query, { auth, filters, nowIso, cutoffIso, futureActivityIds, tagRegistrationIds, unattendedIds, attendanceExclusionIds = [] }) {
  // "all" é o sentinel da UI para "todos os corretores" (ver app/admin/simulacoes/page.jsx),
  // mas applyResponsibleUserScope só entende "" como "sem filtro" e "unassigned" como
  // "sem responsável" — sem essa normalização, "all" ia direto como .eq("responsible_user_id", "all")
  // e o Postgres rejeitava com "invalid input syntax for type uuid".
  const rouletteFilter = filters.responsibleUserId === ROULETTE_RESPONSIBLE_FILTER;
  const responsibleUserId = filters.responsibleUserId === "all" || rouletteFilter ? "" : filters.responsibleUserId;
  // Pesquisando por nome/telefone o corretor também encontra o cliente que ele
  // disparou e que voltou para a fila sem responsável (precisa tratar a resposta).
  const searching = Boolean(sanitizeFilterTerm(filters.query));
  // Contato particular (2026-10-09) não é cliente: fora de todas as listas.
  query = query.is("private_contact_at", null);
  query = applyResponsibleUserScope(query, auth, "responsible_user_id", responsibleUserId, { returnedFromColumn: searching ? "returned_from_user_id" : "" });
  if (rouletteFilter) query = query.not("pending_distribution_at", "is", null);
  // "Não contactar": visível para quem tem acesso ao cliente (regra do dono,
  // 2026-10-02 — ver canViewDoNotContact); fora da aba "Todos", aparece em
  // "Arquivados" e na pesquisa por nome/telefone.
  if (!sanitizeFilterTerm(filters.query)) query = applyDoNotContactScope(query, auth);
  // Cliente "Pago" (fim do pipeline de venda) some da lista de Clientes —
  // pedido do dono, 2026-10-01, pra ter uma visão mais limpa: o cadastro
  // continua existindo e segue acessível de dentro do Financeiro (link direto
  // por id, ver fetchPinnedClientItem), só não aparece mais navegando/buscando
  // aqui. Vale pra toda aba (Todos, Venda, etc.) e pros contadores, que usam
  // esta mesma função.
  query = query.neq("status", CLIENT_STATUS.SALE_PAID);
  query = applySearchFilter(query, filters.query);
  // Data de cadastro (dono, 2026-10-14), dia de São Paulo; vale para lista, contadores e o "investido" do Patrocinado.
  if (filters.dateFrom) query = query.gte("created_at", zonedPlainDateToUtcIso(filters.dateFrom));
  if (filters.dateTo) query = query.lt("created_at", zonedPlainDateToUtcIso(addDaysToPlainDate(filters.dateTo, 1)));
  if (filters.needsFirstContact) query = unattendedIds?.length ? query.in("id", unattendedIds) : query.eq("id", "00000000-0000-0000-0000-000000000000");

  if (tagRegistrationIds) {
    query = tagRegistrationIds.length ? query.in("id", tagRegistrationIds) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  if (filters.pendingOnly) {
    query = query.not("status", "in", `(${CLIENT_STATUS.ARCHIVED},${CLIENT_STATUS.DO_NOT_CONTACT})`);
    query = applyNoOwnFutureActivityFilter(query, nowIso);
    query = applyNotInFutureActivityIds(query, futureActivityIds);
    query = query.or(`and(last_whatsapp_contact_at.not.is.null,last_whatsapp_contact_at.lt.${cutoffIso}),and(last_whatsapp_contact_at.is.null,created_at.lt.${cutoffIso})`);
    // Atendimento nos últimos 3 dias (regra do dono 2026-10-16, lib/client-attendance-core.mjs) zera a contagem.
    query = applyNotInFutureActivityIds(query, attendanceExclusionIds);
    // Reativação: "Tentando contato" só volta a ser pendente 3 dias depois da última mudança de etapa.
    query = query.or(`status.neq.${CLIENT_STATUS.AWAITING_RETURN},last_status_change_at.is.null,last_status_change_at.lt.${cutoffIso}`);
  } else {
    if (filters.staleContactOnly) {
      query = applyStaleContactFilter(query, cutoffIso);
      // Atividade futura agendada tira o cliente do alerta "Sem contato há +3 dias" (regra do dono 2026-10-08).
      query = applyNoOwnFutureActivityFilter(query, nowIso);
      query = applyNotInFutureActivityIds(query, futureActivityIds);
      // Atendimento nos últimos 3 dias (regra do dono 2026-10-16, lib/client-attendance-core.mjs) zera a contagem.
      query = applyNotInFutureActivityIds(query, attendanceExclusionIds);
    }
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
  const storedSimulation = bestSimulationRow ? rowToSimulation(bestSimulationRow) : null;
  // Entrada/FGTS do cadastro (dono, 2026-10-19) — mesma regra de getSimulation (lib/simulation-resources-core.mjs).
  const simulation = storedSimulation ? { ...storedSimulation, ...pickResources(resolveSimulationResources(storedSimulation, registration)) } : null;
  const summary = getSimulationListSummary(simulation || {});
  const status = resolveClientStatus(registration, summary);

  return {
    id: registration.id,
    completed: summary.completed || false,
    lastAdminLabel: registration.lastAdminName || "",
    lastWhatsappContactAt: registration.lastWhatsappContactAt || "",
    lastStatusChangeAt: registration.lastStatusChangeAt || "",
    name: registration.fullName || "Cliente sem nome",
    registration,
    simulation,
    sortDate: registration.lastFormSubmittedAt || registration.createdAt || "",
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

// "Último contato" do card mostra o mais recente entre o contato gravado no cliente
// (simulation_registrations.last_whatsapp_contact_at) e a última resposta humana da
// conversa (whatsapp_conversations.last_human_reply_at). Desde 2026-10-03 (P-11) a
// mensagem humana enviada pelo Chat OU pelo celular grava os DOIS (registerHumanContact,
// lib/whatsapp-human-contact.js), então este rótulo é só uma rede de segurança para
// conversas anteriores a isso — o clique em "abrir WhatsApp" também grava a coluna do
// cliente, mas NÃO é mensagem enviada. Só ajusta o RÓTULO exibido nesta página —
// nunca escreve no banco.
async function applyChatContactSignal(supabase, items) {
  const ids = items.map((item) => item.id).filter(Boolean);
  if (!ids.length) return items;

  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select("client_id, last_human_reply_at")
    .in("client_id", ids)
    .not("last_human_reply_at", "is", null);
  if (error) throw error;

  const lastReplyByClientId = new Map((data || []).map((row) => [row.client_id, row.last_human_reply_at]));
  // Regra do dono (2026-10-16): a mensagem RECEBIDA do cliente no Chat também atualiza o "Último contato" e tira o
  // alerta "Sem contato há +3 dias" do card (só leitura; regra em lib/chat-contact-signal-core.mjs).
  const [inboundByClientId, attendanceByClientId] = await Promise.all([
    loadInboundChatAtByClient(supabase, items.map((item) => ({ id: item.id, responsibleUserId: item.registration?.responsibleUserId || "" }))),
    // Último atendimento dos últimos 3 dias (regra do dono, 2026-10-16): os selos "Sem contato há +3 dias" e
    // "Aguardando ação" do card usam (pendingReferenceAt/isStaleContactClient, lib/client-status.js).
    loadRecentAttendanceByClient(supabase, { sinceIso: new Date(Date.now() - NO_CONTACT_ALERT_MS).toISOString(), clientIds: ids })
  ]);
  for (const item of items) {
    const chatContactAt = lastReplyByClientId.get(item.id);
    if (chatContactAt && (!item.lastWhatsappContactAt || new Date(chatContactAt) > new Date(item.lastWhatsappContactAt))) {
      item.lastWhatsappContactAt = chatContactAt;
    }
    const inboundAt = inboundByClientId.get(item.id);
    if (inboundAt) item.lastWhatsappContactAt = laterContactAt(item.lastWhatsappContactAt, inboundAt);
    const attendanceAt = attendanceByClientId.get(item.id);
    if (attendanceAt) item.lastAttendanceAt = attendanceAt;
  }
  return items;
}

// Posição na fila da roleta (dono, 2026-10-22) para os itens da página que estão na fila: "Roleta · 3º na fila",
// "Fila de reativação · 2º" ou "Roleta · fora da fila (motivo)". Só carrega a fila quando a página tem alguém nela.
async function applyRouletteQueueSignal(items, preloaded = null) {
  if (!items.some((item) => item.registration?.pendingDistributionAt)) return items;
  let entries = preloaded;
  if (!entries) {
    try {
      entries = await loadRouletteQueueEntries();
    } catch (error) {
      // A posição é informação extra: falhando, o card mostra só "Roleta" e o erro fica no log — a lista não cai.
      console.error("Falha ao calcular a posição na fila da roleta:", error?.message || error);
      return items;
    }
  }
  return items.map((item) => {
    if (!item.registration?.pendingDistributionAt) return item;
    const entry = entries.get(item.id) || null;
    return { ...item, rouletteQueue: { queue: entry?.queue || "waiting", position: entry?.position || 0, label: rouletteQueueLabel(entry) } };
  });
}

// Custo estimado do patrocinado no card (2026-10-08). Gasto do anúncio de origem (Meta) dividido entre os clientes do
// CRM que vieram dele (lib/sponsored-cost-core.mjs). Administrador geral: valor real com o detalhe. Demais perfis
// (regra do dono): só o valor, inflado em 50% (teamSponsoredCost). Melhor esforço: nunca derruba a lista.
async function applySponsoredCostSignal(auth, items) {
  if (!items.length) return items;
  // Decisão do dono (2026-10-09): o card mostra para TODOS (inclusive o administrador) o mesmo valor da equipe —
  // real × 1,5, ou R$ 10–16,99 quando não há custo identificado. O valor real fica só no resumo da aba Patrocinado.
  const realCost = false;
  try {
    const { getSponsoredCostIndex } = await import("./sponsored-cost");
    const index = await getSponsoredCostIndex();
    for (const item of items) {
      const cost = sponsoredCostOfClient(index, item.id);
      if (cost) item.sponsoredCost = realCost ? cost : teamSponsoredCost(cost);
      else if (!realCost && index.sponsoredClients?.has(item.id)) item.sponsoredCost = teamFallbackSponsoredCost(item.id);
    }
  } catch (error) {
    console.warn("Falha ao calcular o custo de patrocinado dos cards:", error?.message || error);
  }
  return items;
}

// Sinais do card em paralelo (velocidade, 2026-10-22): chat/contato, custo do patrocinado e "documentos por fora" leem
// fontes independentes e cada um só grava os PRÓPRIOS campos no mesmo item (lastWhatsappContactAt/lastAttendanceAt,
// sponsoredCost, documentsOffline) — nenhum lê o que outro grava. A posição na roleta vem por último porque devolve
// itens copiados. Resultado idêntico ao encadeamento em série de antes; falha do sinal de chat continua derrubando a
// lista como antes (os outros dois são melhor esforço).
async function applyCardSignals(supabase, auth, items, rouletteEntries = null) {
  await Promise.all([
    applyChatContactSignal(supabase, items),
    applySponsoredCostSignal(auth, items),
    applyDocumentsOfflineSignal(supabase, items)
  ]);
  return applyRouletteQueueSignal(items, rouletteEntries);
}

// Busca uma única página já filtrada, ordenada e paginada no banco — nunca
// carrega a base inteira de clientes. Reproduz o comportamento antigo de
// "Tentando contato" (awaiting_return) sempre por último dentro da aba
// "Todos": como o PostgREST não ordena por expressão calculada, fazemos duas
// consultas (não-awaiting_return e awaiting_return) e montamos a página
// certa a partir dos dois totais — só entra em jogo quando a aba "Todos"
// está selecionada, que é o único lugar onde awaiting_return convive com
// outros status (nas demais abas, ou é 100% awaiting_return, ou nunca
// aparece — a ordem entre eles não muda visualmente).
// Cliente "Pago" (ou qualquer outro escondido da lista) continua acessível
// por link direto — hoje só o Financeiro usa isso (ver AdminFinancialDashboard.jsx,
// link "Ver cliente" → /admin/simulacoes?clientId=<id>). Busca sem filtro de
// status, mas ainda respeitando escopo de responsável/permissão: o link não é
// um jeito de contornar quem pode ver o quê, só de contornar o "some da lista".
async function fetchPinnedClientItem(supabase, auth, pinClientId) {
  if (!pinClientId) return null;
  let query = supabase.from("simulation_registrations").select(SELECT_COLUMNS).eq("id", pinClientId);
  query = applyResponsibleUserScope(query, auth, "responsible_user_id", "", { returnedFromColumn: "returned_from_user_id" });
  // Link direto (ex.: pendência "Respostas da prospecção" de um cliente em
  // "Não contactar"): abre para quem tem acesso pelo responsável.
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? rowToClientItem(data) : null;
}

export async function listSimulationClientsPage({ auth, filters = {}, page = 1, pageSize = DEFAULT_PAGE_SIZE, pinClientId = "" }) {
  const supabase = getClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - NO_CONTACT_ALERT_MS).toISOString();
  const safePageSize = PAGE_SIZE_OPTIONS.includes(Number(pageSize)) ? Number(pageSize) : DEFAULT_PAGE_SIZE;
  const safePage = Math.max(1, Number(page) || 1);

  const groupStatuses = statusesForGroup(filters.statusGroup);
  const sponsoredTab = filters.statusGroup === SPONSORED_TAB_KEY;
  const isAllTab = !filters.statusGroup || filters.statusGroup === "all";
  const searching = Boolean(sanitizeFilterTerm(filters.query));

  const needsFutureActivityIds = filters.pendingOnly || filters.noFutureActivityOnly || filters.staleContactOnly;
  const [futureActivityIds, tagRegistrationIds, unattendedIds, attendanceExclusionIds, allTabTagClientIds] = await Promise.all([
    needsFutureActivityIds ? getRegistrationIdsWithFutureCalendarActivity(supabase, currentMinuteBucket(now)) : Promise.resolve([]),
    resolveTagRegistrationIds(supabase, filters.tagId),
    filters.needsFirstContact ? getUnattendedClientIds(auth) : Promise.resolve(null),
    needsAttendanceExclusion(filters) ? listAttendanceExclusionIds(supabase, cutoffIso) : Promise.resolve([]),
    isAllTab && !searching ? loadAllTabTagClientIds(supabase) : Promise.resolve([])
  ]);

  function buildFiltered(extraStatusValues, selectColumns = SELECT_COLUMNS, selectOptions = { count: "exact" }) {
    let query = supabase.from("simulation_registrations").select(sponsoredTab ? sponsoredSelect(selectColumns) : selectColumns, selectOptions);
    query = applyScopedFilters(query, { auth, filters, nowIso, cutoffIso, futureActivityIds, tagRegistrationIds, unattendedIds, attendanceExclusionIds });
    if (sponsoredTab) query = applySponsoredOriginFilter(query);

    if (isAllTab) {
      // Sem situação negativa (status e etiquetas) na aba Todos (regra do dono, 2026-10-23, CLI-12a); a busca segue como antes.
      query = applyAllTabExclusions(query, { searching, tagClientIds: allTabTagClientIds });
    } else if (groupStatuses.length) {
      query = query.in("status", groupStatuses);
    }

    if (filters.status && filters.status !== "all") {
      query = query.eq("status", filters.status);
    }

    if (extraStatusValues === "exclude-awaiting-return") {
      // Um novo formulário é uma interação atual: mesmo que o status ainda
      // seja "Tentando contato" (Atendimento Rápido), o card volta ao topo.
      query = query.or(`status.neq.${CLIENT_STATUS.AWAITING_RETURN},last_form_submitted_at.not.is.null`);
    } else if (extraStatusValues === "only-awaiting-return") {
      query = query.eq("status", CLIENT_STATUS.AWAITING_RETURN).is("last_form_submitted_at", null);
    }

    return query;
  }

  // Filtro Roleta: ordem = posição real na fila (não a data da lista). A fila tem poucas centenas de clientes: busca os
  // ids filtrados (mesmos filtros/escopo), ordena pela fila e só então carrega a página.
  if (filters.responsibleUserId === ROULETTE_RESPONSIBLE_FILTER) {
    const [{ data: idRows, error: idError, count }, entries] = await Promise.all([
      buildFiltered(null, "id", { count: "exact" }).limit(5000),
      loadRouletteQueueEntries()
    ]);
    if (idError) throw idError;
    const fallback = (id) => ({ id, pending_distribution_at: "" });
    const orderedIds = (idRows || []).map((row) => row.id)
      .sort((a, b) => compareRouletteQueueEntries(entries.get(a) || fallback(a), entries.get(b) || fallback(b)));
    const offset = (safePage - 1) * safePageSize;
    const pageIds = orderedIds.slice(offset, offset + safePageSize);
    let rows = [];
    if (pageIds.length) {
      const { data, error } = await supabase.from("simulation_registrations").select(SELECT_COLUMNS).in("id", pageIds);
      if (error) throw error;
      const byId = new Map((data || []).map((row) => [row.id, row]));
      rows = pageIds.map((id) => byId.get(id)).filter(Boolean);
    }
    let items = rows.map(rowToClientItem);
    if (pinClientId && !items.some((item) => item.id === pinClientId)) {
      const pinned = await fetchPinnedClientItem(supabase, auth, pinClientId);
      if (pinned) items = [...items, pinned];
    }
    const total = count ?? orderedIds.length;
    return {
      items: await applyCardSignals(supabase, auth, items, entries),
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, Math.ceil(total / safePageSize))
    };
  }

  // Só a aba "Todos" sem substatus específico precisa do split — fora dela,
  // uma única consulta ordenada resolve exatamente igual ao comportamento
  // anterior (awaiting_return nunca aparece misturado com outro status).
  const needsTrailingSplit = isAllTab && (!filters.status || filters.status === "all");

  if (!needsTrailingSplit) {
    const offset = (safePage - 1) * safePageSize;
    const { data, error, count } = await buildFiltered(null)
      .order("list_order_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + safePageSize - 1);
    if (error) throw error;

    const total = count || 0;
    let items = (data || []).map(rowToClientItem);
    if (pinClientId && !items.some((item) => item.id === pinClientId)) {
      const pinned = await fetchPinnedClientItem(supabase, auth, pinClientId);
      if (pinned) items = [...items, pinned];
    }
    return {
      items: await applyCardSignals(supabase, auth, items),
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, Math.ceil(total / safePageSize))
    };
  }

  // As duas contagens não dependem uma da outra — em paralelo (1 round-trip
  // a menos na aba "Todos", a mais visitada do CRM). Achado da 2ª rodada da
  // auditoria de performance 2026-10-01.
  const [
    { count: nonTrailingTotal, error: nonTrailingCountError },
    { count: trailingTotal, error: trailingCountError }
  ] = await Promise.all([
    buildFiltered("exclude-awaiting-return", "id", { count: "exact", head: true }),
    buildFiltered("only-awaiting-return", "id", { count: "exact", head: true })
  ]);
  if (nonTrailingCountError) throw nonTrailingCountError;
  if (trailingCountError) throw trailingCountError;

  const safeNonTrailingTotal = nonTrailingTotal || 0;
  const safeTrailingTotal = trailingTotal || 0;
  const total = safeNonTrailingTotal + safeTrailingTotal;
  const offset = (safePage - 1) * safePageSize;

  const rows = [];

  if (offset < safeNonTrailingTotal) {
    const end = Math.min(offset + safePageSize, safeNonTrailingTotal);
    const { data, error } = await buildFiltered("exclude-awaiting-return")
      .order("list_order_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, end - 1);
    if (error) throw error;
    rows.push(...(data || []));
  }

  if (rows.length < safePageSize && offset + rows.length < total) {
    const trailingOffset = Math.max(0, offset - safeNonTrailingTotal);
    const remaining = safePageSize - rows.length;
    const { data, error } = await buildFiltered("only-awaiting-return")
      .order("list_order_at", { ascending: false })
      .order("id", { ascending: false })
      .range(trailingOffset, trailingOffset + remaining - 1);
    if (error) throw error;
    rows.push(...(data || []));
  }

  let items = rows.map(rowToClientItem);
  if (pinClientId && !items.some((item) => item.id === pinClientId)) {
    const pinned = await fetchPinnedClientItem(supabase, auth, pinClientId);
    if (pinned) items = [...items, pinned];
  }
  return {
    items: await applyCardSignals(supabase, auth, items),
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

  // Contador da aba Todos = mesma exclusão da lista sem busca: status e etiquetas negativos (regra do dono, 2026-10-23, CLI-12a).
  const countAllTab = async () => {
    let allTotalQuery = supabase.from("simulation_registrations").select("id", { count: "exact", head: true });
    allTotalQuery = applyResponsibleUserScope(allTotalQuery.is("private_contact_at", null), auth, "responsible_user_id", "");
    allTotalQuery = applyDoNotContactScope(allTotalQuery, auth);
    allTotalQuery = applyAllTabExclusions(allTotalQuery, { tagClientIds: await loadAllTabTagClientIds(supabase) });
    return allTotalQuery.neq("status", CLIENT_STATUS.SALE_PAID);
  };

  const needsFutureActivityIds = filters.pendingOnly || filters.noFutureActivityOnly || filters.staleContactOnly;
  const [futureActivityIds, tagRegistrationIds, unattendedIds, allTotalResult, attendanceExclusionIds] = await Promise.all([
    needsFutureActivityIds ? getRegistrationIdsWithFutureCalendarActivity(supabase, currentMinuteBucket(now)) : Promise.resolve([]),
    resolveTagRegistrationIds(supabase, filters.tagId),
    filters.needsFirstContact ? getUnattendedClientIds(auth) : Promise.resolve(null),
    countAllTab(),
    needsAttendanceExclusion(filters) ? listAttendanceExclusionIds(supabase, cutoffIso) : Promise.resolve([])
  ]);
  if (allTotalResult.error) throw allTotalResult.error;
  const allTotal = allTotalResult.count || 0;

  // Uma única consulta em lote pedindo só a coluna "status" (com os MESMOS
  // filtros "menos status" de applyScopedFilters) em vez de uma consulta
  // count() por valor de CLIENT_STATUS (~25 requisições simultâneas via
  // Promise.all) — esse burst de conexões estava batendo num limite de
  // concorrência do Supabase e derrubando a tela inteira em produção com um
  // erro sem mensagem útil (bug real corrigido 2026-09-23). Contagem por
  // status é só reduzir as linhas em memória, mesmo padrão já usado em
  // computeStockMetricsByBroker (lib/performance-overview.js).
  const statusRows = await fetchAllRows((from, to) => {
    let query = supabase.from("simulation_registrations").select("status");
    query = applyScopedFilters(query, { auth, filters, nowIso, cutoffIso, futureActivityIds, tagRegistrationIds, unattendedIds, attendanceExclusionIds });
    return query.order("id", { ascending: true }).range(from, to);
  });

  const byStatus = {};
  for (const row of statusRows) {
    const normalized = normalizeClientStatus(row.status);
    byStatus[normalized] = (byStatus[normalized] || 0) + 1;
  }

  // Aba "Patrocinado": mesma base de filtros "menos status", só os clientes com origem paga.
  let sponsoredQuery = supabase.from("simulation_registrations").select(sponsoredSelect("id"), { count: "exact", head: true });
  sponsoredQuery = applyScopedFilters(sponsoredQuery, { auth, filters, nowIso, cutoffIso, futureActivityIds, tagRegistrationIds, unattendedIds, attendanceExclusionIds });
  sponsoredQuery = applySponsoredOriginFilter(sponsoredQuery);
  const { count: sponsoredCount, error: sponsoredError } = await sponsoredQuery;
  if (sponsoredError) {
    console.warn("Falha ao contar os clientes patrocinados:", sponsoredError.message || sponsoredError);
  }

  // Aba Patrocinado, só para o administrador: quanto de gasto de anúncio há nos clientes da VISÃO ATUAL (inclui o filtro de
  // corretor), total, média e quantos ficaram sem custo identificado (lib/sponsored-cost-core.mjs).
  let sponsoredCost = null;
  if (filters.statusGroup === SPONSORED_TAB_KEY && isGeneralAdminAuth(auth)) {
    try {
      const { getSponsoredCostIndex } = await import("./sponsored-cost");
      const [index, rows] = await Promise.all([
        getSponsoredCostIndex(),
        fetchAllRows((from, to) => {
          let query = supabase.from("simulation_registrations").select(sponsoredSelect("id"));
          query = applyScopedFilters(query, { auth, filters, nowIso, cutoffIso, futureActivityIds, tagRegistrationIds, unattendedIds, attendanceExclusionIds });
          query = applySponsoredOriginFilter(query);
          if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
          return query.order("id", { ascending: true }).range(from, to);
        })
      ]);
      sponsoredCost = summarizeSponsoredCost(index, rows.map((row) => row.id));
    } catch (costError) {
      console.warn("Falha ao somar o custo de patrocinado:", costError?.message || costError);
    }
  }

  const byGroup = { [SPONSORED_TAB_KEY]: sponsoredCount || 0 };
  for (const group of CLIENT_STATUS_FILTER_GROUPS) {
    byGroup[group.key] = group.key === "all"
      ? allTotal
      : group.statuses.reduce((total, status) => total + (byStatus[status] || 0), 0);
  }

  return { all: allTotal, byStatus, byGroup, ...(sponsoredCost ? { sponsoredCost } : {}) };
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

  const [futureActivityIds, attendanceExclusionIds] = await Promise.all([
    getRegistrationIdsWithFutureCalendarActivity(supabase, currentMinuteBucket(now)),
    listAttendanceExclusionIds(supabase, cutoffIso)
  ]);

  let query = supabase.from("simulation_registrations").select("id", { count: "exact", head: true });
  query = applyResponsibleUserScope(query.is("private_contact_at", null), auth, "responsible_user_id", "");
  query = applyDoNotContactScope(query, auth);
  query = query.not("status", "in", `(${CLIENT_STATUS.ARCHIVED},${CLIENT_STATUS.DO_NOT_CONTACT})`);
  query = applyNoOwnFutureActivityFilter(query, nowIso);
  query = applyNotInFutureActivityIds(query, futureActivityIds);
  query = query.or(`and(last_whatsapp_contact_at.not.is.null,last_whatsapp_contact_at.lt.${cutoffIso}),and(last_whatsapp_contact_at.is.null,created_at.lt.${cutoffIso})`);
  // Atendimento nos últimos 3 dias (regra do dono 2026-10-16, lib/client-attendance-core.mjs) zera a contagem.
  query = applyNotInFutureActivityIds(query, attendanceExclusionIds);

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}
