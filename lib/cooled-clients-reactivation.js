import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { isOwnerAdminEmail } from "./admin-profiles";
import { isRouletteEligibleClient } from "./client-distribution-core.mjs";
import { COOLED_FLOW_SETTING_ID } from "./cooled-clients-core.mjs";
import {
  REACTIVATION_DEADLINE_MS,
  REACTIVATION_SPACING_MS,
  REACTIVATION_STATUS,
  backfillCaseDecision,
  hasHumanMessageSince,
  offeredCaseOutcome,
  planReactivationDeliveries,
  queuedCaseStillWaiting
} from "./cooled-clients-reactivation-core.mjs";
import {
  isMissingSchemaError,
  listOnlineRouletteBrokerIds,
  queueCooledClientForReactivation,
  recordLeadDistributionHistory
} from "./lead-distribution";

// Fila de reativação dos clientes TRANSFERIDOS pelo FUN-15 (FUN-15l — REGRA OFICIAL DE NEGÓCIO, dono, 2026-10-17).
// Regras puras: lib/cooled-clients-reactivation-core.mjs. Estado: colunas reactivation_* de cooled_client_cases
// (migration 20261017120000). Enquanto espera, o cliente fica com o dono (FUN-11) e com pending_distribution_at — a
// fila de espera comum (reassignPendingRouletteLeads) o ignora (listCooledReactivationQueuedClientIds).
// Roda a cada rodada do cron scheduled-activities (2 min), só com o liga/desliga `cooled_clients_flow` LIGADO:
//  1) uma única vez, devolve à fila os transferidos que ninguém contactou (backfill, resultado em crm_settings);
//  2) entregues há 3 min ou mais: mandou mensagem → fica; não mandou → FIM da fila;
//  3) entrega aos corretores elegíveis da roleta, 1 por corretor e só 3 min depois da entrega anterior a ele.
// Prazo de 3 min checado pelo cron de 2 min: a devolução acontece entre 3 e 5 min depois da entrega (mensagem enviada
// até a checagem conta).

const BACKFILL_SETTING_ID = "cooled_reactivation_backfill";
// Primeiro dia do FUN-15 (16/10/2026, 00:00 de Brasília): só transferências deste fluxo entram no backfill.
const BACKFILL_SINCE = "2026-10-16T03:00:00.000Z";
const OPEN_STATUSES = [REACTIVATION_STATUS.QUEUED, REACTIVATION_STATUS.OFFERED];
const CASE_COLUMNS = "id, client_id, broker_id, decision, decided_at, transferred_to, reactivation_status, reactivation_queued_at, reactivation_offered_to, reactivation_offered_at, reactivation_rounds";
const CLIENT_COLUMNS = "id, full_name, client_code, status, responsible_user_id, pending_distribution_at, direct_broker_link, distribution_type, prospecting_contact_id, last_whatsapp_contact_at";
const CHUNK = 150;
const SYSTEM_ACTOR = { email: "sistema", name: "Sistema", role: "automacao" };

function db() {
  return getSupabaseAdminClient();
}

async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function chunk(list, size = CHUNK) {
  const parts = [];
  for (let index = 0; index < list.length; index += size) parts.push(list.slice(index, index + size));
  return parts;
}

// Migration 20261017120000 aplicada? Sem as colunas, a transferência do FUN-15 segue o caminho antigo (roleta direta).
export async function isCooledReactivationAvailable() {
  const { error } = await db().from("cooled_client_cases").select("reactivation_status").limit(1);
  if (!error) return true;
  if (isMissingSchemaError(error)) {
    console.warn("[fila de reativação] migration 20261017120000 ainda não aplicada: transferência do FUN-15 segue direto para a roleta.");
    return false;
  }
  throw error;
}

async function flowEnabled() {
  const row = await run(db().from("crm_settings").select("setting_value").eq("id", COOLED_FLOW_SETTING_ID).maybeSingle());
  return row?.setting_value?.enabled === true;
}

async function loadOwnerId() {
  const users = (await run(db().from("admin_users").select("id, email, status"))) || [];
  return users.find((user) => isOwnerAdminEmail(user.email) && user.status === "active")?.id || "";
}

async function loadClients(ids) {
  const rows = [];
  for (const part of chunk([...new Set(ids)])) rows.push(...((await run(db().from("simulation_registrations").select(CLIENT_COLUMNS).in("id", part))) || []));
  const contactIds = [...new Set(rows.map((row) => row.prospecting_contact_id).filter(Boolean))];
  const availableAfter = new Map();
  for (const part of chunk(contactIds)) {
    for (const contact of (await run(db().from("prospecting_contacts").select("id, available_after").in("id", part))) || []) availableAfter.set(contact.id, contact.available_after);
  }
  return new Map(rows.map((row) => [row.id, { ...row, eligible: isRouletteEligibleClient({ ...row, available_after: availableAfter.get(row.prospecting_contact_id) || null }) }]));
}

// Mensagens HUMANAS de saída de cada cliente depois de `sinceByClient` (mesma régua de contato do CRM).
async function loadContactedClientIds(sinceByClient) {
  const clientIds = [...sinceByClient.keys()];
  const contacted = new Set();
  if (!clientIds.length) return contacted;
  const conversationsByClient = new Map();
  for (const part of chunk(clientIds)) {
    for (const row of (await run(db().from("whatsapp_conversations").select("id, client_id").in("client_id", part))) || []) conversationsByClient.set(row.id, row.client_id);
  }
  const conversationIds = [...conversationsByClient.keys()];
  const earliest = [...sinceByClient.values()].map((value) => Date.parse(value || "")).filter(Number.isFinite).sort((a, b) => a - b)[0];
  if (!conversationIds.length || !Number.isFinite(earliest)) return contacted;
  const byClient = new Map();
  for (const part of chunk(conversationIds)) {
    const rows = (await run(db().from("whatsapp_messages")
      .select("conversation_id, direction, sender_type, status, message_type, metadata, message_at")
      .in("conversation_id", part)
      .eq("direction", "outbound")
      .eq("sender_type", "user")
      .gt("message_at", new Date(earliest).toISOString())
      .limit(5000))) || [];
    for (const row of rows) {
      const clientId = conversationsByClient.get(row.conversation_id);
      if (!byClient.has(clientId)) byClient.set(clientId, []);
      byClient.get(clientId).push(row);
    }
  }
  for (const [clientId, since] of sinceByClient) if (hasHumanMessageSince(byClient.get(clientId) || [], since)) contacted.add(clientId);
  return contacted;
}

async function updateCase(id, patch, { expectStatus = null } = {}) {
  let query = db().from("cooled_client_cases").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (expectStatus) query = query.eq("reactivation_status", expectStatus);
  return Boolean((await run(query.select("id")))?.length);
}

// ---------------------------------------------------------------------------
// Backfill (uma vez): transferidos pelo FUN-15 que ninguém contactou voltam para a fila.
// ---------------------------------------------------------------------------

export async function backfillCooledReactivationQueue({ ownerId, dryRun = false } = {}) {
  const cases = (await run(db().from("cooled_client_cases").select(CASE_COLUMNS).eq("decision", "transferred").is("reactivation_status", null).gte("decided_at", BACKFILL_SINCE).order("decided_at", { ascending: true }).limit(2000))) || [];
  const summary = { checked: cases.length, queued: 0, alreadyWaiting: 0, failed: 0, skipped: {} };
  if (!cases.length) return summary;
  // Caso mais recente de cada cliente (um cliente pode ter sido transferido mais de uma vez).
  const latest = new Map();
  for (const row of cases) latest.set(row.client_id, row);
  const clients = await loadClients([...latest.keys()]);
  const contacted = await loadContactedClientIds(new Map([...latest.values()].map((row) => [row.client_id, row.decided_at])));
  for (const row of latest.values()) {
    const client = clients.get(row.client_id);
    // "Contactado" = mensagem humana depois da transferência OU contato gravado depois dela (definição do dono).
    const wasContacted = contacted.has(row.client_id) || (client?.last_whatsapp_contact_at && Date.parse(client.last_whatsapp_contact_at) > Date.parse(row.decided_at));
    const decision = backfillCaseDecision({ caseRow: row, client, ownerId, contacted: Boolean(wasContacted) });
    if (decision !== "queue") {
      summary.skipped[decision] = (summary.skipped[decision] || 0) + 1;
      continue;
    }
    if (dryRun) { summary.queued += 1; continue; }
    try {
      const waitingWithOwner = queuedCaseStillWaiting({ clientResponsibleId: client.responsible_user_id, ownerId, pendingDistributionAt: client.pending_distribution_at, clientEligible: client.eligible });
      // Marca a fila ANTES de mexer no cliente: a fila de espera comum nunca o pega no meio do caminho.
      await updateCase(row.id, { reactivation_status: REACTIVATION_STATUS.QUEUED, reactivation_queued_at: row.decided_at || new Date().toISOString() });
      if (waitingWithOwner) {
        summary.alreadyWaiting += 1;
      } else {
        try {
          await queueCooledClientForReactivation(row.client_id, { expectedResponsibleId: client.responsible_user_id || null, caseId: row.id, trigger: "backfill", reason: "Transferido pelo fluxo de clientes que esfriaram e sem mensagem do corretor: voltou para a fila de reativação" });
        } catch (error) {
          await updateCase(row.id, { reactivation_status: null, reactivation_queued_at: null });
          throw error;
        }
      }
      summary.queued += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("[fila de reativação] backfill falhou:", row.id, error?.message || error);
    }
  }
  return summary;
}

async function backfillOnce(ownerId) {
  const marker = await run(db().from("crm_settings").select("setting_value").eq("id", BACKFILL_SETTING_ID).maybeSingle());
  if (marker?.setting_value?.doneAt) return null;
  const startedAt = new Date().toISOString();
  // Marca antes de rodar: duas rodadas do cron nunca fazem o backfill duas vezes.
  const { error } = await db().from("crm_settings").insert({ id: BACKFILL_SETTING_ID, setting_value: { startedAt }, updated_at: startedAt });
  if (error) {
    if (error.code === "23505") return null;
    throw error;
  }
  const summary = await backfillCooledReactivationQueue({ ownerId });
  const doneAt = new Date().toISOString();
  await run(db().from("crm_settings").update({ setting_value: { startedAt, doneAt, ...summary }, updated_at: doneAt }).eq("id", BACKFILL_SETTING_ID));
  return summary;
}

// ---------------------------------------------------------------------------
// Rotina da fila
// ---------------------------------------------------------------------------

export async function runCooledReactivationQueue({ now = Date.now() } = {}) {
  if (!(await flowEnabled())) return { enabled: false };
  if (!(await isCooledReactivationAvailable())) return { enabled: true, migrationMissing: true };
  const ownerId = await loadOwnerId();
  if (!ownerId) throw new Error("Administrador principal não encontrado para a fila de reativação.");
  const summary = { enabled: true, backfill: await backfillOnce(ownerId), kept: 0, requeued: 0, left: 0, delivered: 0, waiting: 0 };

  const open = (await run(db().from("cooled_client_cases").select(CASE_COLUMNS).in("reactivation_status", OPEN_STATUSES).order("reactivation_queued_at", { ascending: true }).order("id", { ascending: true }).limit(2000))) || [];
  if (!open.length) return summary;
  const clients = await loadClients(open.map((row) => row.client_id));

  // 2) Entregues: prazo de 3 min.
  const offered = open.filter((row) => row.reactivation_status === REACTIVATION_STATUS.OFFERED);
  const contacted = await loadContactedClientIds(new Map(offered.map((row) => [row.client_id, row.reactivation_offered_at])));
  const requeuedIds = new Set();
  for (const row of offered) {
    const client = clients.get(row.client_id);
    const outcome = offeredCaseOutcome({ offeredTo: row.reactivation_offered_to, offeredAt: row.reactivation_offered_at, clientResponsibleId: client?.responsible_user_id || "", clientEligible: Boolean(client?.eligible), contacted: contacted.has(row.client_id), now });
    try {
      if (outcome === "kept") {
        if (await updateCase(row.id, { reactivation_status: REACTIVATION_STATUS.KEPT, reactivation_kept_at: new Date(now).toISOString() }, { expectStatus: REACTIVATION_STATUS.OFFERED })) summary.kept += 1;
      } else if (outcome === "left") {
        if (await updateCase(row.id, { reactivation_status: REACTIVATION_STATUS.LEFT }, { expectStatus: REACTIVATION_STATUS.OFFERED })) summary.left += 1;
      } else if (outcome === "requeue") {
        // Volta ao FIM da fila (queued_at = agora), com o dono, esperando outro corretor on-line.
        const queuedAt = new Date(now).toISOString();
        if (!(await updateCase(row.id, { reactivation_status: REACTIVATION_STATUS.QUEUED, reactivation_queued_at: queuedAt }, { expectStatus: REACTIVATION_STATUS.OFFERED }))) continue;
        try {
          await queueCooledClientForReactivation(row.client_id, { expectedResponsibleId: row.reactivation_offered_to, caseId: row.id, trigger: "no_message_3min", reason: "Sem mensagem ao cliente em 3 minutos: voltou para o fim da fila de reativação" });
        } catch (error) {
          await updateCase(row.id, { reactivation_status: REACTIVATION_STATUS.OFFERED, reactivation_queued_at: row.reactivation_queued_at });
          throw error;
        }
        requeuedIds.add(row.id);
        summary.requeued += 1;
      }
    } catch (error) {
      console.error("[fila de reativação] falha no prazo de 3 min:", row.id, error?.message || error);
    }
  }

  // 3) Fila: quem ainda espera, na ordem (devolvidos agora já estão no fim, pelo queued_at).
  const freshClients = requeuedIds.size ? await loadClients(open.filter((row) => requeuedIds.has(row.id)).map((row) => row.client_id)) : new Map();
  const queue = [];
  for (const row of open) {
    const isQueued = row.reactivation_status === REACTIVATION_STATUS.QUEUED || requeuedIds.has(row.id);
    if (!isQueued) continue;
    const client = freshClients.get(row.client_id) || clients.get(row.client_id);
    if (!queuedCaseStillWaiting({ clientResponsibleId: client?.responsible_user_id || "", ownerId, pendingDistributionAt: client?.pending_distribution_at, clientEligible: Boolean(client?.eligible) })) {
      if (await updateCase(row.id, { reactivation_status: REACTIVATION_STATUS.LEFT }, { expectStatus: REACTIVATION_STATUS.QUEUED })) {
        summary.left += 1;
        // Saiu por status que não vai à roleta: continua com o dono (FUN-11), fora da fila de espera.
        if (client && !client.eligible && client.pending_distribution_at && client.responsible_user_id === ownerId) {
          await run(db().from("simulation_registrations").update({ pending_distribution_at: null }).eq("id", client.id).eq("responsible_user_id", ownerId));
        }
      }
      continue;
    }
    queue.push({ row, client, queuedAt: requeuedIds.has(row.id) ? new Date(now).toISOString() : row.reactivation_queued_at });
  }
  queue.sort((a, b) => Date.parse(a.queuedAt || 0) - Date.parse(b.queuedAt || 0));
  summary.waiting = queue.length;
  if (!queue.length) return summary;

  const onlineBrokerIds = await listOnlineRouletteBrokerIds();
  if (!onlineBrokerIds.length) return summary;
  const sinceIso = new Date(now - REACTIVATION_SPACING_MS).toISOString();
  const [recentOffers, positions] = await Promise.all([
    run(db().from("cooled_client_cases").select("reactivation_offered_to, reactivation_offered_at").in("reactivation_offered_to", onlineBrokerIds).gte("reactivation_offered_at", sinceIso)),
    run(db().from("admin_users").select("id, lead_distribution_position").in("id", onlineBrokerIds))
  ]);
  const lastOfferAtByBroker = new Map();
  for (const offer of recentOffers || []) {
    const previous = lastOfferAtByBroker.get(offer.reactivation_offered_to);
    if (!previous || Date.parse(offer.reactivation_offered_at) > Date.parse(previous)) lastOfferAtByBroker.set(offer.reactivation_offered_to, offer.reactivation_offered_at);
  }
  // Para a ordem entre os disponíveis: última entrega da fila de cada um (mesmo antiga).
  const lastEver = (await run(db().from("cooled_client_cases").select("reactivation_offered_to, reactivation_offered_at").in("reactivation_offered_to", onlineBrokerIds).not("reactivation_offered_at", "is", null).order("reactivation_offered_at", { ascending: false }).limit(500))) || [];
  for (const offer of lastEver) if (!lastOfferAtByBroker.has(offer.reactivation_offered_to)) lastOfferAtByBroker.set(offer.reactivation_offered_to, offer.reactivation_offered_at);

  const plan = planReactivationDeliveries({
    queue: queue.map((item) => ({ caseId: item.row.id, previousBrokerId: item.row.broker_id })),
    onlineBrokerIds,
    lastOfferAtByBroker,
    positionByBroker: new Map((positions || []).map((user) => [user.id, user.lead_distribution_position])),
    ownerId,
    now
  });
  const byCase = new Map(queue.map((item) => [item.row.id, item]));
  for (const { caseId, brokerId } of plan) {
    try {
      if (await deliverReactivationClient(byCase.get(caseId), brokerId, ownerId, now)) summary.delivered += 1;
    } catch (error) {
      console.error("[fila de reativação] falha na entrega:", caseId, error?.message || error);
    }
  }
  summary.waiting -= summary.delivered;
  return summary;
}

async function deliverReactivationClient({ row, client }, brokerId, ownerId, now) {
  const at = new Date(now).toISOString();
  const holder = client.responsible_user_id || null;
  let update = db().from("simulation_registrations")
    .update({ responsible_user_id: brokerId, previous_responsible_user_id: holder, responsible_changed_at: at, pending_distribution_at: null })
    .eq("id", client.id)
    .not("pending_distribution_at", "is", null);
  update = holder ? update.eq("responsible_user_id", holder) : update.is("responsible_user_id", null);
  const moved = await run(update.select("id"));
  if (!moved?.length) return false;
  await updateCase(row.id, {
    reactivation_status: REACTIVATION_STATUS.OFFERED,
    reactivation_offered_to: brokerId,
    reactivation_offered_at: at,
    reactivation_rounds: (Number(row.reactivation_rounds) || 0) + 1,
    transferred_to: brokerId
  });

  const deadlineMinutes = Math.round(REACTIVATION_DEADLINE_MS / 60000);
  const { logClientJourneyEvent } = await import("./client-journey");
  await Promise.allSettled([
    // historyPreviousUserId: a "Conversa anterior" (FUN-15g/h) do novo corretor é a do corretor do FUN-15, não a do dono
    // que só segurou a fila (lastResponsibleTransferCut).
    recordLeadDistributionHistory({
      registration: { id: client.id, fullName: client.full_name },
      eventType: "assigned",
      fromUserId: holder,
      toUserId: brokerId,
      details: { fromWaitingQueue: true, cooledReactivation: "delivered", caseId: row.id, historyPreviousUserId: row.broker_id || null, deadlineMinutes }
    }),
    logClientJourneyEvent({ clientId: client.id, eventType: "responsible_assigned", actor: SYSTEM_ACTOR, details: { source: "roleta_fila_reativacao", brokerId, caseId: row.id } }),
    // Aviso só para quem recebe (como a roleta já faz) — nunca em massa.
    db().from("crm_notifications").insert({
      recipient_user_id: brokerId,
      client_id: client.id,
      title: "Cliente transferido para você",
      description: `${client.full_name || "Um cliente"} foi transferido(a) para você pela roleta. Envie uma mensagem em até ${deadlineMinutes} minutos, senão ele(a) volta para a fila.`,
      notification_type: "new_client",
      scheduled_at: at
    })
  ]);
  return true;
}
