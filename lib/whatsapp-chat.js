import "server-only";
import { createHmac } from "node:crypto";
import { digitsOnly, toBrazilianE164 } from "./phone-utils";
import { getSupabaseAdminClient } from "./supabase";
import { CLIENT_STATUS_META, getClientFunnelStage, CLIENT_FUNNEL_STAGES, normalizeClientStatus } from "./client-status";
import { isGeneralAdminAuth } from "./admin-profiles";
import { ensureManualSimulationRegistration } from "./simulation-registrations";
import { sendWhatsappTextMessage } from "./whatsapp-master";

// CHAT do WhatsApp Master — camada de conversas/mensagens em cima do webhook
// e do envio que já existem (lib/whatsapp-master.js). Nada aqui fala com a
// Graph API diretamente: envio reaproveita sendWhatsappTextMessage; entrada
// vem do MESMO webhook (processWhatsappWebhook chama projectChatFromEvents).

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MESSAGE_PAGE_SIZE = 100;
const CONVERSATION_PAGE_SIZE = 40;
const CONVERSATION_FILTERS = ["all", "unread", "open", "in_service", "finished"];
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

export function canLoadWhatsappChat() {
  return Boolean(getSupabaseAdminClient());
}

// ---------------------------------------------------------------------------
// Telefones / clientes
// ---------------------------------------------------------------------------

// Variantes de armazenamento de um mesmo telefone brasileiro: E.164, só
// dígitos, nacional (sem 55) e — porque a Meta às vezes entrega o número sem
// o nono dígito — a versão com/sem o 9 depois do DDD.
function phoneCandidates(phone) {
  const digits = digitsOnly(phone);
  if (!digits) return [];
  const national = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  const variants = new Set([digits, national, `55${national}`]);
  const e164 = toBrazilianE164(phone);
  if (e164) variants.add(e164);

  if (national.length === 10) {
    const withNine = `${national.slice(0, 2)}9${national.slice(2)}`;
    variants.add(withNine);
    variants.add(`55${withNine}`);
    variants.add(`+55${withNine}`);
  } else if (national.length === 11 && national[2] === "9") {
    const withoutNine = `${national.slice(0, 2)}${national.slice(3)}`;
    variants.add(withoutNine);
    variants.add(`55${withoutNine}`);
    variants.add(`+55${withoutNine}`);
  }
  variants.add(`+${digits}`);
  return Array.from(variants);
}

// phone -> id do cadastro mais recente que bate com qualquer variante do
// telefone. Não cria nem altera cliente nenhum.
async function findClientIdsByPhones(phones) {
  const unique = [...new Set((phones || []).filter(Boolean))];
  const result = new Map();
  if (!unique.length) return result;

  const candidatesByPhone = new Map(unique.map((phone) => [phone, phoneCandidates(phone)]));
  const allCandidates = [...new Set([...candidatesByPhone.values()].flat())];
  if (!allCandidates.length) return result;

  const { data, error } = await db()
    .from("simulation_registrations")
    .select("id, phone_normalized, created_at")
    .in("phone_normalized", allCandidates)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const byNormalized = new Map();
  for (const row of data || []) {
    if (!byNormalized.has(row.phone_normalized)) byNormalized.set(row.phone_normalized, row);
  }

  for (const phone of unique) {
    let best = null;
    for (const candidate of candidatesByPhone.get(phone) || []) {
      const row = byNormalized.get(candidate);
      if (row && (!best || row.created_at > best.created_at)) best = row;
    }
    result.set(phone, best?.id || null);
  }
  return result;
}

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
    const { data: existing, error: existingError } = await db()
      .from("whatsapp_conversations")
      .select("id, contact_phone")
      .in("contact_phone", phones);
    if (existingError) throw existingError;
    const conversationByPhone = new Map((existing || []).map((row) => [row.contact_phone, row.id]));

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
  const contactPhone = toBrazilianE164(phone) || (digitsOnly(phone) ? `+${digitsOnly(phone)}` : "");
  if (!contactPhone) return;
  const { data: conversation } = await db().from("whatsapp_conversations").select("id").eq("contact_phone", contactPhone).maybeSingle();
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
      responsibleName: responsibleNames.get(client.responsible_user_id) || "",
      origin: originByClient.get(client.id) || ""
    });
  }
  return info;
}

function conversationRow(row, clientInfo) {
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
    client: row.client_id ? clientInfo.get(row.client_id) || { id: row.client_id, name: "", code: "" } : null
  };
}

// Conversas sem cliente vinculado tentam de novo a busca por telefone: um
// cliente cadastrado DEPOIS da primeira mensagem passa a aparecer vinculado.
async function linkMissingClients(rows) {
  const unlinked = rows.filter((row) => !row.client_id);
  if (!unlinked.length) return;
  const matches = await findClientIdsByPhones(unlinked.map((row) => row.contact_phone));
  for (const row of unlinked) {
    const clientId = matches.get(row.contact_phone);
    if (clientId) {
      row.client_id = clientId;
      await db().from("whatsapp_conversations").update({ client_id: clientId }).eq("id", row.id).is("client_id", null);
    }
  }
}

export async function listChatConversations({ filter = "all", query = "", before = "", limit = CONVERSATION_PAGE_SIZE } = {}) {
  const safeFilter = CONVERSATION_FILTERS.includes(filter) ? filter : "all";
  let request = db()
    .from("whatsapp_conversations")
    .select("*")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(Number(limit) || CONVERSATION_PAGE_SIZE, 1), 100));

  if (safeFilter === "unread") request = request.gt("unread_count", 0);
  else if (safeFilter !== "all") request = request.eq("status", safeFilter);
  if (before) request = request.lt("last_message_at", before);

  const term = sanitizeSearch(query);
  if (term) {
    const digits = term.replace(/\D/g, "");
    const filters = [`contact_name.ilike.%${term}%`];
    if (digits) filters.push(`contact_phone.ilike.%${digits}%`);
    request = request.or(filters.join(","));
  }

  const { data, error } = await request;
  if (error) throw error;
  const rows = data || [];
  await linkMissingClients(rows);
  const clientInfo = await loadClientInfo(rows.map((row) => row.client_id));
  return rows.map((row) => conversationRow(row, clientInfo));
}

export async function getChatSummary() {
  const { data, error } = await db().from("whatsapp_conversations").select("unread_count").gt("unread_count", 0);
  if (error) throw error;
  const rows = data || [];
  return {
    unreadConversations: rows.length,
    unreadMessages: rows.reduce((sum, row) => sum + (row.unread_count || 0), 0),
    topic: getChatRealtimeTopic()
  };
}

async function loadConversation(id) {
  const { data, error } = await db().from("whatsapp_conversations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new WhatsappChatError("Conversa não encontrada.", { status: 404 });
  return data;
}

function messageRow(row, auth) {
  const isAdmin = isGeneralAdminAuth(auth);
  return {
    id: row.id,
    direction: row.direction,
    senderType: row.sender_type,
    sentByName: row.sender_type === "user" ? row.sent_by_name || "" : "",
    type: row.message_type,
    body: row.body || "",
    status: row.status,
    // Motivo técnico só para o administrador — a interface normal só mostra
    // "não enviada".
    errorCode: isAdmin ? row.error_code || "" : "",
    errorMessage: isAdmin ? row.error_message || "" : "",
    at: row.message_at,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    metaMessageId: isAdmin ? row.meta_message_id || "" : ""
  };
}

export async function getChatConversation(id, { before = "" } = {}, auth) {
  const conversation = await loadConversation(id);
  await linkMissingClients([conversation]);
  const clientInfo = await loadClientInfo([conversation.client_id]);

  let request = db()
    .from("whatsapp_messages")
    .select("*")
    .eq("conversation_id", id)
    .order("message_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (before) request = request.lt("message_at", before);
  const { data, error } = await request;
  if (error) throw error;

  const rows = (data || []).slice().reverse();
  return {
    conversation: conversationRow(conversation, clientInfo),
    messages: rows.map((row) => messageRow(row, auth)),
    hasMore: (data || []).length === MESSAGE_PAGE_SIZE
  };
}

// "Lida pelo usuário do CRM" — separado do status de leitura da Meta.
export async function markChatConversationRead(id, auth) {
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
  const patch = { status, updated_at: new Date().toISOString() };
  if (status === "in_service" && auth?.profile?.id) patch.assigned_user_id = auth.profile.id;
  const { error } = await db().from("whatsapp_conversations").update(patch).eq("id", id);
  if (error) throw error;
  await broadcastChatChanged();
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export async function sendChatMessage(id, text, auth) {
  const body = String(text || "").trim();
  if (!body) throw new WhatsappChatError("Digite uma mensagem.");
  if (body.length > 4096) throw new WhatsappChatError("A mensagem passa do limite de 4096 caracteres.");

  const conversation = await loadConversation(id);
  const window = windowInfo(conversation.last_inbound_at);
  if (!window.open) {
    throw new WhatsappChatError(
      "A janela de 24h do WhatsApp está fechada para este contato. Só é possível enviar um modelo (template) aprovado — mensagem livre seria recusada pela Meta.",
      { status: 409, code: "WINDOW_CLOSED" }
    );
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
  await reconcileStatusFromEvents(sent.messageId);
  await broadcastChatChanged();

  const { data: fresh } = await db().from("whatsapp_messages").select("*").eq("id", inserted.id).maybeSingle();
  return messageRow(fresh || inserted, auth);
}

// ---------------------------------------------------------------------------
// Adicionar ao CRM
// ---------------------------------------------------------------------------

export async function addChatConversationToCrm(id, { name = "" } = {}, auth) {
  const conversation = await loadConversation(id);
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
