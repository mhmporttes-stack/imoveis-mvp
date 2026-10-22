import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assignRoundRobinLead, isMissingSchemaError, recordLeadDistributionHistory, releaseRouletteReceipt } from "./lead-distribution";
import { countActiveRoundRobinBrokers, getRouletteRedistributionDeadlineMs, notifyRoundRobinStalled } from "./crm-automations";
import { createMarketplaceRegistration, updateSimulationRegistration } from "./simulation-registrations";
import { createAlertDeliveries, getAlertDefinition, resolveAlertDeliveriesByPrefix } from "./crm-alerts";
import { resolveServiceStallRecipients } from "./whatsapp-service-stall-core.mjs";
import { markClientOnHumanMessage } from "./whatsapp-client-status";
import { addSystemTagToClient } from "./client-tags";
import { isBrokerProfile, isGeneralAdminAuth, isManagerProfile, isOwnerAdminEmail, listAdminProfiles } from "./admin-profiles";
import { allowedBrokerFilter, buildChatScope, canAssignTo, canSeeConversation } from "./whatsapp-chat-scope.mjs";
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
  STALE_SENDING_MS,
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
  validateOutboundText
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

// Respostas do corretor ainda na fila de saída da extensão (escritas, não enviadas): a mais recente por conversa.
async function pendingRepliesByConversation(ids) {
  const result = new Map();
  if (!ids.length) return result;
  const { data, error } = await db().from(MESSAGES).select("conversation_id, created_at").in("conversation_id", ids)
    .eq("direction", "outbound").in("status", ["queued", "sending"]).not("sender_user_id", "is", null);
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
  const pending = await pendingRepliesByConversation((assigned || []).map((row) => row.id));
  const overdue = (assigned || []).filter((row) => shouldRedistribute(row, now, { deadlineMs, pendingReplySince: pending.get(row.id) || null }));
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

export async function recordMarketplaceExtensionSignal(now = new Date()) {
  const iso = now.toISOString();
  await writeSetting(EXTENSION_SIGNAL_ID, { last_sync_at: iso }, iso);
}

export async function getMarketplaceExtensionSignal() {
  const signal = await readSetting(EXTENSION_SIGNAL_ID);
  return { lastSyncAt: signal?.last_sync_at || null };
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
        context: { source: EXTENSION_SIGNAL_ID, episode: decision.episode, link: EXTENSION_LINK },
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
        echoCandidates ??= (await db().from(MESSAGES).select("id, external_id, direction, status, body, sent_at, created_at").eq("conversation_id", conversation.id).is("external_id", null).eq("direction", "outbound")).data || [];
        const echo = findOutboundEcho(message, echoCandidates, now);
        if (echo) {
          await db().from(MESSAGES).update({ external_id: message.externalId }).eq("id", echo.id);
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

// --- Fila de saída (extensão) ---------------------------------------------------------------------------------
export async function claimNextMarketplaceOutbound(now = new Date()) {
  const settings = await getMarketplaceChatSettings();
  // Envio sem retorno há 10 min: falha (não volta à fila sozinho — pode ter saído e duplicaria).
  await db().from(MESSAGES).update({ status: "failed", error: "A extensão não deu retorno. Confira no Facebook antes de reenviar." })
    .eq("status", "sending").lt("claimed_at", new Date(now.getTime() - STALE_SENDING_MS).toISOString());
  const [sent, sending] = await Promise.all([
    db().from(MESSAGES).select("id", { count: "exact", head: true }).eq("status", "sent").not("sender_user_id", "is", null).gte("sent_at", new Date(now.getTime() - 60 * 60 * 1000).toISOString()),
    db().from(MESSAGES).select("id", { count: "exact", head: true }).eq("status", "sending")
  ]);
  if (sent.error) raise(sent.error);
  if (sending.error) raise(sending.error);
  const gate = evaluateOutboxGate({ syncEnabled: settings.syncEnabled, sentLastHour: sent.count || 0, maxSendsPerHour: settings.maxSendsPerHour, hasSending: (sending.count || 0) > 0 });
  if (!gate.allowed) return { message: null, reason: gate.reason };

  const { data: candidates, error } = await db().from(MESSAGES).select("*").eq("status", "queued").order("created_at", { ascending: true }).limit(3);
  if (error) raise(error);
  for (const candidate of candidates || []) {
    const { data: claimed, error: claimError } = await db().from(MESSAGES)
      .update({ status: "sending", claimed_at: now.toISOString(), attempts: Number(candidate.attempts || 0) + 1 })
      .eq("id", candidate.id).eq("status", "queued").select("*").maybeSingle();
    if (claimError) raise(claimError);
    if (!claimed) continue;
    const { data: conversation, error: conversationError } = await db().from(CONVERSATIONS).select("thread_key, thread_url").eq("id", claimed.conversation_id).single();
    if (conversationError) raise(conversationError);
    return { message: toOutboxPayload(claimed, conversation), reason: null };
  }
  return { message: null, reason: "fila_vazia" };
}

export async function reportMarketplaceOutboundResult(id, body, now = new Date()) {
  const { data: message, error } = await db().from(MESSAGES).select("*").eq("id", id).maybeSingle();
  if (error) raise(error);
  if (!message) throw new MarketplaceChatError("Mensagem não encontrada.", 404);
  const patch = planOutboundResult(message, body, now);
  const { data, error: updateError } = await db().from(MESSAGES).update(patch).eq("id", id).eq("status", "sending").select("id, status").maybeSingle();
  if (updateError) raise(updateError);
  if (!data) throw new MarketplaceChatError("Esta mensagem não está em envio.", 409);
  // Resposta EFETIVAMENTE enviada por uma pessoa = contato humano no cliente (mesma regra do Chat: "Atendimento
  // automático" → "Em atendimento", último contato, crédito ao responsável só se foi ele/associado dele).
  if (data.status === "sent" && message.sender_user_id) {
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
  return data;
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

export async function getMarketplaceConversation(id, auth) {
  const conversation = await loadScopedConversation(id, auth);
  const { data: messages, error } = await db().from(MESSAGES).select("id, direction, sender_name, body, attachments, status, error, message_at, created_at").eq("conversation_id", id).order("message_at", { ascending: true }).limit(300);
  if (error) raise(error);
  if (conversation.unread_count) await db().from(CONVERSATIONS).update({ unread_count: 0 }).eq("id", id);
  const names = await userNames([conversation.assigned_user_id]);
  return {
    conversation: conversationRow({ ...conversation, unread_count: 0 }, names),
    messages: (messages || []).map((row) => ({ id: row.id, direction: row.direction, senderName: row.sender_name, body: row.body, attachments: row.attachments || [], status: row.status, error: row.error, at: row.message_at }))
  };
}

// Resposta do corretor → fila de saída (a extensão envia pelo perfil do Facebook do dono, sem prefixo).
export async function queueMarketplaceReply(id, text, auth, now = new Date()) {
  const body = validateOutboundText(text);
  const conversation = await loadScopedConversation(id, auth);
  const iso = now.toISOString();
  const { data, error } = await db().from(MESSAGES).insert({
    conversation_id: id,
    direction: "outbound",
    sender_name: auth?.profile?.name || auth?.user?.email || "Equipe",
    sender_user_id: auth?.profile?.id || null,
    body,
    status: "queued",
    message_at: iso
  }).select("id").single();
  if (error) raise(error);
  // `last_human_reply_at` NÃO é gravado aqui: só a resposta efetivamente enviada conta para o prazo (MKT-2e); enquanto
  // está na fila de saída ela só segura o prazo (pendingRepliesByConversation).
  const patch = { last_message_at: iso, last_message_preview: body.slice(0, 140), updated_at: iso };
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
    await db().from("simulation_registrations").update({ responsible_user_id: userId, updated_at: iso }).eq("id", conversation.client_id);
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
    for (const row of rows || []) {
      if (!row.external_id) {
        kept.push(row);
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
