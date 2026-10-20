import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { assignRoundRobinLead, recordLeadDistributionHistory } from "./lead-distribution";
import { createMarketplaceRegistration } from "./simulation-registrations";
import { markClientOnHumanMessage } from "./whatsapp-client-status";
import { addSystemTagToClient } from "./client-tags";
import { isBrokerProfile, isGeneralAdminAuth, isManagerProfile } from "./admin-profiles";
import { buildChatScope, canAssignTo, canSeeConversation } from "./whatsapp-chat-scope.mjs";
import {
  CHAT_SETTINGS_ID,
  MarketplaceChatError,
  STALE_SENDING_MS,
  evaluateOutboxGate,
  findOutboundEcho,
  matchListing,
  messagePreview,
  normalizeChatSettings,
  normalizeSyncPayload,
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
// Conversa nova cujo último contato do cliente é mais antigo que isto (1ª sincronização traz o histórico) não entra na
// roleta: fica sem atendente, visível ao administrador geral.
const DISTRIBUTE_RECENT_MS = 24 * 60 * 60 * 1000;

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

async function distribute(conversation, { excludedBrokerId = null, now = new Date() } = {}) {
  const { brokerId } = await assignRoundRobinLead(excludedBrokerId ? { excludedBrokerId } : {});
  const iso = now.toISOString();
  if (brokerId) {
    const patch = { assigned_user_id: brokerId, assigned_at: iso, waiting_distribution_at: null, updated_at: iso };
    if (excludedBrokerId) patch.redistributions = Number(conversation.redistributions || 0) + 1;
    await db().from(CONVERSATIONS).update(patch).eq("id", conversation.id);
    let clientId = conversation.client_id || null;
    try {
      if (clientId) {
        // Cliente já existe (redistribuição): vai junto com a conversa.
        await db().from("simulation_registrations").update({ responsible_user_id: brokerId, updated_at: iso }).eq("id", clientId);
      } else {
        clientId = await ensureClientForConversation(conversation, brokerId);
      }
      await recordLeadDistributionHistory({
        registration: { id: clientId, full_name: conversation.contact_name },
        eventType: excludedBrokerId ? "auto_transferred" : "assigned",
        fromUserId: excludedBrokerId || null,
        toUserId: brokerId,
        details: { source: "facebook_marketplace", conversationId: conversation.id }
      }).catch((error) => console.warn("[marketplace-chat] histórico da roleta falhou:", error?.message || error));
    } catch (error) {
      // Sem a migration 20261020200000 o cliente sem telefone é recusado pelo banco: a conversa segue atribuída.
      console.warn("[marketplace-chat] não criou/atualizou o cliente da conversa:", error?.message || error);
    }
    await notifyReceiver(brokerId, clientId, conversation, Boolean(excludedBrokerId));
    return brokerId;
  }
  // Ninguém on-line: sem atendente fica na fila de espera; redistribuição sem ninguém livre mantém quem está.
  if (!conversation.assigned_user_id && !conversation.waiting_distribution_at) {
    await db().from(CONVERSATIONS).update({ waiting_distribution_at: iso, updated_at: iso }).eq("id", conversation.id);
  }
  return null;
}

// Fila de espera e prazo sem resposta. Chamado a cada sincronização da extensão (1–2 min).
export async function processMarketplaceDistribution(now = new Date()) {
  const result = { delivered: 0, redistributed: 0 };
  const { data: waiting, error } = await db().from(CONVERSATIONS).select("*").not("waiting_distribution_at", "is", null).is("assigned_user_id", null).order("waiting_distribution_at", { ascending: true }).limit(5);
  if (error) raise(error);
  for (const conversation of waiting || []) {
    if (!(await distribute(conversation, { now }))) break; // ninguém liberado agora: tenta na próxima rodada
    result.delivered += 1;
  }
  const { data: assigned, error: assignedError } = await db().from(CONVERSATIONS).select("*").not("assigned_at", "is", null).is("client_id", null)
    .gte("assigned_at", new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()).limit(50);
  if (assignedError) raise(assignedError);
  for (const conversation of (assigned || []).filter((row) => shouldRedistribute(row, now))) {
    if (await distribute(conversation, { excludedBrokerId: conversation.assigned_user_id, now })) result.redistributed += 1;
  }
  return result;
}

// --- Sincronização (extensão) ---------------------------------------------------------------------------------
async function loadListings() {
  const { data, error } = await db().from("marketplace_listings").select("id, title, marketplace_url").eq("status", "published");
  if (error && !isMissingTable(error)) throw error;
  return data || [];
}

export async function syncMarketplaceConversations(body, now = new Date()) {
  const conversations = normalizeSyncPayload(body);
  const listings = conversations.length ? await loadListings() : [];
  const summary = { conversations: 0, newMessages: 0, created: 0 };

  for (const item of conversations) {
    const { data: existing, error } = await db().from(CONVERSATIONS).select("*").eq("thread_key", item.threadKey).maybeSingle();
    if (error) raise(error);
    let conversation = existing;
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
    const fresh = item.messages.filter((message) => !knownIds.has(message.externalId));

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
        sender_name: message.direction === "inbound" ? item.contactName : "Facebook (enviada fora do CRM)",
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
    const { data: updated, error: updateError } = await db().from(CONVERSATIONS).update(patch).eq("id", conversation.id).select("*").single();
    if (updateError) raise(updateError);
    summary.conversations += 1;
    summary.newMessages += inserts.length;

    const recentInbound = updated.last_inbound_at && now.getTime() - new Date(updated.last_inbound_at).getTime() <= DISTRIBUTE_RECENT_MS;
    if (!updated.assigned_user_id && !updated.waiting_distribution_at && inbound.length && recentInbound) await distribute(updated, { now });
  }

  const distribution = await processMarketplaceDistribution(now);
  return { ...summary, ...distribution, settings: await getMarketplaceChatSettings() };
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

export async function listMarketplaceConversations(auth) {
  const scope = scopeFor(auth);
  let query = db().from(CONVERSATIONS).select("*").order("last_message_at", { ascending: false, nullsFirst: false }).limit(200);
  if (!scope.all) query = query.in("assigned_user_id", scope.ids);
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) return { ready: false, conversations: [] };
    throw error;
  }
  const names = await userNames((data || []).map((row) => row.assigned_user_id));
  return { ready: true, conversations: (data || []).map((row) => conversationRow(row, names)) };
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
  const patch = { last_human_reply_at: iso, last_message_at: iso, last_message_preview: body.slice(0, 140), updated_at: iso };
  // Quem responde assume a conversa que estava sem atendente (ação operacional: atribuída ao perfil efetivo).
  if (!conversation.assigned_user_id && auth?.profile?.id) Object.assign(patch, { assigned_user_id: auth.profile.id, assigned_at: iso, waiting_distribution_at: null });
  await db().from(CONVERSATIONS).update(patch).eq("id", id);
  return { id: data.id };
}

export async function assignMarketplaceConversation(id, userId, auth) {
  const scope = scopeFor(auth);
  if (!scope.supervisor) throw new MarketplaceChatError("Só gestor ou administrador transfere conversas.", 403);
  if (!canAssignTo(scope, userId)) throw new MarketplaceChatError("Você não pode atribuir a esta pessoa.", 403);
  const conversation = await loadScopedConversation(id, auth);
  const iso = new Date().toISOString();
  const { error } = await db().from(CONVERSATIONS).update({ assigned_user_id: userId || null, assigned_at: userId ? iso : null, waiting_distribution_at: null, updated_at: iso }).eq("id", id);
  if (error) raise(error);
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

// Contador do menu: mensagens não lidas nas conversas do Marketplace que a pessoa enxerga.
export async function countMarketplaceUnread(auth) {
  const scope = scopeFor(auth);
  let query = db().from(CONVERSATIONS).select("unread_count").gt("unread_count", 0).limit(500);
  if (!scope.all) query = query.in("assigned_user_id", scope.ids);
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) return 0;
    throw error;
  }
  return (data || []).reduce((sum, row) => sum + Number(row.unread_count || 0), 0);
}
