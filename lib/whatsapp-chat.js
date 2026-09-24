import "server-only";
import { createHmac } from "node:crypto";
import { canonicalWhatsappPhone, phoneLookupCandidates } from "./phone-utils";
import { markConversationHumanReply } from "./whatsapp-attendance";
import { sendPushToUser } from "./push-subscriptions";
import { ensureInboundAudioStored, readStoredMedia } from "./whatsapp-media";
import { findConversationByPhone, findLatestRegistrationIdsByPhones } from "./client-phone-lookup";
import { getSupabaseAdminClient } from "./supabase";
import { CLIENT_STATUS_META, getClientFunnelStage, CLIENT_FUNNEL_STAGES, normalizeClientStatus } from "./client-status";
import { isAdminPermissionError } from "./admin-access";
import { buildBrokerSimulationLink, getAdminProfileById, isBrokerProfile, isGeneralAdminAuth, isManagerProfile, listAdminProfiles } from "./admin-profiles";
import { directSimulationLink } from "./whatsapp-flow-core.mjs";
import { uploadChatMedia } from "./media-storage";
import { ensureManualSimulationRegistration } from "./simulation-registrations";
import { sendWhatsappMessagePayload, sendWhatsappTemplateMessage, sendWhatsappTextMessage } from "./whatsapp-master";

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
// Administrador geral e gestor veem todas as conversas (como já era). Corretor
// e associado veem SÓ as conversas de clientes pelos quais são responsáveis
// (ou do corretor a que o associado está vinculado) — mesma regra de
// applyResponsibleUserScope. Sem auth = nada (nunca abre por esquecimento).
function chatScope(auth) {
  const profile = auth?.profile;
  if (auth && (isGeneralAdminAuth(auth) || isManagerProfile(profile))) return { all: true, brokerIds: [] };
  if (auth && isBrokerProfile(profile) && profile?.id) {
    return { all: false, brokerIds: [profile.id, profile.linkedBrokerId].filter(Boolean) };
  }
  return { all: false, brokerIds: [EMPTY_UUID] };
}

// Corretor/associado enxergam: conversas de clientes pelos quais respondem
// OU conversas atribuídas a eles no Chat (mesmo que o cliente seja de outro
// corretor). Duas consultas (o PostgREST não faz OR entre a tabela e um
// recurso embutido) e junção sem duplicar. `build` aplica filtros/ordem/limite.
async function runScopedQuery(auth, columns, build) {
  const scope = chatScope(auth);
  if (scope.all) {
    const { data, error } = await build(db().from("whatsapp_conversations").select(columns).is("deleted_at", null));
    if (error) throw error;
    return data || [];
  }
  const [byClient, byAssignee] = await Promise.all([
    build(db().from("whatsapp_conversations").select(`${columns}, ${SCOPE_EMBED}`).is("deleted_at", null)).in("scope.responsible_user_id", scope.brokerIds),
    build(db().from("whatsapp_conversations").select(columns).is("deleted_at", null)).in("assigned_user_id", scope.brokerIds)
  ]);
  if (byClient.error) throw byClient.error;
  if (byAssignee.error) throw byAssignee.error;
  const merged = new Map();
  for (const row of [...(byClient.data || []), ...(byAssignee.data || [])]) {
    if (!merged.has(row.id)) merged.set(row.id, row);
  }
  return [...merged.values()].sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
}

async function assertConversationAccess(conversation, auth) {
  const scope = chatScope(auth);
  if (scope.all) return;
  if (conversation.assigned_user_id && scope.brokerIds.includes(conversation.assigned_user_id)) return;
  let responsibleId = null;
  if (conversation.client_id) {
    const { data } = await db().from("simulation_registrations").select("responsible_user_id").eq("id", conversation.client_id).maybeSingle();
    responsibleId = data?.responsible_user_id || null;
  }
  if (!responsibleId || !scope.brokerIds.includes(responsibleId)) {
    throw new WhatsappChatError("Você não tem acesso a esta conversa.", { status: 403 });
  }
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
  const inbound = (events || []).filter((event) => event.event_type === "message" && event.direction === "inbound" && event.message_id && event.sender_phone);
  const changedConversations = new Set();

  if (inbound.length) {
    const phones = [...new Set(inbound.map((event) => event.sender_phone))];
    // Conversa existente em QUALQUER formato do número (com/sem 9, com/sem +55):
    // o mesmo contato nunca abre duas conversas só por diferença de formato.
    const candidatesByPhone = new Map(phones.map((phone) => [phone, phoneLookupCandidates(phone)]));
    const { data: existing, error: existingError } = await db()
      .from("whatsapp_conversations")
      .select("id, contact_phone, last_message_at")
      .in("contact_phone", [...new Set([...candidatesByPhone.values()].flat())]);
    if (existingError) throw existingError;
    const conversationByPhone = new Map();
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
        .upsert(missing.map((phone) => ({ contact_phone: phone })), { onConflict: "contact_phone", ignoreDuplicates: true })
        .select("id, contact_phone");
      if (createError) throw createError;
      for (const row of created || []) conversationByPhone.set(row.contact_phone, row.id);
      // upsert ignoreDuplicates não devolve linhas criadas por outra requisição
      // concorrente — busca as que ainda faltam.
      const stillMissing = missing.filter((phone) => !conversationByPhone.has(phone));
      if (stillMissing.length) {
        const { data: refetched } = await db().from("whatsapp_conversations").select("id, contact_phone").in("contact_phone", stillMissing);
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
        payload: type === "text" ? {} : message,
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
      }
    }
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
    db().from("simulation_registrations").select("id, full_name, client_code, status, responsible_user_id, phone_normalized").in("id", ids),
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
  const { data } = await db().from("admin_users").select("id, name").in("id", unique);
  return new Map((data || []).map((row) => [row.id, row.name || ""]));
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

function conversationRow(row, clientInfo, userNames = new Map()) {
  const client = row.client_id ? clientInfo.get(row.client_id) || { id: row.client_id, name: "", code: "" } : null;
  const brokerId = row.assigned_user_id || client?.responsibleId || null;
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
    broker: brokerId ? { id: brokerId, name: userNames.get(brokerId) || client?.responsibleName || "", assigned: Boolean(row.assigned_user_id) } : null,
    assignedUserId: row.assigned_user_id || null,
    waiting: waitingInfo(row)
  };
}

async function buildConversationRows(rows) {
  await linkMissingClients(rows);
  const clientInfo = await loadClientInfo(rows.map((row) => row.client_id));
  const responsibleIds = [...clientInfo.values()].map((client) => client.responsibleId);
  const userNames = await loadUserNames([...rows.map((row) => row.assigned_user_id), ...responsibleIds]);
  return rows.map((row) => {
    const { scope, ...clean } = row;
    return conversationRow(clean, clientInfo, userNames);
  });
}

// Conversas sem cliente vinculado tentam de novo a busca por telefone: um
// cliente cadastrado DEPOIS da primeira mensagem passa a aparecer vinculado.
async function linkMissingClients(rows) {
  const unlinked = rows.filter((row) => !row.client_id);
  if (!unlinked.length) return;
  const matches = await findLatestRegistrationIdsByPhones(unlinked.map((row) => row.contact_phone));
  for (const row of unlinked) {
    const clientId = matches.get(row.contact_phone);
    if (clientId) {
      row.client_id = clientId;
      await db().from("whatsapp_conversations").update({ client_id: clientId }).eq("id", row.id).is("client_id", null);
    }
  }
}

export async function listChatConversations({ filter = "all", query = "", before = "", limit = CONVERSATION_PAGE_SIZE } = {}, auth) {
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
  });
  return buildConversationRows(rows.slice(0, pageSize));
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

async function loadConversation(id, auth, { includeDeleted = false } = {}) {
  const { data, error } = await db().from("whatsapp_conversations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data || (data.deleted_at && !includeDeleted)) throw new WhatsappChatError("Conversa não encontrada.", { status: 404 });
  await assertConversationAccess(data, auth);
  return data;
}

// Mídia mostrada no Chat. Enviada pelo CRM: URL pública guardada em metadata.media. Recebida do
// cliente (áudio): sempre pela rota autenticada do CRM (o arquivo é baixado da Meta pelo servidor,
// guardado em storage privado e servido com verificação de permissão) — nunca a URL temporária da Meta.
function buildMessageMedia(row) {
  if (row.metadata?.media?.url) return { url: row.metadata.media.url, mime: row.metadata.media.mime || "", name: row.metadata.media.name || "" };
  if (row.direction === "inbound" && row.message_type === "audio" && row.payload?.audio?.id) {
    const stored = row.metadata?.media;
    return {
      url: `/api/admin/whatsapp-chat/media/${row.id}`,
      mime: stored?.mime || String(row.payload.audio.mime_type || "audio/ogg"),
      name: "",
      state: stored?.status || "pending",
      inbound: true
    };
  }
  return null;
}

function messageRow(row, auth) {
  const isAdmin = isGeneralAdminAuth(auth);
  return {
    id: row.id,
    direction: row.direction,
    internal: row.direction === "internal",
    senderType: row.sender_type,
    sentByName: row.sender_type === "user" ? row.sent_by_name || "" : "",
    type: row.message_type,
    body: row.body || "",
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
    metaMessageId: isAdmin ? row.meta_message_id || "" : ""
  };
}

export async function getChatConversation(id, { before = "" } = {}, auth) {
  const conversation = await loadConversation(id, auth);
  const [conversationView] = await buildConversationRows([conversation]);
  const internalAllowed = await canManageConversation(conversation, auth);

  let request = db()
    .from("whatsapp_messages")
    .select("*")
    .eq("conversation_id", id)
    .order("message_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  // Mensagens internas: filtradas NO BACKEND. Quem não pode nunca as recebe (nem por chamada direta).
  if (!internalAllowed) request = request.neq("direction", "internal");
  if (before) request = request.lt("message_at", before);
  const { data, error } = await request;
  if (error) throw error;

  const rows = (data || []).slice().reverse();
  return {
    conversation: { ...conversationView, canInternal: internalAllowed },
    messages: rows.map((row) => messageRow(row, auth)),
    hasMore: (data || []).length === MESSAGE_PAGE_SIZE
  };
}

// "Lida pelo usuário do CRM" — separado do status de leitura da Meta.
export async function markChatConversationRead(id, auth) {
  await loadConversation(id, auth);
  const { error } = await db()
    .from("whatsapp_conversations")
    .update({ unread_count: 0, last_read_at: new Date().toISOString(), last_read_by: auth?.profile?.id || null })
    .eq("id", id)
    .gt("unread_count", 0);
  if (error) throw error;
  await broadcastChatChanged();
}

export async function updateChatConversationStatus(id, status, auth) {
  if (!CONVERSATION_STATUSES.includes(status)) throw new WhatsappChatError("Status inválido.");
  await loadConversation(id, auth);
  const patch = { status, updated_at: new Date().toISOString() };
  if (status === "in_service" && auth?.profile?.id) patch.assigned_user_id = auth.profile.id;
  const { error } = await db().from("whatsapp_conversations").update(patch).eq("id", id);
  if (error) throw error;
  await broadcastChatChanged();
}

// ---------------------------------------------------------------------------
// Mídia recebida (áudio do cliente)
// ---------------------------------------------------------------------------

// Bytes do áudio recebido, com a MESMA verificação de acesso da conversa (o corretor só ouve o que
// pode ver). Se ainda não foi guardado (ou o download anterior falhou), baixa da Meta agora.
export async function getChatMessageMedia(messageId, auth, { retry = false } = {}) {
  const { data: row, error } = await db().from("whatsapp_messages").select("*").eq("id", messageId).maybeSingle();
  if (error) throw error;
  if (!row || row.direction !== "inbound" || row.message_type !== "audio") throw new WhatsappChatError("Áudio não encontrado.", { status: 404 });
  await loadConversation(row.conversation_id, auth);

  const media = await ensureInboundAudioStored(row, { force: retry });
  if (media.status !== "stored") {
    throw new WhatsappChatError("Não foi possível carregar este áudio.", { status: 502, code: "MEDIA_UNAVAILABLE" });
  }
  return readStoredMedia(media);
}

// Tenta recuperar áudios recebidos que ainda aparecem só como placeholder (a Meta guarda a mídia por
// ~14 dias). Só gestão/admin. Se a Meta não tem mais, o motivo fica registrado na mensagem.
export async function recoverInboundAudios(auth, { limit = 25 } = {}) {
  if (!chatScope(auth).all) throw new WhatsappChatError("Apenas gestor ou administrador.", { status: 403 });
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await db()
    .from("whatsapp_messages")
    .select("*")
    .eq("direction", "inbound")
    .eq("message_type", "audio")
    .gte("message_at", since)
    .order("message_at", { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 25, 1), 100));
  if (error) throw error;

  const result = { checked: 0, stored: 0, alreadyStored: 0, failed: [] };
  for (const row of rows || []) {
    result.checked += 1;
    if (row.metadata?.media?.status === "stored") { result.alreadyStored += 1; continue; }
    const media = await ensureInboundAudioStored(row, { force: true });
    if (media.status === "stored") result.stored += 1;
    else result.failed.push({ messageId: row.id, error: media.error || "" });
  }
  await broadcastChatChanged();
  return result;
}

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
    const recipients = new Set([client?.responsible_user_id, conversation.assigned_user_id].filter(Boolean));
    const { data: staff } = await db().from("admin_users").select("id").in("role", ["admin", "manager"]).eq("status", "active");
    for (const user of staff || []) recipients.add(user.id);
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

export async function sendChatMessage(id, text, auth) {
  const body = String(text || "").trim();
  if (!body) throw new WhatsappChatError("Digite uma mensagem.");
  if (body.length > 4096) throw new WhatsappChatError("A mensagem passa do limite de 4096 caracteres.");

  const conversation = await loadConversation(id, auth);
  const window = windowInfo(conversation.last_inbound_at);
  if (!window.open) {
    throw new WhatsappChatError(
      "A janela de 24h do WhatsApp está fechada para este contato. Só é possível enviar um modelo (template) aprovado — mensagem livre seria recusada pela Meta.",
      { status: 409, code: "WINDOW_CLOSED" }
    );
  }

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
    message_at: now
  };

  let sent;
  try {
    sent = await sendWhatsappTextMessage({ to: conversation.contact_phone, text: body, allowRawRecipient: true });
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

  const { data: inserted, error: insertError } = await db()
    .from("whatsapp_messages")
    .upsert({ ...base, meta_message_id: sent.messageId, status: "sent", sent_at: now }, { onConflict: "meta_message_id" })
    .select("*")
    .single();
  if (insertError) throw insertError;

  await db().rpc("whatsapp_chat_apply_outbound", {
    p_conversation_id: id,
    p_at: now,
    p_preview: previewFor("text", body),
    p_mark_in_service: true
  });
  await markConversationHumanReply(id);
  await autoAssignOnReply(conversation, auth);
  await reconcileStatusFromEvents(sent.messageId);
  await broadcastChatChanged();

  const { data: fresh } = await db().from("whatsapp_messages").select("*").eq("id", inserted.id).maybeSingle();
  return messageRow(fresh || inserted, auth);
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

  if (target && target !== self && !scope.all) {
    throw new WhatsappChatError("Só gestor ou administrador pode atribuir a conversa a outra pessoa.", { status: 403 });
  }
  if (target === null && !scope.all && conversation.assigned_user_id && conversation.assigned_user_id !== self) {
    throw new WhatsappChatError("Esta conversa está com outra pessoa.", { status: 403 });
  }

  const patch = { updated_at: new Date().toISOString() };
  let transferred = false;
  if (target === null) {
    patch.assigned_user_id = null;
    patch.status = "open";
  } else {
    if (!target) throw new WhatsappChatError("Usuário inválido.");
    const { data: user } = await db().from("admin_users").select("id").eq("id", target).maybeSingle();
    if (!user) throw new WhatsappChatError("Usuário não encontrado.", { status: 404 });

    // O card do cliente acompanha a conversa: atribuir a conversa a um corretor
    // transfere o cliente para ele (pelo mesmo caminho da tela de Clientes, com
    // histórico de transferência). Só admin/gestor mudam o responsável do cliente.
    if (conversation.client_id && scope.all) {
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
export async function listChatBrokers(auth) {
  if (!chatScope(auth).all) throw new WhatsappChatError("Apenas gestor ou administrador.", { status: 403 });
  const profiles = await listAdminProfiles();
  return profiles
    .filter((profile) => profile.id && profile.status === "active")
    .map((profile) => ({ id: profile.id, name: profile.name || profile.email || "Sem nome", role: profile.role }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Botão "WhatsApp" dos cards de cliente: abre (ou cria) a conversa deste
// cliente no número OFICIAL. Quem clica e é responsável pelo cliente já fica
// como atendente da conversa.
export async function openChatForClient(clientId, auth) {
  const { data: client, error } = await db()
    .from("simulation_registrations")
    .select("id, full_name, phone, phone_normalized, responsible_user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!client) throw new WhatsappChatError("Cliente não encontrado.", { status: 404 });

  const scope = chatScope(auth);
  if (!scope.all && !scope.brokerIds.includes(client.responsible_user_id)) {
    throw new WhatsappChatError("Você não tem acesso a este cliente.", { status: 403 });
  }

  const phone = canonicalWhatsappPhone(client.phone_normalized || client.phone);
  if (!phone) throw new WhatsappChatError("Este cliente não possui um WhatsApp válido.");

  const { data: existingRows } = await db()
    .from("whatsapp_conversations")
    .select("id, client_id, assigned_user_id, status, deleted_at, contact_phone")
    .in("contact_phone", phoneLookupCandidates(phone))
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);
  let conversation = existingRows?.[0] || null;

  if (!conversation) {
    const { data: created, error: createError } = await db()
      .from("whatsapp_conversations")
      .insert({ contact_phone: phone, contact_name: client.full_name || null, client_id: client.id, status: "open" })
      .select("id, client_id, assigned_user_id, status")
      .single();
    if (createError) throw createError;
    conversation = created;
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
  if (isResponsible && !conversation.assigned_user_id) {
    await db()
      .from("whatsapp_conversations")
      .update({ assigned_user_id: self, status: conversation.status === "finished" ? "in_service" : conversation.status === "open" ? "in_service" : conversation.status })
      .eq("id", conversation.id);
  }
  await broadcastChatChanged();
  return { conversationId: conversation.id };
}

// Canal do botão "WhatsApp" do card do cliente: dentro da janela de 24h da
// conversa (o cliente escreveu há menos de 24h) o atendimento abre no Chat; fora
// dela o Chat só enviaria modelo aprovado, então o botão abre o WhatsApp do
// próprio corretor. Só consulta — não cria conversa. Mesmo escopo do
// openChatForClient (corretor só consulta os clientes dele).
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

  let conversation = null;
  const { data: linked, error: linkedError } = await db()
    .from("whatsapp_conversations")
    .select("id, last_inbound_at")
    .eq("client_id", client.id)
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (linkedError) throw linkedError;
  conversation = linked?.[0] || null;
  if (!conversation) {
    const phone = canonicalWhatsappPhone(client.phone_normalized || client.phone);
    if (phone) conversation = await findConversationByPhone(phone, "id, last_inbound_at");
  }

  const info = windowInfo(conversation?.last_inbound_at);
  return { windowOpen: info.open, expiresAt: info.expiresAt };
}

// ---------------------------------------------------------------------------
// Visão geral (nome do cliente, corretor responsável e quem está no vácuo)
// ---------------------------------------------------------------------------

export async function getChatOverview({ brokerId = "", situation = "", query = "" } = {}, auth) {
  const data = await runScopedQuery(auth, "*", (base) =>
    base.order("last_message_at", { ascending: false, nullsFirst: false }).limit(500)
  );
  let rows = await buildConversationRows(data.slice(0, 500));

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
  await markConversationHumanReply(id);
  await autoAssignOnReply(conversation, auth);
  await reconcileStatusFromEvents(sent.messageId);
  await broadcastChatChanged();
  return messageRow(inserted, auth);
}

// ---------------------------------------------------------------------------
// Mídia e atalhos (imagem, áudio, documento, textos prontos, link do corretor)
// ---------------------------------------------------------------------------

const MEDIA_MAX_BYTES = 4 * 1024 * 1024; // limite de corpo da Vercel (~4,5 MB)
const AUDIO_TYPES = ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr"];
const IMAGE_TYPES = ["image/jpeg", "image/png"];
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
async function deliverChatMessage(conversation, { message, type = "text", body = "", metadata = {} }, auth) {
  if (!windowInfo(conversation.last_inbound_at).open) {
    throw new WhatsappChatError(
      "A janela de 24h do WhatsApp está fechada para este contato. Só é possível enviar um modelo (template) aprovado.",
      { status: 409, code: "WINDOW_CLOSED" }
    );
  }
  const senderName = auth?.profile?.name || auth?.user?.email || "Equipe";
  const now = new Date().toISOString();
  const base = {
    conversation_id: conversation.id,
    direction: "outbound",
    sender_type: "user",
    sender_user_id: auth?.profile?.id || null,
    sent_by_name: senderName,
    message_type: type,
    body,
    metadata,
    message_at: now
  };

  let sent;
  try {
    sent = await sendWhatsappMessagePayload({ to: conversation.contact_phone, message });
  } catch (error) {
    await db().from("whatsapp_messages").insert({ ...base, status: "failed", failed_at: now, error_message: String(error?.message || "Falha ao enviar").slice(0, 500) });
    await broadcastChatChanged();
    throw new WhatsappChatError(error?.message || "Não foi possível enviar a mensagem.", { status: 502, code: "SEND_FAILED" });
  }

  const { data: inserted, error: insertError } = await db()
    .from("whatsapp_messages")
    .upsert({ ...base, meta_message_id: sent.messageId, status: "sent", sent_at: now }, { onConflict: "meta_message_id" })
    .select("*")
    .single();
  if (insertError) throw insertError;

  await db().rpc("whatsapp_chat_apply_outbound", { p_conversation_id: conversation.id, p_at: now, p_preview: previewFor(type, body), p_mark_in_service: true });
  await markConversationHumanReply(conversation.id);
  await autoAssignOnReply(conversation, auth);
  await reconcileStatusFromEvents(sent.messageId);
  await broadcastChatChanged();
  return messageRow(inserted, auth);
}

// Anexo escolhido pelo atendente (foto, PDF, áudio gravado…).
export async function sendChatMedia(id, { buffer, mimeType, fileName, caption = "" }, auth) {
  const conversation = await loadConversation(id, auth);
  const mime = cleanMime(mimeType);
  const size = buffer?.length || 0;
  if (!size) throw new WhatsappChatError("Arquivo vazio.");
  if (size > MEDIA_MAX_BYTES) throw new WhatsappChatError("O arquivo passa de 4 MB. Envie um menor (fotos são reduzidas automaticamente).");

  let kind;
  if (IMAGE_TYPES.includes(mime)) kind = "image";
  else if (AUDIO_TYPES.includes(mime)) kind = "audio";
  else if (DOCUMENT_TYPES.includes(mime)) kind = "document";
  else throw new WhatsappChatError("Tipo de arquivo não suportado pelo WhatsApp. Use foto JPG/PNG, PDF, documento do Office ou áudio.");

  const text = String(caption || "").trim().slice(0, 1024);
  const name = String(fileName || "arquivo").slice(0, 120);
  const { url } = await uploadChatMedia({ buffer, contentType: mime, fileName: name, folder: "sent" });

  let message;
  if (kind === "image") message = { type: "image", image: { link: url, ...(text ? { caption: text } : {}) } };
  else if (kind === "audio") message = { type: "audio", audio: { link: url } };
  else message = { type: "document", document: { link: url, filename: name, ...(text ? { caption: text } : {}) } };

  return deliverChatMessage(conversation, { message, type: kind, body: kind === "audio" ? "" : text, metadata: { media: { url, mime, name } } }, auth);
}

// Link de simulação do corretor RESPONSÁVEL pelo cliente desta conversa (nunca
// o da roleta/genérico quando há responsável); direto no formulário.
async function resolveSimulationLink(conversation, auth) {
  let responsibleId = null;
  if (conversation.client_id) {
    const { data } = await db().from("simulation_registrations").select("responsible_user_id").eq("id", conversation.client_id).maybeSingle();
    responsibleId = data?.responsible_user_id || null;
  }
  responsibleId = responsibleId || conversation.assigned_user_id || auth?.profile?.id || null;
  const profile = responsibleId ? await getAdminProfileById(responsibleId).catch(() => null) : null;
  return { url: directSimulationLink(buildBrokerSimulationLink(profile)), brokerName: profile?.name || "" };
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
  if (!chatScope(auth).all) throw new WhatsappChatError("Apenas gestor ou administrador pode gerenciar os atalhos.", { status: 403 });
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
