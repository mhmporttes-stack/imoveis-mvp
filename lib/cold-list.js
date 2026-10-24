import "server-only";
import { CLIENT_STATUS } from "./client-status";
import { getSupabaseAdminClient } from "./supabase";
import { acquireLock, releaseLock } from "./crm-metrics/cache";
import { recordClientStatusChange } from "./client-status-history";
import {
  COLD_LIST_ARCHIVE_PASSAGES,
  COLD_LIST_ARCHIVE_REASON,
  COLD_LIST_HISTORY_EVENT,
  COLD_LIST_LOCK_UNTIL,
  COLD_LIST_MANUAL_ATTEMPT_EVENTS,
  COLD_LIST_RETURN_EVENTS,
  COLD_LIST_TAG,
  coldListArchiveBlockReason,
  countColdListPassages,
  countDistinctAttemptBrokers,
  isColdListHidden,
  isManualAttemptHistory
} from "./cold-list-core.mjs";

// Lista fria (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24). Regras em lib/cold-list-core.mjs.
const PAGE = 1000;
const CHUNK = 150;

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase não configurado.");
  return client;
}

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function inChunks(ids, run) {
  const list = [...new Set((ids || []).filter(Boolean))];
  const rows = [];
  for (let from = 0; from < list.length; from += CHUNK) rows.push(...(await run(list.slice(from, from + CHUNK))));
  return rows;
}

export async function loadColdListTagId(supabase = db()) {
  const { data, error } = await supabase.from("tags").select("id").eq("normalized_name", COLD_LIST_TAG.key).maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

// Clientes escondidos da visão padrão de Clientes: etiqueta "Lista fria" E ainda em "Tentando contato" (quem respondeu e
// avançou volta a aparecer; a etiqueta fica como histórico). Erro sobe: sem a lista, a tela mostraria números errados.
export async function loadColdListHiddenIds(supabase = db()) {
  const tagId = await loadColdListTagId(supabase);
  if (!tagId) return [];
  const links = await fetchAll(() => supabase.from("client_tags").select("client_id").eq("tag_id", tagId).order("client_id", { ascending: true }));
  const rows = await inChunks(links.map((row) => row.client_id), async (ids) => {
    const { data, error } = await supabase.from("simulation_registrations").select("id").in("id", ids).eq("status", CLIENT_STATUS.AWAITING_RETURN);
    if (error) throw error;
    return data || [];
  });
  return rows.map((row) => row.id);
}

async function loadAttemptsByClient(clientIds) {
  const wanted = new Set(clientIds);
  const byClient = new Map();
  const push = (clientId, brokerId, at) => {
    if (!wanted.has(clientId)) return;
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId).push({ brokerId, at });
  };
  const [goalAttempts, manual] = await Promise.all([
    fetchAll(() => db().from("daily_goal_attempts").select("client_id, broker_id, created_at").not("client_id", "is", null).order("id", { ascending: true })),
    fetchAll(() => db().from("prospecting_history").select("registration_id, user_id, event_type, details, created_at").in("event_type", COLD_LIST_MANUAL_ATTEMPT_EVENTS).not("registration_id", "is", null).order("id", { ascending: true }))
  ]);
  for (const row of goalAttempts) push(row.client_id, row.broker_id, row.created_at);
  for (const row of manual) if (isManualAttemptHistory(row)) push(row.registration_id, row.user_id, row.created_at);
  return byClient;
}

async function loadReturnsByClient(clientIds) {
  const wanted = new Set(clientIds);
  const rows = await fetchAll(() => db().from("prospecting_history").select("registration_id, created_at").in("event_type", COLD_LIST_RETURN_EVENTS).not("registration_id", "is", null).order("id", { ascending: true }));
  const byClient = new Map();
  for (const row of rows) {
    if (!wanted.has(row.registration_id)) continue;
    if (!byClient.has(row.registration_id)) byClient.set(row.registration_id, []);
    byClient.get(row.registration_id).push({ at: row.created_at });
  }
  return byClient;
}

// "Quem respondeu" (conservador, qualquer sinal em qualquer passagem): mensagem do cliente numa conversa ligada a ele ou
// do mesmo telefone, pendência "Cliente respondeu" da Prospecção (aberta ou não), rodada convertida ou "Em atendimento"
// pela Prospecção.
async function loadProtection(clients) {
  const ids = clients.map((client) => client.id);
  const phones = clients.map((client) => client.phone_normalized).filter(Boolean);
  const [byClientConv, byPhoneConv, alerts, history, simulations, wallet] = await Promise.all([
    inChunks(ids, async (chunk) => {
      const { data, error } = await db().from("whatsapp_conversations").select("client_id").in("client_id", chunk).not("last_inbound_at", "is", null);
      if (error) throw error;
      return data || [];
    }),
    inChunks(phones, async (chunk) => {
      const { data, error } = await db().from("whatsapp_conversations").select("contact_phone").in("contact_phone", chunk).not("last_inbound_at", "is", null);
      if (error) throw error;
      return data || [];
    }),
    inChunks(ids, async (chunk) => {
      const { data, error } = await db().from("prospecting_reply_alerts").select("client_id").in("client_id", chunk);
      if (error) throw error;
      return data || [];
    }),
    inChunks(ids, async (chunk) => {
      const { data, error } = await db().from("prospecting_history").select("registration_id").in("registration_id", chunk).in("event_type", ["daily_goal_converted", "in_service"]);
      if (error) throw error;
      return data || [];
    }),
    inChunks(ids, async (chunk) => {
      const { data, error } = await db().from("simulations").select("registration_id").in("registration_id", chunk);
      if (error) throw error;
      return data || [];
    }),
    inChunks(ids, async (chunk) => {
      const { data, error } = await db().from("prospecting_contacts").select("registration_id").in("registration_id", chunk).eq("status", "claimed");
      if (error) throw error;
      return data || [];
    })
  ]);
  const respondedPhones = new Set(byPhoneConv.map((row) => row.contact_phone));
  const responded = new Set([...byClientConv.map((row) => row.client_id), ...alerts.map((row) => row.client_id), ...history.map((row) => row.registration_id)]);
  for (const client of clients) if (client.phone_normalized && respondedPhones.has(client.phone_normalized)) responded.add(client.id);
  return {
    responded,
    withSimulation: new Set(simulations.map((row) => row.registration_id)),
    inWallet: new Set(wallet.map((row) => row.registration_id))
  };
}

async function archiveColdListClient(client, passages, now) {
  const nowIso = now.toISOString();
  const { data: updated, error } = await db().from("simulation_registrations")
    .update({ status: CLIENT_STATUS.ARCHIVED, last_status_change_at: nowIso })
    .eq("id", client.id)
    .eq("status", CLIENT_STATUS.AWAITING_RETURN)
    .is("private_contact_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) return false;

  await recordClientStatusChange({ supabase: db(), clientId: client.id, previousStatus: CLIENT_STATUS.AWAITING_RETURN, newStatus: CLIENT_STATUS.ARCHIVED, changedAt: nowIso, changedBy: "sistema", source: "system" });
  const { logClientJourneyEvent } = await import("./client-journey");
  await logClientJourneyEvent({ clientId: client.id, eventType: "status_reason", details: { newStatus: CLIENT_STATUS.ARCHIVED, previousStatus: CLIENT_STATUS.AWAITING_RETURN, reason: COLD_LIST_ARCHIVE_REASON } });

  // Nunca mais volta à fila: todos os contatos da pessoa (mesmo cadastro ou mesmo telefone) que estão na fila ficam
  // travados (claim_* só entrega recent_attempt com available_after vencido). Contato com corretor ou "Não contactar" não muda.
  let contactQuery = db().from("prospecting_contacts")
    .update({ status: "recent_attempt", assigned_user_id: null, available_after: COLD_LIST_LOCK_UNTIL, queue_sort_at: COLD_LIST_LOCK_UNTIL, updated_at: nowIso })
    .in("status", ["available", "recent_attempt"]);
  contactQuery = client.phone_normalized
    ? contactQuery.or(`registration_id.eq.${client.id},phone_normalized.eq.${client.phone_normalized}`)
    : contactQuery.eq("registration_id", client.id);
  const { data: locked, error: lockError } = await contactQuery.select("id");
  if (lockError) throw lockError;
  if (locked?.length) {
    const { error: historyError } = await db().from("prospecting_history").insert(locked.map((contact) => ({
      contact_id: contact.id, registration_id: client.id, user_id: null, event_type: COLD_LIST_HISTORY_EVENT,
      details: { reason: COLD_LIST_ARCHIVE_REASON, passages, availableAfter: COLD_LIST_LOCK_UNTIL }
    })));
    if (historyError) throw historyError;
  }
  return true;
}

// Rotina do cron scheduled-activities. A trava (mesma de lib/crm-metrics/cache.js) também espaça a rotina: depois de uma
// execução completa ela só volta a rodar quando a trava vence (10 min). Falha libera a trava para a próxima rodada.
export const COLD_LIST_LOCK_NAME = "prospecting_cold_list";
const COLD_LIST_INTERVAL_SECONDS = 600;

export async function runColdListJob(now = new Date()) {
  if (!(await acquireLock(COLD_LIST_LOCK_NAME, COLD_LIST_INTERVAL_SECONDS))) return { skipped: "aguardando_intervalo" };
  try {
    return await applyColdListRules(now);
  } catch (error) {
    await releaseLock(COLD_LIST_LOCK_NAME);
    throw error;
  }
}

export async function applyColdListRules(now = new Date()) {
  const clients = await fetchAll(() => db().from("simulation_registrations")
    .select("id, status, private_contact_at, phone_normalized")
    .eq("status", CLIENT_STATUS.AWAITING_RETURN)
    .is("private_contact_at", null)
    .order("id", { ascending: true }));
  if (!clients.length) return { hidden: 0, archived: 0 };
  const ids = clients.map((client) => client.id);
  const [attemptsByClient, returnsByClient, tagId] = await Promise.all([loadAttemptsByClient(ids), loadReturnsByClient(ids), loadColdListTagId()]);

  const tagged = new Set();
  if (tagId) {
    const links = await fetchAll(() => db().from("client_tags").select("client_id").eq("tag_id", tagId).order("client_id", { ascending: true }));
    for (const row of links) tagged.add(row.client_id);
  }

  const toHide = [];
  const archiveCandidates = [];
  for (const client of clients) {
    const attempts = attemptsByClient.get(client.id) || [];
    if (!tagged.has(client.id) && isColdListHidden({ status: client.status, privateContactAt: client.private_contact_at, distinctBrokers: countDistinctAttemptBrokers(attempts) })) toHide.push(client);
    const passages = countColdListPassages(attempts, returnsByClient.get(client.id) || []);
    if (passages >= COLD_LIST_ARCHIVE_PASSAGES) archiveCandidates.push({ client, passages });
  }

  let hidden = 0;
  if (toHide.length) {
    const { addSystemTagToClient } = await import("./client-tags");
    for (const client of toHide) {
      const result = await addSystemTagToClient(client.id, COLD_LIST_TAG.name, COLD_LIST_TAG.color);
      if (result?.added) hidden += 1;
    }
  }

  let archived = 0;
  const skipped = {};
  if (archiveCandidates.length) {
    const protection = await loadProtection(archiveCandidates.map(({ client }) => client));
    for (const { client, passages } of archiveCandidates) {
      const reason = coldListArchiveBlockReason({
        status: client.status,
        privateContactAt: client.private_contact_at,
        passages,
        responded: protection.responded.has(client.id),
        hasSimulation: protection.withSimulation.has(client.id),
        contactInWallet: protection.inWallet.has(client.id)
      });
      if (reason) { skipped[reason] = (skipped[reason] || 0) + 1; continue; }
      if (await archiveColdListClient(client, passages, now)) archived += 1;
    }
  }
  return { hidden, archived, skipped };
}
