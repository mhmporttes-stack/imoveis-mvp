import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { ACTIVE_CLIENT_STATUS_VALUES } from "./client-status";
import { addDaysToPlainDate, getTodayInSaoPaulo, zonedPlainDateToUtcIso } from "./daily-report";
import { evaluateDailyGoalPending, isDailyGoalPendingCandidate } from "./daily-goal-progress.mjs";

// Clientes PENDENTES da Meta Diária (regra oficial 2026-09-25): clientes ativos
// do corretor, com mais de 3 dias sem contato e sem atividade futura — a mesma
// regra de "Clientes pendentes" do CRM (isClientAwaitingAction). A quantidade e
// a lista são CONGELADAS no início do dia (tabela daily_goal_pending_freeze):
// quem completa 3 dias durante o dia só entra amanhã. A lógica de "o que é
// pendente / o que é resolvido" é pura e testada em daily-goal-progress.mjs;
// aqui ficam só as consultas.

const PAGE_SIZE = 1000;
const CHUNK_SIZE = 150;
const NO_CONTACT_MS = 3 * 24 * 60 * 60 * 1000;
const CLIENT_COLUMNS = "id, status, responsible_user_id, last_whatsapp_contact_at, created_at, scheduled_activity_at, scheduled_activity_completed_at";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

function chunk(list, size = CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks;
}

// A tabela de congelamento vem de uma migration. Enquanto ela não existir no
// banco, a Meta Diária continua exatamente como antes (sem pendentes) em vez de
// falhar — o código pode ir ao ar antes ou depois da migration.
function isFreezeTableMissing(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  return /42P01|PGRST205/.test(text) || (/daily_goal_pending_freeze/.test(text) && /does not exist|could not find/i.test(text));
}

// Atividade pendente mais distante de cada cliente (agenda do calendário). A
// atividade "legada" fica na própria linha do cliente.
async function loadLatestCalendarActivity(clientIds) {
  const latest = new Map();
  for (const ids of chunk(clientIds)) {
    const { data, error } = await db().from("calendar_activities").select("client_id, scheduled_at").eq("status", "pending").in("client_id", ids);
    if (error) throw error;
    for (const row of data || []) {
      const at = Date.parse(row.scheduled_at);
      if (Number.isFinite(at) && at > (latest.get(row.client_id) ?? -Infinity)) latest.set(row.client_id, at);
    }
  }
  return latest;
}

function rowToClient(row, calendarLatest) {
  const legacyAt = row.scheduled_activity_at && !row.scheduled_activity_completed_at ? Date.parse(row.scheduled_activity_at) : NaN;
  const latest = Math.max(Number.isFinite(legacyAt) ? legacyAt : -Infinity, calendarLatest.get(row.id) ?? -Infinity);
  return {
    id: row.id,
    status: row.status,
    responsibleUserId: row.responsible_user_id,
    lastWhatsappContactAt: row.last_whatsapp_contact_at,
    createdAt: row.created_at,
    latestActivityAt: Number.isFinite(latest) ? new Date(latest).toISOString() : null
  };
}

// Candidatos do corretor no instante asOfMs (início do dia). O filtro de data
// no banco só evita trazer a carteira inteira; a decisão final é sempre da
// regra única isDailyGoalPendingCandidate.
async function loadPendingCandidates(brokerId, asOfMs) {
  const cutoffIso = new Date(asOfMs - NO_CONTACT_MS).toISOString();
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db()
      .from("simulation_registrations")
      .select(CLIENT_COLUMNS)
      .eq("responsible_user_id", brokerId)
      .in("status", [...ACTIVE_CLIENT_STATUS_VALUES])
      .or(`last_whatsapp_contact_at.lt.${cutoffIso},and(last_whatsapp_contact_at.is.null,created_at.lt.${cutoffIso})`)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  const calendarLatest = await loadLatestCalendarActivity(rows.map((row) => row.id));
  return rows.map((row) => rowToClient(row, calendarLatest)).filter((client) => isDailyGoalPendingCandidate(client, asOfMs));
}

// Cliente que já está na cadência da Meta Diária (rodada ativa) é obrigação de
// PROSPECÇÃO — não entra também como pendente, senão contaria em dobro.
async function loadActiveRoundClientIds(brokerId) {
  const { data, error } = await db().from("daily_goal_rounds").select("client_id").eq("broker_id", brokerId).eq("status", "active").not("client_id", "is", null);
  if (error) throw error;
  return new Set((data || []).map((row) => row.client_id));
}

async function loadAttemptClientIds(brokerId, day) {
  const { data, error } = await db().from("daily_goal_attempts").select("client_id").eq("broker_id", brokerId).eq("goal_date", day);
  if (error) throw error;
  return new Set((data || []).map((row) => row.client_id).filter(Boolean));
}

async function loadClientsByIds(ids) {
  const rows = [];
  for (const part of chunk(ids)) {
    const { data, error } = await db().from("simulation_registrations").select(CLIENT_COLUMNS).in("id", part);
    if (error) throw error;
    rows.push(...(data || []));
  }
  const calendarLatest = await loadLatestCalendarActivity(rows.map((row) => row.id));
  return new Map(rows.map((row) => [row.id, rowToClient(row, calendarLatest)]));
}

async function readFreeze(brokerId, day) {
  const { data, error } = await db().from("daily_goal_pending_freeze").select("*").eq("broker_id", brokerId).eq("goal_date", day).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Congela (uma única vez por corretor/dia) a lista de pendentes do dia. Idempotente
// e seguro para concorrência: a chave primária decide quem grava; os outros só leem.
// Devolve { row, created } ou null quando o recurso ainda não está disponível.
export async function freezeDailyGoalPendingIfMissing(brokerId, day, source = "lazy") {
  try {
    const existing = await readFreeze(brokerId, day);
    if (existing) return { row: existing, created: false };

    const asOfMs = Date.parse(zonedPlainDateToUtcIso(day));
    const [candidates, roundClientIds] = await Promise.all([loadPendingCandidates(brokerId, asOfMs), loadActiveRoundClientIds(brokerId)]);
    const ids = candidates.map((client) => client.id).filter((id) => !roundClientIds.has(id));

    // Com ignoreDuplicates, o retorno só traz a linha se ESTA chamada foi a que gravou.
    const { data: inserted, error } = await db()
      .from("daily_goal_pending_freeze")
      .upsert({ broker_id: brokerId, goal_date: day, pending_client_ids: ids, pending_total: ids.length, source }, { onConflict: "broker_id,goal_date", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (inserted) return { row: inserted, created: true };

    const row = await readFreeze(brokerId, day);
    return row ? { row, created: false } : null;
  } catch (error) {
    if (isFreezeTableMissing(error)) return null;
    throw error;
  }
}

// Situação das pendências do corretor no dia: { total, done, remaining } — o
// total parte da lista congelada (só diminui se o cliente deixa de ser do
// corretor). Devolve null se o recurso ainda não está disponível (migration
// não aplicada): quem chama trata como "sem pendentes".
//
// `createIfMissing: false` (fechamento de dias passados) só LÊ o que já foi
// congelado: nunca congela retroativamente um dia antigo com dados de hoje —
// dia sem congelamento fecha como sempre fechou (só prospecção).
export async function getDailyGoalPendingProgress(brokerId, day, { attemptClientIds = null, source = "lazy", createIfMissing = true } = {}) {
  let frozen;
  if (createIfMissing) {
    frozen = await freezeDailyGoalPendingIfMissing(brokerId, day, source);
  } else {
    try {
      const row = await readFreeze(brokerId, day);
      frozen = row ? { row, created: false } : null;
    } catch (error) {
      if (isFreezeTableMissing(error)) return null;
      throw error;
    }
  }
  if (!frozen) return null;

  const ids = frozen.row.pending_client_ids || [];
  const base = { frozenTotal: frozen.row.pending_total || 0, frozenAt: frozen.row.frozen_at };
  if (!ids.length) return { total: 0, done: 0, remaining: 0, ...base };

  const dayStartMs = Date.parse(zonedPlainDateToUtcIso(day));
  const dayEndMs = Date.parse(zonedPlainDateToUtcIso(addDaysToPlainDate(day, 1)));
  const [clientsById, attempted] = await Promise.all([loadClientsByIds(ids), attemptClientIds ? Promise.resolve(attemptClientIds) : loadAttemptClientIds(brokerId, day)]);

  return {
    ...evaluateDailyGoalPending({ brokerId, frozenIds: ids, clientsById, dayStartMs, nowMs: Math.min(Date.now(), dayEndMs), attemptClientIds: attempted }),
    ...base
  };
}

// Cron diário (00:10, junto do fechamento do dia anterior): congela as pendências
// de hoje dos corretores que usam a Meta Diária. Limita o tempo da rodada — quem
// ficar de fora é congelado no primeiro acesso do dia (plano B).
export async function freezeDailyGoalPendingForActiveBrokers({ budgetMs = 30000, lookbackDays = 14 } = {}) {
  const today = getTodayInSaoPaulo();
  const { data, error } = await db().from("daily_goals").select("broker_id").gte("goal_date", addDaysToPlainDate(today, -lookbackDays));
  if (error) throw error;
  const brokerIds = [...new Set((data || []).map((row) => row.broker_id))];

  const startedAt = Date.now();
  const summary = { brokers: brokerIds.length, frozen: 0, alreadyFrozen: 0, skipped: 0, unavailable: false };
  for (const brokerId of brokerIds) {
    if (Date.now() - startedAt > budgetMs) { summary.skipped += 1; continue; }
    try {
      const result = await freezeDailyGoalPendingIfMissing(brokerId, today, "cron");
      if (!result) { summary.unavailable = true; break; }
      if (result.created) summary.frozen += 1;
      else summary.alreadyFrozen += 1;
    } catch (freezeError) {
      summary.skipped += 1;
      console.error("Falha ao congelar as pendências da Meta Diária.", freezeError?.message || freezeError);
    }
  }
  return summary;
}
