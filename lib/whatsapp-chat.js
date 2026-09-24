import "server-only";
import { createHmac } from "node:crypto";
import { digitsOnly, toBrazilianE164 } from "./phone-utils";
import { getSupabaseAdminClient } from "./supabase";
import { CLIENT_STATUS_META, getClientFunnelStage, CLIENT_FUNNEL_STAGES, normalizeClientStatus } from "./client-status";
import { isBrokerProfile, isGeneralAdminAuth, isManagerProfile, listAdminProfiles } from "./admin-profiles";
import { ensureManualSimulationRegistration } from "./simulation-registrations";
import { sendWhatsappTemplateMessage, sendWhatsappTextMessage } from "./whatsapp-master";

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

function scopedColumns(auth, columns = "*") {
  return chatScope(auth).all ? columns : `${columns}, ${SCOPE_EMBED}`;
}

function applyChatScope(query, auth) {
  const scope = chatScope(auth);
  return scope.all ? query : query.in("scope.responsible_user_id", scope.brokerIds);
}

async function assertConversationAccess(conversation, auth) {
  const scope = chatScope(auth);
  if (scope.all) return;
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
  const matches = await findClientIdsByPhones(unlinked.map((row) => row.contact_phone));
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
  let request = db()
    .from("whatsapp_conversations")
    .select(scopedColumns(auth))
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(Number(limit) || CONVERSATION_PAGE_SIZE, 1), 100));
  request = applyChatScope(request, auth);

  if (safeFilter === "unread") request = request.gt("unread_count", 0);
  else if (safeFilter === "awaiting") request = request.eq("last_message_direction", "inbound").neq("status", "finished");
  else if (safeFilter === "silent") {
    request = request
      .eq("last_message_direction", "outbound")
      .neq("status", "finished")
      .lt("last_message_at", new Date(Date.now() - SILENT_MIN * 60000).toISOString());
  } else if (safeFilter !== "all") request = request.eq("status", safeFilter);
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
  return buildConversationRows(data || []);
}

export async function getChatSummary(auth) {
  const { data, error } = await applyChatScope(
    db()
      .from("whatsapp_conversations")
      .select(scopedColumns(auth, "unread_count, status, last_message_direction, last_message_at"))
      .or("unread_count.gt.0,last_message_direction.eq.inbound"),
    auth
  );
  if (error) throw error;
  const rows = data || [];
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

async function loadConversation(id, auth) {
  const { data, error } = await db().from("whatsapp_conversations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new WhatsappChatError("Conversa não encontrada.", { status: 404 });
  await assertConversationAccess(data, auth);
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
    templateName: row.metadata?.template || "",
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
    conversation: conversationView,
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
  // Quem responde assume o atendimento se ninguém estiver com a conversa.
  if (senderUserId) {
    await db().from("whatsapp_conversations").update({ assigned_user_id: senderUserId }).eq("id", id).is("assigned_user_id", null);
  }
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
  if (target === null) {
    patch.assigned_user_id = null;
    patch.status = "open";
  } else {
    if (!target) throw new WhatsappChatError("Usuário inválido.");
    const { data: user } = await db().from("admin_users").select("id").eq("id", target).maybeSingle();
    if (!user) throw new WhatsappChatError("Usuário não encontrado.", { status: 404 });
    patch.assigned_user_id = target;
    patch.status = "in_service";
  }
  const { error } = await db().from("whatsapp_conversations").update(patch).eq("id", id);
  if (error) throw error;
  await broadcastChatChanged();
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

  const phone = toBrazilianE164(client.phone_normalized || client.phone);
  if (!phone) throw new WhatsappChatError("Este cliente não possui um WhatsApp válido.");

  const { data: existingRows } = await db()
    .from("whatsapp_conversations")
    .select("id, client_id, assigned_user_id, status")
    .in("contact_phone", phoneCandidates(phone))
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

// ---------------------------------------------------------------------------
// Visão geral (nome do cliente, corretor responsável e quem está no vácuo)
// ---------------------------------------------------------------------------

export async function getChatOverview({ brokerId = "", situation = "", query = "" } = {}, auth) {
  const { data, error } = await applyChatScope(
    db()
      .from("whatsapp_conversations")
      .select(scopedColumns(auth))
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(500),
    auth
  );
  if (error) throw error;
  let rows = await buildConversationRows(data || []);

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
  if (senderUserId) {
    await db().from("whatsapp_conversations").update({ assigned_user_id: senderUserId }).eq("id", id).is("assigned_user_id", null);
  }
  await reconcileStatusFromEvents(sent.messageId);
  await broadcastChatChanged();
  return messageRow(inserted, auth);
}
