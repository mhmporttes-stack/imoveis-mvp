import "server-only";
import { findInternalTeamPhone } from "./internal-phones";
import { createHmac } from "node:crypto";
import { canonicalWhatsappPhone, phoneLookupCandidates } from "./phone-utils";
import { registerHumanContact } from "./whatsapp-human-contact";
import { markClientsInServiceOnReply, startServiceOnManualAdd } from "./whatsapp-client-status";
import { isClientReplyMessage } from "./whatsapp-client-status-core.mjs";
import { sendPushToUser } from "./push-subscriptions";
import { ensureInboundMediaStored, readStoredMedia, signedStoredMediaUrl } from "./whatsapp-media";
import { INBOUND_MEDIA_TYPES, inboundMediaInfo } from "./whatsapp-media-utils.mjs";
import { findConversationByPhone, findLatestRegistrationIdsByPhones } from "./client-phone-lookup";
import { getSupabaseAdminClient } from "./supabase";
import { CLIENT_STATUS_META, getClientFunnelStage, CLIENT_FUNNEL_STAGES, normalizeClientStatus } from "./client-status";
import { hasSimulationData } from "./simulation-registration-schema";
import { isAdminPermissionError } from "./admin-access";
import { buildBrokerSimulationLink, getAdminProfileById, isBrokerProfile, isGeneralAdminAuth, isManagerProfile, isOwnerAdminEmail, listAdminProfiles } from "./admin-profiles";
import { directSimulationLink } from "./whatsapp-flow-core.mjs";
import { createChatMediaUploadUrl, describeChatMediaPath, uploadChatMedia, CHAT_MEDIA_BUCKET } from "./media-storage";
import { ensureManualSimulationRegistration } from "./simulation-registrations";
import { sendWhatsappMessagePayload, sendWhatsappTemplateMessage, sendWhatsappTextMessage } from "./whatsapp-master";
import { getTeamPresence } from "./admin-presence";
import { latestReactionsByTarget } from "./whatsapp-reactions.mjs";
import { redundantOfficialConversationIds } from "./whatsapp-chat-redundant.mjs";
import { OFFICIAL_SESSION_KEY, allowedBrokerFilter, archivedConversationAccess, isArchivedChatViewer, buildChatScope, canAssignTo, canSeeConversation, canSeeMessage, conversationOwnerIds, conversationSessionOwner } from "./whatsapp-chat-scope.mjs";
import { REACTION_EMOJIS, canDeleteForEveryone, canEditMessage, canReplyOrReact, isRevoked, messageRefId, outboundKindForMime, replyTargetRefId } from "./whatsapp-message-actions.mjs";
import { deleteIndividualMessageForEveryone, editIndividualMessage, getIndividualSessionStatusForUser, listIndividualSessionStatuses, reactIndividualMessage, sendIndividualMessage } from "./whatsapp-individual";
import { pickSendChannel } from "./whatsapp-individual-routing.mjs";

// CHAT do WhatsApp Master — camada de conversas/mensagens em cima do webhook
// e do envio que já existem (lib/whatsapp-master.js). Nada aqui fala com a
// Graph API diretamente: envio reaproveita sendWhatsappTextMessage; entrada
// vem do MESMO webhook (processWhatsappWebhook chama projectChatFromEvents).

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MESSAGE_PAGE_SIZE = 100;
const CONVERSATION_PAGE_SIZE = 40;
const CONVERSATION_FILTERS = ["all", "unread", "open", "in_service", "finished", "awaiting", "silent"];

// "No vácuo": limites (em minutos) para sinalizar conversa parada.
//  - awaiting_us: o cliente escreveu e ninguém respondeu ainda (10 min = atenção, 30 min = atrasado);
//  - contact_silent: nós escrevemos por último e o cliente não respondeu (3h).
const WAIT_WARN_MIN = 10;
const WAIT_LATE_MIN = 30;
const SILENT_MIN = 180;
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const SCOPE_EMBED = "scope:simulation_registrations!client_id!inner(responsible_user_id)";
const CONVERSATION_STATUSES = ["open", "in_service", "finished"];

// Ordem de progresso do status de entrega — nunca deixa um "delivered"
// tardio regredir um "read" (a Meta pode entregar eventos fora de ordem).
const STATUS_RANK = { received: 0, queued: 1, sent: 2, delivered: 3, read: 4, failed: 5 };
const STATUS_TIMESTAMP_COLUMN = { sent: "sent_at", delivered: "delivered_at", read: "read_at", failed: "failed_at" };

const MEDIA_LABELS = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contacts: "Contato",
  reaction: "Reação",
  order: "Pedido",
  unsupported: "Mensagem não suportada"
};

export class WhatsappChatError extends Error {
  constructor(message, { status = 400, code = "" } = {}) {
    super(message);
    this.name = "WhatsappChatError";
    this.status = status;
    this.code = code;
  }
}

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

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

// ---------------------------------------------------------------------------
// Escopo de acesso (quem vê quais conversas)
// ---------------------------------------------------------------------------
// Regra (dono, 2026-10-02) e testes em lib/whatsapp-chat-scope.mjs:
// administrador geral vê tudo; gestor vê as próprias + as da equipe dele
// (managedUserIds, relação gerente -> corretor já existente); corretor só as
// próprias; associado as do corretor vinculado. Sem auth = nada.
// `supervisor` = papel de gestão (admin ou gestor) — usado só para AÇÕES de
// gestão (atalhos, atribuir, supervisão), nunca para ampliar visibilidade.
function chatScope(auth) {
  const profile = auth?.profile;
  const scope = buildChatScope({
    generalAdmin: Boolean(auth) && isGeneralAdminAuth(auth),
    manager: Boolean(auth) && isManagerProfile(profile),
    broker: Boolean(auth) && isBrokerProfile(profile),
    profileId: profile?.id || "",
    managedUserIds: profile?.managedUserIds || null,
    linkedBrokerId: profile?.linkedBrokerId || ""
  });
  return { ...scope, brokerIds: scope.ids };
}

// Duas consultas (o PostgREST não faz OR entre a tabela e um recurso
// embutido) + junção sem duplicar: conversas de clientes pelos quais os
// brokerIds respondem OU conversas atribuídas a eles no Chat.
async function scopedMerge(columns, build, brokerIds) {
  // Visibilidade por CONVERSA (telefone + sessão):
  //  - número oficial / sem sessão (session_key vazia): quem é atribuído OU
  //    responsável pelo cliente (regra de sempre);
  //  - WhatsApp pessoal de alguém (session_key = dono): SÓ o dono, o gestor
  //    dele e o administrador — atribuição ou "ser responsável pelo cliente"
  //    não abrem a conversa de OUTRO número.
  const sessionIds = brokerIds.filter((id) => id && id !== OFFICIAL_SESSION_KEY);
  const withSessionColumn = columns === "*" || columns.includes("session_key") ? columns : `${columns}, session_key`;
  const [byClient, byAssignee, bySession] = await Promise.all([
    build(db().from("whatsapp_conversations").select(`${withSessionColumn}, ${SCOPE_EMBED}`).is("deleted_at", null)).eq("session_key", OFFICIAL_SESSION_KEY).in("scope.responsible_user_id", brokerIds),
    build(db().from("whatsapp_conversations").select(withSessionColumn).is("deleted_at", null)).eq("session_key", OFFICIAL_SESSION_KEY).in("assigned_user_id", brokerIds),
    sessionIds.length
      ? build(db().from("whatsapp_conversations").select(withSessionColumn).is("deleted_at", null)).in("session_key", sessionIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (byClient.error) throw byClient.error;
  if (byAssignee.error) throw byAssignee.error;
  if (bySession.error) throw bySession.error;
  const merged = new Map();
  for (const row of [...(byClient.data || []), ...(byAssignee.data || []), ...(bySession.data || [])]) {
    if (!merged.has(row.id)) merged.set(row.id, row);
  }
  return [...merged.values()].sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
}

// Corretor/associado enxergam: conversas de clientes pelos quais respondem
// OU conversas atribuídas a eles no Chat (mesmo que o cliente seja de outro
// corretor). `build` aplica filtros/ordem/limite.
//
// `brokerId`: aba "Corretores" da Supervisão — admin/gestor "vendo como" um
// corretor específico (mesmo padrão de junção que o corretor usa pra ver a
// própria carteira). Admin: qualquer um; gestor: só da equipe dele (fora
// dela = lista vazia); nunca amplia o que um corretor/associado já vê.
async function runScopedQuery(auth, columns, build, { brokerId = "" } = {}) {
  const scope = chatScope(auth);
  const filterId = allowedBrokerFilter(scope, brokerId);
  if (filterId === null) return [];
  if (filterId) return scopedMerge(columns, build, [filterId]);
  if (scope.all) {
    const { data, error } = await build(db().from("whatsapp_conversations").select(columns).is("deleted_at", null));
    if (error) throw error;
    return data || [];
  }
  return scopedMerge(columns, build, scope.brokerIds);
}

async function assertConversationAccess(conversation, auth) {
  const scope = chatScope(auth);
  const sessionKey = conversation.session_key || null;
  // Conversa de um WhatsApp pessoal: só pela sessão (dono/gestor/admin).
  if (conversationSessionOwner({ session_key: sessionKey })) {
    if (!canSeeConversation(scope, { sessionKey })) throw new WhatsappChatError("Você não tem acesso a esta conversa.", { status: 403 });
    return;
  }
  if (canSeeConversation(scope, { assignedUserId: conversation.assigned_user_id })) return;
  let responsibleId = null;
  if (conversation.client_id) {
    const { data } = await db().from("simulation_registrations").select("responsible_user_id").eq("id", conversation.client_id).maybeSingle();
    responsibleId = data?.responsible_user_id || null;
  }
  if (!canSeeConversation(scope, { responsibleUserId: responsibleId })) {
    throw new WhatsappChatError("Você não tem acesso a esta conversa.", { status: 403 });
  }
}

// Filtro de mensagens do WhatsApp individual de quem está fora do escopo
// (canSeeMessage, no banco): oficial/interna/automação (sem sessão) sempre;
// sessão só se for de alguém do escopo.
function applyMessageScope(query, scope) {
  if (scope.all) return query;
  return query.or(`session_user_id.is.null,session_user_id.in.(${scope.ids.join(",")})`);
}

// Mensagem visível para quem pede (mesma regra da tela) — para quem lê
// mensagens do Chat fora deste arquivo (ex.: análise de documentos).
export function isChatMessageVisible(row, auth) {
  return canSeeMessage(chatScope(auth), row);
}

// Guia de Atendimento: mesma verificação de acesso da conversa (corretor só vê as dos SEUS clientes).
export async function getConversationForGuide(id, auth) {
  return loadConversation(id, auth);
}

export function canLoadWhatsappChat() {
  return Boolean(getSupabaseAdminClient());
}

// ---------------------------------------------------------------------------
// Telefones / clientes
// ---------------------------------------------------------------------------

// Formatos de telefone e busca de cliente/conversa: lib/phone-utils.js e
// lib/client-phone-lookup.js (estratégia central, igual para todo o WhatsApp).

// ---------------------------------------------------------------------------
// Entrada (webhook)
// ---------------------------------------------------------------------------

function inboundBody(message) {
  if (!message) return null;
  if (message.type === "text") return message.text?.body || null;
  if (message.type === "button") return message.button?.text || null;
  if (message.type === "interactive") {
    return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || null;
  }
  const media = message[message.type];
  return media?.caption || null;
}

function previewFor(type, body) {
  if (body) return String(body).replace(/\s+/g, " ").trim().slice(0, 140);
  return `[${MEDIA_LABELS[type] || "Mensagem"}]`;
}

function buildOrigin(message) {
  const referral = message?.referral;
  if (!referral || typeof referral !== "object") return null;
  // Conversa iniciada por anúncio "Click to WhatsApp": guarda o que a Meta
  // mandou (anúncio, campanha, ctwa_clid...) para as etapas futuras. Nada
  // aqui decide/dispara regra nenhuma.
  return { kind: "meta_ad", referral };
}

// Chamado por processWhatsappWebhook com os eventos já extraídos do payload
// (linhas de whatsapp_master_events) e o mapa telefone -> cliente. Idempotente:
// a mensagem é chaveada pelo ID da Meta, então reentrega de webhook nunca
// duplica mensagem nem soma não lida duas vezes.
export async function projectChatFromEvents(events, clientByPhone = new Map()) {
  const inbound = (events || []).filter((event) => event.event_type === "message" && event.direction === "inbound" && event.message_type !== "reaction" && event.message_id && event.sender_phone);
  const changedConversations = new Set();
  const repliedClientIds = new Set();
  const pushTargets = new Map(); // conversationId -> { recipientId, title, preview }

  if (inbound.length) {
    const phones = [...new Set(inbound.map((event) => event.sender_phone))];
    // Conversa existente em QUALQUER formato do número (com/sem 9, com/sem +55):
    // o mesmo contato nunca abre duas conversas só por diferença de formato.
    const candidatesByPhone = new Map(phones.map((phone) => [phone, phoneLookupCandidates(phone)]));
    const { data: existing, error: existingError } = await db()
      .from("whatsapp_conversations")
      .select("id, contact_phone, last_message_at, assigned_user_id")
      // Número OFICIAL: só a conversa SEM sessão. A conversa do mesmo cliente
      // com o WhatsApp pessoal de um corretor é outra conversa.
      .eq("session_key", OFFICIAL_SESSION_KEY)
      .in("contact_phone", [...new Set([...candidatesByPhone.values()].flat())]);
    if (existingError) throw existingError;
    const conversationByPhone = new Map();
    // Conversa criada agora mesmo (mais abaixo) ainda não tem atendente — só entra
    // no mapa quem já estava atribuído antes desta mensagem chegar.
    const assignedByConversation = new Map((existing || []).map((row) => [row.id, row.assigned_user_id || null]));
    for (const phone of phones) {
      const accepted = new Set(candidatesByPhone.get(phone));
      const rows = (existing || [])
        .filter((row) => accepted.has(row.contact_phone))
        .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
      if (rows[0]) conversationByPhone.set(phone, rows[0].id);
    }

    const missing = phones.filter((phone) => !conversationByPhone.has(phone));
    if (missing.length) {
      const { data: created, error: createError } = await db()
        .from("whatsapp_conversations")
        .upsert(missing.map((phone) => ({ contact_phone: phone, session_key: OFFICIAL_SESSION_KEY })), { onConflict: "contact_phone,session_key", ignoreDuplicates: true })
        .select("id, contact_phone");
      if (createError) throw createError;
      for (const row of created || []) conversationByPhone.set(row.contact_phone, row.id);
      // upsert ignoreDuplicates não devolve linhas criadas por outra requisição
      // concorrente — busca as que ainda faltam.
      const stillMissing = missing.filter((phone) => !conversationByPhone.has(phone));
      if (stillMissing.length) {
        const { data: refetched } = await db().from("whatsapp_conversations").select("id, contact_phone").eq("session_key", OFFICIAL_SESSION_KEY).in("contact_phone", stillMissing);
        for (const row of refetched || []) conversationByPhone.set(row.contact_phone, row.id);
      }
    }

    const messageRows = inbound.map((event) => {
      const message = event.raw_payload?.message || {};
      const type = event.message_type || message.type || "text";
      return {
        conversation_id: conversationByPhone.get(event.sender_phone),
        direction: "inbound",
        sender_type: "customer",
        meta_message_id: event.message_id,
        message_type: type,
        body: inboundBody(message) || event.message_text || null,
        payload: type === "text" ? (message.context ? { context: message.context } : {}) : message,
        status: "received",
        message_at: event.event_at || new Date().toISOString()
      };
    }).filter((row) => row.conversation_id);

    if (messageRows.length) {
      const { data: inserted, error: insertError } = await db()
        .from("whatsapp_messages")
        .upsert(messageRows, { onConflict: "meta_message_id", ignoreDuplicates: true })
        .select("conversation_id, meta_message_id, message_type, body, message_at");
      if (insertError) throw insertError;

      const newByConversation = new Map();
      for (const row of inserted || []) {
        if (!newByConversation.has(row.conversation_id)) newByConversation.set(row.conversation_id, []);
        newByConversation.get(row.conversation_id).push(row);
      }

      for (const [conversationId, rows] of newByConversation) {
        rows.sort((a, b) => new Date(a.message_at) - new Date(b.message_at));
        const last = rows[rows.length - 1];
        const phone = [...conversationByPhone].find(([, id]) => id === conversationId)?.[0];
        const sourceEvents = inbound.filter((event) => event.sender_phone === phone);
        const named = [...sourceEvents].reverse().find((event) => event.contact_name);
        const originEvent = sourceEvents.find((event) => buildOrigin(event.raw_payload?.message));
        const { error: rpcError } = await db().rpc("whatsapp_chat_apply_inbound", {
          p_conversation_id: conversationId,
          p_count: rows.length,
          p_at: last.message_at,
          p_preview: previewFor(last.message_type, last.body),
          p_name: named?.contact_name || null,
          p_client_id: clientByPhone.get(phone) || null,
          p_origin: originEvent ? buildOrigin(originEvent.raw_payload.message) : null
        });
        if (rpcError) throw rpcError;
        changedConversations.add(conversationId);
        // Cliente respondeu (mensagem de verdade, não reação): candidato a "Em atendimento".
        const repliedClientId = clientByPhone.get(phone);
        // Integrante da equipe (cliente de TESTE por formulário) escrevendo não muda o status do card.
        if (repliedClientId && rows.some((row) => isClientReplyMessage(row.message_type)) && !(await findInternalTeamPhone(phone))) repliedClientIds.add(repliedClientId);
        // Push + ícone do app (regra do dono, 2026-09-27): só para quem já atende essa
        // conversa — conversa nova sem atendente ainda (recém-criada pela roleta, por
        // exemplo) não empurra notificação a ninguém nesta primeira versão.
        const recipientId = assignedByConversation.get(conversationId);
        if (recipientId) {
          pushTargets.set(conversationId, { recipientId, title: named?.contact_name || phone, preview: previewFor(last.message_type, last.body) });
        }
      }
    }
  }

  // Reações são vinculadas à mensagem, inclusive se a Meta enviou a
  // mensagem original e a reação no mesmo lote. Não somam não lidas.
  for (const event of (events || []).filter((item) => item.event_type === "message" && item.direction === "inbound" && item.message_type === "reaction")) {
    const reaction = event.raw_payload?.message?.reaction;
    if (!reaction?.message_id || !event.message_id || !event.sender_phone) continue;
    const { data: target, error: targetError } = await db().from("whatsapp_messages")
      .select("conversation_id, whatsapp_conversations!inner(contact_phone)")
      .eq("meta_message_id", reaction.message_id).neq("message_type", "reaction").maybeSingle();
    if (targetError) throw targetError;
    if (!target || !phoneLookupCandidates(event.sender_phone).includes(target.whatsapp_conversations?.contact_phone)) continue;
    const { data: inserted, error: reactionError } = await db().from("whatsapp_messages").upsert({
      conversation_id: target.conversation_id, direction: "inbound", sender_type: "customer",
      meta_message_id: event.message_id, message_type: "reaction", body: reaction.emoji || null,
      payload: event.raw_payload.message, status: "received", message_at: event.event_at || new Date().toISOString()
    }, { onConflict: "meta_message_id", ignoreDuplicates: true }).select("id");
    if (reactionError) throw reactionError;
    if (inserted?.length) changedConversations.add(target.conversation_id);
  }

  // Ícone do app (badge) + notificação push de mensagem nova do cliente — melhor
  // esforço, nunca derruba o webhook. Um push por conversa por chamada (a Meta já
  // agrupa mensagens próximas no mesmo evento); "unreadCount" vai com o total ATUAL
  // do destinatário (mesma conta do menu), nunca incrementado às cegas.
  // Conversa que a função do banco manteve fora do Chat (cliente arquivado,
  // regra do dono 2026-10-02) não avisa ninguém.
  if (pushTargets.size) {
    const { data: hiddenRows } = await db().from("whatsapp_conversations").select("id").in("id", [...pushTargets.keys()]).not("deleted_at", "is", null);
    for (const row of hiddenRows || []) pushTargets.delete(row.id);
  }
  for (const { recipientId, title, preview } of pushTargets.values()) {
    try {
      const unreadCount = await getUnreadMessageCountForBroker(recipientId);
      await sendPushToUser(recipientId, {
        title,
        body: preview || "Nova mensagem no WhatsApp",
        url: "/admin/chat",
        tag: `whatsapp-chat:${recipientId}`,
        unreadCount
      });
    } catch (pushError) {
      console.warn("Falha ao enviar push de mensagem nova do Chat:", pushError?.message || pushError);
    }
  }

  // Regra do dono: cliente em "Tentando contato" que responde passa para "Em atendimento".
  // Melhor esforço — nunca derruba o webhook nem a projeção do Chat.
  try {
    // Número oficial: não há consumidor da Prospecção aqui (a cadência é do WhatsApp
    // individual), então a regra "resposta de cliente em prospecção -> Em atendimento"
    // vale direto neste caminho (includeProspected).
    await markClientsInServiceOnReply([...repliedClientIds], { includeProspected: true });
  } catch (statusError) {
    console.warn("Falha ao atualizar o status do cliente que respondeu:", statusError?.message || statusError);
  }

  const statusChanged = await applyOutboundStatusEvents((events || []).filter((event) => event.direction === "outbound"));
  if (changedConversations.size || statusChanged) await broadcastChatChanged();
  return { conversations: changedConversations.size, statusUpdates: statusChanged };
}

// Status de entrega (enviada/entregue/lida/falhou) das mensagens que o CRM
// enviou pelo CHAT ou pela automação. Mensagens de fora do CHAT (Disparo,
// lembretes) simplesmente não têm linha aqui e são ignoradas.
async function applyOutboundStatusEvents(statusEvents) {
  const relevant = statusEvents.filter((event) => STATUS_RANK[event.event_type] > 1 && event.message_id);
  if (!relevant.length) return 0;

  const ids = [...new Set(relevant.map((event) => event.message_id))];
  const { data: rows, error } = await db()
    .from("whatsapp_messages")
    .select("id, meta_message_id, status")
    .in("meta_message_id", ids);
  if (error) throw error;
  const byMetaId = new Map((rows || []).map((row) => [row.meta_message_id, row]));

  let updates = 0;
  for (const event of relevant) {
    const current = byMetaId.get(event.message_id);
    if (!current) continue;
    const next = event.event_type;
    if (STATUS_RANK[current.status] >= STATUS_RANK[next]) continue;
    // "Falhou" só faz sentido antes de a mensagem ser entregue/lida.
    if (next === "failed" && STATUS_RANK[current.status] >= STATUS_RANK.delivered) continue;

    const patch = { status: next, [STATUS_TIMESTAMP_COLUMN[next]]: event.event_at || new Date().toISOString() };
    if (next === "failed") {
      const info = event.raw_payload?.status?.errors?.[0];
      if (info) {
        patch.error_code = String(info.code || "");
        patch.error_message = String(info.error_data?.details || info.title || info.message || "").slice(0, 500);
      }
    }
    const { error: updateError } = await db().from("whatsapp_messages").update(patch).eq("id", current.id);
    if (!updateError) {
      current.status = next;
      updates += 1;
    }
  }
  return updates;
}

// Se o status da Meta chegou ANTES de a linha da mensagem enviada existir
// (webhook mais rápido que o INSERT), reaplica a partir do que já ficou
// gravado em whatsapp_master_events.
async function reconcileStatusFromEvents(metaMessageId) {
  const { data } = await db()
    .from("whatsapp_master_events")
    .select("message_id, event_type, event_at, raw_payload, direction")
    .eq("message_id", metaMessageId)
    .eq("direction", "outbound");
  if (data?.length) await applyOutboundStatusEvents(data);
}

// Mensagem enviada de forma automática (resposta por palavra-chave do
// Disparo etc.) — aparece no CHAT diferenciada como "automação".
export async function recordOutboundAutomationMessage({ phone, text, metaMessageId, automationId = null, metadata = {} }) {
  // metadata.buttons (Fluxos): rótulos dos botões/opções da mensagem, só para
  // exibição no Chat — nada é reenviado a partir daqui.
  const conversation = await findConversationByPhone(phone, "id");
  if (!conversation) return;

  const now = new Date().toISOString();
  const { error } = await db().from("whatsapp_messages").upsert({
    conversation_id: conversation.id,
    direction: "outbound",
    sender_type: "automation",
    automation_id: automationId,
    meta_message_id: metaMessageId,
    message_type: "text",
    body: text,
    metadata,
    status: "sent",
    sent_at: now,
    message_at: now
  }, { onConflict: "meta_message_id", ignoreDuplicates: true });
  if (error) throw error;

  await db().rpc("whatsapp_chat_apply_outbound", {
    p_conversation_id: conversation.id,
    p_at: now,
    p_preview: previewFor("text", text),
    p_mark_in_service: false
  });
  await db().from("whatsapp_conversations").update({ account_channel: "whatsapp_cloud_api", account_user_id: null }).eq("id", conversation.id);
  await reconcileStatusFromEvents(metaMessageId);
  await broadcastChatChanged();
}

// ---------------------------------------------------------------------------
// Tempo real (Supabase Realtime Broadcast)
// ---------------------------------------------------------------------------
// postgres_changes não serve aqui: o CRM autentica por cookie próprio (o
// navegador não tem sessão do Supabase) e as tabelas negam tudo ao papel
// anon. Então o servidor só manda um "ping" sem dados (Broadcast) num canal
// de nome não adivinhável, e o navegador refaz a busca pela API autenticada.
// Um polling lento continua como rede de segurança.

export function getChatRealtimeTopic() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.WHATSAPP_APP_SECRET || "";
  if (!secret) return "";
  return `wa-chat-${createHmac("sha256", secret).update("whatsapp-chat-topic").digest("hex").slice(0, 20)}`;
}

export async function broadcastChatChanged() {
  const topic = getChatRealtimeTopic();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!topic || !url || !key) return;
  try {
    await fetch(`${url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic, event: "changed", payload: { at: Date.now() }, private: false }] }),
      signal: AbortSignal.timeout(4000)
    });
  } catch {
    // Best-effort: o polling de segurança cobre uma falha pontual.
  }
}

// ---------------------------------------------------------------------------
// Leitura para a tela
// ---------------------------------------------------------------------------

function windowInfo(lastInboundAt) {
  const lastMs = lastInboundAt ? new Date(lastInboundAt).getTime() : 0;
  const expiresMs = lastMs + WINDOW_MS;
  return {
    open: Boolean(lastMs) && expiresMs > Date.now(),
    expiresAt: lastMs ? new Date(expiresMs).toISOString() : null
  };
}

function sanitizeSearch(value) {
  return String(value || "").replace(/[,()*%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

async function loadClientInfo(clientIds) {
  const ids = [...new Set((clientIds || []).filter(Boolean))];
  const info = new Map();
  if (!ids.length) return info;

  const [{ data: clients, error }, { data: origins }] = await Promise.all([
    db().from("simulation_registrations").select("id, full_name, client_code, status, responsible_user_id, phone_normalized, oldest_birth_date, primary_monthly_income, secondary_monthly_income, available_purchase_resource").in("id", ids),
    db().from("client_origins").select("client_id, source_label").in("client_id", ids)
  ]);
  if (error) throw error;

  const responsibleIds = [...new Set((clients || []).map((client) => client.responsible_user_id).filter(Boolean))];
  let responsibleNames = new Map();
  if (responsibleIds.length) {
    const { data: admins } = await db().from("admin_users").select("id, name").in("id", responsibleIds);
    responsibleNames = new Map((admins || []).map((admin) => [admin.id, admin.name || ""]));
  }
  const originByClient = new Map((origins || []).map((row) => [row.client_id, row.source_label || ""]));

  for (const client of clients || []) {
    const status = normalizeClientStatus(client.status);
    const stageKey = getClientFunnelStage(status);
    info.set(client.id, {
      id: client.id,
      name: client.full_name || "Cliente sem nome",
      code: client.client_code || "",
      phone: client.phone_normalized || "",
      status,
      statusLabel: CLIENT_STATUS_META[status]?.label || status,
      // O cliente preencheu os dados da simulação? (cadastro por WhatsApp/manual só tem valores padrão)
      simulationFilled: hasSimulationData({
        oldestBirthDate: client.oldest_birth_date,
        primaryMonthlyIncome: client.primary_monthly_income,
        secondaryMonthlyIncome: client.secondary_monthly_income,
        availablePurchaseResource: client.available_purchase_resource
      }),
      funnelStage: CLIENT_FUNNEL_STAGES.find((stage) => stage.key === stageKey)?.label || "",
      responsibleId: client.responsible_user_id || null,
      responsibleName: responsibleNames.get(client.responsible_user_id) || "",
      origin: originByClient.get(client.id) || ""
    });
  }
  return info;
}

async function loadUserNames(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await db().from("admin_users").select("id, name, photo_url").in("id", unique);
  return new Map((data || []).map((row) => [row.id, { name: row.name || "", photoUrl: row.photo_url || "" }]));
}

// Badge visual da lista de Conversas: qual conta enviou a última mensagem
// de saída (ou recebeu a primeira, se nunca houve saída — ver
// whatsapp_conversations.account_channel/account_user_id e a migration
// whatsapp_conversation_account_badge). "usersById" é o mesmo Map de
// loadUserNames, reaproveitado — não busca de novo.
function accountInfo(row, usersById) {
  if (!row.account_channel) return null;
  if (row.account_channel === "whatsapp_cloud_api") {
    return { channel: "whatsapp_cloud_api", userId: null, name: "WhatsApp Oficial", photoUrl: "" };
  }
  const user = row.account_user_id ? usersById.get(row.account_user_id) : null;
  return { channel: "whatsapp_individual", userId: row.account_user_id || null, name: user?.name || "", photoUrl: user?.photoUrl || "" };
}

// Situação da conversa quanto a resposta ("no vácuo").
function waitingInfo(row) {
  if (row.status === "finished" || !row.last_message_at) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(row.last_message_at).getTime()) / 60000));
  if (row.last_message_direction === "inbound") {
    return { kind: "awaiting_us", minutes, level: minutes >= WAIT_LATE_MIN ? "late" : minutes >= WAIT_WARN_MIN ? "warn" : "ok" };
  }
  if (row.last_message_direction === "outbound" && minutes >= SILENT_MIN) {
    return { kind: "contact_silent", minutes, level: "warn" };
  }
  return null;
}

function conversationRow(row, clientInfo, usersById = new Map()) {
  const client = row.client_id ? clientInfo.get(row.client_id) || { id: row.client_id, name: "", code: "" } : null;
  // Conversa do WhatsApp pessoal de alguém: o corretor da linha é o dono da sessão.
  const sessionOwner = conversationSessionOwner(row);
  const brokerId = sessionOwner || row.assigned_user_id || client?.responsibleId || null;
  return {
    id: row.id,
    phone: row.contact_phone,
    name: row.contact_name || "",
    photoUrl: row.profile_photo_url || "",
    status: row.status,
    unreadCount: row.unread_count || 0,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview || "",
    lastMessageDirection: row.last_message_direction || "",
    lastInboundAt: row.last_inbound_at,
    window: windowInfo(row.last_inbound_at),
    origin: row.origin || {},
    client,
    broker: brokerId ? { id: brokerId, name: usersById.get(brokerId)?.name || (brokerId === client?.responsibleId ? client?.responsibleName : "") || "", assigned: Boolean(row.assigned_user_id || sessionOwner) } : null,
    assignedUserId: row.assigned_user_id || null,
    sessionUserId: sessionOwner,
    account: accountInfo(row, usersById),
    waiting: waitingInfo(row)
  };
}

// Prévia da lista: se a ÚLTIMA mensagem da conversa veio do WhatsApp
// pessoal de alguém fora do escopo de quem olha (ex.: o dono falando com um
// corretor), a prévia vira neutra — o texto nunca aparece na lista.
async function maskForeignPreviews(rows, auth) {
  const scope = chatScope(auth);
  if (scope.all || !rows.length) return rows;
  const ids = rows.map((row) => row.id);
  const { data, error } = await db().from("whatsapp_messages")
    .select("conversation_id, message_at")
    .in("conversation_id", ids)
    .not("session_user_id", "is", null)
    .not("session_user_id", "in", `(${scope.ids.join(",")})`)
    .order("message_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const latestForeign = new Map();
  for (const row of data || []) if (!latestForeign.has(row.conversation_id)) latestForeign.set(row.conversation_id, row.message_at);
  return rows.map((row) => {
    const foreignAt = latestForeign.get(row.id);
    if (!foreignAt || new Date(foreignAt) < new Date(row.last_message_at || 0)) return row;
    return { ...row, last_message_preview: "[Mensagem]" };
  });
}

// Esconde da lista a entrada redundante do número oficial (regra em
// lib/whatsapp-chat-redundant.mjs) — só apresentação: nada é alterado nem apagado.
async function hideRedundantOfficialRows(rows, auth) {
  const official = rows.filter((row) => !row.session_key || row.session_key === OFFICIAL_SESSION_KEY);
  if (!official.length) return rows;
  const phones = [...new Set(official.map((row) => row.contact_phone).filter(Boolean))];
  if (!phones.length) return rows;
  const { data: siblings, error } = await db().from("whatsapp_conversations")
    .select("contact_phone, session_key")
    .in("contact_phone", phones)
    .neq("session_key", OFFICIAL_SESSION_KEY)
    .is("deleted_at", null);
  if (error) throw error;
  if (!siblings?.length) return rows;
  const siblingPhones = new Set(siblings.map((sibling) => sibling.contact_phone));
  const candidates = official.filter((row) => siblingPhones.has(row.contact_phone));
  const { data: usefulRows, error: usefulError } = await db().from("whatsapp_messages")
    .select("conversation_id")
    .in("conversation_id", candidates.map((row) => row.id))
    .or("direction.neq.outbound,status.is.null,status.neq.failed")
    .limit(5000);
  if (usefulError) throw usefulError;
  const hidden = redundantOfficialConversationIds({
    rows: candidates,
    personalSiblings: siblings,
    usefulConversationIds: new Set((usefulRows || []).map((row) => row.conversation_id)),
    scope: chatScope(auth)
  });
  return hidden.size ? rows.filter((row) => !hidden.has(row.id)) : rows;
}

async function buildConversationRows(rows) {
  await linkMissingClients(rows);
  const clientInfo = await loadClientInfo(rows.map((row) => row.client_id));
  const responsibleIds = [...clientInfo.values()].map((client) => client.responsibleId);
  const usersById = await loadUserNames([...rows.map((row) => row.assigned_user_id), ...rows.map((row) => row.account_user_id), ...rows.map((row) => conversationSessionOwner(row)), ...responsibleIds]);
  return rows.map((row) => {
    const { scope, ...clean } = row;
    return conversationRow(clean, clientInfo, usersById);
  });
}

// Conversas sem cliente vinculado tentam de novo a busca por telefone: um
// cliente cadastrado DEPOIS da primeira mensagem passa a aparecer vinculado.
async function linkMissingClients(rows) {
  const unlinked = rows.filter((row) => !row.client_id);
  if (!unlinked.length) return;
  const matches = await findLatestRegistrationIdsByPhones(unlinked.map((row) => row.contact_phone));
  // Em paralelo em vez de sequencial — achado de performance, pente-fino
  // 2026-09-30: depois de uma importação ou uma leva de contatos orgânicos
  // do WhatsApp, dezenas de conversas sem client_id podiam se resolver na
  // mesma requisição, cada uma esperando seu próprio round-trip antes da
  // lista renderizar.
  await Promise.all(unlinked.map((row) => {
    const clientId = matches.get(row.contact_phone);
    if (!clientId) return null;
    row.client_id = clientId;
    return db().from("whatsapp_conversations").update({ client_id: clientId }).eq("id", row.id).is("client_id", null);
  }));
}

export async function listChatConversations({ filter = "all", query = "", before = "", limit = CONVERSATION_PAGE_SIZE, brokerId = "" } = {}, auth) {
  const safeFilter = CONVERSATION_FILTERS.includes(filter) ? filter : "all";
  const pageSize = Math.min(Math.max(Number(limit) || CONVERSATION_PAGE_SIZE, 1), 100);
  const term = sanitizeSearch(query);

  const rows = await runScopedQuery(auth, "*", (base) => {
    let request = base
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(pageSize);
    if (safeFilter === "unread") request = request.gt("unread_count", 0);
    else if (safeFilter === "awaiting") request = request.eq("last_message_direction", "inbound").neq("status", "finished");
    else if (safeFilter === "silent") {
      request = request
        .eq("last_message_direction", "outbound")
        .neq("status", "finished")
        .lt("last_message_at", new Date(Date.now() - SILENT_MIN * 60000).toISOString());
    } else if (safeFilter !== "all") request = request.eq("status", safeFilter);
    if (before) request = request.lt("last_message_at", before);
    if (term) {
      const digits = term.replace(/\D/g, "");
      const filters = [`contact_name.ilike.%${term}%`];
      if (digits) filters.push(`contact_phone.ilike.%${digits}%`);
      request = request.or(filters.join(","));
    }
    return request;
  }, { brokerId: isGeneralAdminAuth(auth) || isManagerProfile(auth?.profile) ? brokerId : "" });
  return buildConversationRows(await maskForeignPreviews(await hideRedundantOfficialRows(rows.slice(0, pageSize), auth), auth));
}

// Mesma conta de "não lidas" de getChatSummary (conversa atribuída a ele OU de
// cliente por quem ele responde), só que para UM corretor direto por id — sem
// precisar montar um `auth` inteiro. Usado para o número do push/ícone do app,
// tanto pelo canal oficial (este arquivo) quanto pelo individual (exportada
// para lib/whatsapp-individual-inbound.js).
export async function getUnreadMessageCountForBroker(brokerId) {
  if (!brokerId) return 0;
  // Mesma visibilidade da lista: oficial por atribuição/cliente + as
  // conversas do WhatsApp PESSOAL dele. Não lida de outro número nunca soma.
  const [byAssignee, byClient, bySession] = await Promise.all([
    db().from("whatsapp_conversations").select("id, unread_count").is("deleted_at", null).eq("session_key", OFFICIAL_SESSION_KEY).eq("assigned_user_id", brokerId).gt("unread_count", 0),
    db().from("whatsapp_conversations").select(`id, unread_count, ${SCOPE_EMBED}`).is("deleted_at", null).eq("session_key", OFFICIAL_SESSION_KEY).gt("unread_count", 0).in("scope.responsible_user_id", [brokerId]),
    db().from("whatsapp_conversations").select("id, unread_count").is("deleted_at", null).eq("session_key", brokerId).gt("unread_count", 0)
  ]);
  if (byAssignee.error) throw byAssignee.error;
  if (byClient.error) throw byClient.error;
  if (bySession.error) throw bySession.error;
  const merged = new Map();
  for (const row of [...(byAssignee.data || []), ...(byClient.data || []), ...(bySession.data || [])]) merged.set(row.id, row.unread_count || 0);
  let total = 0;
  for (const value of merged.values()) total += value;
  return total;
}

export async function getChatSummary(auth) {
  const rows = await runScopedQuery(auth, "id, unread_count, status, last_message_direction, last_message_at", (base) =>
    base.or("unread_count.gt.0,last_message_direction.eq.inbound")
  );
  const unread = rows.filter((row) => (row.unread_count || 0) > 0);
  const waiting = rows.filter((row) => waitingInfo(row)?.kind === "awaiting_us");
  return {
    unreadConversations: unread.length,
    unreadMessages: unread.reduce((sum, row) => sum + (row.unread_count || 0), 0),
    awaitingReply: waiting.filter((row) => waitingInfo(row).level !== "ok").length,
    awaitingLate: waiting.filter((row) => waitingInfo(row).level === "late").length,
    topic: getChatRealtimeTopic()
  };
}

// Conversa de cliente ARQUIVADO (regra do dono, 2026-10-02 — WA-13): fica
// fora do Chat para todo mundo; só a conta do dono (identidade única, `isArchivedChatViewer`)
// pode ABRIR pelo card do cliente e LER as mensagens — nunca por cargo.
// Somente leitura: enviar/reagir/editar/apagar/atribuir continuam 404.
// A decisão (dono lê / demais recebem vazio) é pura e testada:
// `archivedConversationAccess` (lib/whatsapp-chat-scope.mjs). Conversa já oculta
// antes do arquivamento (sem a marca do gatilho) também conta.
async function loadConversation(id, auth, { includeDeleted = false, allowArchivedView = false } = {}) {
  const { data, error } = await db().from("whatsapp_conversations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  let archivedView = false;
  if (data?.deleted_at && !includeDeleted && allowArchivedView) {
    let clientStatus = null;
    if (!data.origin?.archived_hidden_at && data.client_id) {
      const { data: client, error: clientError } = await db().from("simulation_registrations").select("status").eq("id", data.client_id).maybeSingle();
      if (clientError) throw clientError;
      clientStatus = client?.status || null;
    }
    const access = archivedConversationAccess({ conversation: data, clientStatus, isOwner: isArchivedChatViewer(auth) });
    // Demais: o código ARCHIVED_HIDDEN faz a leitura (getChatConversation) devolver Chat vazio.
    if (access === "empty") throw new WhatsappChatError("Conversa não encontrada.", { status: 404, code: "ARCHIVED_HIDDEN" });
    archivedView = access === "read";
  }
  if (!data || (data.deleted_at && !includeDeleted && !archivedView)) throw new WhatsappChatError("Conversa não encontrada.", { status: 404 });
  await assertConversationAccess(data, auth);
  return data;
}

// Mídia mostrada no Chat. Enviada pelo CRM: URL pública guardada em metadata.media. Recebida do
// cliente (áudio): sempre pela rota autenticada do CRM (o arquivo é baixado da Meta pelo servidor,
// guardado em storage privado e servido com verificação de permissão) — nunca a URL temporária da Meta.
function buildMessageMedia(row) {
  if (isRevoked(row)) return null;
  if (row.metadata?.media?.url) return { url: row.metadata.media.url, mime: row.metadata.media.mime || "", name: row.metadata.media.name || "", gif: Boolean(row.metadata?.gif) };
  // WhatsApp individual: mídia recebida do cliente OU enviada pelo corretor no
  // app do celular — já guardada no storage privado pelo microsserviço
  // (ou com o motivo da falha). Sempre pela rota autenticada do CRM.
  if (row.channel === "whatsapp_individual" && row.metadata?.media?.status && INBOUND_MEDIA_TYPES.includes(row.message_type)) {
    const stored = row.metadata.media;
    return {
      url: `/api/admin/whatsapp-chat/media/${row.id}`,
      mime: stored.mime || "",
      name: stored.name || "",
      size: stored.size || 0,
      state: stored.status,
      inbound: true,
      gif: Boolean(row.metadata?.gif)
    };
  }
  if (row.direction === "inbound" && INBOUND_MEDIA_TYPES.includes(row.message_type)) {
    const info = inboundMediaInfo(row.payload, row.message_type);
    if (!info.id) return null;
    const stored = row.metadata?.media;
    return {
      url: `/api/admin/whatsapp-chat/media/${row.id}`,
      mime: stored?.mime || info.mime || (row.message_type === "audio" ? "audio/ogg" : ""),
      name: stored?.name || info.filename || "",
      size: stored?.size || 0,
      state: stored?.status || "pending",
      inbound: true
    };
  }
  return null;
}

function messageRow(row, auth) {
  const isAdmin = isGeneralAdminAuth(auth);
  const actor = { userId: auth?.profile?.id || "", isManager: isAdmin || isManagerProfile(auth?.profile) };
  const revoked = isRevoked(row);
  return {
    id: row.id,
    direction: row.direction,
    internal: row.direction === "internal",
    senderType: row.sender_type,
    sentByName: row.sender_type === "user" ? row.sent_by_name || "" : "",
    type: row.message_type,
    body: revoked ? "" : row.body || "",
    status: row.status,
    // Motivo técnico só para o administrador — a interface normal só mostra
    // "não enviada".
    errorCode: isAdmin ? row.error_code || "" : "",
    errorMessage: isAdmin ? row.error_message || "" : "",
    templateName: row.metadata?.template || "",
    media: buildMessageMedia(row),
    shortcut: row.metadata?.shortcut || "",
    buttons: Array.isArray(row.metadata?.buttons) ? row.metadata.buttons.slice(0, 12) : [],
    linkLabel: row.metadata?.link?.label || "",
    automationKind: row.sender_type === "automation" ? row.metadata?.kind || "" : "",
    at: row.message_at,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    metaMessageId: row.meta_message_id || "",
    // Identificador no WhatsApp em qualquer canal (Meta ou sessão individual)
    // — liga respostas citadas e reações à mensagem certa.
    refId: messageRefId(row),
    channel: row.channel || "",
    editedAt: revoked ? null : row.metadata?.edited_at || null,
    // Apagada para todos: o conteúdo some para todo mundo (como no WhatsApp);
    // só o administrador vê o texto original, para auditoria.
    revoked,
    revokedBy: revoked ? row.metadata?.revoked_by || "" : "",
    originalBody: isAdmin && (revoked || row.metadata?.edited_at) ? row.metadata?.original_body || "" : "",
    canReply: canReplyOrReact(row),
    canReact: canReplyOrReact(row),
    canEdit: canEditMessage(row, actor),
    canDelete: canDeleteForEveryone(row, actor)
  };
}

export async function getChatConversation(id, { before = "" } = {}, auth) {
  let conversation;
  try {
    conversation = await loadConversation(id, auth, { allowArchivedView: true });
  } catch (error) {
    // Cliente arquivado + quem não é o dono: visualização vazia (como se não
    // houvesse conversa) — nenhum dado do histórico, nem erro que revele algo.
    if (error?.code === "ARCHIVED_HIDDEN") return { empty: true, conversation: null, messages: [], hasMore: false };
    throw error;
  }
  const archivedReadOnly = Boolean(conversation.deleted_at);
  const [conversationView] = await buildConversationRows(await maskForeignPreviews([conversation], auth));
  const internalAllowed = await canManageConversation(conversation, auth);

  let request = db()
    .from("whatsapp_messages")
    .select("*")
    .eq("conversation_id", id)
    .neq("message_type", "reaction")
    .order("message_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  // Mensagens internas: filtradas NO BACKEND. Quem não pode nunca as recebe (nem por chamada direta).
  if (!internalAllowed) request = request.neq("direction", "internal");
  // WhatsApp pessoal de quem está fora do escopo de quem olha: oculto.
  const scope = chatScope(auth);
  request = applyMessageScope(request, scope);
  if (before) request = request.lt("message_at", before);
  const { data, error } = await request;
  if (error) throw error;

  const rows = (data || []).slice().reverse();
  const metaIds = rows.map((row) => row.meta_message_id).filter(Boolean);
  const waIds = rows.filter((row) => row.channel === "whatsapp_individual").map((row) => row.metadata?.wa_message_id).filter(Boolean);
  let reactions = [];
  if (metaIds.length || waIds.length) {
    // Busca as reações separadamente para que não consumam as 100 posições da
    // página de mensagens. Meta: payload/metadata.replyToMessageId; sessão
    // individual: metadata.reaction_target_wa_id.
    const reactionQuery = () => applyMessageScope(db().from("whatsapp_messages").select("direction, body, payload, metadata, message_at, status")
      .eq("conversation_id", id).eq("message_type", "reaction"), scope);
    const results = await Promise.all([
      metaIds.length ? reactionQuery().in("payload->reaction->>message_id", metaIds) : { data: [] },
      metaIds.length ? reactionQuery().in("metadata->>replyToMessageId", metaIds) : { data: [] },
      waIds.length ? reactionQuery().in("metadata->>reaction_target_wa_id", waIds) : { data: [] }
    ]);
    for (const result of results) if (result.error) throw result.error;
    reactions = results.flatMap((result) => result.data || [])
      .sort((a, b) => new Date(b.message_at) - new Date(a.message_at));
  }
  const refIds = rows.map((row) => messageRefId(row)).filter(Boolean);
  const reactionsByTarget = latestReactionsByTarget(reactions, refIds);
  return {
    conversation: { ...conversationView, canInternal: internalAllowed && !archivedReadOnly, archivedReadOnly },
    messages: rows.map((row) => ({
      ...messageRow(row, auth),
      reactions: ["customer", "team"].map((sender) => ({ sender, emoji: reactionsByTarget.get(`${messageRefId(row)}:${sender}`) || "" })).filter((entry) => entry.emoji),
      replyToMessageId: replyTargetRefId(row),
      // Cliente arquivado: somente leitura (sem responder/reagir/editar/apagar).
      ...(archivedReadOnly ? { canReply: false, canReact: false, canEdit: false, canDelete: false } : {})
    })),
    hasMore: (data || []).length === MESSAGE_PAGE_SIZE
  };
}

// "Lida pelo usuário do CRM" — separado do status de leitura da Meta.
//
// Administrador/gestor abrindo a conversa para SUPERVISIONAR (ela não é dele) não a marca como lida:
// quem responde por ela é o corretor atribuído, e a conversa continua "não lida" até ele abrir.
// Conversa do próprio administrador (atribuída a ele) é lida normalmente.
export async function markChatConversationRead(id, auth) {
  const conversation = await loadConversation(id, auth, { allowArchivedView: true });
  if (conversation.deleted_at) return { marked: false };
  const readOwner = conversationSessionOwner(conversation);
  const mine = readOwner ? readOwner === (auth?.profile?.id || null) : conversation.assigned_user_id === (auth?.profile?.id || null);
  if (chatScope(auth).supervisor && !mine) {
    return { marked: false };
  }
  const { error } = await db()
    .from("whatsapp_conversations")
    .update({ unread_count: 0, last_read_at: new Date().toISOString(), last_read_by: auth?.profile?.id || null })
    .eq("id", id)
    .gt("unread_count", 0);
  if (error) throw error;
  await broadcastChatChanged();
  return { marked: true };
}

export async function updateChatConversationStatus(id, status, auth) {
  if (!CONVERSATION_STATUSES.includes(status)) throw new WhatsappChatError("Status inválido.");
  const statusConversation = await loadConversation(id, auth);
  const statusSessionOwner = conversationSessionOwner(statusConversation);
  const patch = { status, updated_at: new Date().toISOString() };
  if (status === "in_service" && auth?.profile?.id && (!statusSessionOwner || statusSessionOwner === auth.profile.id)) {
    patch.assigned_user_id = auth.profile.id;
    patch.assumed_at = new Date().toISOString();
    patch.assumed_by = auth.profile.id;
  }
  const { error } = await db().from("whatsapp_conversations").update(patch).eq("id", id);
  if (error) throw error;
  await broadcastChatChanged();
}

// ---------------------------------------------------------------------------
// Mídia recebida (áudio do cliente)
// ---------------------------------------------------------------------------

// Mídia recebida (áudio, imagem, documento, vídeo, figurinha), com a MESMA verificação de acesso da
// conversa (o corretor só vê o que pode ver). Se ainda não foi guardada (ou o download anterior falhou),
// baixa da Meta agora. Áudio volta como bytes (o player usa Range); as demais voltam como um endereço
// temporário do storage privado (abrir ou baixar com o nome original).
export async function resolveChatMedia(messageId, auth, { retry = false, download = false } = {}) {
  const { data: row, error } = await db().from("whatsapp_messages").select("*").eq("id", messageId).maybeSingle();
  if (error) throw error;
  const individualStored = row?.channel === "whatsapp_individual" && row?.metadata?.media?.path;
  if (!row || (row.direction !== "inbound" && !individualStored) || !INBOUND_MEDIA_TYPES.includes(row.message_type) || isRevoked(row)) throw new WhatsappChatError("Arquivo não encontrado.", { status: 404 });
  await loadConversation(row.conversation_id, auth, { allowArchivedView: true });
  if (!canSeeMessage(chatScope(auth), row)) throw new WhatsappChatError("Arquivo não encontrado.", { status: 404 });

  const media = await ensureInboundMediaStored(row, { force: retry });
  if (media.status !== "stored") {
    throw new WhatsappChatError("Não foi possível carregar este arquivo.", { status: 502, code: "MEDIA_UNAVAILABLE" });
  }
  if (row.message_type === "audio") return { kind: "bytes", ...(await readStoredMedia(media)) };
  return { kind: "redirect", url: await signedStoredMediaUrl(media, { download }) };
}

// Compatibilidade: só áudio (bytes).
export async function getChatMessageMedia(messageId, auth, { retry = false } = {}) {
  const result = await resolveChatMedia(messageId, auth, { retry });
  if (result.kind !== "bytes") throw new WhatsappChatError("Áudio não encontrado.", { status: 404 });
  return result;
}

// Tenta recuperar mídias recebidas que ainda aparecem só como placeholder (a Meta guarda a mídia por
// alguns dias). Só gestão/admin. Se a Meta não tem mais, o motivo fica registrado na mensagem.
export async function recoverInboundMedia(auth, { limit = 25 } = {}) {
  if (!chatScope(auth).supervisor) throw new WhatsappChatError("Apenas gestor ou administrador.", { status: 403 });
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await db()
    .from("whatsapp_messages")
    .select("*")
    .eq("direction", "inbound")
    .in("message_type", INBOUND_MEDIA_TYPES)
    .gte("message_at", since)
    .order("message_at", { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 25, 1), 100));
  if (error) throw error;

  const result = { checked: 0, stored: 0, alreadyStored: 0, failed: [] };
  for (const row of rows || []) {
    result.checked += 1;
    if (row.metadata?.media?.status === "stored") { result.alreadyStored += 1; continue; }
    const media = await ensureInboundMediaStored(row, { force: true });
    if (media.status === "stored") result.stored += 1;
    else result.failed.push({ messageId: row.id, error: media.error || "" });
  }
  await broadcastChatChanged();
  return result;
}

export const recoverInboundAudios = recoverInboundMedia;

// ---------------------------------------------------------------------------
// Mensagens INTERNAS e exclusão de conversa
// ---------------------------------------------------------------------------

// Quem pode LER e ESCREVER mensagens internas e excluir a conversa: administrador, gestor(a) e o
// corretor responsável pelo cliente ou atendente da conversa. Decidido AQUI, no backend — a tela
// só reflete (canInternal). Se o cliente for transferido, o novo responsável passa a enxergar o
// histórico interno (a permissão é sobre o responsável ATUAL).
async function canManageConversation(conversation, auth) {
  const profile = auth?.profile;
  if (isGeneralAdminAuth(auth) || isManagerProfile(profile)) return true;
  const self = profile?.id || null;
  if (!self) return false;
  if (conversation.assigned_user_id === self) return true;
  if (conversation.client_id) {
    const { data } = await db().from("simulation_registrations").select("responsible_user_id").eq("id", conversation.client_id).maybeSingle();
    if (data?.responsible_user_id === self) return true;
  }
  return false;
}

async function recordConversationAudit(conversation, action, auth, detail = {}) {
  try {
    await db().from("whatsapp_conversation_audit").insert({
      conversation_id: conversation.id,
      client_id: conversation.client_id || null,
      contact_phone: conversation.contact_phone || null,
      action,
      actor_user_id: auth?.profile?.id || null,
      actor_name: auth?.profile?.name || auth?.user?.email || null,
      detail
    });
  } catch (error) {
    console.warn("Falha ao gravar a auditoria da conversa do Chat:", error?.message || error);
  }
}

// Mensagem interna: existe SÓ no CRM. Não chama a Meta, não usa nem renova a janela de 24h, não
// altera status/atendente/última mensagem da conversa, não conta como resposta ao cliente e não
// dispara automação. Pode ser escrita mesmo com a janela de 24h fechada.
export async function sendChatInternalMessage(id, text, auth) {
  const body = String(text || "").trim();
  if (!body) throw new WhatsappChatError("Digite a mensagem interna.");
  if (body.length > 4096) throw new WhatsappChatError("A mensagem passa do limite de 4096 caracteres.");

  const conversation = await loadConversation(id, auth);
  if (!(await canManageConversation(conversation, auth))) {
    throw new WhatsappChatError("Só o corretor responsável, a gestão e o administrador usam mensagens internas desta conversa.", { status: 403 });
  }

  const now = new Date().toISOString();
  const { data: inserted, error } = await db()
    .from("whatsapp_messages")
    .insert({
      conversation_id: id,
      direction: "internal",
      sender_type: "user",
      sender_user_id: auth?.profile?.id || null,
      sent_by_name: auth?.profile?.name || auth?.user?.email || "Equipe",
      message_type: "internal",
      body,
      status: "sent",
      message_at: now,
      metadata: { internal: true }
    })
    .select("*")
    .single();
  if (error) throw error;

  await notifyInternalMessage(conversation, auth);
  await broadcastChatChanged();
  return messageRow(inserted, auth);
}

// Avisa os DEMAIS autorizados (responsável do cliente, atendente da conversa, gestão e administrador)
// pelas notificações internas do CRM (crm_notifications + push do app). NUNCA WhatsApp.
async function notifyInternalMessage(conversation, auth) {
  try {
    const authorId = auth?.profile?.id || null;
    const authorName = auth?.profile?.name || auth?.user?.email || "Alguém";
    let client = null;
    if (conversation.client_id) {
      const { data } = await db().from("simulation_registrations").select("full_name, responsible_user_id").eq("id", conversation.client_id).maybeSingle();
      client = data || null;
    }
    const owners = [client?.responsible_user_id, conversation.assigned_user_id].filter(Boolean);
    const recipients = new Set(owners);
    // Administradores: todos. Gestores: só quem enxerga esta conversa (a
    // conversa é da equipe dele — mesma regra de chatScope); o aviso traz o
    // nome do contato, então nunca vai para gestor de outra equipe.
    const { data: staff } = await db().from("admin_users").select("id, role, manager_id, linked_broker_id, status");
    const users = staff || [];
    const managerOf = new Map(users.map((user) => [user.id, user.manager_id || null]));
    const roleOf = new Map(users.map((user) => [user.id, user.role]));
    const linkedOf = new Map(users.map((user) => [user.id, user.linked_broker_id || null]));
    // Gestor de um integrante: o manager_id dele, ou do corretor ao qual o associado está vinculado.
    const managerOfMember = (userId) => managerOf.get(userId) || (roleOf.get(userId) === "associate" ? managerOf.get(linkedOf.get(userId)) || null : null);
    for (const user of users) {
      if (user.status !== "active") continue;
      if (user.role === "admin") recipients.add(user.id);
      else if (user.role === "manager" && owners.some((ownerId) => ownerId === user.id || managerOfMember(ownerId) === user.id)) recipients.add(user.id);
    }
    if (authorId) recipients.delete(authorId);
    if (!recipients.size) return;

    const contact = client?.full_name || conversation.contact_name || conversation.contact_phone || "contato";
    const title = "Mensagem interna no Chat";
    const description = `${authorName} adicionou uma mensagem interna na conversa de ${contact}.`;
    const now = new Date().toISOString();
    const { error } = await db().from("crm_notifications").insert([...recipients].map((recipientId) => ({
      recipient_user_id: recipientId,
      client_id: conversation.client_id || null,
      title,
      description,
      notification_type: "chat_internal",
      scheduled_at: now
    })));
    if (error) throw error;
    const url = conversation.client_id ? `/admin/chat?client=${encodeURIComponent(conversation.client_id)}` : "/admin/chat";
    for (const recipientId of recipients) await sendPushToUser(recipientId, { title, body: description, url });
  } catch (error) {
    console.warn("Falha ao notificar a mensagem interna:", error?.message || error);
  }
}

// "Excluir conversa" = tirar da caixa do Chat (soft delete). NÃO exclui o cliente, histórico, funil,
// atividades, documentos, simulações, vendas nem o responsável, e não tenta apagar nada na Meta.
// Registra quem excluiu. Mensagem nova do cliente traz a conversa de volta.
export async function deleteChatConversation(id, auth) {
  const conversation = await loadConversation(id, auth);
  if (!(await canManageConversation(conversation, auth))) {
    throw new WhatsappChatError("Só o corretor responsável, a gestão e o administrador podem excluir esta conversa.", { status: 403 });
  }
  const now = new Date().toISOString();
  const { data: updated, error } = await db()
    .from("whatsapp_conversations")
    .update({ deleted_at: now, deleted_by: auth?.profile?.id || null, unread_count: 0, updated_at: now })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) throw new WhatsappChatError("Conversa não encontrada.", { status: 404 });

  await recordConversationAudit(conversation, "deleted", auth, { status: conversation.status, assignedUserId: conversation.assigned_user_id || null });
  try {
    const { endLiveFlowSession } = await import("./whatsapp-flows");
    await endLiveFlowSession(conversation.contact_phone, "conversa_excluida");
  } catch (flowError) {
    console.warn("Falha ao encerrar o fluxo automático da conversa excluída:", flowError?.message || flowError);
  }
  await broadcastChatChanged();
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

// Por QUAL WhatsApp esta conversa responde — decidido AQUI, no backend:
//  - conversa de um WhatsApp pessoal (session_key = dono): SEMPRE pela sessão
//    desse dono (nunca pelo atribuído, nunca pelo oficial); desconectada =
//    bloqueia com erro claro, a mensagem digitada não se perde;
//  - conversa do número oficial: como sempre — se o atribuído tem sessão
//    pessoal conectada, a resposta sai por ela e a conversa passa a ser a do
//    WhatsApp pessoal dele (adoção, mesmo histórico); sem sessão = oficial.
async function resolveSendRoute(conversation) {
  const owner = conversationSessionOwner(conversation);
  if (owner) {
    const status = await getIndividualSessionStatusForUser(owner);
    return { sendChannel: status === "connected" ? "individual" : "blocked", sessionUserId: owner };
  }
  const assignedUserId = conversation.assigned_user_id || null;
  const individualSessionStatus = assignedUserId ? await getIndividualSessionStatusForUser(assignedUserId) : null;
  const sendChannel = pickSendChannel({ assignedUserId, individualSessionStatus });
  if (sendChannel !== "individual") return { sendChannel, sessionUserId: null };
  const { error } = await db()
    .from("whatsapp_conversations")
    .update({ session_key: assignedUserId, updated_at: new Date().toISOString() })
    .eq("id", conversation.id)
    .eq("session_key", OFFICIAL_SESSION_KEY);
  if (error) {
    if (error.code === "23505") {
      throw new WhatsappChatError("Este cliente já tem uma conversa no WhatsApp de quem atende. Abra a conversa do WhatsApp dele na lista para responder.", { status: 409, code: "USE_SESSION_CONVERSATION" });
    }
    throw error;
  }
  conversation.session_key = assignedUserId;
  return { sendChannel: "individual", sessionUserId: assignedUserId };
}

export async function sendChatMessage(id, text, auth, replyToMessageId = "") {
  const body = String(text || "").trim();
  if (!body) throw new WhatsappChatError("Digite uma mensagem.");
  if (body.length > 4096) throw new WhatsappChatError("A mensagem passa do limite de 4096 caracteres.");
  if (replyToMessageId && (typeof replyToMessageId !== "string" || !/^[0-9a-f-]{36}$/i.test(replyToMessageId))) {
    throw new WhatsappChatError("Mensagem original inválida.");
  }

  const conversation = await loadConversation(id, auth);
  let replyTo = "";
  let replyTarget = null;
  if (replyToMessageId) {
    replyTarget = await loadActionTarget(id, replyToMessageId, auth);
    if (!replyTarget || !canReplyOrReact(replyTarget)) throw new WhatsappChatError("Mensagem original indisponível para resposta.");
    replyTo = messageRefId(replyTarget);
  }
  // A janela de 24h (regra da Meta pro número oficial) deixou de bloquear o
  // envio aqui: o canal individual (WhatsApp Web) não tem esse limite, e o
  // número oficial está banido de qualquer forma — não faz mais sentido
  // forçar template. Se o envio realmente for pelo número oficial e a Meta
  // recusar, o erro aparece normalmente (catch mais abaixo).

  // WhatsApp INDIVIDUAL (número oficial banido pela Meta em 28/09/2026):
  // decide AQUI, no backend, se esta mensagem sai pela sessão pessoal do
  // responsável pela conversa ou pelo número oficial (comportamento de
  // sempre) — nunca confia em estado que o frontend mandou. Se o responsável
  // já configurou sessão individual mas ela não está conectada, bloqueia com
  // um erro claro em vez de tentar o número oficial banido silenciosamente
  // (o texto digitado continua no campo: nada foi enviado nem perdido).
  // "assignedUserId" abaixo = dono da sessão que envia (null no número oficial).
  const { sendChannel, sessionUserId: assignedUserId } = await resolveSendRoute(conversation);
  if (sendChannel === "blocked") {
    throw new WhatsappChatError("WhatsApp desconectado. Reconecte para enviar esta mensagem.", { status: 409, code: "INDIVIDUAL_DISCONNECTED" });
  }
  if (replyTarget) assertTargetOnSameNumber(replyTarget, sendChannel, assignedUserId);

  // Quando uma pessoa responde, o fluxo automático que estava conversando com
  // este cliente para (o atendimento passou para um humano).
  try {
    const { endLiveFlowSession } = await import("./whatsapp-flows");
    await endLiveFlowSession(conversation.contact_phone, "atendente_assumiu");
  } catch (flowError) {
    console.warn("Falha ao encerrar o fluxo automático:", flowError?.message || flowError);
  }

  const senderName = auth?.profile?.name || auth?.user?.email || "Equipe";
  const senderUserId = auth?.profile?.id || null;
  const now = new Date().toISOString();
  const base = {
    conversation_id: id,
    direction: "outbound",
    sender_type: "user",
    sender_user_id: senderUserId,
    sent_by_name: senderName,
    message_type: "text",
    body,
    channel: sendChannel === "individual" ? "whatsapp_individual" : "whatsapp_cloud_api",
    session_user_id: sendChannel === "individual" ? assignedUserId : null,
    metadata: replyTo ? { replyToMessageId: replyTo } : {},
    message_at: now
  };

  let sent;
  try {
    sent = sendChannel === "individual"
      ? await sendIndividualMessage(assignedUserId, { to: conversation.contact_phone, text: body, quoted: replyTarget ? { id: replyTo, fromMe: replyTarget.direction === "outbound", text: replyTarget.body || "" } : undefined })
      : await sendWhatsappTextMessage({ to: conversation.contact_phone, text: body, allowRawRecipient: true, replyToMessageId: replyTo });
    if (!sent?.messageId) throw new Error("O envio não retornou o ID da mensagem.");
  } catch (error) {
    // Falha registrada para auditoria (quem tentou, o quê, e o motivo).
    await db().from("whatsapp_messages").insert({
      ...base,
      status: "failed",
      failed_at: now,
      error_message: String(error?.message || "Falha ao enviar").slice(0, 500)
    });
    await broadcastChatChanged();
    throw new WhatsappChatError(error?.message || "Não foi possível enviar a mensagem.", { status: 502, code: "SEND_FAILED" });
  }

  // Canal individual (Baileys) não tem meta_message_id da Meta — o ID vai em
  // metadata.wa_message_id (mesmo campo que o dedupe/idempotência usa; ver
  // índice único parcial da migration whatsapp_individual_sessions) e a linha
  // é sempre um INSERT novo (não há reenvio de webhook a reconciliar aqui,
  // diferente do canal oficial).
  let inserted, insertError;
  if (sendChannel === "individual") {
    ({ data: inserted, error: insertError } = await db()
      .from("whatsapp_messages")
      .insert({ ...base, status: "sent", sent_at: now, metadata: { ...base.metadata, wa_message_id: sent.messageId, ...(sent.remoteJid ? { remote_jid: sent.remoteJid } : {}) } })
      .select("*")
      .single());
  } else {
    ({ data: inserted, error: insertError } = await db()
      .from("whatsapp_messages")
      .upsert({ ...base, meta_message_id: sent.messageId, status: "sent", sent_at: now }, { onConflict: "meta_message_id" })
      .select("*")
      .single());
  }
  if (insertError) throw insertError;

  await db().rpc("whatsapp_chat_apply_outbound", {
    p_conversation_id: id,
    p_at: now,
    p_preview: previewFor("text", body),
    p_mark_in_service: true
  });
  // Badge da lista de Conversas: qual conta enviou por último (nunca
  // sobrescrito por mensagem recebida depois — só por outro envio).
  await db().from("whatsapp_conversations").update({ account_channel: base.channel, account_user_id: base.session_user_id }).eq("id", id);
  await autoAssignOnReply(conversation, auth);
  await noteHumanContact(conversation, auth, { messageType: "text", at: now });
  // Status de entrega (enviada/entregue/lida) só existe para o canal oficial
  // (vem de whatsapp_master_events, alimentado pelo webhook da Meta).
  if (sendChannel !== "individual") await reconcileStatusFromEvents(sent.messageId);
  await broadcastChatChanged();

  const { data: fresh } = await db().from("whatsapp_messages").select("*").eq("id", inserted.id).maybeSingle();
  return messageRow(fresh || inserted, auth);
}

// Mensagem alvo de uma ação (responder, reagir, editar, apagar) — sempre da
// MESMA conversa.
// Mensagem-alvo de responder/reagir/editar/apagar: da MESMA conversa e
// visível para quem pede (mensagem do WhatsApp pessoal de alguém fora do
// escopo = como se não existisse).
async function loadActionTarget(conversationId, messageId, auth) {
  if (typeof messageId !== "string" || !/^[0-9a-f-]{36}$/i.test(messageId)) return null;
  const { data, error } = await db().from("whatsapp_messages").select("*")
    .eq("id", messageId).eq("conversation_id", conversationId).neq("message_type", "reaction").maybeSingle();
  if (error) throw error;
  if (!data || !canSeeMessage(chatScope(auth), data)) return null;
  return data;
}

// Citar/reagir pela sessão individual só funciona no MESMO número em que a
// mensagem está (outro corretor nunca viu essa mensagem no WhatsApp dele).
function assertTargetOnSameNumber(target, sendChannel, sessionUserId) {
  if (target.channel !== "whatsapp_individual") {
    if (sendChannel === "individual") throw new WhatsappChatError("Esta mensagem é do número oficial — não dá para citar/reagir pelo WhatsApp do corretor.");
    return;
  }
  if (sendChannel !== "individual" || (target.session_user_id && target.session_user_id !== sessionUserId)) {
    throw new WhatsappChatError("Esta mensagem está no WhatsApp de outro número — não dá para citar/reagir por aqui.", { status: 409, code: "OTHER_NUMBER" });
  }
}

export async function sendChatReaction(id, messageId, emoji, auth) {
  if (typeof messageId !== "string" || !/^[0-9a-f-]{36}$/i.test(messageId) || typeof emoji !== "string") {
    throw new WhatsappChatError("Reação inválida.");
  }
  const conversation = await loadConversation(id, auth);
  const value = emoji;
  if (value && !REACTION_EMOJIS.includes(value)) {
    throw new WhatsappChatError("Escolha uma reação válida.");
  }
  const target = await loadActionTarget(id, messageId, auth);
  if (!target || !canReplyOrReact(target)) throw new WhatsappChatError("Mensagem original indisponível para reação.");
  const now = new Date().toISOString();
  const actor = { sender_user_id: auth?.profile?.id || null, sent_by_name: auth?.profile?.name || auth?.user?.email || "Equipe" };

  // WhatsApp individual: reage pelo MESMO número em que a mensagem está.
  if (target.channel === "whatsapp_individual") {
    const { sendChannel, sessionUserId: assignedUserId } = await resolveSendRoute(conversation);
    if (sendChannel === "blocked") throw new WhatsappChatError("WhatsApp desconectado. Reconecte para reagir.", { status: 409, code: "INDIVIDUAL_DISCONNECTED" });
    assertTargetOnSameNumber(target, sendChannel, assignedUserId);
    let sent;
    try {
      sent = await reactIndividualMessage(assignedUserId, { to: conversation.contact_phone, targetId: target.metadata.wa_message_id, targetFromMe: target.direction === "outbound", emoji: value });
    } catch (error) {
      throw new WhatsappChatError(error?.message || "Não foi possível enviar a reação.", { status: 502, code: "REACTION_FAILED" });
    }
    const metadata = { reaction_target_wa_id: target.metadata.wa_message_id, ...(sent?.waMessageId ? { wa_message_id: sent.waMessageId } : {}) };
    const { error } = await db().from("whatsapp_messages").insert({
      conversation_id: id, direction: "outbound", sender_type: "user", ...actor,
      channel: "whatsapp_individual", session_user_id: assignedUserId,
      message_type: "reaction", body: value || null, metadata, status: "sent", sent_at: now, message_at: now
    });
    if (error && error.code !== "23505") throw error;
    await broadcastChatChanged();
    return { emoji: value };
  }

  if (target.direction !== "inbound" || !target.meta_message_id) throw new WhatsappChatError("Mensagem original indisponível para reação.");
  let sent;
  try {
    sent = await sendWhatsappMessagePayload({
      to: conversation.contact_phone,
      message: { type: "reaction", reaction: { message_id: target.meta_message_id, emoji: value } }
    });
  } catch (error) {
    throw new WhatsappChatError(error?.message || "Não foi possível enviar a reação.", { status: 502, code: "REACTION_FAILED" });
  }
  const { error } = await db().from("whatsapp_messages").upsert({
    conversation_id: id, direction: "outbound", sender_type: "user", ...actor,
    meta_message_id: sent.messageId, message_type: "reaction", body: value || null,
    metadata: { replyToMessageId: target.meta_message_id }, status: "sent", sent_at: now, message_at: now
  }, { onConflict: "meta_message_id", ignoreDuplicates: true });
  if (error) throw error;
  await broadcastChatChanged();
  return { emoji: value };
}

// Editar e "apagar para todos" (2026-10-02): só mensagem da EQUIPE enviada
// pelo WhatsApp individual, por quem enviou (ou admin/gestor), no prazo do
// WhatsApp, e sempre pelo MESMO número que enviou (session_user_id).
async function loadOwnSentMessage(id, messageId, auth, check) {
  const conversation = await loadConversation(id, auth);
  const target = await loadActionTarget(id, messageId, auth);
  const actor = { userId: auth?.profile?.id || "", isManager: isGeneralAdminAuth(auth) || isManagerProfile(auth?.profile) };
  if (!target || !check(target, actor)) return { conversation, target: null };
  const sessionUserId = target.session_user_id;
  const status = sessionUserId ? await getIndividualSessionStatusForUser(sessionUserId) : null;
  if (status !== "connected") throw new WhatsappChatError("O WhatsApp que enviou esta mensagem está desconectado.", { status: 409, code: "INDIVIDUAL_DISCONNECTED" });
  return { conversation, target };
}

export async function editChatMessage(id, messageId, text, auth) {
  const body = String(text || "").trim();
  if (!body) throw new WhatsappChatError("Digite o novo texto.");
  if (body.length > 4096) throw new WhatsappChatError("A mensagem passa do limite de 4096 caracteres.");
  const { conversation, target } = await loadOwnSentMessage(id, messageId, auth, canEditMessage);
  if (!target) throw new WhatsappChatError("Esta mensagem não pode mais ser editada (só as suas, até 15 minutos depois do envio).", { status: 409, code: "EDIT_NOT_ALLOWED" });
  if (body === (target.body || "")) return messageRow(target, auth);
  try {
    await editIndividualMessage(target.session_user_id, { to: conversation.contact_phone, targetId: target.metadata.wa_message_id, text: body });
  } catch (error) {
    throw new WhatsappChatError(error?.message || "Não foi possível editar a mensagem.", { status: 502, code: "EDIT_FAILED" });
  }
  const now = new Date().toISOString();
  const metadata = { ...(target.metadata || {}), edited_at: now, edited_by: auth?.profile?.id || null };
  if (metadata.original_body === undefined) metadata.original_body = target.body || "";
  const { data, error } = await db().from("whatsapp_messages").update({ body, metadata }).eq("id", target.id).select("*").single();
  if (error) throw error;
  await broadcastChatChanged();
  return messageRow(data, auth);
}

export async function deleteChatMessageForEveryone(id, messageId, auth) {
  const { conversation, target } = await loadOwnSentMessage(id, messageId, auth, canDeleteForEveryone);
  if (!target) throw new WhatsappChatError("Esta mensagem não pode mais ser apagada para todos (só as suas, até 48 horas depois do envio).", { status: 409, code: "DELETE_NOT_ALLOWED" });
  try {
    await deleteIndividualMessageForEveryone(target.session_user_id, { to: conversation.contact_phone, targetId: target.metadata.wa_message_id });
  } catch (error) {
    throw new WhatsappChatError(error?.message || "Não foi possível apagar a mensagem.", { status: 502, code: "DELETE_FAILED" });
  }
  const now = new Date().toISOString();
  const metadata = { ...(target.metadata || {}), revoked_at: now, revoked_by: "team", revoked_by_user_id: auth?.profile?.id || null };
  if (metadata.original_body === undefined) metadata.original_body = target.body || "";
  const { data, error } = await db().from("whatsapp_messages").update({ body: null, metadata }).eq("id", target.id).select("*").single();
  if (error) throw error;
  await broadcastChatChanged();
  return messageRow(data, auth);
}

// ---------------------------------------------------------------------------
// Adicionar ao CRM
// ---------------------------------------------------------------------------

export async function addChatConversationToCrm(id, { name = "" } = {}, auth) {
  const conversation = await loadConversation(id, auth);
  if (conversation.client_id) throw new WhatsappChatError("Este contato já está vinculado a um cliente.", { status: 409 });

  const fullName = String(name || conversation.contact_name || "").trim();
  if (!fullName) throw new WhatsappChatError("Informe o nome do cliente para adicionar ao CRM.");

  // Mesma regra de cadastro manual do CRM (não cria duplicado: reaproveita um
  // cadastro que já bata com o telefone) — só troca a ORIGEM para WhatsApp.
  const registration = await ensureManualSimulationRegistration({
    fullName,
    phone: conversation.contact_phone,
    includeDetails: false,
    adminEmail: auth?.user?.email,
    acquisitionContext: {
      kind: "whatsapp_chat",
      label: "WhatsApp (Chat)",
      actor: auth?.user?.email || null,
      destination: "broker"
    }
  }, auth);

  const { error } = await db()
    .from("whatsapp_conversations")
    .update({ client_id: registration.id, contact_name: conversation.contact_name || fullName, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  // Quem adiciona a conversa ao CRM já está atendendo: sem formulário preenchido não fica em "Aguardando simulação".
  try {
    await startServiceOnManualAdd(registration, auth?.user?.email || "");
  } catch (statusError) {
    console.warn("Falha ao atualizar o status do cliente adicionado ao CRM:", statusError?.message || statusError);
  }
  await broadcastChatChanged();
  return { clientId: registration.id };
}

// ---------------------------------------------------------------------------
// Atendimento: assumir / atribuir, brokers, abrir conversa de um cliente
// ---------------------------------------------------------------------------

// Assumir a conversa (userId omitido = o próprio usuário), atribuir a outra
// pessoa (só gestor/admin) ou liberar (userId = null). Não muda o corretor
// responsável do CLIENTE — só quem está atendendo esta conversa no Chat.
export async function assignChatConversation(id, userId, auth) {
  const conversation = await loadConversation(id, auth);
  const self = auth?.profile?.id || null;
  const target = userId === undefined ? self : userId;
  const scope = chatScope(auth);

  if (target && target !== self && !scope.supervisor) {
    throw new WhatsappChatError("Só gestor ou administrador pode atribuir a conversa a outra pessoa.", { status: 403 });
  }
  // Gestor só atribui para alguém da equipe dele (nunca para outra equipe).
  if (target && target !== self && !canAssignTo(scope, target)) {
    throw new WhatsappChatError("Você só pode atribuir a conversa a alguém da sua equipe.", { status: 403 });
  }
  if (target === null && !scope.supervisor && conversation.assigned_user_id && conversation.assigned_user_id !== self) {
    throw new WhatsappChatError("Esta conversa está com outra pessoa.", { status: 403 });
  }
  // A conversa do WhatsApp pessoal de alguém pertence àquele número: não é
  // entregue a outra pessoa (quem recebe o cliente conversa pelo próprio
  // WhatsApp, numa conversa dele).
  const sessionOwner = conversationSessionOwner(conversation);
  if (sessionOwner && target && target !== sessionOwner) {
    throw new WhatsappChatError("Esta conversa é do WhatsApp de outro corretor e não pode ser passada para outra pessoa. Para trocar o corretor do cliente, transfira o cliente — o novo responsável conversa pelo próprio WhatsApp.", { status: 409, code: "SESSION_CONVERSATION" });
  }

  const patch = { updated_at: new Date().toISOString() };
  let transferred = false;
  if (target === null) {
    patch.assigned_user_id = null;
    patch.status = "open";
    patch.assumed_at = null;
    patch.assumed_by = null;

    // Regra do dono (2026-09-27): liberar a conversa devolve o CLIENTE para a
    // roleta por presença (mesma escolha de lead novo) — o corretor que estava
    // com ele deixa de ser responsável. Sem ninguém elegível (todos offline/
    // indisponíveis), só libera mesmo, nada muda no cliente. Melhor esforço:
    // uma falha aqui nunca impede de liberar a conversa.
    if (conversation.client_id) {
      try {
        const { data: client } = await db().from("simulation_registrations").select("id, full_name, responsible_user_id").eq("id", conversation.client_id).maybeSingle();
        if (client) {
          const { assignRoundRobinLead, recordLeadDistributionHistory } = await import("./lead-distribution");
          const picked = await assignRoundRobinLead({ excludedBrokerId: client.responsible_user_id || null });
          if (picked.brokerId) {
            const { updateSimulationRegistration } = await import("./simulation-registrations");
            // auth=null: ação do SISTEMA (roleta), não do usuário que clicou em liberar.
            await updateSimulationRegistration(conversation.client_id, { responsibleUserId: picked.brokerId }, null);
            await recordLeadDistributionHistory({
              registration: client,
              eventType: "auto_transferred",
              fromUserId: client.responsible_user_id || null,
              toUserId: picked.brokerId,
              details: { source: "whatsapp_chat_release", presenceTier: picked.tier, skipped: picked.skippedNames }
            });
            patch.assigned_user_id = picked.brokerId;
          }
        }
      } catch (rouletteError) {
        console.warn("Falha ao devolver o cliente para a roleta ao liberar a conversa:", rouletteError?.message || rouletteError);
      }
    }
  } else {
    if (!target) throw new WhatsappChatError("Usuário inválido.");
    const { data: user } = await db().from("admin_users").select("id").eq("id", target).maybeSingle();
    if (!user) throw new WhatsappChatError("Usuário não encontrado.", { status: 404 });

    // O card do cliente acompanha a conversa: atribuir a conversa a um corretor
    // transfere o cliente para ele (pelo mesmo caminho da tela de Clientes, com
    // histórico de transferência). Só admin/gestor mudam o responsável do cliente.
    if (conversation.client_id && scope.supervisor) {
      const { data: client } = await db().from("simulation_registrations").select("responsible_user_id").eq("id", conversation.client_id).maybeSingle();
      if (client && client.responsible_user_id !== target) {
        try {
          const { updateSimulationRegistration } = await import("./simulation-registrations");
          await updateSimulationRegistration(conversation.client_id, { responsibleUserId: target }, auth);
          transferred = true;
        } catch (transferError) {
          if (isAdminPermissionError(transferError)) {
            throw new WhatsappChatError(transferError.message || "Você não pode transferir este cliente para essa pessoa.", { status: 403 });
          }
          throw transferError;
        }
      }
    }
    patch.assigned_user_id = target;
    patch.status = "in_service";
    // Assumir tira o cliente da redistribuição automática (sinal próprio: não conta Meta Diária/ranking).
    patch.assumed_at = new Date().toISOString();
    patch.assumed_by = self;
  }
  const { error } = await db().from("whatsapp_conversations").update(patch).eq("id", id);
  if (error) throw error;
  await broadcastChatChanged();
  return { transferred };
}

// Quem responde assume a conversa se ninguém estiver com ela — mas só quando é
// o responsável pelo cliente (ou a conversa não tem cliente): um admin/gestor
// que só responde a um cliente de outro corretor NÃO fica com a conversa (e,
// por consequência, não leva o cliente).
// Regra do dono: uma pessoa da equipe enviou mensagem ao cliente pelo Chat -> "Em atendimento" (se ele
// estava em "Atendimento automático") ou "Tentando contato" (se estava em "Aguardando simulação").
// Melhor esforço: a mensagem já foi enviada.
// Fonte única do contato humano (P-11): registerHumanContact (lib/whatsapp-human-contact.js) marca a conversa
// e o cliente. A AUTORIA fica em quem enviou de verdade (auth.profile), nunca no responsável pelo cliente.
async function noteHumanContact(conversation, auth, { messageType = "text", at = new Date().toISOString() } = {}) {
  await registerHumanContact({
    conversation,
    actor: { userId: auth?.profile?.id || null, email: auth?.user?.email || auth?.profile?.email || "", linkedBrokerId: auth?.profile?.linkedBrokerId || null },
    at,
    message: { direction: "outbound", senderType: "user", status: "sent", messageType, metadata: {} }
  });
}

async function autoAssignOnReply(conversation, auth) {
  const self = auth?.profile?.id || null;
  if (!self || conversation.assigned_user_id) return;
  if (conversation.client_id) {
    const { data } = await db().from("simulation_registrations").select("responsible_user_id").eq("id", conversation.client_id).maybeSingle();
    const responsibleId = data?.responsible_user_id || null;
    if (responsibleId && ![self, auth?.profile?.linkedBrokerId].filter(Boolean).includes(responsibleId)) return;
  }
  await db().from("whatsapp_conversations").update({ assigned_user_id: self }).eq("id", conversation.id).is("assigned_user_id", null);
}

// Corretores/gestores ativos que podem receber uma conversa (tela de gestão).
// Presença (regra do dono, 2026-09-27): mesma janela já usada no resto do CRM
// (online = interagiu nos últimos 5 min) — melhor esforço, nunca impede a lista
// de carregar se a presença falhar.
export async function listChatBrokers(auth) {
  const scope = chatScope(auth);
  if (!scope.supervisor) throw new WhatsappChatError("Apenas gestor ou administrador.", { status: 403 });
  const profiles = await listAdminProfiles();
  // Gestor: só a própria equipe (mesma regra de atribuição, canAssignTo).
  const active = profiles.filter((profile) => profile.id && profile.status === "active" && canAssignTo(scope, profile.id));

  let presenceByUser = new Map();
  try {
    const { loadVisualPresence } = await import("./admin-presence");
    const visual = await loadVisualPresence(active.map((profile) => profile.id));
    presenceByUser = new Map([...visual].map(([id, presence]) => [id, presence.status]));
  } catch (presenceError) {
    console.warn("Falha ao carregar presença dos corretores do Chat:", presenceError?.message || presenceError);
  }

  return active
    .map((profile) => ({ id: profile.id, name: profile.name || profile.email || "Sem nome", role: profile.role, online: presenceByUser.get(profile.id) === "online" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Aba "Corretores" da Supervisão: um card por corretor da equipe (mesmo
// escopo de visibilidade de getTeamPresence — respeita gestor vs. admin),
// com o status da sessão de WhatsApp INDIVIDUAL dele (whatsapp_individual_sessions
// — conectado/desconectado de verdade via QR Code, não presença no CRM) e as
// contagens de conversas atribuídas a ele OU de clientes pelos quais é
// responsável — MESMA junção de chatScope/scopedMerge, nunca uma cópia
// divergente do "de quem é essa conversa". getTeamPresence só empresta o
// roster com escopo correto (gestor vs. admin); presença do CRM não decide
// mais esse status.
export async function getChatBrokerCards(auth) {
  if (!chatScope(auth).supervisor) throw new WhatsappChatError("Apenas gestor ou administrador.", { status: 403 });

  const presence = await getTeamPresence(auth);
  const members = [...presence.members];
  // getTeamPresence/listVisibleTeamProfiles exclui o admin geral (dono) de
  // propósito em toda tela de "equipe" — mas aqui é status de WhatsApp
  // individual, não gestão de equipe, e o dono também conecta a própria
  // sessão (pedido do dono, 2026-09-28: "meu WhatsApp conectado também
  // precisa aparecer aqui"). Só quando quem está OLHANDO é admin geral —
  // gestor continua vendo só a própria equipe, o dono não é subordinado dele.
  if (isGeneralAdminAuth(auth)) {
    const allProfiles = await listAdminProfiles();
    for (const profile of allProfiles) {
      if (!profile.id || profile.status !== "active" || !isOwnerAdminEmail(profile.email)) continue;
      if (members.some((member) => member.id === profile.id)) continue;
      members.push({ id: profile.id, name: profile.name || profile.email || "Usuário", photoUrl: profile.photoUrl || "", lastActivityAt: null });
    }
  }
  const ids = members.map((member) => member.id);
  if (!ids.length) return [];

  const columns = "id, assigned_user_id, session_key, unread_count, last_message_direction, status";
  const [byAssignee, byClient, bySession, individualStatusByUser] = await Promise.all([
    db().from("whatsapp_conversations").select(columns).is("deleted_at", null).in("assigned_user_id", ids),
    db().from("whatsapp_conversations").select(`${columns}, ${SCOPE_EMBED}`).is("deleted_at", null).in("scope.responsible_user_id", ids),
    db().from("whatsapp_conversations").select(columns).is("deleted_at", null).in("session_key", ids),
    listIndividualSessionStatuses(ids)
  ]);
  if (byAssignee.error) throw byAssignee.error;
  if (byClient.error) throw byClient.error;
  if (bySession.error) throw bySession.error;

  const conversationOwners = new Map(); // conversationId -> Set<brokerId>
  function addOwner(conversationId, brokerId) {
    if (!brokerId || !ids.includes(brokerId)) return;
    if (!conversationOwners.has(conversationId)) conversationOwners.set(conversationId, new Set());
    conversationOwners.get(conversationId).add(brokerId);
  }
  const conversationById = new Map();
  for (const row of [...(byAssignee.data || []), ...(byClient.data || []), ...(bySession.data || [])]) {
    conversationById.set(row.id, row);
    // Conversa de WhatsApp pessoal conta só para o dono da linha; a do número
    // oficial, para o atribuído e o responsável pelo cliente.
    for (const ownerId of conversationOwnerIds({ sessionKey: row.session_key, assignedUserId: row.assigned_user_id, responsibleUserId: row.scope?.responsible_user_id })) addOwner(row.id, ownerId);
  }

  const countsByBroker = new Map(ids.map((id) => [id, { unread: 0, awaiting: 0, active: 0 }]));
  for (const [conversationId, owners] of conversationOwners) {
    const row = conversationById.get(conversationId);
    for (const brokerId of owners) {
      const bucket = countsByBroker.get(brokerId);
      if (row.unread_count > 0) bucket.unread += 1;
      if (row.last_message_direction === "inbound" && row.status !== "finished") bucket.awaiting += 1;
      if (row.status === "in_service") bucket.active += 1;
    }
  }

  return members.map((member) => ({
    ...member,
    status: individualStatusByUser.get(member.id) || "disconnected",
    counts: countsByBroker.get(member.id) || { unread: 0, awaiting: 0, active: 0 }
  }));
}

// Botão "WhatsApp" dos cards de cliente: abre (ou cria) a conversa deste
// cliente no número OFICIAL. Quem clica e é responsável pelo cliente já fica
// como atendente da conversa.
// `assign: false` (botão "WhatsApp" do card, regra do dono 2026-10-02): só abre a
// conversa — nunca muda atendente/status. O padrão (true) segue valendo para
// quem chama de dentro de um fluxo de atendimento (ex.: documentos do cliente).
export async function openChatForClient(clientId, auth, { assign = true } = {}) {
  const { data: client, error } = await db()
    .from("simulation_registrations")
    .select("id, full_name, phone, phone_normalized, responsible_user_id, status")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!client) throw new WhatsappChatError("Cliente não encontrado.", { status: 404 });

  const scope = chatScope(auth);
  if (!scope.all && !scope.brokerIds.includes(client.responsible_user_id)) {
    throw new WhatsappChatError("Você não tem acesso a este cliente.", { status: 403 });
  }

  // Cliente ARQUIVADO fica fora do Chat (regra do dono, 2026-10-02): o botão
  // nunca recria, restaura nem atribui a conversa. Só o dono pode abrir a
  // conversa existente para LER (somente leitura).
  if (client.status === "archived") {
    // Demais usuários (inclusive o corretor do cliente): o Chat abre em
    // branco, como se não houvesse conversa — sem erro, sem revelar nada.
    if (!isArchivedChatViewer(auth)) return { conversationId: null };
    const { data: archivedRows, error: archivedError } = await db()
      .from("whatsapp_conversations")
      .select("id")
      .eq("client_id", client.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (archivedError) throw archivedError;
    if (!archivedRows?.[0]) return { conversationId: null };
    return { conversationId: archivedRows[0].id, archivedReadOnly: true };
  }

  const phone = canonicalWhatsappPhone(client.phone_normalized || client.phone);
  if (!phone) throw new WhatsappChatError("Este cliente não possui um WhatsApp válido.");

  // Qual conversa abrir: a do WhatsApp por onde o RESPONSÁVEL atende este
  // cliente (conversa = telefone + sessão). Nunca "a mais recente" por cliente
  // ou por telefone: ela pode ser a conversa do WhatsApp de OUTRO corretor.
  const responsibleSession = client.responsible_user_id ? await getIndividualSessionStatusForUser(client.responsible_user_id) : null;
  const sessionKey = responsibleSession ? client.responsible_user_id : OFFICIAL_SESSION_KEY;
  const CONVERSATION_COLUMNS = "id, client_id, assigned_user_id, status, deleted_at, contact_phone, session_key";

  // Conversa JÁ vinculada a este cliente NESTA sessão primeiro; depois a do
  // mesmo telefone na mesma sessão.
  const { data: linkedRows } = await db()
    .from("whatsapp_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("client_id", client.id)
    .eq("session_key", sessionKey)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  let conversation = linkedRows?.[0] || null;
  const candidates = phoneLookupCandidates(phone);
  if (!conversation) {
    const { data: existingRows } = await db()
      .from("whatsapp_conversations")
      .select(CONVERSATION_COLUMNS)
      .in("contact_phone", candidates)
      .eq("session_key", sessionKey)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1);
    conversation = existingRows?.[0] || null;
  }

  // Conversa do número oficial já atribuída a este corretor: vira a conversa
  // do WhatsApp pessoal dele (mesmo histórico), em vez de abrir uma segunda.
  if (!conversation && sessionKey !== OFFICIAL_SESSION_KEY) {
    const { data: adoptable } = await db()
      .from("whatsapp_conversations")
      .select("id")
      .in("contact_phone", candidates)
      .eq("session_key", OFFICIAL_SESSION_KEY)
      .eq("assigned_user_id", sessionKey)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (adoptable?.[0]) {
      const { data: adopted, error: adoptError } = await db()
        .from("whatsapp_conversations")
        .update({ session_key: sessionKey, updated_at: new Date().toISOString() })
        .eq("id", adoptable[0].id)
        .eq("session_key", OFFICIAL_SESSION_KEY)
        .select(CONVERSATION_COLUMNS)
        .maybeSingle();
      if (adoptError && adoptError.code !== "23505") throw adoptError;
      conversation = adopted || null;
    }
  }

  if (!conversation) {
    const { data: created, error: createError } = await db()
      .from("whatsapp_conversations")
      .insert({ contact_phone: phone, contact_name: client.full_name || null, client_id: client.id, status: "open", session_key: sessionKey })
      .select(CONVERSATION_COLUMNS)
      .single();
    if (createError) {
      // 23505 = outra requisição criou a conversa deste telefone nesta sessão no
      // mesmo instante: usa a que já existe, nunca cria (nem falha) por causa da corrida.
      if (createError.code !== "23505") throw createError;
      const { data: raced, error: racedError } = await db()
        .from("whatsapp_conversations")
        .select(CONVERSATION_COLUMNS)
        .in("contact_phone", candidates)
        .eq("session_key", sessionKey)
        .limit(1);
      if (racedError) throw racedError;
      conversation = raced?.[0] || null;
      if (!conversation) throw createError;
    } else {
      conversation = created;
    }
  } else if (!conversation.client_id) {
    await db().from("whatsapp_conversations").update({ client_id: client.id }).eq("id", conversation.id);
  }
  if (conversation?.deleted_at) {
    // Conversa excluída da caixa e o usuário abriu de propósito o atendimento deste cliente: volta (com auditoria).
    await db().from("whatsapp_conversations").update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() }).eq("id", conversation.id);
    await recordConversationAudit(conversation, "restored_by_open", auth, { reason: "botão WhatsApp do cliente" });
  }

  const self = auth?.profile?.id || null;
  const isResponsible = Boolean(self) && [self, auth?.profile?.linkedBrokerId].filter(Boolean).includes(client.responsible_user_id);
  if (assign && isResponsible && !conversation.assigned_user_id) {
    await db()
      .from("whatsapp_conversations")
      .update({ assigned_user_id: self, status: conversation.status === "finished" ? "in_service" : conversation.status === "open" ? "in_service" : conversation.status })
      .eq("id", conversation.id);
  }
  await broadcastChatChanged();
  return { conversationId: conversation.id };
}

// Canal do botão "WhatsApp" do card do cliente: o atendimento abre no Chat
// quando dá pra mandar mensagem de lá agora — dentro da janela de 24h da
// conversa (o cliente escreveu há menos de 24h, número oficial) OU o
// responsável já tem a sessão de WhatsApp individual dele CONECTADA (esse
// canal não tem limite de 24h, ver pickSendChannel em
// whatsapp-individual-routing.mjs). Só quando nenhum dos dois vale é que o
// botão abre o WhatsApp pessoal do corretor fora do CRM. Antes só olhava a
// janela de 24h — corretor com sessão individual conectada (o caso normal
// depois do número oficial banido em 28/09) continuava caindo no WhatsApp
// externo à toa, em qualquer botão que consulte esta função. Só consulta —
// não cria conversa. Mesmo escopo do openChatForClient (corretor só
// consulta os clientes dele).
export async function getClientChatWindow(clientId, auth) {
  const { data: client, error } = await db()
    .from("simulation_registrations")
    .select("id, phone, phone_normalized, responsible_user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!client) throw new WhatsappChatError("Cliente não encontrado.", { status: 404 });

  const scope = chatScope(auth);
  if (!scope.all && !scope.brokerIds.includes(client.responsible_user_id)) {
    throw new WhatsappChatError("Você não tem acesso a este cliente.", { status: 403 });
  }

  // A janela é a da conversa por onde o responsável atende (telefone + sessão).
  const responsibleSession = client.responsible_user_id ? await getIndividualSessionStatusForUser(client.responsible_user_id) : null;
  const sessionKey = responsibleSession ? client.responsible_user_id : OFFICIAL_SESSION_KEY;
  let conversation = null;
  const { data: linked, error: linkedError } = await db()
    .from("whatsapp_conversations")
    .select("id, last_inbound_at")
    .eq("client_id", client.id)
    .eq("session_key", sessionKey)
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (linkedError) throw linkedError;
  conversation = linked?.[0] || null;
  if (!conversation) {
    const phone = canonicalWhatsappPhone(client.phone_normalized || client.phone);
    if (phone) conversation = await findConversationByPhone(phone, "id, last_inbound_at", { sessionKey });
  }

  const info = windowInfo(conversation?.last_inbound_at);
  const individualConnected = responsibleSession === "connected";
  return { windowOpen: info.open || individualConnected, expiresAt: info.expiresAt };
}

// ---------------------------------------------------------------------------
// Visão geral (nome do cliente, corretor responsável e quem está no vácuo)
// ---------------------------------------------------------------------------

export async function getChatOverview({ brokerId = "", situation = "", query = "" } = {}, auth) {
  const data = await runScopedQuery(auth, "*", (base) =>
    base.order("last_message_at", { ascending: false, nullsFirst: false }).limit(500)
  );
  let rows = await buildConversationRows(await maskForeignPreviews(await hideRedundantOfficialRows(data.slice(0, 500), auth), auth));

  const term = sanitizeSearch(query).toLowerCase();
  if (term) {
    const digits = term.replace(/\D/g, "");
    rows = rows.filter((row) => {
      const haystack = `${row.client?.name || ""} ${row.name} ${row.broker?.name || ""}`.toLowerCase();
      return haystack.includes(term) || (digits && row.phone.includes(digits));
    });
  }
  if (brokerId === "none") rows = rows.filter((row) => !row.broker);
  else if (brokerId) rows = rows.filter((row) => row.broker?.id === brokerId);

  const counts = {
    total: rows.length,
    awaitingLate: rows.filter((row) => row.waiting?.kind === "awaiting_us" && row.waiting.level === "late").length,
    awaitingWarn: rows.filter((row) => row.waiting?.kind === "awaiting_us" && row.waiting.level === "warn").length,
    silent: rows.filter((row) => row.waiting?.kind === "contact_silent").length,
    noBroker: rows.filter((row) => !row.broker && row.status !== "finished").length,
    inService: rows.filter((row) => row.status === "in_service").length
  };

  if (situation === "awaiting_us") rows = rows.filter((row) => row.waiting?.kind === "awaiting_us" && row.waiting.level !== "ok");
  else if (situation === "contact_silent") rows = rows.filter((row) => row.waiting?.kind === "contact_silent");
  else if (situation === "no_broker") rows = rows.filter((row) => !row.broker && row.status !== "finished");
  else if (situation === "in_service") rows = rows.filter((row) => row.status === "in_service");
  else if (situation === "finished") rows = rows.filter((row) => row.status === "finished");

  const severity = (row) => {
    if (row.waiting?.kind === "awaiting_us" && row.waiting.level === "late") return 0;
    if (row.waiting?.kind === "awaiting_us" && row.waiting.level === "warn") return 1;
    if (row.waiting?.kind === "contact_silent") return 2;
    return 3;
  };
  rows.sort((a, b) => severity(a) - severity(b) || new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
  return { rows: rows.slice(0, 300), counts };
}

// ---------------------------------------------------------------------------
// Modelos (template) — única forma de escrever fora da janela de 24h
// ---------------------------------------------------------------------------

function templateBodyText(row) {
  const components = Array.isArray(row.components) ? row.components : [];
  return String(components.find((component) => String(component?.type).toUpperCase() === "BODY")?.text || "");
}

function templateVariableCount(text) {
  const matches = [...String(text).matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]));
  return matches.length ? Math.max(...matches) : 0;
}

// Só modelos APROVADOS e sem botão de link dinâmico (esse tipo precisa de
// parâmetro de campanha e continua exclusivo do Disparo).
export async function listChatTemplates() {
  const { data, error } = await db()
    .from("whatsapp_templates")
    .select("id, name, language, category, status, components, button_text")
    .eq("status", "APPROVED")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || [])
    .filter((row) => !row.button_text)
    .map((row) => {
      const body = templateBodyText(row);
      return { id: row.id, name: row.name, category: row.category, body, variableCount: templateVariableCount(body) };
    });
}

export async function sendChatTemplate(id, { templateId, params = [] } = {}, auth) {
  const conversation = await loadConversation(id, auth);
  const { data: template, error } = await db()
    .from("whatsapp_templates")
    .select("id, name, language, status, components, button_text")
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw error;
  if (!template || template.status !== "APPROVED" || template.button_text) {
    throw new WhatsappChatError("Modelo indisponível. Escolha um modelo aprovado.", { status: 400 });
  }

  const body = templateBodyText(template);
  const count = templateVariableCount(body);
  const values = Array.from({ length: count }, (_, index) => String(params[index] ?? "").replace(/\s+/g, " ").trim().slice(0, 300));
  if (values.some((value) => !value)) throw new WhatsappChatError("Preencha todas as variáveis do modelo.");
  const rendered = body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, number) => values[Number(number) - 1] ?? "");

  const senderName = auth?.profile?.name || auth?.user?.email || "Equipe";
  const senderUserId = auth?.profile?.id || null;
  const now = new Date().toISOString();
  const base = {
    conversation_id: id,
    direction: "outbound",
    sender_type: "user",
    sender_user_id: senderUserId,
    sent_by_name: senderName,
    message_type: "template",
    body: rendered,
    metadata: { template: template.name },
    message_at: now
  };

  let sent;
  try {
    sent = await sendWhatsappTemplateMessage({ to: conversation.contact_phone, templateName: template.name, languageCode: template.language || "pt_BR", bodyParameters: values });
  } catch (sendError) {
    await db().from("whatsapp_messages").insert({ ...base, status: "failed", failed_at: now, error_message: String(sendError?.message || "Falha ao enviar").slice(0, 500) });
    await broadcastChatChanged();
    throw new WhatsappChatError(sendError?.message || "Não foi possível enviar o modelo.", { status: 502, code: "SEND_FAILED" });
  }

  const { data: inserted, error: insertError } = await db()
    .from("whatsapp_messages")
    .upsert({ ...base, meta_message_id: sent.messageId, status: "sent", sent_at: now }, { onConflict: "meta_message_id" })
    .select("*")
    .single();
  if (insertError) throw insertError;

  await db().rpc("whatsapp_chat_apply_outbound", { p_conversation_id: id, p_at: now, p_preview: previewFor("text", rendered), p_mark_in_service: true });
  await db().from("whatsapp_conversations").update({ account_channel: "whatsapp_cloud_api", account_user_id: null }).eq("id", id);
  await autoAssignOnReply(conversation, auth);
  await noteHumanContact(conversation, auth, { messageType: "template", at: now });
  await reconcileStatusFromEvents(sent.messageId);
  await broadcastChatChanged();
  return messageRow(inserted, auth);
}

// ---------------------------------------------------------------------------
// Mídia e atalhos (imagem, áudio, documento, textos prontos, link do corretor)
// ---------------------------------------------------------------------------

const MEDIA_MAX_BYTES = 4 * 1024 * 1024; // limite de corpo da Vercel (~4,5 MB)
const AUDIO_TYPES = ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr"];
const IMAGE_TYPES = ["image/jpeg", "image/png"]; // atalhos (imagem fixa)
const DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain"
];

function cleanMime(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

// Envia uma mensagem escrita por uma PESSOA (texto/mídia/atalho): confere a
// janela de 24h, envia pela Meta, registra (inclusive falha, para auditoria) e
// atualiza a conversa.
async function deliverChatMessage(conversation, { message, type = "text", body = "", metadata = {}, mediaKind = "" }, auth) {
  const senderName = auth?.profile?.name || auth?.user?.email || "Equipe";
  const senderUserId = auth?.profile?.id || null;
  const now = new Date().toISOString();

  // Mesma decisão de canal do sendChatMessage (texto normal): atalhos e
  // modelos internos também precisam sair pela sessão individual quando é
  // ela quem atende — antes SEMPRE iam pelo número oficial banido.
  const { sendChannel, sessionUserId: assignedUserId } = await resolveSendRoute(conversation);
  if (sendChannel === "blocked") {
    throw new WhatsappChatError("WhatsApp desconectado. Reconecte para enviar esta mensagem.", { status: 409, code: "INDIVIDUAL_DISCONNECTED" });
  }
  // Foto/documento/áudio saem pela sessão individual via a MESMA URL pública
  // já usada pelo número oficial (o Baileys baixa e envia sozinho). Só o
  // botão interativo com link (Meta-specific) não existe no WhatsApp Web —
  // vira texto simples com o link escrito no corpo.
  const individualMedia = sendChannel === "individual" && metadata?.media?.url
    ? { kind: mediaKind || type, url: metadata.media.url, mimeType: metadata.media.mime, fileName: metadata.media.name }
    : null;
  if (sendChannel === "individual" && type !== "text" && !individualMedia) {
    throw new WhatsappChatError(
      "Esse tipo de mensagem ainda não sai pela sessão individual. Escreva a mensagem no campo normal, ou peça para reconectar o número oficial.",
      { status: 409, code: "INDIVIDUAL_MEDIA_UNSUPPORTED" }
    );
  }
  // Sem botão interativo no texto simples: o link (quando existe) vai
  // escrito no corpo da mensagem.
  const individualText = metadata?.link?.url ? `${body}\n\n${metadata.link.url}` : body;

  const base = {
    conversation_id: conversation.id,
    direction: "outbound",
    sender_type: "user",
    sender_user_id: senderUserId,
    sent_by_name: senderName,
    channel: sendChannel === "individual" ? "whatsapp_individual" : "whatsapp_cloud_api",
    session_user_id: sendChannel === "individual" ? assignedUserId : null,
    message_type: type,
    body: sendChannel === "individual" ? individualText : body,
    metadata,
    message_at: now
  };

  let sent;
  try {
    sent = sendChannel === "individual"
      ? await sendIndividualMessage(assignedUserId, { to: conversation.contact_phone, text: individualText, media: individualMedia })
      : await sendWhatsappMessagePayload({ to: conversation.contact_phone, message });
  } catch (error) {
    await db().from("whatsapp_messages").insert({ ...base, status: "failed", failed_at: now, error_message: String(error?.message || "Falha ao enviar").slice(0, 500) });
    await broadcastChatChanged();
    throw new WhatsappChatError(error?.message || "Não foi possível enviar a mensagem.", { status: 502, code: "SEND_FAILED" });
  }

  let inserted, insertError;
  if (sendChannel === "individual") {
    ({ data: inserted, error: insertError } = await db()
      .from("whatsapp_messages")
      .insert({ ...base, status: "sent", sent_at: now, metadata: { ...base.metadata, wa_message_id: sent.messageId, ...(sent.remoteJid ? { remote_jid: sent.remoteJid } : {}) } })
      .select("*")
      .single());
  } else {
    ({ data: inserted, error: insertError } = await db()
      .from("whatsapp_messages")
      .upsert({ ...base, meta_message_id: sent.messageId, status: "sent", sent_at: now }, { onConflict: "meta_message_id" })
      .select("*")
      .single());
  }
  if (insertError) throw insertError;

  await db().rpc("whatsapp_chat_apply_outbound", { p_conversation_id: conversation.id, p_at: now, p_preview: previewFor(type, base.body), p_mark_in_service: true });
  await db().from("whatsapp_conversations").update({ account_channel: base.channel, account_user_id: base.session_user_id }).eq("id", conversation.id);
  await autoAssignOnReply(conversation, auth);
  await noteHumanContact(conversation, auth, { messageType: type, at: now });
  if (sendChannel !== "individual") await reconcileStatusFromEvents(sent.messageId);
  await broadcastChatChanged();
  return messageRow(inserted, auth);
}

// Anexo escolhido pelo atendente (foto, vídeo, GIF, figurinha, PDF, áudio
// gravado…). Mesma regra de tipo para celular, app e navegador
// (outboundKindForMime em lib/whatsapp-message-actions.mjs).
function mediaSendPlan({ mime, name, text, url, asGif }) {
  let kind = outboundKindForMime(mime, { asGif });
  if (!kind) {
    if (AUDIO_TYPES.includes(mime)) kind = "audio";
    else if (DOCUMENT_TYPES.includes(mime)) kind = "document";
  }
  if (!kind) throw new WhatsappChatError("Tipo de arquivo não suportado pelo WhatsApp. Use foto JPG/PNG, vídeo MP4, GIF, figurinha WEBP, PDF, documento do Office ou áudio.");
  const caption = text ? { caption: text } : {};
  if (kind === "image") return { kind, type: "image", body: text, message: { type: "image", image: { link: url, ...caption } } };
  if (kind === "video") return { kind, type: "video", body: text, message: { type: "video", video: { link: url, ...caption } } };
  if (kind === "gif") return { kind, type: "video", body: text, gif: true, message: { type: "video", video: { link: url, ...caption } } };
  if (kind === "sticker") return { kind, type: "sticker", body: "", message: { type: "sticker", sticker: { link: url } } };
  if (kind === "audio") return { kind, type: "audio", body: "", message: { type: "audio", audio: { link: url } } };
  // Documento — inclui o GIF animado (.gif): o WhatsApp não anima .gif
  // enviado como foto; como arquivo, abre animado.
  return { kind: "document", type: "document", body: text, message: { type: "document", document: { link: url, filename: name, ...caption } } };
}

export async function sendChatMedia(id, { buffer, mimeType, fileName, caption = "", asGif = false }, auth) {
  const conversation = await loadConversation(id, auth);
  const mime = cleanMime(mimeType);
  const size = buffer?.length || 0;
  if (!size) throw new WhatsappChatError("Arquivo vazio.");
  if (size > MEDIA_MAX_BYTES) throw new WhatsappChatError("O arquivo passa de 4 MB. Envie um menor (fotos são reduzidas automaticamente).");
  const text = String(caption || "").trim().slice(0, 1024);
  const name = String(fileName || "arquivo").slice(0, 120);
  mediaSendPlan({ mime, name, text, url: "", asGif }); // valida o tipo antes de subir o arquivo
  const { url, path } = await uploadChatMedia({ buffer, contentType: mime, fileName: name, folder: "sent" });
  return deliverPlannedMedia(conversation, { mime, name, text, url, path, asGif }, auth);
}

function deliverPlannedMedia(conversation, { mime, name, text, url, path, asGif }, auth) {
  const plan = mediaSendPlan({ mime, name, text, url, asGif });
  const metadata = { media: { url, path, bucket: CHAT_MEDIA_BUCKET, mime, name }, ...(plan.gif ? { gif: true } : {}) };
  return deliverChatMessage(conversation, { message: plan.message, type: plan.type, body: plan.body, metadata, mediaKind: plan.kind }, auth);
}

// Arquivos grandes (vídeo até 16 MB): o navegador envia DIRETO para o storage
// por uma URL assinada (o corpo nunca passa pela Vercel, limite ~4,5 MB) e
// depois pede o envio com o caminho devolvido aqui.
const DIRECT_UPLOAD_MAX_BYTES = 16 * 1024 * 1024;

export async function createChatMediaUploadTarget(id, { mimeType, fileName, size }, auth) {
  await loadConversation(id, auth);
  const mime = cleanMime(mimeType);
  if (!Number(size) || Number(size) > DIRECT_UPLOAD_MAX_BYTES) throw new WhatsappChatError("O arquivo passa de 16 MB (limite do WhatsApp).");
  mediaSendPlan({ mime, name: fileName, text: "", url: "", asGif: false });
  return createChatMediaUploadUrl({ contentType: mime, fileName: String(fileName || "arquivo").slice(0, 120), conversationId: id });
}

export async function sendUploadedChatMedia(id, { path, mimeType, fileName, caption = "", asGif = false }, auth) {
  const conversation = await loadConversation(id, auth);
  const mime = cleanMime(mimeType);
  // Só aceita o caminho que o próprio CRM gerou para ESTA conversa.
  if (typeof path !== "string" || !path.startsWith(`sent/direct/${id}/`) || path.includes("..")) throw new WhatsappChatError("Arquivo inválido.");
  const { url } = await describeChatMediaPath(path);
  return deliverPlannedMedia(conversation, { mime, name: String(fileName || "arquivo").slice(0, 120), text: String(caption || "").trim().slice(0, 1024), url, path, asGif }, auth);
}

// Link de simulação do corretor RESPONSÁVEL pelo cliente desta conversa (nunca
// o da roleta/genérico quando há responsável); direto no formulário.
//
// Corretor INATIVO (desligado, mas o cliente continua com responsible_user_id
// apontando pra ele) nunca pode gerar o link ?ref=<dele>: o formulário público só
// aceita ?ref= de corretor ATIVO (resolveAdminProfileByRef) e rejeita no fim do
// preenchimento com "Este link de corretor é inválido ou está inativo." — o
// cliente perdia todo o formulário já preenchido pra descobrir isso só na hora de
// enviar. Corretor inativo = mesmo tratamento de "sem responsável": link público
// genérico (cai no corretor padrão/roleta na hora do cadastro).
async function resolveSimulationLink(conversation, auth) {
  let responsibleId = null;
  if (conversation.client_id) {
    const { data } = await db().from("simulation_registrations").select("responsible_user_id").eq("id", conversation.client_id).maybeSingle();
    responsibleId = data?.responsible_user_id || null;
  }
  responsibleId = responsibleId || conversation.assigned_user_id || auth?.profile?.id || null;
  const profile = responsibleId ? await getAdminProfileById(responsibleId).catch(() => null) : null;
  const activeProfile = profile?.status === "active" ? profile : null;
  return { url: directSimulationLink(buildBrokerSimulationLink(activeProfile)), brokerName: activeProfile?.name || "" };
}

function rowToShortcut(row) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    body: row.body || "",
    mediaUrl: row.media_url || "",
    mediaName: row.media_name || "",
    mediaMime: row.media_mime || "",
    sortOrder: row.sort_order || 0,
    active: Boolean(row.active)
  };
}

export async function listChatShortcuts({ includeInactive = false } = {}) {
  let request = db().from("whatsapp_chat_shortcuts").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
  if (!includeInactive) request = request.eq("active", true);
  const { data, error } = await request;
  if (error) throw error;
  return (data || []).map(rowToShortcut);
}

export async function sendChatShortcut(id, shortcutId, auth) {
  const conversation = await loadConversation(id, auth);
  const { data: row, error } = await db().from("whatsapp_chat_shortcuts").select("*").eq("id", shortcutId).eq("active", true).maybeSingle();
  if (error) throw error;
  if (!row) throw new WhatsappChatError("Atalho não encontrado.", { status: 404 });

  const body = String(row.body || "").trim();
  const metadata = { shortcut: row.label };

  if (row.kind === "text") {
    return deliverChatMessage(conversation, { message: { type: "text", text: { body: body.slice(0, 4096) } }, type: "text", body, metadata }, auth);
  }
  if (row.kind === "image" || row.kind === "document") {
    const media = { url: row.media_url, mime: row.media_mime || "", name: row.media_name || "" };
    const message = row.kind === "image"
      ? { type: "image", image: { link: row.media_url, ...(body ? { caption: body.slice(0, 1024) } : {}) } }
      : { type: "document", document: { link: row.media_url, filename: row.media_name || "arquivo", ...(body ? { caption: body.slice(0, 1024) } : {}) } };
    return deliverChatMessage(conversation, { message, type: row.kind, body, metadata: { ...metadata, media } }, auth);
  }
  if (row.kind === "simulation_link") {
    const { url } = await resolveSimulationLink(conversation, auth);
    const text = (body || "Aqui está o link para fazer a sua simulação de financiamento. Leva poucos minutos e é sem compromisso. 😉").slice(0, 1024);
    const label = "Fazer simulação";
    return deliverChatMessage(conversation, {
      message: { type: "interactive", interactive: { type: "cta_url", body: { text }, action: { name: "cta_url", parameters: { display_text: label, url } } } },
      type: "text",
      body: text,
      metadata: { ...metadata, link: { label, url } }
    }, auth);
  }
  throw new WhatsappChatError("Tipo de atalho inválido.");
}

function assertCanManageShortcuts(auth) {
  if (!chatScope(auth).supervisor) throw new WhatsappChatError("Apenas gestor ou administrador pode gerenciar os atalhos.", { status: 403 });
}

export async function createChatShortcut({ label, kind, body = "", file = null }, auth) {
  assertCanManageShortcuts(auth);
  const cleanLabel = String(label || "").trim().slice(0, 60);
  if (!cleanLabel) throw new WhatsappChatError("Dê um nome ao atalho.");
  if (!["text", "image", "document", "simulation_link"].includes(kind)) throw new WhatsappChatError("Tipo de atalho inválido.");
  const cleanBody = String(body || "").trim().slice(0, 4000);
  if (kind === "text" && !cleanBody) throw new WhatsappChatError("Escreva o texto do atalho.");

  const record = { kind, label: cleanLabel, body: cleanBody || null, created_by: auth?.profile?.id || null };
  if (kind === "image" || kind === "document") {
    if (!file?.buffer?.length) throw new WhatsappChatError("Envie o arquivo do atalho.");
    const mime = cleanMime(file.mimeType);
    if (kind === "image" && !IMAGE_TYPES.includes(mime)) throw new WhatsappChatError("A imagem precisa ser JPG ou PNG.");
    if (kind === "document" && !DOCUMENT_TYPES.includes(mime)) throw new WhatsappChatError("Documento não suportado (use PDF ou Office).");
    if (file.buffer.length > MEDIA_MAX_BYTES) throw new WhatsappChatError("O arquivo passa de 4 MB.");
    const { url } = await uploadChatMedia({ buffer: file.buffer, contentType: mime, fileName: file.fileName || "arquivo", folder: "shortcuts" });
    record.media_url = url;
    record.media_name = String(file.fileName || "arquivo").slice(0, 120);
    record.media_mime = mime;
  }

  const { data: last } = await db().from("whatsapp_chat_shortcuts").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  record.sort_order = (last?.sort_order ?? 0) + 1;
  const { data, error } = await db().from("whatsapp_chat_shortcuts").insert(record).select("*").single();
  if (error) throw error;
  return rowToShortcut(data);
}

export async function updateChatShortcut(id, patch = {}, auth) {
  assertCanManageShortcuts(auth);
  const update = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) {
    const label = String(patch.label || "").trim().slice(0, 60);
    if (!label) throw new WhatsappChatError("Dê um nome ao atalho.");
    update.label = label;
  }
  if (patch.body !== undefined) update.body = String(patch.body || "").trim().slice(0, 4000) || null;
  if (patch.active !== undefined) update.active = Boolean(patch.active);
  if (patch.sortOrder !== undefined) update.sort_order = Number(patch.sortOrder) || 0;
  const { data, error } = await db().from("whatsapp_chat_shortcuts").update(update).eq("id", id).select("*").single();
  if (error) throw error;
  return rowToShortcut(data);
}

export async function deleteChatShortcut(id, auth) {
  assertCanManageShortcuts(auth);
  const { error } = await db().from("whatsapp_chat_shortcuts").delete().eq("id", id);
  if (error) throw error;
  return { deleted: true };
}
