import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assignRoundRobinLead, isMissingSchemaError, recordLeadDistributionHistory, releaseRouletteReceipt } from "./lead-distribution";
import { countActiveRoundRobinBrokers, getRouletteRedistributionDeadlineMs, notifyRoundRobinStalled } from "./crm-automations";
import { createMarketplaceRegistration, updateSimulationRegistration } from "./simulation-registrations";
import { isResponsibleTransfer } from "./transfer-status-core.mjs";
import { applyTransferStatusRuleAfterTransfer } from "./transfer-status";
import { createAlertDeliveries, getAlertDefinition, resolveAlertDeliveriesByPrefix } from "./crm-alerts";
import { resolveServiceStallRecipients } from "./whatsapp-service-stall-core.mjs";
import { NOTIFICATION_KIND } from "./notification-policy-core.mjs";
import { sendPushToUser } from "./push-subscriptions";
import { markClientOnHumanMessage } from "./whatsapp-client-status";
import { addSystemTagToClient } from "./client-tags";
import { uploadChatMedia } from "./media-storage";
import { assertCanAccessResponsibleUser } from "./admin-access";
import { clientAccessOwnerId } from "./client-returned-scope-core.mjs";
import { findDoNotContactInboundBlock } from "./client-phone-lookup";
import { getTimeGreeting } from "./daily-report";
import { AdminPermissionError, isBrokerProfile, isGeneralAdminAuth, isManagerProfile, isOwnerAdminEmail, listAdminProfiles } from "./admin-profiles";
import { allowedBrokerFilter, buildChatScope, canAssignTo, canSeeConversation, marksReadOnOpen } from "./whatsapp-chat-scope.mjs";
import {
  ASSIGNMENT_SOURCE,
  CHAT_SETTINGS_ID,
  EXTENSION_ALERT_STATE_ID,
  EXTENSION_SIGNAL_ID,
  decideExtensionSignal,
  REDISTRIBUTION_JOB_ID,
  decideRedistributionStall,
  roundRobinCycleComplete,
  MarketplaceChatError,
  MAX_SEND_ATTEMPTS,
  SEND_RETRY_INTERVAL_MS,
  STALE_SENDING_MS,
  isSafeToResend,
  outboundStatusView,
  evaluateOutboxGate,
  findOutboundEcho,
  matchListing,
  messagePreview,
  normalizeChatSettings,
  normalizeFacebookMessage,
  normalizeSyncPayload,
  assignMessageTimes,
  routeNewConversation,
  planOutboundResult,
  shouldRedistribute,
  toOutboxPayload,
  validateOutboundText,
  validateOutboundMedia,
  pickOutboxCandidate,
  AUTO_REPLY_CANCEL,
  AUTO_REPLY_KIND,
  AUTO_REPLY_LABEL,
  AUTO_REPLY_SENDER_NAME,
  autoReplyCancelPatch,
  autoReplyCancelReason,
  buildAvailabilityAutoReply,
  isAutoReplyRow,
  planAvailabilityAutoReply,
  supportsMarketplaceMedia,
  OUTBOX_ATTEMPTS_ID,
  recentOutboxAttempts,
  planStaleSending,
  resendBlockReason,
  resendStopPatch,
  resendStopReason,
  RESEND_STOP_LABELS,
  needsVerify,
  sameOutboundCount,
  INTERNAL_DIRECTION,
  buildMarketplaceInternalNote,
  buildMarketplaceInternalNotice,
  canUseMarketplaceInternal,
  marketplaceConversationLink,
  resolveMarketplaceInternalRecipients
} from "./marketplace-chat-core.mjs";

// Chat do Marketplace (MKT-2, dono, 2026-10-20). Tabelas marketplace_conversations/marketplace_messages (migration
// 20261020180000). Distribuição pela MESMA roleta do Chat (`assignRoundRobinLead`: on-line, ROL-2d/2e/2f, 10 min entre
// recebimentos ROL-2h, fila). Escopo pelo mesmo núcleo do Chat (lib/whatsapp-chat-scope.mjs) pela pessoa atribuída.
// Nunca envia nada sozinho: só o que um corretor escreve vai para a fila de saída, que a extensão envia.

const CONVERSATIONS = "marketplace_conversations";
const MESSAGES = "marketplace_messages";

function db() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  return getSupabaseAdminClient();
}

function isMissingTable(error) {
  return error && (error.code === "42P01" || error.code === "PGRST205");
}

function raise(error) {
  if (isMissingTable(error)) throw new MarketplaceChatError("O Chat do Marketplace ainda não foi criado no banco (migration 20261020180000).", 503);
  throw error;
}

function scopeFor(auth) {
  return buildChatScope({
    generalAdmin: Boolean(auth) && isGeneralAdminAuth(auth),
    manager: Boolean(auth) && isManagerProfile(auth?.profile),
    broker: Boolean(auth) && isBrokerProfile(auth?.profile),
    profileId: auth?.profile?.id || "",
    managedUserIds: auth?.profile?.managedUserIds || null,
    linkedBrokerId: auth?.profile?.linkedBrokerId || ""
  });
}

// --- Configuração ---------------------------------------------------------------------------------------------
export async function getMarketplaceChatSettings() {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", CHAT_SETTINGS_ID).maybeSingle();
  if (error) throw error;
  return normalizeChatSettings(data?.setting_value || {});
}

export async function saveMarketplaceChatSettings(input, auth) {
  const value = normalizeChatSettings(input || {});
  const { error } = await db().from("crm_settings").upsert({ id: CHAT_SETTINGS_ID, setting_value: value, updated_by: auth?.profile?.id || null, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
  return value;
}

// --- Roleta ---------------------------------------------------------------------------------------------------
const MARKETPLACE_TAG = "Marketplace";
const MARKETPLACE_TAG_COLOR = "#0866FF";

function marketplaceOrigin(conversation) {
  return {
    kind: "facebook_marketplace",
    label: `Facebook Marketplace${conversation.listing_title ? ` — ${conversation.listing_title}` : ""}`,
    actor: "sistema",
    destination: "roulette",
    metadata: { listingId: conversation.listing_id || null, listingUrl: conversation.listing_url || null, threadKey: conversation.thread_key }
  };
}

// "Toda conversa do Marketplace distribuída vira cliente automaticamente, só com o nome" (dono, 2026-10-20).
async function ensureClientForConversation(conversation, responsibleUserId) {
  if (conversation.client_id) return conversation.client_id;
  const registration = await createMarketplaceRegistration({ fullName: conversation.contact_name, responsibleUserId, acquisitionContext: marketplaceOrigin(conversation) });
  await db().from(CONVERSATIONS).update({ client_id: registration.id }).eq("id", conversation.id).is("client_id", null);
  await addSystemTagToClient(registration.id, MARKETPLACE_TAG, MARKETPLACE_TAG_COLOR).catch((error) => console.warn("[marketplace-chat] etiqueta não aplicada:", error?.message || error));
  return registration.id;
}

async function notifyReceiver(brokerId, clientId, conversation, redistributed) {
  const { error } = await db().from("crm_notifications").insert({
    recipient_user_id: brokerId,
    client_id: clientId,
    title: "Novo cliente do Marketplace",
    description: `${conversation.contact_name || "Um cliente"} chamou no Facebook Marketplace${conversation.listing_title ? ` (${conversation.listing_title})` : ""}${redistributed ? " e ninguém respondeu a tempo" : ""} — foi enviado(a) para você. Responda pelo Chat Marketplace.`,
    notification_type: "new_client",
    scheduled_at: new Date().toISOString()
  });
  if (error) console.warn("[marketplace-chat] aviso ao corretor falhou:", error.message || error);
}

// Colunas da migration 20261022150000 (origem da atribuição, MKT-2e). Sem ela aplicada, grava sem as colunas novas (a
// atribuição nunca deixa de acontecer) e avisa no log; a redistribuição por prazo fica parada e o job acusa o erro.
const ASSIGNMENT_COLUMNS = ["assignment_source", "lost_by_user_id"];

// Atualiza a conversa; `guard` restringe ao estado lido (corrida entre a sincronização da extensão e o cron).
// Devolve true se alguma linha mudou. Erro de banco nunca é engolido.
async function updateConversation(id, patch, guard = (query) => query) {
  const run = (values) => guard(db().from(CONVERSATIONS).update(values).eq("id", id)).select("id");
  let { data, error } = await run(patch);
  if (error && isMissingSchemaError(error) && ASSIGNMENT_COLUMNS.some((column) => column in patch)) {
    console.warn("[marketplace-chat] migration 20261022150000 pendente: atribuição gravada sem a origem.");
    ({ data, error } = await run(Object.fromEntries(Object.entries(patch).filter(([key]) => !ASSIGNMENT_COLUMNS.includes(key)))));
  }
  if (error) raise(error);
  return Boolean(data?.length);
}

// Mesmo estado lido: ninguém mudou a atribuição entre a leitura e a gravação.
function sameAssignment(conversation) {
  return (query) => conversation.assigned_user_id
    ? query.eq("assigned_user_id", conversation.assigned_user_id).eq("assigned_at", conversation.assigned_at)
    : query.is("assigned_user_id", null);
}

async function moveClientTo(clientId, userId) {
  if (!clientId || !userId) return;
  await updateSimulationRegistration(clientId, { responsibleUserId: userId });
}

// Atribuição do dia (configuração do admin): direto à pessoa, sem roleta; vira cliente e recebe o aviso como na roleta.
// Origem "1ª carga": escolha explícita do dono, nunca redistribuída por prazo (MKT-2e).
async function assignDirect(conversation, userId, now = new Date()) {
  const iso = now.toISOString();
  await updateConversation(conversation.id, { assigned_user_id: userId, assigned_at: iso, waiting_distribution_at: null, assignment_source: ASSIGNMENT_SOURCE.FIRST_LOAD, lost_by_user_id: null, updated_at: iso });
  let clientId = conversation.client_id || null;
  try {
    clientId = await ensureClientForConversation(conversation, userId);
    await recordLeadDistributionHistory({ registration: { id: clientId, full_name: conversation.contact_name }, eventType: "assigned", toUserId: userId, details: { source: "facebook_marketplace_first_sync", conversationId: conversation.id } })
      .catch((error) => console.warn("[marketplace-chat] histórico da atribuição falhou:", error?.message || error));
  } catch (error) {
    console.warn("[marketplace-chat] não criou o cliente da conversa:", error?.message || error);
  }
  await notifyReceiver(userId, clientId, conversation, false);
}

// Entrega pela roleta de leads (`assignRoundRobinLead`: on-line, WhatsApp conectado e ativo, sem restrição, presença,
// 10 min entre recebimentos ROL-2h, ordem da fila). `transfer` = troca por prazo vencido (quem perdeu fica excluído).
// Ninguém liberado → null (quem chamou decide: fila de espera).
async function distribute(conversation, { excludedBrokerId = null, now = new Date(), transfer = false } = {}) {
  const pickedSince = new Date().toISOString();
  const roulette = await assignRoundRobinLead(excludedBrokerId ? { excludedBrokerId } : {});
  const brokerId = roulette.brokerId;
  const iso = now.toISOString();
  if (!brokerId) {
    // Ninguém on-line: conversa nova sem atendente fica na fila de espera.
    if (!transfer && !conversation.assigned_user_id && !conversation.waiting_distribution_at) {
      await updateConversation(conversation.id, { waiting_distribution_at: iso, updated_at: iso }, sameAssignment(conversation));
    }
    return null;
  }
  const fromUserId = transfer ? conversation.assigned_user_id : null;
  const patch = { assigned_user_id: brokerId, assigned_at: iso, waiting_distribution_at: null, assignment_source: ASSIGNMENT_SOURCE.ROULETTE, lost_by_user_id: null, updated_at: iso };
  if (transfer) patch.redistributions = Number(conversation.redistributions || 0) + 1;
  if (!(await updateConversation(conversation.id, patch, sameAssignment(conversation)))) {
    await releaseRouletteReceipt(brokerId, pickedSince); // outra rodada já mexeu nesta conversa: devolve a vez
    return null;
  }
  let clientId = conversation.client_id || null;
  try {
    // Cliente já existe (redistribuição/fila): vai junto com a conversa, pelo mesmo caminho da roleta (histórico de
    // responsável anterior e responsible_changed_at, base do FUN-15h).
    if (clientId) await moveClientTo(clientId, brokerId);
    else clientId = await ensureClientForConversation(conversation, brokerId);
    await recordLeadDistributionHistory({
      registration: { id: clientId, full_name: conversation.contact_name },
      eventType: transfer ? "auto_transferred" : "assigned",
      fromUserId,
      toUserId: brokerId,
      details: {
        source: "facebook_marketplace",
        conversationId: conversation.id,
        presenceTier: roulette.tier,
        skipped: roulette.skippedNames,
        ...(transfer ? { reason: "Prazo de atendimento excedido" } : {}),
        ...(conversation.lost_by_user_id ? { fromWaitingQueue: true } : {})
      }
    }).catch((error) => console.warn("[marketplace-chat] histórico da roleta falhou:", error?.message || error));
  } catch (error) {
    console.error("[marketplace-chat] não criou/atualizou o cliente da conversa:", error?.message || error);
  }
  await notifyReceiver(brokerId, clientId, conversation, transfer || Boolean(conversation.lost_by_user_id));
  return brokerId;
}

// Prazo vencido e ninguém mais liberado (ROL-4a): sai de quem não respondeu e fica com o dono na fila de espera; a fila
// entrega ao próximo corretor liberado, nunca a quem perdeu (`lost_by_user_id`).
async function moveConversationToWaiting(conversation, now) {
  const ownerId = (await listAdminProfiles()).find((profile) => isOwnerAdminEmail(profile.email) && profile.status === "active")?.id || "";
  const fromUserId = conversation.assigned_user_id;
  if (!ownerId || fromUserId === ownerId) return false;
  const iso = now.toISOString();
  const moved = await updateConversation(conversation.id, {
    assigned_user_id: null, assigned_at: null, waiting_distribution_at: iso, assignment_source: ASSIGNMENT_SOURCE.ROULETTE, lost_by_user_id: fromUserId, updated_at: iso
  }, sameAssignment(conversation));
  if (!moved) return false;
  if (conversation.client_id) {
    await moveClientTo(conversation.client_id, ownerId);
    await recordLeadDistributionHistory({
      registration: { id: conversation.client_id, full_name: conversation.contact_name },
      eventType: "auto_transferred",
      fromUserId,
      toUserId: ownerId,
      details: { source: "facebook_marketplace", conversationId: conversation.id, toWaitingQueue: true, reason: "Prazo de atendimento excedido e nenhum outro corretor on-line: aguardando o próximo corretor" }
    }).catch((error) => console.warn("[marketplace-chat] histórico da fila de espera falhou:", error?.message || error));
  }
  return true;
}

// Respostas HUMANAS escritas pelo Chat do CRM (outbound com sender_user_id), em QUALQUER status de envio — na fila,
// enviando, enviada ou falhou: a mais recente por conversa. Segura o cliente com quem respondeu (MKT-2e, dono 2026-10-22).
// Só `direction = 'outbound'`: mensagem interna (MKT-2i) não é resposta ao cliente.
async function humanRepliesByConversation(ids) {
  const result = new Map();
  if (!ids.length) return result;
  const { data, error } = await db().from(MESSAGES).select("conversation_id, created_at").in("conversation_id", ids)
    .eq("direction", "outbound").not("sender_user_id", "is", null);
  if (error) raise(error);
  for (const row of data || []) {
    if (!result.has(row.conversation_id) || row.created_at > result.get(row.conversation_id)) result.set(row.conversation_id, row.created_at);
  }
  return result;
}

// Prazo de resposta (MKT-2e, dono 2026-10-22): conversa entregue pela ROLETA sem resposta humana no prazo da regra
// "REDISTRIBUIÇÃO DE LEADS" → próximo corretor liberado (nunca quem perdeu); ninguém liberado → fila de espera; já girou
// pela equipe inteira em 24 h → para e avisa o dono (mesma trava da roleta).
async function redistributeOverdue(now, result) {
  const deadlineMs = await getRouletteRedistributionDeadlineMs();
  result.deadlineMinutes = deadlineMs ? Math.round(deadlineMs / 60000) : null;
  if (!deadlineMs) return;
  const { data: assigned, error } = await db().from(CONVERSATIONS).select("*")
    .eq("assignment_source", ASSIGNMENT_SOURCE.ROULETTE).not("assigned_user_id", "is", null)
    .lte("assigned_at", new Date(now.getTime() - deadlineMs).toISOString())
    .gte("assigned_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
    .order("assigned_at", { ascending: true }).limit(50);
  if (error) {
    if (isMissingSchemaError(error)) throw new Error("Redistribuição do Marketplace parada: migration 20261022150000 (origem da atribuição) ainda não aplicada.");
    raise(error);
  }
  const replies = await humanRepliesByConversation((assigned || []).map((row) => row.id));
  const overdue = (assigned || []).filter((row) => shouldRedistribute(row, now, { deadlineMs, humanReplySince: replies.get(row.id) || null }));
  if (!overdue.length) return;
  const poolSize = await countActiveRoundRobinBrokers();
  for (const conversation of overdue) {
    if (conversation.client_id) {
      const { count, error: hopError } = await db().from("lead_distribution_history").select("id", { count: "exact", head: true })
        .eq("registration_id", conversation.client_id).eq("event_type", "auto_transferred")
        .gte("created_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
      if (hopError) throw hopError;
      if (roundRobinCycleComplete({ recentHops: count, poolSize })) {
        if (await updateConversation(conversation.id, { assignment_source: ASSIGNMENT_SOURCE.ROULETTE_STALLED, updated_at: now.toISOString() }, sameAssignment(conversation))) {
          await notifyRoundRobinStalled({ id: conversation.client_id, full_name: conversation.contact_name });
          result.stalled += 1;
        }
        continue;
      }
    }
    if (await distribute(conversation, { excludedBrokerId: conversation.assigned_user_id, now, transfer: true })) result.redistributed += 1;
    else if (await moveConversationToWaiting(conversation, now)) result.toWaitingQueue += 1;
  }
}

// Fila de espera (a cada sincronização da extensão, 1–2 min) e, no cron `scheduled-activities` (2 min,
// `runMarketplaceRedistributionJob`), também o prazo sem resposta — o prazo não depende da extensão estar aberta.
export async function processMarketplaceDistribution(now = new Date(), { redistribute = true } = {}) {
  const result = { delivered: 0, redistributed: 0, toWaitingQueue: 0, stalled: 0, deadlineMinutes: null };
  const { data: waiting, error } = await db().from(CONVERSATIONS).select("*").not("waiting_distribution_at", "is", null).is("assigned_user_id", null).order("waiting_distribution_at", { ascending: true }).limit(5);
  if (error) raise(error);
  const settings = await getMarketplaceChatSettings();
  for (const conversation of waiting || []) {
    // Perdeu pelo prazo (fila de espera da ROL-4a): vai a OUTRO corretor; só quem perdeu liberado → espera.
    if (conversation.lost_by_user_id) {
      if (await distribute(conversation, { excludedBrokerId: conversation.lost_by_user_id, now })) result.delivered += 1;
      continue;
    }
    // 1ª carga (dono, 2026-10-21) vale também para quem já estava na fila: dia com par → direto à pessoa;
    // anterior ao dia configurado → sai da fila (não distribui, nada é apagado).
    const route = routeNewConversation({ lastActivityAt: conversation.last_inbound_at || null, now, settings });
    if (route.kind === "assignee") {
      await assignDirect(conversation, route.userId, now);
      result.delivered += 1;
      continue;
    }
    if (route.kind === "ignore") {
      await updateConversation(conversation.id, { waiting_distribution_at: null, updated_at: now.toISOString() });
      continue;
    }
    if (!(await distribute(conversation, { now }))) break; // ninguém liberado agora: tenta na próxima rodada
    result.delivered += 1;
  }
  if (redistribute) await redistributeOverdue(now, result);
  return result;
}

// --- Monitoramento do job (MKT-2e) ----------------------------------------------------------------------------
// Cada rodada do cron grava um sinal em crm_settings; o cron `whatsapp-flows` confere e, sem sucesso há mais de 10 min
// (falhando ou sem rodar), entrega um alerta Importante aos admins gerais na Central de Alertas. Nunca fica em silêncio.
async function loadRedistributionHeartbeat() {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", REDISTRIBUTION_JOB_ID).maybeSingle();
  if (error) throw error;
  return data?.setting_value || null;
}

async function saveRedistributionHeartbeat(now, { result = null, error = null } = {}) {
  const previous = await loadRedistributionHeartbeat();
  const iso = now.toISOString();
  const value = {
    first_seen_at: previous?.first_seen_at || iso,
    last_run_at: iso,
    last_ok_at: error ? previous?.last_ok_at || null : iso,
    last_error: error ? String(error?.message || error).slice(0, 300) : "",
    last_result: result || previous?.last_result || null
  };
  const { error: saveError } = await db().from("crm_settings").upsert({ id: REDISTRIBUTION_JOB_ID, setting_value: value, updated_at: iso }, { onConflict: "id" });
  if (saveError) throw saveError;
}

export async function runMarketplaceRedistributionJob(now = new Date()) {
  let result = null;
  let failure = null;
  try {
    result = await processMarketplaceDistribution(now);
  } catch (error) {
    failure = error;
    console.error("[marketplace-chat] redistribuição automática do Marketplace falhou:", error?.message || error);
  }
  try {
    await saveRedistributionHeartbeat(now, { result, error: failure });
  } catch (heartbeatError) {
    console.error("[marketplace-chat] sinal do job de redistribuição não gravado:", heartbeatError?.message || heartbeatError);
  }
  return failure ? { error: failure?.message || "Falha na redistribuição do Marketplace." } : result;
}

const STALL_TITLE = "Redistribuição do Marketplace parada";
const STALL_LINK = "/admin/chat/marketplace";

export async function checkMarketplaceRedistributionStalled(now = Date.now()) {
  try {
    const heartbeat = await loadRedistributionHeartbeat();
    const decision = decideRedistributionStall(heartbeat, now);
    if (!decision.stalled) {
      const closed = heartbeat ? await resolveAlertDeliveriesByPrefix(`${REDISTRIBUTION_JOB_ID}:`) : 0;
      return { alerted: false, reason: heartbeat ? "saudavel" : "sem_registro", closed };
    }
    console.error(`[marketplace-chat] redistribuição do Marketplace sem rodar com sucesso há ${decision.minutes} min.`, decision.lastError);
    const definition = await getAlertDefinition(REDISTRIBUTION_JOB_ID).catch(() => null);
    if (definition?.enabled === false) return { alerted: false, stalled: true, reason: "definicao_desligada" };
    const { data: users, error } = await db().from("admin_users").select("id, role, status, disabled_at");
    if (error) throw error;
    const body = `A troca automática de corretor do Chat Marketplace (cliente sem resposta no prazo) não roda com sucesso há ${decision.minutes} minutos.${decision.lastError ? ` Último erro: ${decision.lastError}` : ""} Enquanto isso, ninguém troca de corretor sozinho.`;
    const created = await createAlertDeliveries(resolveServiceStallRecipients(users || []).map((recipientId) => ({
      definition_id: definition?.id || null,
      recipient_id: recipientId,
      kind: definition?.kind === "informative" ? "informative" : "important",
      title: definition?.title || STALL_TITLE,
      body: definition?.body_template ? definition.body_template.replace(/\{minutos\}/g, String(decision.minutes)) : body,
      context: { source: REDISTRIBUTION_JOB_ID, last_ok_at: decision.episode, link: STALL_LINK },
      dedupe_key: decision.dedupeKey
    })));
    return { alerted: created.length > 0, stalled: true, reason: created.length ? "ok" : "duplicado" };
  } catch (error) {
    console.error("[marketplace-chat] falha ao conferir o job de redistribuição:", error?.message || error);
    return { alerted: false, reason: "erro" };
  }
}

// --- Sinal da extensão (MKT-2g, dono, 2026-10-22) ---------------------------------------------------------------
// Cada chamada da extensão à sincronização grava o último sinal; o cron `whatsapp-flows` avisa os admins gerais (Central de
// Alertas) quando passa de 30 min sem sinal no horário da sincronização, e avisa a volta. Regra pura: decideExtensionSignal.
async function readSetting(id) {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.setting_value || null;
}

async function writeSetting(id, value, iso) {
  const { error } = await db().from("crm_settings").upsert({ id, setting_value: value, updated_at: iso }, { onConflict: "id" });
  if (error) throw error;
}

// version: cabeçalho X-Extension-Version da extensão (desde a 1.9.3; versões antigas não mandam → fica vazio). Mostra no
// Chat qual versão roda no PC — em 22/10 o PC rodava a 1.9.0 sem ninguém saber.
export async function recordMarketplaceExtensionSignal(now = new Date(), { version = "" } = {}) {
  const iso = now.toISOString();
  const clean = /^\d{1,3}(\.\d{1,4}){0,3}$/.test(String(version || "")) ? String(version) : "";
  await writeSetting(EXTENSION_SIGNAL_ID, { last_sync_at: iso, ...(clean ? { extension_version: clean } : {}) }, iso);
}

export async function getMarketplaceExtensionSignal() {
  const signal = await readSetting(EXTENSION_SIGNAL_ID);
  return { lastSyncAt: signal?.last_sync_at || null, extensionVersion: signal?.extension_version || null };
}

// Início do dono (INI-5), só leitura: a extensão está sem sinal agora (mesma régua do aviso, decideExtensionSignal, sem
// olhar se o aviso já saiu) e quantas respostas da equipe falharam nas últimas 24 h (saída humana com status `failed`,
// o mesmo critério do reprocessamento — reprocessMarketplaceOutboundFailures).
const FAILED_REPLIES_WINDOW_MS = 24 * 60 * 60 * 1000;
export async function getMarketplaceAttention(now = Date.now()) {
  const sinceIso = new Date(now - FAILED_REPLIES_WINDOW_MS).toISOString();
  const [signal, settings, failed] = await Promise.all([
    readSetting(EXTENSION_SIGNAL_ID),
    readSetting(CHAT_SETTINGS_ID),
    db().from(MESSAGES).select("id", { count: "exact", head: true }).eq("direction", "outbound").not("sender_user_id", "is", null).eq("status", "failed").gte("created_at", sinceIso)
  ]);
  if (failed.error && !isMissingTable(failed.error)) throw failed.error;
  const decision = decideExtensionSignal({ signal, alertState: null, settings: settings || {}, now });
  return { extensionSilentMinutes: decision.action === "silent" ? decision.minutes : null, failedReplies: failed.count || 0 };
}

const EXTENSION_LINK = "/admin/chat/marketplace";
const EXTENSION_SILENT_DEFINITION = "marketplace_extension_silent";

export async function checkMarketplaceExtensionSignal(now = Date.now()) {
  try {
    const [signal, alertState, settings] = await Promise.all([readSetting(EXTENSION_SIGNAL_ID), readSetting(EXTENSION_ALERT_STATE_ID), readSetting(CHAT_SETTINGS_ID)]);
    const decision = decideExtensionSignal({ signal, alertState, settings: settings || {}, now });
    if (decision.action === "none") return { alerted: false, reason: signal ? "ok" : "sem_registro" };
    const iso = new Date(now).toISOString();
    const definition = await getAlertDefinition(EXTENSION_SILENT_DEFINITION).catch(() => null);
    const { data: users, error } = await db().from("admin_users").select("id, role, status, disabled_at");
    if (error) throw error;
    const recipients = resolveServiceStallRecipients(users || []);
    if (decision.action === "silent") {
      console.error(`[marketplace-chat] extensão do Marketplace sem sinal há ${decision.minutes} min.`);
      if (definition?.enabled === false) return { alerted: false, silent: true, reason: "definicao_desligada" };
      const body = `A extensão do Chat do Marketplace não lê o Facebook há ${decision.minutes} minutos. Enquanto isso, mensagens novas não chegam ao CRM e as respostas não saem. Confira se o computador do escritório e o Chrome estão ligados.`;
      const created = await createAlertDeliveries(recipients.map((recipientId) => ({
        definition_id: definition?.id || null,
        recipient_id: recipientId,
        kind: definition?.kind === "informative" ? "informative" : "important",
        title: definition?.title || "Extensão do Marketplace sem sinal",
        body: definition?.body_template ? definition.body_template.replace(/\{minutos\}/g, String(decision.minutes)) : body,
        // Push no celular dos admins gerais (dono, 2026-10-22): 1 por episódio — a entrega é deduplicada e o push só sai
        // na criação. Só com kind Importante (Informativo pela definição = só sino). A volta fica só no sino.
        context: { source: EXTENSION_SIGNAL_ID, episode: decision.episode, link: EXTENSION_LINK, push_kind: NOTIFICATION_KIND.MARKETPLACE_EXTENSION_SILENT },
        dedupe_key: decision.dedupeKey
      })));
      await writeSetting(EXTENSION_ALERT_STATE_ID, { episode: decision.episode, alerted_at: iso }, iso);
      return { alerted: created.length > 0, silent: true, reason: created.length ? "ok" : "duplicado" };
    }
    // Voltou depois de um aviso: fecha o aviso de "sem sinal" e avisa a volta (uma vez por episódio).
    const closed = await resolveAlertDeliveriesByPrefix(decision.closePrefix);
    const created = definition?.enabled === false ? [] : await createAlertDeliveries(recipients.map((recipientId) => ({
      definition_id: definition?.id || null,
      recipient_id: recipientId,
      kind: "informative",
      title: "Extensão do Marketplace voltou",
      body: "A extensão do Chat do Marketplace voltou a ler o Facebook.",
      context: { source: EXTENSION_SIGNAL_ID, episode: decision.episode, link: EXTENSION_LINK },
      dedupe_key: decision.dedupeKey
    })));
    await writeSetting(EXTENSION_ALERT_STATE_ID, { episode: null, back_at: iso }, iso);
    return { alerted: created.length > 0, back: true, closed };
  } catch (error) {
    console.error("[marketplace-chat] falha ao conferir o sinal da extensão:", error?.message || error);
    return { alerted: false, reason: "erro" };
  }
}

// --- Sincronização (extensão) ---------------------------------------------------------------------------------
async function loadListings() {
  const { data, error } = await db().from("marketplace_listings").select("id, title, marketplace_url").eq("status", "published");
  if (error && !isMissingTable(error)) throw error;
  return data || [];
}

export async function syncMarketplaceConversations(body, now = new Date()) {
  const conversations = normalizeSyncPayload(body, now);
  const chatSettings = await getMarketplaceChatSettings();
  const listings = conversations.length ? await loadListings() : [];
  const summary = { conversations: 0, newMessages: 0, created: 0, ignored: 0, ignoredKeys: [] };

  for (const item of conversations) {
    const { data: existing, error } = await db().from(CONVERSATIONS).select("*").eq("thread_key", item.threadKey).maybeSingle();
    if (error) raise(error);
    let conversation = existing;
    // 1ª leitura com conteúdo: conversa nova OU já gravada sem nenhuma mensagem (extensão 1.8.6–1.8.8 criou
    // conversas vazias quando a leitura falhava). Vale como 1ª sincronização: horários em ordem até a última
    // atividade lida na caixa e a rota de conversa nova (1ª carga / MKT-2 decisão 4), não a de "cliente retomou".
    const firstContent = !existing || !existing.last_message_at;
    const timed = firstContent ? assignMessageTimes(item.messages, item.lastActivityAt || now) : item.messages;
    let route = null;
    if (firstContent) {
      // Data da última mensagem do CLIENTE (sem mensagem dele, a última atividade). Sem data conhecida → null.
      const dateKnown = Boolean(item.lastActivityAt) || item.messages.some((message) => message.at);
      const lastClient = [...timed].reverse().find((message) => message.direction === "inbound");
      route = routeNewConversation({ lastActivityAt: dateKnown ? lastClient?.at || item.lastActivityAt : null, now, settings: chatSettings });
      // Regra da 1ª carga (dono, 2026-10-21): anterior ao dia configurado não é importada (nem conversa nem mensagens).
      // Conversa já gravada vazia fica como está (nada é apagado) e não é distribuída.
      if (route.kind === "ignore") {
        summary.ignored += 1;
        summary.ignoredKeys.push(item.threadKey);
        continue;
      }
    }
    const listing = matchListing(item, listings);
    if (!conversation) {
      const { data: created, error: insertError } = await db().from(CONVERSATIONS).insert({
        thread_key: item.threadKey,
        thread_url: item.threadUrl,
        contact_name: item.contactName,
        contact_photo_url: item.contactPhotoUrl,
        listing_id: listing?.id || null,
        listing_title: item.listingTitle,
        listing_url: item.listingUrl
      }).select("*").single();
      if (insertError) raise(insertError);
      conversation = created;
      summary.created += 1;
    }

    const externalIds = item.messages.map((message) => message.externalId);
    const { data: known, error: knownError } = externalIds.length
      ? await db().from(MESSAGES).select("external_id").eq("conversation_id", conversation.id).in("external_id", externalIds)
      : { data: [], error: null };
    if (knownError) raise(knownError);
    const knownIds = new Set((known || []).map((row) => row.external_id));
    const fresh = timed.filter((message) => !knownIds.has(message.externalId));

    let echoCandidates = null;
    const inserts = [];
    for (const message of fresh) {
      if (message.direction === "outbound") {
        echoCandidates ??= (await db().from(MESSAGES).select("id, external_id, direction, status, body, attachments, sent_at, created_at, attempts, sender_user_id, conversation_id").eq("conversation_id", conversation.id).is("external_id", null).eq("direction", "outbound").order("created_at", { ascending: true })).data || [];
        const echo = findOutboundEcho(message, echoCandidates, now);
        if (echo) {
          // Eco da resposta do CRM: liga ao id do Facebook. Se estava como falha/nova tentativa, ela SAIU — vira enviada
          // (e para de tentar), sem duplicar (2026-10-22).
          const confirm = echo.status !== "sent";
          await db().from(MESSAGES).update(confirm ? { external_id: message.externalId, status: "sent", sent_at: message.at || now.toISOString(), error: null } : { external_id: message.externalId }).eq("id", echo.id);
          if (confirm) await afterOutboundSent(echo, now).catch((error) => console.warn("[marketplace-chat] confirmação pelo eco:", error?.message || error));
          echo.external_id = message.externalId;
          continue;
        }
      }
      inserts.push({
        conversation_id: conversation.id,
        external_id: message.externalId,
        direction: message.direction,
        sender_name: message.direction === "inbound" ? message.senderName || item.contactName : "Facebook (enviada fora do CRM)",
        body: message.body,
        attachments: message.attachments,
        status: message.direction === "inbound" ? "received" : "sent",
        message_at: message.at || now.toISOString()
      });
    }
    if (inserts.length) {
      const { error: messagesError } = await db().from(MESSAGES).upsert(inserts, { onConflict: "conversation_id,external_id", ignoreDuplicates: true });
      if (messagesError) raise(messagesError);
    }

    const inbound = inserts.filter((row) => row.direction === "inbound");
    const last = inserts[inserts.length - 1];
    const patch = {
      contact_name: item.contactName || conversation.contact_name,
      contact_photo_url: item.contactPhotoUrl || conversation.contact_photo_url,
      thread_url: item.threadUrl || conversation.thread_url,
      listing_title: item.listingTitle || conversation.listing_title,
      listing_url: item.listingUrl || conversation.listing_url,
      listing_id: conversation.listing_id || listing?.id || null,
      updated_at: now.toISOString()
    };
    if (inbound.length) {
      patch.unread_count = Number(conversation.unread_count || 0) + inbound.length;
      patch.last_inbound_at = inbound[inbound.length - 1].message_at;
    }
    if (last) {
      patch.last_message_at = last.message_at;
      patch.last_message_preview = messagePreview(last);
    }
    // Resposta escrita direto no Facebook (fora do CRM, não é eco de uma do CRM) também é resposta humana: segura o
    // prazo da roleta (MKT-2e). A enviada pelo CRM conta quando a extensão confirma o envio.
    const outsideReply = [...inserts].reverse().find((row) => row.direction === "outbound");
    if (outsideReply && (!conversation.last_human_reply_at || outsideReply.message_at > conversation.last_human_reply_at)) patch.last_human_reply_at = outsideReply.message_at;
    const { data: updated, error: updateError } = await db().from(CONVERSATIONS).update(patch).eq("id", conversation.id).select("*").single();
    if (updateError) raise(updateError);
    summary.conversations += 1;
    summary.newMessages += inserts.length;

    // Resposta automática de disponibilidade (MKT-2l). Independente da sincronização: falha aqui (ex.: migration
    // 20261024160000 ainda não aplicada) fica no log e não impede gravar mensagens nem distribuir.
    if (firstContent) {
      await scheduleAvailabilityAutoReply(updated, timed, chatSettings, now)
        .catch((autoError) => console.error("[marketplace-chat] resposta automática de disponibilidade não agendada:", autoError?.message || autoError));
    }

    if (!updated.assigned_user_id && !updated.waiting_distribution_at && inbound.length) {
      if (firstContent) {
        if (route.kind === "assignee") await assignDirect(updated, route.userId, now);
        else if (route.kind === "roulette") await distribute(updated, { now });
      } else if (now.getTime() - new Date(updated.last_inbound_at).getTime() <= 24 * 60 * 60 * 1000) {
        // Conversa antiga que o cliente retomou: entra na roleta como uma nova.
        await distribute(updated, { now });
      }
    }
  }

  const distribution = await processMarketplaceDistribution(now, { redistribute: false });
  return { ...summary, ...distribution, settings: chatSettings };
}

// Resposta automática de disponibilidade (REGRA OFICIAL — dono, 2026-10-24, MKT-2l): conversa nova cuja 1ª mensagem do
// cliente é a pergunta padrão → UM item na fila de saída da extensão, sem autor (não é resposta humana), com atraso de
// 30 s a 2 min (`send_after`). Uma vez por conversa: índice único (conversation_id, auto_kind) — repetição é ignorada.
async function scheduleAvailabilityAutoReply(conversation, messages, settings, now = new Date()) {
  const plan = planAvailabilityAutoReply({ settings, firstContent: true, messages, contactName: conversation.contact_name, greeting: getTimeGreeting(now), now });
  if (!plan.body) return null;
  const { error } = await db().from(MESSAGES).insert({
    conversation_id: conversation.id,
    direction: "outbound",
    sender_name: AUTO_REPLY_SENDER_NAME,
    sender_user_id: null,
    body: plan.body,
    attachments: [],
    status: "queued",
    auto_kind: AUTO_REPLY_KIND,
    send_after: plan.sendAfter,
    message_at: plan.sendAfter
  });
  if (error && error.code !== "23505") raise(error);
  return plan;
}

// Alguém da equipe digitou ou respondeu pelo CRM: a resposta automática ainda na fila desta conversa é cancelada.
// Coluna `auto_kind` ausente (migration não aplicada) = não existe resposta automática a cancelar.
async function cancelQueuedAutoReplies(conversationId, reason) {
  const { error } = await db().from(MESSAGES).update(autoReplyCancelPatch(reason)).eq("conversation_id", conversationId)
    .eq("direction", "outbound").eq("status", "queued").not("auto_kind", "is", null);
  if (error && error.code !== "42703") raise(error);
}

// Corretor começou a digitar no Chat Marketplace ("para assim que o corretor digitar", MKT-2l).
export async function markMarketplaceComposerActivity(id, auth) {
  const conversation = await loadScopedConversation(id, auth);
  await cancelQueuedAutoReplies(conversation.id, AUTO_REPLY_CANCEL.HUMAN_TYPING);
  return { ok: true };
}

// --- Fila de saída (extensão) ---------------------------------------------------------------------------------
// extensionVersion: cabeçalho X-Extension-Version — arquivo só sai pela extensão que sabe anexar (1.9.5+).
// Cliente da conversa em "Não contactar" / telefone bloqueado (mesma régua das respostas automáticas,
// findDoNotContactInboundBlock). Conversa sem cliente: nada a bloquear. Erro de leitura LANÇA (na dúvida, não reenvia).
async function conversationDoNotContactReason(conversationId) {
  const { data: conversation, error } = await db().from(CONVERSATIONS).select("client_id").eq("id", conversationId).maybeSingle();
  if (error) raise(error);
  if (!conversation?.client_id) return null;
  const { data: client, error: clientError } = await db().from("simulation_registrations").select("phone").eq("id", conversation.client_id).maybeSingle();
  if (clientError) throw clientError;
  return findDoNotContactInboundBlock(client?.phone || "", conversation.client_id);
}

// Reenvio parado de vez (conversa bloqueada, Não contactar, teto de 24 h): "Não enviada" + o alerta de sempre.
async function stopResend(row, reason, detail) {
  const { data, error } = await db().from(MESSAGES).update(resendStopPatch(reason, detail)).eq("id", row.id).eq("status", row.status).select("id").maybeSingle();
  if (error) raise(error);
  if (data) await alertOutboundFailed(row, reason).catch((alertError) => console.warn("[marketplace-chat] aviso de envio falho:", alertError?.message || alertError));
}

export async function claimNextMarketplaceOutbound(now = new Date(), { extensionVersion = "" } = {}) {
  const settings = await getMarketplaceChatSettings();
  // Envio sem retorno há 10 min: pode ter saído. Extensão 1.9.6+ → volta à fila e a próxima tentativa CONFERE a conversa
  // antes de digitar (dono, 2026-10-24); extensão antiga → falha (não volta sozinho — duplicaria). planStaleSending.
  const { data: stale, error: staleError } = await db().from(MESSAGES).select("*")
    .eq("status", "sending").lt("claimed_at", new Date(now.getTime() - STALE_SENDING_MS).toISOString()).limit(20);
  if (staleError) raise(staleError);
  for (const row of stale || []) {
    const patch = isAutoReplyRow(row) ? autoReplyCancelPatch(AUTO_REPLY_CANCEL.FAILED, "A extensão não deu retorno.") : planStaleSending(row, now, { extensionVersion });
    const { data: changed, error: staleUpdateError } = await db().from(MESSAGES).update(patch).eq("id", row.id).eq("status", "sending").select("id").maybeSingle();
    if (staleUpdateError) raise(staleUpdateError);
    if (changed && patch.status === "failed") await alertOutboundFailed(row, resendStopReason(patch.error)).catch(() => {});
  }
  const [sent, sending, attemptLog] = await Promise.all([
    // Só respostas de saída: nota interna (MKT-2i) também tem status `sent` e autor, mas não sai pelo Facebook.
    db().from(MESSAGES).select("id", { count: "exact", head: true }).eq("direction", "outbound").eq("status", "sent").not("sender_user_id", "is", null).gte("sent_at", new Date(now.getTime() - 60 * 60 * 1000).toISOString()),
    db().from(MESSAGES).select("id", { count: "exact", head: true }).eq("status", "sending"),
    readSetting(OUTBOX_ATTEMPTS_ID)
  ]);
  if (sent.error) raise(sent.error);
  if (sending.error) raise(sending.error);
  const attempts = recentOutboxAttempts(attemptLog?.at, now);
  const gate = evaluateOutboxGate({ syncEnabled: settings.syncEnabled, sentLastHour: sent.count || 0, attemptsLastHour: attempts.length, maxSendsPerHour: settings.maxSendsPerHour, hasSending: (sending.count || 0) > 0 });
  if (!gate.allowed) return { message: null, reason: gate.reason };

  // Nova tentativa só depois do intervalo de 30 s (claimed_at da tentativa anterior). Ordem por conversa (vários arquivos
  // na mesma resposta, 2026-10-23): o 1º item na fila de cada conversa segura os seguintes dela (pickOutboxCandidate).
  const retryBefore = new Date(now.getTime() - SEND_RETRY_INTERVAL_MS).toISOString();
  const { data: queued, error } = await db().from(MESSAGES).select("*").eq("direction", "outbound").eq("status", "queued")
    .order("created_at", { ascending: true }).limit(50);
  if (error) raise(error);
  const pending = [...(queued || [])];
  const mediaAllowed = supportsMarketplaceMedia(extensionVersion);
  for (let candidate = pickOutboxCandidate(pending, { retryBefore, mediaAllowed, now }); candidate; candidate = pickOutboxCandidate(pending, { retryBefore, mediaAllowed, now })) {
    pending.splice(pending.indexOf(candidate), 1);
    // Resposta automática (MKT-2l): confere tudo de novo logo antes de sair; texto com a saudação da hora do envio real.
    let autoBody = null;
    if (isAutoReplyRow(candidate)) {
      let cancel = null;
      try {
        const [{ data: conversation, error: conversationError }, { data: siblings, error: siblingsError }, doNotContactReason] = await Promise.all([
          db().from(CONVERSATIONS).select("contact_name, last_human_reply_at").eq("id", candidate.conversation_id).single(),
          db().from(MESSAGES).select("id, direction").eq("conversation_id", candidate.conversation_id).eq("direction", "outbound"),
          conversationDoNotContactReason(candidate.conversation_id)
        ]);
        if (conversationError) raise(conversationError);
        if (siblingsError) raise(siblingsError);
        cancel = autoReplyCancelReason(candidate, { settings, conversation, messages: siblings || [], doNotContactReason, now });
        autoBody = buildAvailabilityAutoReply({ greeting: getTimeGreeting(now), contactName: conversation?.contact_name || "" });
      } catch (lookupError) {
        console.warn("[marketplace-chat] resposta automática adiada (não deu para conferir a conversa):", lookupError?.message || lookupError);
        continue;
      }
      if (cancel) {
        const { error: cancelError } = await db().from(MESSAGES).update(autoReplyCancelPatch(cancel)).eq("id", candidate.id).eq("status", "queued");
        if (cancelError) raise(cancelError);
        continue;
      }
    }
    // Reenvio automático: nunca para cliente Não contactar/telefone bloqueado, nunca depois do teto de 24 h.
    if (Number(candidate.attempts || 0) > 0) {
      let doNotContactReason = null;
      try {
        doNotContactReason = await conversationDoNotContactReason(candidate.conversation_id);
      } catch (lookupError) {
        console.warn("[marketplace-chat] reenvio adiado (não deu para conferir Não contactar):", lookupError?.message || lookupError);
        continue;
      }
      const blocked = resendBlockReason(candidate, { doNotContactReason, now });
      if (blocked) {
        await stopResend(candidate, blocked, candidate.error || "");
        continue;
      }
    }
    const { data: claimed, error: claimError } = await db().from(MESSAGES)
      .update({ status: "sending", claimed_at: now.toISOString(), attempts: Number(candidate.attempts || 0) + 1, ...(autoBody ? { body: autoBody, message_at: now.toISOString() } : {}) })
      .eq("id", candidate.id).eq("status", "queued").select("*").maybeSingle();
    if (claimError) raise(claimError);
    if (!claimed) continue;
    // Cada tentativa (1º envio ou reenvio) conta no limite por hora (dono, 2026-10-24).
    await writeSetting(OUTBOX_ATTEMPTS_ID, { at: recentOutboxAttempts(attempts, now, { add: true }) }, now.toISOString());
    const [{ data: conversation, error: conversationError }, recent] = await Promise.all([
      db().from(CONVERSATIONS).select("thread_key, thread_url").eq("id", claimed.conversation_id).single(),
      needsVerify(claimed)
        ? db().from(MESSAGES).select("id, direction, status, body, attachments, message_at, created_at").eq("conversation_id", claimed.conversation_id).eq("direction", "outbound").order("message_at", { ascending: false }).limit(15)
        : Promise.resolve({ data: [] })
    ]);
    if (conversationError) raise(conversationError);
    if (recent.error) raise(recent.error);
    return { message: toOutboxPayload(claimed, conversation, { knownSame: sameOutboundCount(claimed, recent.data || []) }), reason: null };
  }
  return { message: null, reason: "fila_vazia" };
}

export async function reportMarketplaceOutboundResult(id, body, now = new Date(), { extensionVersion = "" } = {}) {
  const { data: message, error } = await db().from(MESSAGES).select("*").eq("id", id).maybeSingle();
  if (error) raise(error);
  if (!message) throw new MarketplaceChatError("Mensagem não encontrada.", 404);
  // Resposta automática (MKT-2l) nunca é reenviada: não saiu (ou alguém estava digitando no Facebook) → cancelada.
  const patch = isAutoReplyRow(message) && body?.status !== "sent"
    ? (message.status === "sending" ? autoReplyCancelPatch(body?.humanTyping ? AUTO_REPLY_CANCEL.HUMAN_TYPING : AUTO_REPLY_CANCEL.FAILED, body?.error || "") : planOutboundResult(message, body, now, { extensionVersion }))
    : planOutboundResult(message, body, now, { extensionVersion });
  const { data, error: updateError } = await db().from(MESSAGES).update(patch).eq("id", id).eq("status", "sending").select("id, status").maybeSingle();
  if (updateError) raise(updateError);
  if (!data) throw new MarketplaceChatError("Esta mensagem não está em envio.", 409);
  if (data.status === "sent") await afterOutboundSent(message, now);
  if (data.status === "failed") await alertOutboundFailed(message, resendStopReason(patch.error)).catch((alertError) => console.warn("[marketplace-chat] aviso de envio falho:", alertError?.message || alertError));
  return data;
}

// Resposta EFETIVAMENTE enviada por uma pessoa = contato humano no cliente (mesma regra do Chat: "Atendimento
// automático" → "Em atendimento", último contato, crédito ao responsável só se foi ele/associado dele). Usado no retorno
// da extensão e na confirmação pelo eco (resposta que tinha falhado e saiu).
async function afterOutboundSent(message, now = new Date()) {
  if (!message?.sender_user_id) return;
  // Resposta humana efetivamente enviada: segura o prazo da roleta (MKT-2e).
  await updateConversation(message.conversation_id, { last_human_reply_at: now.toISOString() });
  try {
    const [{ data: conversation }, { data: sender }] = await Promise.all([
      db().from(CONVERSATIONS).select("client_id").eq("id", message.conversation_id).maybeSingle(),
      db().from("admin_users").select("id, email, linked_broker_id").eq("id", message.sender_user_id).maybeSingle()
    ]);
    if (conversation?.client_id) await markClientOnHumanMessage(conversation.client_id, { userId: sender?.id, email: sender?.email || "", linkedBrokerId: sender?.linked_broker_id || null }, { at: now });
  } catch (contactError) {
    console.warn("[marketplace-chat] contato humano não registrado no cliente:", contactError?.message || contactError);
  }
}

// Resposta de corretor que NÃO saiu depois das tentativas: aviso Importante aos admins gerais (Central de Alertas), um
// por mensagem. O corretor vê "Não enviada" e o botão "Tentar de novo" na conversa. `reason` = motivo da parada do
// reenvio automático (RESEND_STOP, 2026-10-24), quando houver.
async function alertOutboundFailed(message, reason = "") {
  if (!message?.sender_user_id) return;
  const [{ data: users, error }, { data: conversation }, { data: sender }] = await Promise.all([
    db().from("admin_users").select("id, role, status, disabled_at"),
    db().from(CONVERSATIONS).select("contact_name").eq("id", message.conversation_id).maybeSingle(),
    db().from("admin_users").select("name").eq("id", message.sender_user_id).maybeSingle()
  ]);
  if (error) throw error;
  await createAlertDeliveries(resolveServiceStallRecipients(users || []).map((recipientId) => ({
    definition_id: null,
    recipient_id: recipientId,
    kind: "important",
    title: "Resposta do Marketplace não enviada",
    body: `A resposta de ${sender?.name || "um corretor"} para ${conversation?.contact_name || "um cliente"} no Chat Marketplace não saiu pelo Facebook ${RESEND_STOP_LABELS[reason] ? `(${RESEND_STOP_LABELS[reason]})` : "depois das tentativas"}. O corretor pode tocar em "Tentar de novo" na conversa.`,
    context: { source: "marketplace_outbound_failed", messageId: message.id, link: "/admin/chat/marketplace" },
    dedupe_key: `marketplace_outbound_failed:${message.id}`
  })));
}

// Procura, nas mensagens já lidas do Facebook, o eco de uma resposta do CRM (saída, mesmo texto, depois de criada).
async function findStoredEcho(row) {
  const { data, error } = await db().from(MESSAGES).select("id, external_id, body, attachments, message_at, direction")
    .eq("conversation_id", row.conversation_id).eq("direction", "outbound").like("external_id", "fb:%")
    .gte("message_at", new Date(new Date(row.created_at).getTime() - 2 * 60 * 1000).toISOString()).limit(50);
  if (error) raise(error);
  const claimed = await db().from(MESSAGES).select("external_id").eq("conversation_id", row.conversation_id).not("sender_user_id", "is", null).like("external_id", "fb:%");
  const taken = new Set((claimed.data || []).map((item) => item.external_id));
  return (data || []).find((item) => !taken.has(item.external_id) && findOutboundEcho({ direction: "outbound", body: item.body, attachments: item.attachments || [], at: item.message_at }, [{ ...row, external_id: null, status: row.status === "sent" ? "sent" : "failed" }], new Date(item.message_at))) || null;
}

// Confirma pelo eco já gravado: o eco (cópia lida do Facebook) dá o id para a resposta do CRM e sai, para não aparecer
// duas vezes.
async function confirmByStoredEcho(row, echo, now = new Date()) {
  const { error: deleteError } = await db().from(MESSAGES).delete().eq("id", echo.id).is("sender_user_id", null).like("external_id", "fb:%");
  if (deleteError) raise(deleteError);
  const { error } = await db().from(MESSAGES).update({ external_id: echo.external_id, status: "sent", sent_at: echo.message_at, error: null }).eq("id", row.id);
  if (error) raise(error);
  await afterOutboundSent(row, now);
}

// "Tentar de novo" do próprio corretor (ou de quem enxerga a conversa). Antes, procura o eco: se a resposta saiu,
// marca como enviada (nunca duplica); senão volta à fila com as 3 tentativas.
export async function retryMarketplaceOutbound(conversationId, messageId, auth, now = new Date()) {
  await loadScopedConversation(conversationId, auth);
  const { data: row, error } = await db().from(MESSAGES).select("*").eq("id", messageId).eq("conversation_id", conversationId).maybeSingle();
  if (error) raise(error);
  if (!row || row.direction !== "outbound" || !row.sender_user_id) throw new MarketplaceChatError("Mensagem não encontrada.", 404);
  if (row.status !== "failed") throw new MarketplaceChatError("Esta mensagem não está como não enviada.", 409);
  const echo = await findStoredEcho(row);
  if (echo) {
    await confirmByStoredEcho(row, echo, now);
    return { status: "sent", confirmed: true };
  }
  const { error: updateError } = await db().from(MESSAGES).update({ status: "queued", attempts: 0, error: null, claimed_at: null }).eq("id", messageId).eq("status", "failed");
  if (updateError) raise(updateError);
  await resolveAlertDeliveriesByPrefix(`marketplace_outbound_failed:${messageId}`).catch(() => {});
  return { status: "queued", confirmed: false };
}

// Reprocessamento das falhas já existentes (acionamento manual, 2026-10-22). Para cada resposta do CRM falha (ou em nova
// tentativa): 1) eco já gravado → enviada; 2) falha que certamente não digitou (isSafeToResend) → volta à fila UMA vez
// (attempts = MAX - 1); 3) o resto ("Não confirmei…") fica como está, para conferir — nunca reenvia no escuro.
export async function reprocessMarketplaceOutboundFailures({ apply = false, now = new Date() } = {}) {
  const { data: rows, error } = await db().from(MESSAGES).select("*").eq("direction", "outbound").not("sender_user_id", "is", null).is("external_id", null).in("status", ["failed", "queued"]).order("created_at", { ascending: true }).limit(200);
  if (error) raise(error);
  const report = { apply, confirmed: [], requeued: [], keptFailed: [], keptQueued: [] };
  for (const row of rows || []) {
    const echo = await findStoredEcho(row);
    if (echo) {
      report.confirmed.push(row.id);
      if (apply) await confirmByStoredEcho(row, echo, now);
      continue;
    }
    if (row.status === "queued") {
      report.keptQueued.push(row.id);
      continue;
    }
    if (isSafeToResend(row.error)) {
      report.requeued.push(row.id);
      if (apply) {
        const { error: updateError } = await db().from(MESSAGES).update({ status: "queued", attempts: MAX_SEND_ATTEMPTS - 1, claimed_at: null }).eq("id", row.id).eq("status", "failed");
        if (updateError) raise(updateError);
      }
      continue;
    }
    report.keptFailed.push({ id: row.id, error: row.error });
  }
  return report;
}

// --- Tela (corretores) ----------------------------------------------------------------------------------------
function conversationRow(row, names) {
  return {
    id: row.id,
    contactName: row.contact_name,
    contactPhotoUrl: row.contact_photo_url,
    listingTitle: row.listing_title,
    listingUrl: row.listing_url,
    threadUrl: row.thread_url,
    assignedUserId: row.assigned_user_id,
    assignedName: names.get(row.assigned_user_id) || "",
    waiting: Boolean(row.waiting_distribution_at && !row.assigned_user_id),
    clientId: row.client_id,
    unreadCount: row.unread_count,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview
  };
}

async function userNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await db().from("admin_users").select("id, name").in("id", unique);
  return new Map((data || []).map((user) => [user.id, user.name]));
}

// Seletor da lista (dono, 2026-10-21): "Todos" (padrão), um corretor específico (brokerId) ou "Roleta (aguardando
// atendimento)" = sem corretor atribuído / fila de espera. Escopo = o MESMO do Chat do WhatsApp
// (buildChatScope/allowedBrokerFilter, lib/whatsapp-chat-scope.mjs): admin geral tudo, gestor a equipe (corretor de
// fora = lista vazia; "Roleta" não existe para ele — conversa sem corretor está fora da equipe), corretor/associado
// só as atribuídas a ele (sem seletor). O filtro só RESTRINGE dentro do escopo.
export const MARKETPLACE_LIST_VIEWS = ["all", "unassigned"];

export async function listMarketplaceConversations(auth, { view = "all", brokerId = "" } = {}) {
  const scope = scopeFor(auth);
  const safeView = MARKETPLACE_LIST_VIEWS.includes(view) ? view : "all";
  const filters = scope.all ? MARKETPLACE_LIST_VIEWS : scope.supervisor ? ["all"] : [];
  const filterId = allowedBrokerFilter(scope, brokerId);
  const empty = { ready: true, conversations: [], filters, view: safeView, brokerId: "" };
  if (filterId === null || (safeView !== "all" && !filters.includes(safeView))) return empty;
  let query = db().from(CONVERSATIONS).select("*").order("last_message_at", { ascending: false, nullsFirst: false }).limit(200);
  if (!scope.all) query = query.in("assigned_user_id", scope.ids);
  if (filterId) query = query.eq("assigned_user_id", filterId);
  else if (safeView === "unassigned") query = query.is("assigned_user_id", null);
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) return { ...empty, ready: false };
    throw error;
  }
  const [names, extension] = await Promise.all([userNames((data || []).map((row) => row.assigned_user_id)), getMarketplaceExtensionSignal()]);
  return { ...empty, brokerId: filterId || "", extension, conversations: (data || []).map((row) => conversationRow(row, names)) };
}

async function loadScopedConversation(id, auth) {
  const { data, error } = await db().from(CONVERSATIONS).select("*").eq("id", id).maybeSingle();
  if (error) raise(error);
  if (!data) throw new MarketplaceChatError("Conversa não encontrada.", 404);
  if (!canSeeConversation(scopeFor(auth), { assignedUserId: data.assigned_user_id })) throw new MarketplaceChatError("Você não tem acesso a esta conversa.", 403);
  return data;
}

// Mensagem interna (MKT-2i): mesmo critério da nota interna do Chat do WhatsApp (`canManageConversation`), depois do
// escopo da conversa (loadScopedConversation).
async function canUseInternal(conversation, auth) {
  const generalAdmin = Boolean(auth) && isGeneralAdminAuth(auth);
  const manager = Boolean(auth) && isManagerProfile(auth?.profile);
  const profileId = auth?.profile?.id || "";
  let clientResponsibleId = "";
  if (!generalAdmin && !manager && profileId && conversation.assigned_user_id !== profileId && conversation.client_id) {
    const { data, error } = await db().from("simulation_registrations").select("responsible_user_id").eq("id", conversation.client_id).maybeSingle();
    if (error) throw error;
    clientResponsibleId = data?.responsible_user_id || "";
  }
  return canUseMarketplaceInternal({ generalAdmin, manager, profileId, assignedUserId: conversation.assigned_user_id || "", clientResponsibleId });
}

// Cliente ligado à conversa, para "Adicionar WhatsApp do cliente" / "Chamar no WhatsApp" no topo (MKT-2, dono 2026-10-23).
// Só para quem já pode ver o cliente (mesmo escopo da ficha, assertCanAccessResponsibleUser); senão null (a tela não
// mostra o campo). O telefone é gravado pela rota da ficha (PATCH /api/simulation-registrations/[id]), nunca aqui.
async function loadConversationClient(clientId, auth) {
  if (!clientId || !auth) return null;
  const { data, error } = await db().from("simulation_registrations")
    .select("id, full_name, phone, phone_normalized, status, responsible_user_id, returned_from_user_id").eq("id", clientId).maybeSingle();
  if (error) raise(error);
  if (!data) return null;
  try {
    assertCanAccessResponsibleUser(auth, clientAccessOwnerId({ responsibleUserId: data.responsible_user_id, returnedFromUserId: data.returned_from_user_id }));
  } catch (scopeError) {
    if (scopeError instanceof AdminPermissionError) return null; // fora do escopo do cliente: sem dado nem campo
    throw scopeError;
  }
  return { id: data.id, name: data.full_name, phone: data.phone || "", phoneNormalized: data.phone_normalized || "", status: data.status, responsibleUserId: data.responsible_user_id || "" };
}

// Resposta automática (MKT-2l): etiqueta "automática" para todos; cancelada aparece só como nota apagada (sem "Não enviada").
function autoReplyView(row, technical) {
  if (!isAutoReplyRow(row)) return {};
  const labels = { queued: "Na fila — sai sozinha em instantes", sending: "Enviando…", sent: "Enviada", failed: "Cancelada — não foi enviada" };
  return { automatic: true, automaticLabel: AUTO_REPLY_LABEL, statusLabel: labels[row.status] || "", canRetry: false, undelivered: false, error: technical ? row.error || null : null };
}

export async function getMarketplaceConversation(id, auth) {
  const conversation = await loadScopedConversation(id, auth);
  const canInternal = await canUseInternal(conversation, auth);
  const technicalView = Boolean(auth) && isGeneralAdminAuth(auth);
  // "*" (e não lista de colunas): `auto_kind` só existe depois da migration 20261024160000 — sem ela a conversa abre igual.
  let query = db().from(MESSAGES).select("*").eq("conversation_id", id).order("message_at", { ascending: true }).limit(300);
  // Notas internas filtradas NO BACKEND: quem não pode nunca as recebe (nem por chamada direta).
  if (!canInternal) query = query.neq("direction", INTERNAL_DIRECTION);
  const { data: messages, error } = await query;
  if (error) raise(error);
  // REGRA OFICIAL (dono, 2026-10-22): "eu abrir a conversa não deve marcar como lida". Só o corretor atribuído (ou o
  // associado dele) zera ao abrir; admin/gestor olhando e conversa na Roleta não — mesma regra do Chat do WhatsApp.
  const markRead = Boolean(conversation.unread_count) && marksReadOnOpen(scopeFor(auth), { ownerId: conversation.assigned_user_id, viewerId: auth?.profile?.id || null });
  if (markRead) await db().from(CONVERSATIONS).update({ unread_count: 0 }).eq("id", id);
  const [names, client] = await Promise.all([userNames([conversation.assigned_user_id]), loadConversationClient(conversation.client_id, auth)]);
  return {
    conversation: { ...conversationRow(markRead ? { ...conversation, unread_count: 0 } : conversation, names), canInternal, client },
    // Erro técnico só para o admin geral; o corretor vê "Mensagem não entregue — reenviando automaticamente" / "Não enviada" (2026-10-24).
    messages: (messages || []).map((row) => ({ id: row.id, direction: row.direction, internal: row.direction === INTERNAL_DIRECTION, senderName: row.sender_name, body: row.body, attachments: row.attachments || [], status: row.status, ...outboundStatusView(row, { technical: technicalView }), ...autoReplyView(row, technicalView), at: row.message_at }))
  };
}

// Nota interna (MKT-2i): grava a mensagem e avisa a equipe (notifyMarketplaceInternalNote). Não entra na fila da extensão, não muda a conversa (última mensagem,
// atendente, prazo da roleta `last_human_reply_at`, não lidas) nem o cliente (sem markClientOnHumanMessage: não é
// contato, atendimento, resposta nem pontuação). Autor = perfil efetivo (ação operacional, inclusive em "Alterar conta").
export async function saveMarketplaceInternalNote(id, text, auth, now = new Date()) {
  const conversation = await loadScopedConversation(id, auth);
  if (!(await canUseInternal(conversation, auth))) {
    throw new MarketplaceChatError("Só o corretor responsável, a gestão e o administrador usam mensagens internas desta conversa.", 403);
  }
  const row = buildMarketplaceInternalNote({ conversationId: id, text, senderUserId: auth?.profile?.id || null, senderName: auth?.profile?.name || auth?.user?.email || "Equipe", now });
  const { data, error } = await db().from(MESSAGES).insert(row).select("id, direction, sender_name, body, attachments, status, error, message_at").single();
  if (error) {
    if (error.code === "23514") throw new MarketplaceChatError("A mensagem interna do Marketplace ainda não foi liberada no banco (migration 20261022200000).", 503);
    raise(error);
  }
  await notifyMarketplaceInternalNote(conversation, data.id, auth);
  return { id: data.id, direction: data.direction, internal: true, senderName: data.sender_name, body: data.body, attachments: [], status: data.status, error: null, at: data.message_at };
}

// Aviso da nota interna (REGRA OFICIAL — dono, 2026-10-22, MKT-2i; exceção à AUT-9 só do Marketplace): UM aviso por mensagem
// (chamado uma vez, logo depois de gravar a nota) no sino (crm_notifications `marketplace_internal`, com o link da conversa)
// e por push, para admin geral, corretor responsável/atribuído e gestora da equipe — nunca o autor, associado ou cliente
// (resolveMarketplaceInternalRecipients). Falha no aviso não desfaz a nota já salva; vai para o log como erro.
async function notifyMarketplaceInternalNote(conversation, messageId, auth) {
  try {
    let client = null;
    if (conversation.client_id) {
      const { data, error } = await db().from("simulation_registrations").select("full_name, responsible_user_id").eq("id", conversation.client_id).maybeSingle();
      if (error) throw error;
      client = data || null;
    }
    const { data: users, error: usersError } = await db().from("admin_users").select("id, role, manager_id, linked_broker_id, status");
    if (usersError) throw usersError;
    const recipients = resolveMarketplaceInternalRecipients({
      users: users || [],
      assignedUserId: conversation.assigned_user_id || "",
      clientResponsibleId: client?.responsible_user_id || "",
      authorId: auth?.profile?.id || ""
    });
    if (!recipients.length) return;
    const { title, description } = buildMarketplaceInternalNotice({
      authorName: auth?.profile?.name || auth?.user?.email || "",
      contactName: client?.full_name || conversation.contact_name || ""
    });
    const link = marketplaceConversationLink(conversation.id);
    const now = new Date().toISOString();
    const { error } = await db().from("crm_notifications").insert(recipients.map((recipientId) => ({
      recipient_user_id: recipientId,
      client_id: conversation.client_id || null,
      title,
      description,
      notification_type: NOTIFICATION_KIND.MARKETPLACE_INTERNAL,
      link,
      scheduled_at: now
    })));
    // Sem a migration 20261022231000 (coluna `link` + tipo liberado no gatilho) o sino falha aqui; o push segue.
    if (error) console.error("[marketplace-chat] aviso da mensagem interna não entrou no sino:", error.message || error);
    for (const recipientId of recipients) {
      await sendPushToUser(recipientId, { kind: NOTIFICATION_KIND.MARKETPLACE_INTERNAL, title, body: description, url: link, tag: `marketplace-internal:${messageId}` })
        .catch((pushError) => console.error("[marketplace-chat] push da mensagem interna falhou:", pushError?.message || pushError));
    }
  } catch (error) {
    console.error("[marketplace-chat] aviso da mensagem interna falhou:", error?.message || error);
  }
}

// Resposta do corretor → fila de saída (a extensão envia pelo perfil do Facebook do dono, sem prefixo).
export async function queueMarketplaceReply(id, text, auth, now = new Date()) {
  const body = validateOutboundText(text);
  const conversation = await loadScopedConversation(id, auth);
  return queueOutbound(conversation, { body, attachments: [] }, auth, now);
}

// Arquivo (foto/PDF) da resposta → UM item da fila de saída, na ordem em que a tela manda (um por vez). Mesmo escopo e
// mesma regra da resposta de texto; o arquivo fica no bucket do Chat (público, caminho com UUID), de onde a extensão baixa.
export async function queueMarketplaceMedia(id, { buffer, mimeType, fileName }, auth, now = new Date()) {
  const conversation = await loadScopedConversation(id, auth);
  const media = validateOutboundMedia({ mimeType, size: buffer?.length || 0, fileName });
  const { url, path } = await uploadChatMedia({ buffer, contentType: media.mime, fileName: media.name, folder: `marketplace/${id}` });
  return queueOutbound(conversation, { body: "", attachments: [{ type: media.type, url, path, name: media.name, mime: media.mime }] }, auth, now);
}

async function queueOutbound(conversation, { body, attachments }, auth, now) {
  const id = conversation.id;
  const iso = now.toISOString();
  const { data, error } = await db().from(MESSAGES).insert({
    conversation_id: id,
    direction: "outbound",
    sender_name: auth?.profile?.name || auth?.user?.email || "Equipe",
    sender_user_id: auth?.profile?.id || null,
    body,
    attachments,
    status: "queued",
    message_at: iso
  }).select("id").single();
  if (error) raise(error);
  // Resposta da equipe pelo CRM cancela a automática ainda na fila (MKT-2l).
  await cancelQueuedAutoReplies(id, AUTO_REPLY_CANCEL.HUMAN_REPLIED);
  // `last_human_reply_at` NÃO é gravado aqui (só a resposta efetivamente enviada/vista no Facebook o grava); o prazo
  // MKT-2e é segurado pela própria mensagem escrita, em qualquer status, mesmo se o envio falhar (humanRepliesByConversation).
  const patch = { last_message_at: iso, last_message_preview: body ? body.slice(0, 140) : messagePreview({ body, attachments }), updated_at: iso };
  // Quem responde assume a conversa que estava sem atendente (ação operacional: atribuída ao perfil efetivo).
  if (!conversation.assigned_user_id && auth?.profile?.id) Object.assign(patch, { assigned_user_id: auth.profile.id, assigned_at: iso, waiting_distribution_at: null, assignment_source: ASSIGNMENT_SOURCE.REPLY, lost_by_user_id: null });
  await updateConversation(id, patch);
  return { id: data.id };
}

export async function assignMarketplaceConversation(id, userId, auth) {
  const scope = scopeFor(auth);
  if (!scope.supervisor) throw new MarketplaceChatError("Só gestor ou administrador transfere conversas.", 403);
  if (!canAssignTo(scope, userId)) throw new MarketplaceChatError("Você não pode atribuir a esta pessoa.", 403);
  const conversation = await loadScopedConversation(id, auth);
  const iso = new Date().toISOString();
  // Transferência manual desliga a redistribuição por prazo (ROL-4d): origem "manual".
  await updateConversation(id, { assigned_user_id: userId || null, assigned_at: userId ? iso : null, waiting_distribution_at: null, assignment_source: userId ? ASSIGNMENT_SOURCE.MANUAL : null, lost_by_user_id: null, updated_at: iso });
  if (userId && conversation.client_id) {
    const { data: before } = await db().from("simulation_registrations").select("responsible_user_id").eq("id", conversation.client_id).maybeSingle();
    await db().from("simulation_registrations").update({ responsible_user_id: userId, updated_at: iso }).eq("id", conversation.client_id);
    // Transferido vai para "Aguardando contato" (REGRA OFICIAL — dono, 2026-10-25, lib/transfer-status.js).
    if (isResponsibleTransfer(before?.responsible_user_id, userId)) await applyTransferStatusRuleAfterTransfer({ clientId: conversation.client_id, auth });
    await recordLeadDistributionHistory({ registration: { id: conversation.client_id, full_name: conversation.contact_name }, eventType: "auto_transferred", fromUserId: conversation.assigned_user_id || null, toUserId: userId, details: { source: "facebook_marketplace_manual", by: auth?.profile?.id || null } })
      .catch((historyError) => console.warn("[marketplace-chat] histórico da transferência falhou:", historyError?.message || historyError));
  }
}

// "Adicionar ao CRM" para conversa que ficou sem cliente (histórico antigo com o admin, ou cliente não criado): mesmo
// cadastro só com o nome; o WhatsApp é preenchido depois no card do cliente.
export async function addMarketplaceConversationToCrm(id, { name = "" } = {}, auth) {
  const conversation = await loadScopedConversation(id, auth);
  if (conversation.client_id) throw new MarketplaceChatError("Esta conversa já está ligada a um cliente.", 409);
  const fullName = String(name || conversation.contact_name || "").trim();
  if (fullName.length < 2) throw new MarketplaceChatError("Informe o nome do cliente.");
  const clientId = await ensureClientForConversation({ ...conversation, contact_name: fullName }, conversation.assigned_user_id || auth?.profile?.id || null);
  return { clientId };
}

// Contador do menu e do atalho: NÚMERO DE CONVERSAS não lidas (unread_count > 0) que a pessoa enxerga — igual ao
// Chat do WhatsApp (dono, 2026-10-21), não a soma de mensagens.
export async function countMarketplaceUnread(auth) {
  const scope = scopeFor(auth);
  let query = db().from(CONVERSATIONS).select("id", { count: "exact", head: true }).gt("unread_count", 0);
  if (!scope.all) query = query.in("assigned_user_id", scope.ids);
  const { count, error } = await query;
  if (error) {
    if (isMissingTable(error)) return 0;
    throw error;
  }
  return count || 0;
}

// --- Renormalização do que já foi gravado (2026-10-21) ---------------------------------------------------------
// Mensagens importadas antes da correção guardaram o aria-label inteiro ("Pressione Enter, Mensagem enviada … por …:
// …"), avatar como anexo e avisos do Facebook. Reaplica normalizeFacebookMessage (mesma regra da sincronização) às
// mensagens LIDAS do Facebook (external_id preenchido; resposta escrita no CRM nunca é tocada nem apagada), apaga as
// descartáveis e recalcula a conversa. Idempotente: na 2ª vez nada muda. apply=false só conta (padrão).
export async function renormalizeMarketplaceMessages({ apply = false, now = new Date() } = {}) {
  const { data: conversations, error } = await db().from(CONVERSATIONS).select("id, contact_name, contact_photo_url, unread_count, last_message_at, last_inbound_at, last_message_preview").limit(1000);
  if (error) raise(error);
  const report = { apply, conversations: 0, updated: 0, deleted: 0, details: [] };
  for (const conversation of conversations || []) {
    const { data: rows, error: rowsError } = await db().from(MESSAGES).select("id, external_id, direction, sender_name, body, attachments, status, message_at").eq("conversation_id", conversation.id).order("message_at", { ascending: true }).limit(2000);
    if (rowsError) raise(rowsError);
    const kept = [];
    const updates = [];
    const deletes = [];
    // Mesma regra da sincronização: conversa com mensagens de id do Facebook → lida sem id do Facebook ("h:") não é
    // mensagem (painel de respostas rápidas/aviso — caso Debora, 2026-10-22) e sai.
    const hasFacebookIds = (rows || []).some((row) => String(row.external_id || "").startsWith("fb:"));
    for (const row of rows || []) {
      // Nota interna (MKT-2i): nunca tocada e fora da última mensagem/não lidas da conversa.
      if (row.direction === INTERNAL_DIRECTION) continue;
      if (!row.external_id) {
        kept.push(row);
        continue;
      }
      if (hasFacebookIds && !String(row.external_id).startsWith("fb:")) {
        deletes.push(row.id);
        continue;
      }
      const parsed = normalizeFacebookMessage({ body: row.body, direction: row.direction, at: null, attachments: row.attachments || [] }, { contactPhotoUrl: conversation.contact_photo_url || "", now });
      if (!parsed) {
        deletes.push(row.id);
        continue;
      }
      const next = {
        body: parsed.body.slice(0, 4000),
        direction: parsed.direction,
        sender_name: parsed.direction === "inbound"
          ? parsed.senderName || conversation.contact_name || row.sender_name
          : row.direction === "outbound" ? row.sender_name : "Facebook (enviada fora do CRM)",
        attachments: parsed.attachments,
        message_at: parsed.at || row.message_at
      };
      const changed = next.body !== row.body || next.direction !== row.direction || next.sender_name !== row.sender_name
        || JSON.stringify(next.attachments) !== JSON.stringify(row.attachments || []) || new Date(next.message_at).getTime() !== new Date(row.message_at).getTime();
      if (changed) updates.push({ id: row.id, patch: { ...next, status: next.direction === "inbound" ? "received" : "sent" } });
      kept.push({ ...row, ...next });
    }
    if (!updates.length && !deletes.length) continue;
    kept.sort((a, b) => new Date(a.message_at) - new Date(b.message_at));
    const last = kept[kept.length - 1] || null;
    const lastInbound = [...kept].reverse().find((row) => row.direction === "inbound") || null;
    const lastOutboundAt = [...kept].reverse().find((row) => row.direction === "outbound")?.message_at || null;
    const pendingInbound = kept.filter((row) => row.direction === "inbound" && (!lastOutboundAt || new Date(row.message_at) > new Date(lastOutboundAt))).length;
    const conversationPatch = {
      last_message_at: last?.message_at || null,
      last_inbound_at: lastInbound?.message_at || null,
      last_message_preview: last ? messagePreview(last) : "",
      // Quem já abriu a conversa (0) continua lido; não lida = mensagens do cliente depois da nossa última.
      unread_count: Number(conversation.unread_count || 0) > 0 ? pendingInbound : 0,
      updated_at: now.toISOString()
    };
    report.conversations += 1;
    report.updated += updates.length;
    report.deleted += deletes.length;
    report.details.push({ id: conversation.id, updates: updates.length, deletes: deletes.length, unread: conversationPatch.unread_count, lastMessageAt: conversationPatch.last_message_at });
    if (!apply) continue;
    for (const { id, patch } of updates) {
      const { error: updateError } = await db().from(MESSAGES).update(patch).eq("id", id);
      if (updateError) raise(updateError);
    }
    if (deletes.length) {
      const { error: deleteError } = await db().from(MESSAGES).delete().in("id", deletes).not("external_id", "is", null);
      if (deleteError) raise(deleteError);
    }
    const { error: conversationError } = await db().from(CONVERSATIONS).update(conversationPatch).eq("id", conversation.id);
    if (conversationError) raise(conversationError);
  }
  return report;
}

// --- Diagnóstico de estrutura (extensão) --------------------------------------------------------------------------
// Esqueleto anonimizado da página do Facebook para calibrar seletores (migration 20261020230000). Só metadados: a
// extensão já mascara textos; aqui só se valida tipo/tamanho.
const DIAGNOSTIC_KINDS = new Set(["inbox_page", "messenger_panel", "thread", "inbox_list"]);
const DIAGNOSTIC_MAX_BYTES = 600_000;

export async function saveMarketplaceDiagnostic(body = {}) {
  const kind = String(body.kind || "");
  if (!DIAGNOSTIC_KINDS.has(kind)) throw new MarketplaceChatError("Tipo de diagnóstico inválido.");
  const payload = body.payload && typeof body.payload === "object" ? body.payload : null;
  if (!payload) throw new MarketplaceChatError("Diagnóstico vazio.");
  if (JSON.stringify(payload).length > DIAGNOSTIC_MAX_BYTES) throw new MarketplaceChatError("Diagnóstico grande demais.");
  const { data, error } = await db().from("marketplace_diagnostics").insert({ kind, payload }).select("id").single();
  if (error) raise(error);
  return data;
}
