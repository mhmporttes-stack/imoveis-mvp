import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { ACTIVE_CLIENT_STATUS_VALUES, CLIENT_STATUS, clientStatusLabel } from "./client-status";
import { isDailyGoalPendingCandidate } from "./daily-goal-progress.mjs";
import { loadLatestCalendarActivity, rowToClient } from "./daily-goal-pending";
import { isGeneralAdminProfile, isManagerProfile, isOwnerAdminEmail } from "./admin-profiles";
import { acknowledgeAlertByDedupeKey, createAlertDeliveries, resolveAlertDeliveriesByPrefix } from "./crm-alerts";
import { isRevoked } from "./whatsapp-message-actions.mjs";
import { getTimeGreeting } from "./daily-report";
import { loadRecentAttendanceByClient } from "./client-attendance";
import {
  CASE_STATUS,
  COOLED_ALERT_TYPE,
  COOLED_APPROVED_STATUS_VALUES,
  COOLED_TRANSFER_TAG,
  COOLED_DEDUPE_PREFIX,
  COOLED_FLOW_SETTING_ID,
  NEGATIVE_DECISION_OPTIONS,
  OPEN_CASE_STATUSES,
  applyCaseAction,
  autoCancelReason,
  availableDecisionActions,
  buildReasonAlertDelivery,
  canAnswerCase,
  canDecideCase,
  caseLatestReason,
  caseRound,
  cooledDedupeKey,
  genericHandoffMessage,
  isCooledCandidate,
  parseHandoffResponse,
  renderHandoffMessage,
  resolveDeciderId,
  wasEverApprovedForCooledFlow
} from "./cooled-clients-core.mjs";

// Fluxo de clientes que esfriaram (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16). Regras puras em
// lib/cooled-clients-core.mjs; aqui ficam só consultas e gravações. Tabela cooled_client_cases (migration
// 20261016120000). Liga/desliga em crm_settings `cooled_clients_flow` (nasce DESLIGADO).
//  - runCooledClientsFlow (cron scheduled-activities, no máx. a cada 10 min): cancela casos que perderam o sentido,
//    abre casos novos e garante a janela obrigatória (Central de Alertas, Importante) do corretor.
//  - answerCooledCase: o corretor escreve o motivo (mín. 15 letras), a janela fecha.
//  - listMyCooledDecisions / decideCooledCase: a decisora (gestora da equipe ou o dono) transfere pela roleta
//    (returnClientToRoulette, o mesmo "Devolver para a roleta"), aplica um status negativo ou devolve uma vez.
//  - getCooledHandoff: resumo + mensagem sugerida por IA para o novo corretor, gerados UMA vez por transferência.

export class CooledClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CooledClientError";
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_SETTING_ID = "cooled_clients_flow_run";
const RUN_INTERVAL_MS = 10 * 60 * 1000;
const NO_CONTACT_MS = 3 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const CHUNK_SIZE = 150;
const CLIENT_COLUMNS = "id, full_name, client_code, phone, phone_normalized, status, responsible_user_id, last_whatsapp_contact_at, last_status_change_at, created_at, scheduled_activity_at, scheduled_activity_completed_at, private_contact_at, responsible_changed_at, approved_at";
const CASE_COLUMNS = "id, client_id, broker_id, decider_id, client_status_at_open, status, opened_at, first_reason, first_reason_by, first_reason_at, returned_text, returned_by, returned_at, second_reason, second_reason_by, second_reason_at, decision, decision_status, decided_by, decided_at, transferred_to, canceled_reason, closed_at";

function db() {
  if (!hasSupabaseAdminConfig) throw new CooledClientError("Supabase não configurado.", 503);
  return getSupabaseAdminClient();
}

// Tabela cooled_client_cases ainda não criada (migration não aplicada): leituras da tela respondem "nada a mostrar".
function isTableMissing(error) {
  return /42P01|PGRST205/.test(`${error?.code || ""} ${error?.message || ""}`);
}

async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function chunk(list, size = CHUNK_SIZE) {
  const parts = [];
  for (let index = 0; index < list.length; index += size) parts.push(list.slice(index, index + size));
  return parts;
}

function viewerOf(auth) {
  // Em "Alterar conta" ninguém responde nem decide em nome de outra pessoa (como a Central de Alertas).
  if (!auth?.ok || auth.accountSwitchMode) return null;
  return {
    viewerId: auth.profile?.id || "",
    isOwner: isOwnerAdminEmail(auth.user?.email),
    isManager: isManagerProfile(auth.profile),
    managedUserIds: auth.profile?.managedUserIds || []
  };
}

// ---------------------------------------------------------------------------
// Liga/desliga
// ---------------------------------------------------------------------------

export async function getCooledFlowSettings() {
  const row = await run(db().from("crm_settings").select("setting_value, updated_at").eq("id", COOLED_FLOW_SETTING_ID).maybeSingle());
  return { enabled: row?.setting_value?.enabled === true, updatedAt: row?.updated_at || null };
}

export async function setCooledFlowEnabled(auth, enabled) {
  if (!auth?.ok || auth.accountSwitchMode || !isGeneralAdminProfile(auth.profile)) throw new CooledClientError("Apenas o administrador geral liga ou desliga este fluxo.", 403);
  const now = new Date().toISOString();
  await run(db().from("crm_settings").upsert({ id: COOLED_FLOW_SETTING_ID, setting_value: { enabled: Boolean(enabled) }, updated_by: auth.profile.id, updated_at: now }, { onConflict: "id" }));
  return { enabled: Boolean(enabled), updatedAt: now };
}

// ---------------------------------------------------------------------------
// Leituras de apoio
// ---------------------------------------------------------------------------

async function loadUsers() {
  const users = (await run(db().from("admin_users").select("id, name, email, role, status, manager_id, linked_broker_id, gender"))) || [];
  const enriched = users.map((user) => ({ ...user, isGeneralAdmin: isGeneralAdminProfile(user) }));
  const usersById = new Map(enriched.map((user) => [user.id, user]));
  const ownerId = enriched.find((user) => isOwnerAdminEmail(user.email) && user.status === "active")?.id || "";
  return { users: enriched, usersById, ownerId };
}

function toClient(row, calendarLatest) {
  // Telefone para os cards do fluxo (FUN-15d): quem recebe o card já tem acesso ao cliente pelo escopo do caso.
  return { ...rowToClient(row, calendarLatest), phone: row.phone_normalized || row.phone || "", privateContactAt: row.private_contact_at || null, responsibleChangedAt: row.responsible_changed_at || null, approvedAt: row.approved_at || null };
}

async function loadClientsByIds(ids) {
  const rows = [];
  for (const part of chunk([...new Set(ids)])) rows.push(...((await run(db().from("simulation_registrations").select(CLIENT_COLUMNS).in("id", part))) || []));
  const calendarLatest = await loadLatestCalendarActivity(rows.map((row) => row.id));
  return new Map(rows.map((row) => [row.id, toClient(row, calendarLatest)]));
}

async function loadHistoryByClient(clientIds) {
  const byClient = new Map();
  for (const part of chunk(clientIds)) {
    const rows = (await run(db().from("client_status_history").select("client_id, previous_status, new_status").in("client_id", part))) || [];
    for (const row of rows) {
      if (!byClient.has(row.client_id)) byClient.set(row.client_id, []);
      byClient.get(row.client_id).push(row);
    }
  }
  return byClient;
}

// Só as linhas do histórico que entram ou saem de Aprovado/Reunião/Venda: "já foi aprovado alguma vez"
// (wasEverApprovedForCooledFlow, regra do dono de 2026-10-16) sem trazer o histórico inteiro de cada cliente.
async function loadApprovalHistoryByClient(clientIds) {
  const byClient = new Map();
  const statuses = COOLED_APPROVED_STATUS_VALUES.join(",");
  for (const part of chunk([...new Set(clientIds)])) {
    const rows = (await run(db().from("client_status_history").select("client_id, previous_status, new_status").in("client_id", part).or(`new_status.in.(${statuses}),previous_status.in.(${statuses})`))) || [];
    for (const row of rows) {
      if (!byClient.has(row.client_id)) byClient.set(row.client_id, []);
      byClient.get(row.client_id).push(row);
    }
  }
  return byClient;
}

function everApproved(client, approvalHistory) {
  return wasEverApprovedForCooledFlow({ status: client?.status, approvedAt: client?.approvedAt, historyRows: approvalHistory.get(client?.id) || [] });
}

// Candidatos de agora: mesmo filtro de banco dos pendentes da Meta Diária (só evita trazer a carteira inteira); a
// decisão final é sempre a regra pura isCooledCandidate.
async function scanCandidates({ users, usersById, now }) {
  const responsibleIds = users.filter((user) => user.status !== "inactive" && ["broker", "associate", "manager"].includes(user.role) && !user.isGeneralAdmin).map((user) => user.id);
  const cutoffIso = new Date(now - NO_CONTACT_MS).toISOString();
  const rows = [];
  for (const ids of chunk(responsibleIds)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const data = await run(db()
        .from("simulation_registrations")
        .select(CLIENT_COLUMNS)
        .in("responsible_user_id", ids)
        .in("status", [...ACTIVE_CLIENT_STATUS_VALUES])
        .is("private_contact_at", null)
        .or(`last_whatsapp_contact_at.lt.${cutoffIso},and(last_whatsapp_contact_at.is.null,created_at.lt.${cutoffIso})`)
        .order("id")
        .range(from, from + PAGE_SIZE - 1));
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  const calendarLatest = await loadLatestCalendarActivity(rows.map((row) => row.id));
  const clients = rows.map((row) => toClient(row, calendarLatest)).filter((client) => isDailyGoalPendingCandidate(client, now));
  if (!clients.length) return [];
  const awaitingReturnIds = clients.filter((client) => client.status === CLIENT_STATUS.AWAITING_RETURN).map((client) => client.id);
  const [history, approvalHistory, attendance] = await Promise.all([
    awaitingReturnIds.length ? loadHistoryByClient(awaitingReturnIds) : new Map(),
    loadApprovalHistoryByClient(clients.map((client) => client.id)),
    // Último atendimento dos últimos 3 dias (regra do dono, 2026-10-16) zera a contagem: sem caso novo.
    loadRecentAttendanceByClient(db(), { sinceIso: cutoffIso, clientIds: clients.map((client) => client.id) })
  ]);
  return clients.filter((client) => isCooledCandidate({
    client: { ...client, lastAttendanceAt: attendance.get(client.id) || null },
    responsible: usersById.get(client.responsibleUserId),
    // Histórico completo para "Tentando contato"; para os demais, só as linhas de aprovação (bastam para a regra).
    historyRows: history.get(client.id) || approvalHistory.get(client.id) || [],
    now
  }));
}

async function loadOpenCases() {
  return (await run(db().from("cooled_client_cases").select(CASE_COLUMNS).in("status", OPEN_CASE_STATUSES).limit(5000))) || [];
}

// ---------------------------------------------------------------------------
// Cron: abrir / reconciliar
// ---------------------------------------------------------------------------

async function cancelCase(row, reason) {
  const now = new Date().toISOString();
  const data = await run(db().from("cooled_client_cases").update({ status: CASE_STATUS.CANCELED, canceled_reason: reason, closed_at: now, updated_at: now }).eq("id", row.id).eq("status", row.status).select("id"));
  if (data?.length) await resolveAlertDeliveriesByPrefix(`${COOLED_DEDUPE_PREFIX}${row.id}:`);
  return Boolean(data?.length);
}

function deliveryFor(caseRow, client, usersById) {
  return buildReasonAlertDelivery({
    caseRow,
    clientName: client?.fullName || "",
    stageLabel: clientStatusLabel(client?.status),
    returnedByName: usersById.get(caseRow.returned_by)?.name || ""
  });
}

// `dryRun`: só conta (consulta de conferência antes de ligar). `force`: ignora o intervalo mínimo entre rodadas.
export async function runCooledClientsFlow({ force = false, dryRun = false } = {}) {
  const now = Date.now();
  if (!dryRun) {
    const settings = await getCooledFlowSettings();
    if (!settings.enabled) return { enabled: false };
    const last = await run(db().from("crm_settings").select("setting_value").eq("id", RUN_SETTING_ID).maybeSingle());
    const lastAt = Date.parse(last?.setting_value?.lastRunAt || "");
    if (!force && Number.isFinite(lastAt) && now - lastAt < RUN_INTERVAL_MS) return { enabled: true, skipped: true };
    await run(db().from("crm_settings").upsert({ id: RUN_SETTING_ID, setting_value: { lastRunAt: new Date(now).toISOString() }, updated_at: new Date(now).toISOString() }, { onConflict: "id" }));
  }

  const { users, usersById, ownerId } = await loadUsers();
  const openCases = dryRun ? [] : await loadOpenCases();
  const summary = { enabled: true, opened: 0, canceled: 0, repairedAlerts: 0, candidates: 0 };

  // 1) Casos abertos que perderam o sentido.
  const openClients = openCases.length ? await loadClientsByIds(openCases.map((row) => row.client_id)) : new Map();
  const openApprovalHistory = openCases.length ? await loadApprovalHistoryByClient(openCases.map((row) => row.client_id)) : new Map();
  const stillOpen = [];
  for (const row of openCases) {
    const client = openClients.get(row.client_id);
    // Contato retomado / atividade futura não encerram mais o caso (regra do dono, 2026-10-16): só o motivo do corretor.
    const reason = autoCancelReason({ row, client, historyRows: openApprovalHistory.get(row.client_id) || [] });
    if (reason) {
      if (await cancelCase(row, reason)) summary.canceled += 1;
    } else stillOpen.push(row);
  }

  // 2) Casos novos (um por cliente enquanto houver caso aberto).
  const candidates = await scanCandidates({ users, usersById, now });
  summary.candidates = candidates.length;
  const openClientIds = new Set(stillOpen.map((row) => row.client_id));
  const fresh = candidates.filter((client) => !openClientIds.has(client.id));
  if (dryRun) {
    const perBroker = {};
    const perDecider = {};
    for (const client of fresh) {
      const responsible = usersById.get(client.responsibleUserId);
      const deciderId = resolveDeciderId({ responsible, usersById, ownerId });
      const brokerName = responsible?.name || client.responsibleUserId;
      const deciderName = usersById.get(deciderId)?.name || "(sem decisor)";
      perBroker[brokerName] = (perBroker[brokerName] || 0) + 1;
      perDecider[deciderName] = (perDecider[deciderName] || 0) + 1;
    }
    return { dryRun: true, total: fresh.length, perBroker, perDecider };
  }

  const newRows = fresh.map((client) => ({
    client_id: client.id,
    broker_id: client.responsibleUserId,
    decider_id: resolveDeciderId({ responsible: usersById.get(client.responsibleUserId), usersById, ownerId }) || null,
    client_status_at_open: client.status,
    status: CASE_STATUS.AWAITING_REASON
  }));
  const inserted = [];
  for (const part of chunk(newRows, 100)) {
    const { data, error } = await db().from("cooled_client_cases").insert(part).select(CASE_COLUMNS);
    if (!error) { inserted.push(...(data || [])); continue; }
    if (error.code !== "23505") throw error;
    // Corrida com outra rodada: grava um a um ignorando quem já tem caso aberto.
    for (const row of part) {
      const single = await db().from("cooled_client_cases").insert(row).select(CASE_COLUMNS).maybeSingle();
      if (single.error && single.error.code !== "23505") throw single.error;
      if (single.data) inserted.push(single.data);
    }
  }
  summary.opened = inserted.length;

  // 3) Janela obrigatória para todo caso aguardando o corretor (idempotente: mesma chave não duplica).
  const candidateById = new Map(candidates.map((client) => [client.id, client]));
  const awaiting = [...stillOpen, ...inserted].filter((row) => row.status === CASE_STATUS.AWAITING_REASON && row.broker_id);
  const deliveries = awaiting.map((row) => deliveryFor(row, openClients.get(row.client_id) || candidateById.get(row.client_id), usersById));
  if (deliveries.length) summary.repairedAlerts = (await createAlertDeliveries(deliveries)).length;

  if (inserted.length) {
    const { logClientJourneyEvents } = await import("./client-journey");
    await logClientJourneyEvents(inserted.map((row) => ({
      clientId: row.client_id,
      eventType: "cooled_case_opened",
      actor: null,
      details: { caseId: row.id, brokerId: row.broker_id, brokerName: usersById.get(row.broker_id)?.name || "", status: row.client_status_at_open }
    })));
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Passo 1: o corretor escreve o motivo
// ---------------------------------------------------------------------------

async function loadCase(caseId) {
  if (!UUID.test(String(caseId || ""))) throw new CooledClientError("Caso inválido.");
  const row = await run(db().from("cooled_client_cases").select(CASE_COLUMNS).eq("id", caseId).maybeSingle());
  if (!row) throw new CooledClientError("Caso não encontrado.", 404);
  return row;
}

export async function answerCooledCase(auth, caseId, text) {
  const viewer = viewerOf(auth);
  if (!viewer?.viewerId) throw new CooledClientError("Resposta indisponível neste modo.", 403);
  const row = await loadCase(caseId);
  if (row.broker_id !== viewer.viewerId) throw new CooledClientError("Caso não encontrado.", 404);
  if (!canAnswerCase(viewer.viewerId, row)) throw new CooledClientError("Este caso já foi respondido.", 409);
  const round = caseRound(row);
  let patch;
  try {
    patch = applyCaseAction(row, "reason", { actorId: viewer.viewerId, text });
  } catch (error) {
    throw new CooledClientError(error.message, 400);
  }
  const data = await run(db().from("cooled_client_cases").update(patch).eq("id", row.id).eq("status", CASE_STATUS.AWAITING_REASON).select("id"));
  if (!data?.length) throw new CooledClientError("Este caso já foi respondido.", 409);
  await acknowledgeAlertByDedupeKey(viewer.viewerId, cooledDedupeKey(row.id, round));
  const { logClientJourneyEvent, resolveActorSnapshot } = await import("./client-journey");
  await logClientJourneyEvent({ clientId: row.client_id, eventType: "cooled_reason", actor: resolveActorSnapshot(auth), details: { caseId: row.id, round, reason: patch[round === 2 ? "second_reason" : "first_reason"] } });
  return { ok: true, round };
}

// Telefone na janela do motivo (FUN-15d, dono 2026-10-16): lido na hora (alertas antigos não guardam o número) e só
// para cliente que quem está vendo já pode acessar (mesmo escopo da ficha: assertCanAccessResponsibleUser).
export async function attachCooledAlertPhones(auth, alerts = []) {
  const cooled = alerts.filter((alert) => alert?.context?.type === COOLED_ALERT_TYPE && UUID.test(String(alert.context.client_id || "")));
  if (!cooled.length) return alerts;
  const ids = [...new Set(cooled.map((alert) => alert.context.client_id))];
  const rows = (await run(db().from("simulation_registrations").select("id, phone, phone_normalized, responsible_user_id").in("id", ids))) || [];
  const { assertCanAccessResponsibleUser } = await import("./admin-access");
  const phones = new Map();
  for (const row of rows) {
    let allowed = false;
    try {
      assertCanAccessResponsibleUser(auth, row.responsible_user_id);
      allowed = true;
    } catch {
      allowed = false; // fora do escopo de quem vê: o card segue sem o número (permissão, não falha)
    }
    if (allowed) phones.set(row.id, row.phone_normalized || row.phone || "");
  }
  return alerts.map((alert) => (alert?.context?.type === COOLED_ALERT_TYPE && phones.get(alert.context.client_id)
    ? { ...alert, context: { ...alert.context, client_phone: phones.get(alert.context.client_id) } }
    : alert));
}

// ---------------------------------------------------------------------------
// Passo 2: a decisora
// ---------------------------------------------------------------------------

function decisionView(row, client, usersById) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: client?.fullName || "Cliente",
    clientCode: client?.clientCode || "",
    clientPhone: client?.phone || "",
    stageLabel: clientStatusLabel(client?.status),
    brokerName: usersById.get(row.broker_id)?.name || "corretor",
    openedAt: row.opened_at,
    firstReason: row.first_reason || "",
    firstReasonAt: row.first_reason_at,
    returnedText: row.returned_text || "",
    returnedByName: usersById.get(row.returned_by)?.name || "",
    secondReason: row.second_reason || "",
    secondReasonAt: row.second_reason_at,
    actions: availableDecisionActions(row)
  };
}

export async function listMyCooledDecisions(auth) {
  const viewer = viewerOf(auth);
  if (!viewer?.viewerId || (!viewer.isOwner && !viewer.isManager)) return { items: [], statusOptions: NEGATIVE_DECISION_OPTIONS };
  const { data, error } = await db().from("cooled_client_cases").select(CASE_COLUMNS).eq("status", CASE_STATUS.AWAITING_DECISION).eq("decider_id", viewer.viewerId).order("first_reason_at", { ascending: true }).order("id", { ascending: true }).limit(200);
  if (error && isTableMissing(error)) return { items: [], statusOptions: NEGATIVE_DECISION_OPTIONS };
  if (error) throw error;
  const rows = (data || []).filter((row) => canDecideCase(viewer, row));
  if (!rows.length) return { items: [], statusOptions: NEGATIVE_DECISION_OPTIONS };
  const [{ usersById }, clients, approvalHistory] = await Promise.all([loadUsers(), loadClientsByIds(rows.map((row) => row.client_id)), loadApprovalHistoryByClient(rows.map((row) => row.client_id))]);
  // Cliente aprovado (agora ou alguma vez — regra do dono de 2026-10-16) nunca vai para a transferência (FUN-15e): some
  // da caixinha já, sem esperar o cron encerrar o caso.
  const decidable = rows.filter((row) => !everApproved(clients.get(row.client_id), approvalHistory));
  return { items: decidable.map((row) => decisionView(row, clients.get(row.client_id), usersById)), statusOptions: NEGATIVE_DECISION_OPTIONS };
}

async function applyNegativeStatus(auth, row, status, client, onCommitted = () => {}) {
  const { getActingAdminEmail } = await import("./admin-auth");
  const { updateSimulationRegistration } = await import("./simulation-registrations");
  const adminEmail = getActingAdminEmail(auth);
  const reason = caseLatestReason(row);
  if (status === CLIENT_STATUS.DO_NOT_CONTACT) {
    const { recordDoNotContactAudit } = await import("./daily-goal-wallet");
    await recordDoNotContactAudit({ clientId: row.client_id, contactId: null, brokerId: row.broker_id, reasonKey: "other", reasonText: reason, executedBy: auth.profile.id, origin: "cooled_client_decision" });
  }
  const updated = await updateSimulationRegistration(row.client_id, { status, statusReason: reason, adminEmail, statusSource: "cooled_client_decision" }, auth);
  onCommitted();
  if (status === CLIENT_STATUS.DO_NOT_CONTACT) {
    const { blockClientProspectingContacts } = await import("./prospecting-reply");
    await blockClientProspectingContacts({ clientId: row.client_id, phoneNormalized: updated?.phoneNormalized || client?.phoneNormalized || "", actorId: auth.profile.id, reason: "cliente_esfriou_nao_contactar" });
  }
}

// Etiqueta "Cliente transferido" (regra do dono, 2026-10-16). Roda depois da transferência já gravada: uma falha aqui
// não desfaz a transferência, mas fica visível (log + `tagError` na resposta), nunca silenciosa.
async function tagTransferredClient(clientId) {
  try {
    const { addSystemTagToClient } = await import("./client-tags");
    const tagged = await addSystemTagToClient(clientId, COOLED_TRANSFER_TAG.name, COOLED_TRANSFER_TAG.color);
    if (tagged?.added) {
      const { logClientJourneyEvent } = await import("./client-journey");
      await logClientJourneyEvent({ clientId, eventType: "tag_added", actor: null, details: { tagName: tagged.tag.name, source: "cooled_transfer" } });
    }
    return { tag: tagged?.tag?.name || "" };
  } catch (error) {
    console.error("[clientes esfriados] transferência feita, mas a etiqueta 'Cliente transferido' falhou:", error?.message || error);
    return { tagError: "Cliente transferido, mas a etiqueta \"Cliente transferido\" não foi aplicada. Marque-a à mão na ficha." };
  }
}

export async function decideCooledCase(auth, caseId, { action, status = "", text = "" } = {}) {
  const viewer = viewerOf(auth);
  if (!viewer?.viewerId) throw new CooledClientError("Decisão indisponível neste modo.", 403);
  const row = await loadCase(caseId);
  if (!canDecideCase(viewer, row)) throw new CooledClientError("Caso não encontrado.", 404);
  if (!availableDecisionActions(row).includes(action)) throw new CooledClientError(row.status === CASE_STATUS.AWAITING_DECISION ? "Ação indisponível para este caso." : "Este caso já foi decidido ou ainda aguarda o corretor.", 409);

  const [clients, approvalHistory] = await Promise.all([loadClientsByIds([row.client_id]), loadApprovalHistoryByClient([row.client_id])]);
  const client = clients.get(row.client_id);
  const cancelReason = autoCancelReason({ row, client, historyRows: approvalHistory.get(row.client_id) || [] });
  if (cancelReason) {
    await cancelCase(row, cancelReason);
    throw new CooledClientError("Este cliente mudou de responsável ou de situação. O caso foi encerrado.", 409);
  }

  let patch;
  try {
    patch = applyCaseAction(row, action, { actorId: viewer.viewerId, text, status });
  } catch (error) {
    throw new CooledClientError(error.message, 400);
  }
  // Reserva a decisão antes de agir: dois cliques (ou duas pessoas) nunca transferem/aplicam duas vezes.
  const claimed = await run(db().from("cooled_client_cases").update(patch).eq("id", row.id).eq("status", CASE_STATUS.AWAITING_DECISION).select("id"));
  if (!claimed?.length) throw new CooledClientError("Este caso acabou de ser decidido por outra pessoa.", 409);
  const revert = () => run(db().from("cooled_client_cases").update({ status: CASE_STATUS.AWAITING_DECISION, decision: null, decision_status: null, decided_by: null, decided_at: null, closed_at: null, returned_text: row.returned_text, returned_by: row.returned_by, returned_at: row.returned_at, updated_at: new Date().toISOString() }).eq("id", row.id));

  const { logClientJourneyEvent, resolveActorSnapshot } = await import("./client-journey");
  const actor = resolveActorSnapshot(auth);
  let result = { ok: true, action };
  // Depois que a ação principal gravou (alerta da devolução, roleta, status), um erro seguinte não desfaz a reserva
  // do caso: o erro aparece, mas o caso não volta para a decisora como se nada tivesse acontecido.
  let committed = false;
  try {
    if (action === "return") {
      const { usersById } = await loadUsers();
      await createAlertDeliveries([deliveryFor({ ...row, ...patch }, client, usersById)]);
      committed = true;
      await logClientJourneyEvent({ clientId: row.client_id, eventType: "cooled_returned", actor, details: { caseId: row.id, text: patch.returned_text } });
    } else if (action === "transfer") {
      const { returnClientToRoulette } = await import("./lead-distribution");
      const roulette = await returnClientToRoulette(row.client_id, auth);
      committed = true;
      await run(db().from("cooled_client_cases").update({ transferred_to: roulette.toUserId || null, updated_at: new Date().toISOString() }).eq("id", row.id));
      await logClientJourneyEvent({ clientId: row.client_id, eventType: "cooled_decision", actor, details: { caseId: row.id, decision: "transferred", toName: roulette.toName || "", waiting: Boolean(roulette.waiting) } });
      result = { ...result, toName: roulette.toName || "", waiting: Boolean(roulette.waiting) };
      result = { ...result, ...(await tagTransferredClient(row.client_id)) };
    } else {
      await applyNegativeStatus(auth, row, status, client, () => { committed = true; });
      await logClientJourneyEvent({ clientId: row.client_id, eventType: "cooled_decision", actor, details: { caseId: row.id, decision: "status", status } });
      result = { ...result, status };
    }
  } catch (error) {
    if (!committed) await revert();
    throw new CooledClientError(error?.message || "Não foi possível concluir a decisão.", error?.status || 400);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Histórico (admin geral: todos; gestora: a equipe)
// ---------------------------------------------------------------------------

export async function listCooledCaseHistory(auth, { brokerId = "", decision = "", days = 30 } = {}) {
  if (!auth?.ok) throw new CooledClientError("Não autorizado.", 401);
  const general = isGeneralAdminProfile(auth.profile) || isOwnerAdminEmail(auth.user?.email);
  if (!general && !isManagerProfile(auth.profile)) throw new CooledClientError("Apenas gestor ou administrador.", 403);
  const since = new Date(Date.now() - Math.min(Math.max(Number(days) || 30, 1), 365) * 24 * 60 * 60 * 1000).toISOString();
  let query = db().from("cooled_client_cases").select(CASE_COLUMNS).gte("opened_at", since).order("opened_at", { ascending: false }).limit(500);
  const team = (auth.profile.managedUserIds || []).filter((id) => id !== auth.profile.id);
  if (!general && !team.length) return { brokers: [], items: [] };
  if (!general) query = query.in("broker_id", team);
  if (brokerId && UUID.test(brokerId)) query = query.eq("broker_id", brokerId);
  if (decision === "transferred") query = query.eq("decision", "transferred");
  else if (decision === "status") query = query.eq("decision", "status");
  else if (decision === "open") query = query.in("status", OPEN_CASE_STATUSES);
  else if (decision === "canceled") query = query.eq("status", CASE_STATUS.CANCELED);
  const rows = (await run(query)) || [];
  const [{ users, usersById }, clients] = await Promise.all([loadUsers(), rows.length ? loadClientsByIds(rows.map((row) => row.client_id)) : Promise.resolve(new Map())]);
  const name = (id) => usersById.get(id)?.name || "";
  const brokerIds = new Set(general ? users.filter((user) => ["broker", "associate", "manager"].includes(user.role) && !user.isGeneralAdmin).map((user) => user.id) : team);
  return {
    brokers: users.filter((user) => brokerIds.has(user.id)).map((user) => ({ id: user.id, name: user.name })).sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR")),
    items: rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      clientName: clients.get(row.client_id)?.fullName || "Cliente",
      clientPhone: clients.get(row.client_id)?.phone || "",
      brokerName: name(row.broker_id),
      deciderName: name(row.decider_id),
      status: row.status,
      openedAt: row.opened_at,
      firstReason: row.first_reason || "",
      firstReasonAt: row.first_reason_at,
      returnedText: row.returned_text || "",
      returnedByName: name(row.returned_by),
      returnedAt: row.returned_at,
      secondReason: row.second_reason || "",
      secondReasonAt: row.second_reason_at,
      decision: row.decision || "",
      decisionStatusLabel: row.decision_status ? clientStatusLabel(row.decision_status) : "",
      decidedByName: name(row.decided_by),
      decidedAt: row.decided_at,
      transferredToName: name(row.transferred_to),
      canceledReason: row.canceled_reason || ""
    }))
  };
}

// ---------------------------------------------------------------------------
// IA (só depois de TRANSFERIDO): resumo + mensagem sugerida ao novo corretor
// ---------------------------------------------------------------------------

async function loadConversationLines(clientId) {
  const conversations = ((await run(db().from("whatsapp_conversations").select("id, contact_phone, private_at").eq("client_id", clientId))) || [])
    .filter((row) => !row.private_at && !String(row.contact_phone || "").startsWith("group:"));
  if (!conversations.length) return [];
  const rows = (await run(db().from("whatsapp_messages").select("*").in("conversation_id", conversations.map((row) => row.id)).neq("direction", "internal").order("message_at", { ascending: false }).limit(150))) || [];
  return rows.reverse().filter((row) => !isRevoked(row)).map((row) => {
    const who = row.direction === "inbound" ? "Cliente" : row.sender_type === "automation" ? "Automação" : "Corretor";
    const content = row.message_type === "audio"
      ? (row.metadata?.transcript?.text ? `[áudio] ${row.metadata.transcript.text}` : "[áudio sem transcrição]")
      : row.body || `[${row.message_type || "mídia"}]`;
    return `${who}: ${String(content).replace(/\s+/g, " ").slice(0, 500)}`;
  });
}

function registrationFacts(registration, row, previousName) {
  const money = (value) => (Number(value) > 0 ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value)) : "");
  return [
    `Etapa no CRM: ${clientStatusLabel(registration.status)}`,
    money(registration.primary_monthly_income) ? `Renda informada: ${money(registration.primary_monthly_income)}` : "",
    money(registration.secondary_monthly_income) ? `Segunda renda: ${money(registration.secondary_monthly_income)}` : "",
    `Corretor anterior: ${previousName || "não informado"}`,
    row.first_reason ? `Motivo escrito pelo corretor anterior: ${row.first_reason}` : "",
    row.returned_text ? `O que a gestão pediu a mais: ${row.returned_text}` : "",
    row.second_reason ? `Complemento do corretor anterior: ${row.second_reason}` : ""
  ].filter(Boolean);
}

function presentHandoff(handoff, row, previousName, registration) {
  return {
    caseId: row.id,
    previousBrokerName: previousName,
    clientName: registration?.full_name || "",
    clientPhone: registration?.phone_normalized || registration?.phone || "",
    summary: handoff.summary || "",
    message: renderHandoffMessage(handoff.message, getTimeGreeting()),
    source: handoff.source || "",
    generatedAt: handoff.generated_at || null
  };
}

export async function getCooledHandoff(auth, clientId) {
  if (!auth?.ok) throw new CooledClientError("Não autorizado.", 401);
  if (!UUID.test(String(clientId || ""))) throw new CooledClientError("Cliente inválido.");
  const registration = await run(db().from("simulation_registrations").select("id, full_name, phone, phone_normalized, status, responsible_user_id, pending_distribution_at, primary_monthly_income, secondary_monthly_income").eq("id", clientId).maybeSingle());
  if (!registration) throw new CooledClientError("Cliente não encontrado.", 404);
  const { assertCanAccessResponsibleUser } = await import("./admin-access");
  if (registration.responsible_user_id) assertCanAccessResponsibleUser(auth, registration.responsible_user_id);

  const { data: row, error: caseError } = await db().from("cooled_client_cases").select(`${CASE_COLUMNS}, handoff, handoff_generated_at`).eq("client_id", clientId).eq("decision", "transferred").order("decided_at", { ascending: false }).limit(1).maybeSingle();
  // Migration ainda não aplicada: não há transferência deste fluxo para mostrar (a ficha segue como antes).
  if (caseError && isTableMissing(caseError)) return null;
  if (caseError) throw caseError;
  // Só depois de o cliente estar com o NOVO corretor (fila de espera da roleta ainda não conta).
  if (!row || !registration.responsible_user_id || registration.responsible_user_id === row.broker_id || registration.pending_distribution_at) return null;

  const { usersById } = await loadUsers();
  const previousName = usersById.get(row.broker_id)?.name || "";
  if (row.handoff?.summary) return presentHandoff(row.handoff, row, previousName, registration);

  const facts = registrationFacts(registration, row, previousName);
  const newBroker = usersById.get(registration.responsible_user_id) || null;
  const previousBroker = usersById.get(row.broker_id) || null;
  const fallbackMessage = genericHandoffMessage(registration.full_name, previousName, { newBrokerName: newBroker?.name || "", newBrokerGender: newBroker?.gender || "", previousBrokerGender: previousBroker?.gender || "" });
  const lines = await loadConversationLines(clientId);
  let handoff;
  if (!lines.length) {
    // Sem conversa: resumo do que há no cadastro/histórico e mensagem genérica, sem gastar IA.
    handoff = { summary: ["Sem conversa de WhatsApp registrada no CRM.", ...facts].join("\n"), message: fallbackMessage, source: "cadastro" };
  } else {
    const { summarizeCooledHandoff } = await import("./ai-chat-assist");
    try {
      const text = await summarizeCooledHandoff({ lines, facts, clientName: registration.full_name || "", previousBrokerName: previousName, newBrokerName: newBroker?.name || "", newBrokerGender: newBroker?.gender || "", triggeredBy: auth.profile?.id || null, clientId });
      handoff = { ...parseHandoffResponse(text, fallbackMessage), source: "ia" };
    } catch (error) {
      throw new CooledClientError(`Não foi possível gerar o resumo agora. ${error?.message || ""}`.trim(), error?.status || 502);
    }
  }
  handoff.generated_at = new Date().toISOString();
  // Uma vez por transferência: se outra abertura gravou primeiro, vale a dela.
  const saved = await run(db().from("cooled_client_cases").update({ handoff, handoff_generated_at: handoff.generated_at, updated_at: handoff.generated_at }).eq("id", row.id).is("handoff_generated_at", null).select("handoff").maybeSingle());
  if (!saved) {
    const again = await run(db().from("cooled_client_cases").select("handoff").eq("id", row.id).maybeSingle());
    if (again?.handoff?.summary) return presentHandoff(again.handoff, row, previousName, registration);
  }
  return presentHandoff(handoff, row, previousName, registration);
}
