import "server-only";
import { createHmac } from "node:crypto";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabase";
import { getAdminDisplayName } from "@/lib/admin-users";
import { AdminPermissionError, getAdminProfileById, isActiveAdminProfile, isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";
import { getActingAdminEmail } from "@/lib/admin-auth";
import { sendPushToUser } from "@/lib/push-subscriptions";
import {
  SUPERVISION_ACK_STATUS,
  SUPERVISION_THREAD_PAGE,
  SupervisionMessageError,
  assertCanRespond,
  buildSupervisionResponse,
  canSuperviseUser,
  normalizeSupervisionBody,
  toSupervisionMessage
} from "@/lib/supervision-messages-core.mjs";

// Mensagens internas de supervisão (gestor/admin ↔ corretor) — pedido do
// dono em 2026-10-01. Tabela supervision_messages (migration
// 20261001210000_supervision_messages.sql). Independente do Chat de
// clientes/WhatsApp. Regras puras em lib/supervision-messages-core.mjs.
//
// Tempo real: mesmo padrão do Chat (getChatRealtimeTopic/broadcastChatChanged
// em lib/whatsapp-chat.js) — o servidor manda um "ping" SEM DADOS num tópico
// de Broadcast do Supabase e o navegador refaz a leitura pela API autenticada.
// Aqui o tópico é POR USUÁRIO (HMAC do id com um segredo do servidor), só é
// entregue ao próprio usuário pela API e não carrega conteúdo — saber o nome
// do tópico não dá acesso a nenhuma mensagem.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function db() {
  return getSupabaseAdminClient();
}

function assertConfigured() {
  if (!hasSupabaseAdminConfig) throw new SupervisionMessageError("Supabase não configurado.", 503);
}

function assertUuid(value, message = "Usuário inválido.") {
  const id = String(value || "").trim();
  if (!UUID_PATTERN.test(id)) throw new SupervisionMessageError(message);
  return id;
}

function viewerFromAuth(auth) {
  return {
    id: auth?.profile?.id || "",
    isGeneralAdmin: isGeneralAdminAuth(auth),
    isManager: isManagerProfile(auth?.profile),
    managedUserIds: auth?.profile?.managedUserIds || []
  };
}

export function getSupervisionTopic(userId) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!secret || !userId) return "";
  return `sup-${createHmac("sha256", secret).update(`supervision-messages:${userId}`).digest("hex").slice(0, 24)}`;
}

async function broadcastSupervisionChanged(userIds = []) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const topics = [...new Set(userIds.filter(Boolean))].map(getSupervisionTopic).filter(Boolean);
  if (!url || !key || !topics.length) return;
  try {
    await fetch(`${url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: topics.map((topic) => ({ topic, event: "changed", payload: { at: Date.now() }, private: false })) }),
      signal: AbortSignal.timeout(4000)
    });
  } catch {
    // Melhor esforço: o navegador também relê ao voltar para a aba e no
    // intervalo de segurança.
  }
}

async function notifyByPush(userId, payload) {
  try {
    await sendPushToUser(userId, payload);
  } catch (error) {
    console.warn("Falha ao enviar push da mensagem de supervisão:", error?.message || error);
  }
}

function preview(text, max = 120) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

async function loadPeople(ids = []) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await db().from("admin_users").select("id, name, email, photo_url").in("id", unique);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, {
    id: row.id,
    name: row.name || getAdminDisplayName(row.email),
    photoUrl: row.photo_url || ""
  }]));
}

async function assertSupervisableTarget(auth, targetId) {
  const id = assertUuid(targetId);
  if (!canSuperviseUser(viewerFromAuth(auth), id)) {
    throw new AdminPermissionError("Você não pode conversar com este usuário pela supervisão.");
  }
  const profile = await getAdminProfileById(id);
  if (!profile || !isActiveAdminProfile(profile)) throw new SupervisionMessageError("Usuário não encontrado ou inativo.", 404);
  return profile;
}

// ---------- Gestor/admin ----------

export async function sendSupervisionMessage(auth, { recipientId, body } = {}) {
  assertConfigured();
  const recipient = await assertSupervisableTarget(auth, recipientId);
  const text = normalizeSupervisionBody(body);
  const senderId = auth.profile.id;

  const { data, error } = await db().from("supervision_messages").insert({
    sender_id: senderId,
    recipient_id: recipient.id,
    body: text,
    kind: "message",
    requires_ack: true,
    ack_status: SUPERVISION_ACK_STATUS.PENDING,
    origin: "crm",
    sent_by_email: getActingAdminEmail(auth) || null
  }).select("*").single();
  if (error) throw error;

  await broadcastSupervisionChanged([recipient.id, senderId]);
  await notifyByPush(recipient.id, {
    title: "Mensagem da supervisão",
    body: `${auth.profile.name || "Supervisão"}: ${preview(text)}`,
    url: "/admin/simulacoes",
    tag: `supervision:${recipient.id}`
  });

  return { message: toSupervisionMessage(data, senderId) };
}

// Histórico do par (eu ↔ userId), mais recentes primeiro no banco e
// devolvido em ordem cronológica. `before` (ISO) pagina para trás.
export async function listSupervisionThread(auth, { userId, before = "", limit = SUPERVISION_THREAD_PAGE } = {}) {
  assertConfigured();
  const partner = await assertSupervisableTarget(auth, userId);
  const me = auth.profile.id;
  const pageSize = Math.min(Math.max(Number(limit) || SUPERVISION_THREAD_PAGE, 1), 100);

  let query = db()
    .from("supervision_messages")
    .select("*")
    .or(`and(sender_id.eq.${me},recipient_id.eq.${partner.id}),and(sender_id.eq.${partner.id},recipient_id.eq.${me})`)
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);
  if (before) {
    const date = new Date(before);
    if (Number.isNaN(date.getTime())) throw new SupervisionMessageError("Paginação inválida.");
    query = query.lt("created_at", date.toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize).reverse();

  return {
    partner: { id: partner.id, name: partner.name, photoUrl: partner.photoUrl || "" },
    messages: page.map((row) => toSupervisionMessage(row, me)),
    hasMore
  };
}

// Gestor abriu a conversa: tudo que o corretor mandou para ele fica visto.
export async function markSupervisionThreadSeen(auth, userId) {
  assertConfigured();
  const partner = await assertSupervisableTarget(auth, userId);
  const now = new Date().toISOString();
  const { error } = await db()
    .from("supervision_messages")
    .update({ seen_at: now, delivered_at: now })
    .eq("recipient_id", auth.profile.id)
    .eq("sender_id", partner.id)
    .is("seen_at", null);
  if (error) throw error;
  return { ok: true };
}

// Badge do card do corretor: respostas/mensagens recebidas e ainda não
// vistas, agrupadas por quem mandou. Também devolve o tópico de tempo real
// do próprio usuário.
export async function getSupervisionUnreadCounts(auth) {
  assertConfigured();
  const me = auth.profile.id;
  const { data, error } = await db()
    .from("supervision_messages")
    .select("sender_id")
    .eq("recipient_id", me)
    .is("seen_at", null)
    .not("sender_id", "is", null)
    .limit(1000);
  if (error) throw error;
  const counts = {};
  for (const row of data || []) counts[row.sender_id] = (counts[row.sender_id] || 0) + 1;
  return { counts, topic: auth.accountSwitchMode ? "" : getSupervisionTopic(me) };
}

// ---------- Corretor ----------

// Pendentes de confirmação do usuário logado, da mais antiga para a mais
// nova (o balão mostra uma por vez). Buscar = entregue (delivered_at).
// Durante "Alterar conta" o balão não aparece: o admin real não deve
// confirmar/responder em nome do corretor uma mensagem da supervisão.
export async function listPendingSupervisionMessages(auth) {
  assertConfigured();
  if (auth.accountSwitchMode) return { messages: [], topic: "", viewAs: true };
  const me = auth.profile.id;

  const { data, error } = await db()
    .from("supervision_messages")
    .select("*")
    .eq("recipient_id", me)
    .eq("ack_status", SUPERVISION_ACK_STATUS.PENDING)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  const rows = data || [];

  const undelivered = rows.filter((row) => !row.delivered_at);
  if (undelivered.length) {
    const now = new Date().toISOString();
    const { error: deliveredError } = await db()
      .from("supervision_messages")
      .update({ delivered_at: now })
      .in("id", undelivered.map((row) => row.id))
      .is("delivered_at", null);
    if (!deliveredError) {
      for (const row of undelivered) row.delivered_at = now;
      await broadcastSupervisionChanged(undelivered.map((row) => row.sender_id));
    }
  }

  const people = await loadPeople(rows.map((row) => row.sender_id));
  return {
    topic: getSupervisionTopic(me),
    messages: rows.map((row) => ({
      ...toSupervisionMessage(row, me),
      sender: people.get(row.sender_id) || { id: row.sender_id || "", name: "Supervisão", photoUrl: "" }
    }))
  };
}

export async function markSupervisionMessageSeen(auth, messageId) {
  assertConfigured();
  if (auth.accountSwitchMode) return { ok: true };
  const id = assertUuid(messageId, "Mensagem inválida.");
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("supervision_messages")
    .update({ seen_at: now })
    .eq("id", id)
    .eq("recipient_id", auth.profile.id)
    .is("seen_at", null)
    .select("sender_id");
  if (error) throw error;
  if (data?.length) await broadcastSupervisionChanged(data.map((row) => row.sender_id));
  return { ok: true };
}

// "OK" ou resposta com texto. Trava otimista: só responde quem é o
// destinatário e enquanto a original ainda está pendente (duas abas do
// mesmo corretor não geram duas respostas).
export async function respondSupervisionMessage(auth, messageId, { action, body } = {}) {
  assertConfigured();
  if (auth.accountSwitchMode) {
    throw new AdminPermissionError("Durante \"Alterar conta\" não é possível responder mensagens da supervisão em nome do corretor.");
  }
  const id = assertUuid(messageId, "Mensagem inválida.");
  const me = auth.profile.id;
  const response = buildSupervisionResponse({ action, body });

  const { data: original, error: loadError } = await db().from("supervision_messages").select("*").eq("id", id).maybeSingle();
  if (loadError) throw loadError;
  assertCanRespond(original, me);

  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await db()
    .from("supervision_messages")
    .update({ ack_status: response.ackStatus, responded_at: now, seen_at: original.seen_at || now, delivered_at: original.delivered_at || now })
    .eq("id", id)
    .eq("recipient_id", me)
    .eq("ack_status", SUPERVISION_ACK_STATUS.PENDING)
    .select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) throw new SupervisionMessageError("Esta mensagem já foi respondida.", 409);

  let reply = null;
  if (original.sender_id) {
    const { data, error } = await db().from("supervision_messages").insert({
      sender_id: me,
      recipient_id: original.sender_id,
      body: response.body,
      kind: response.kind,
      requires_ack: false,
      ack_status: SUPERVISION_ACK_STATUS.NONE,
      in_reply_to: original.id,
      origin: "crm",
      sent_by_email: getActingAdminEmail(auth) || null
    }).select("*").single();
    if (error) {
      // Desfaz a marcação para a mensagem voltar a aparecer como pendente.
      await db().from("supervision_messages")
        .update({ ack_status: SUPERVISION_ACK_STATUS.PENDING, responded_at: null })
        .eq("id", id);
      throw error;
    }
    reply = data;

    await broadcastSupervisionChanged([original.sender_id, me]);
    await notifyByPush(original.sender_id, {
      title: response.kind === "ack" ? `${auth.profile.name || "Corretor"} confirmou` : `${auth.profile.name || "Corretor"} respondeu`,
      body: response.kind === "ack" ? `OK — ${preview(original.body, 80)}` : preview(response.body),
      url: "/admin/meta-diaria",
      tag: `supervision-reply:${original.sender_id}:${me}`
    });
  }

  return { ok: true, ackStatus: response.ackStatus, reply: reply ? toSupervisionMessage(reply, me) : null };
}
