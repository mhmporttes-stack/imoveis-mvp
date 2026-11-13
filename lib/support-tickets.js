import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabase";
import { AdminPermissionError, isOwnerAdminEmail } from "@/lib/admin-profiles";
import { sendPushToUser } from "@/lib/push-subscriptions";
import { NOTIFICATION_KIND } from "@/lib/notification-policy-core.mjs";
import { detectImageType } from "@/lib/image-signature.mjs";
import {
  SUPPORT_NOTICE_LINK,
  SUPPORT_SIGNED_URL_SECONDS,
  TICKET_STATUS,
  buildReplyNotice,
  buildTicketContext,
  canReadSupportTicket,
  canSeeSupportQueue,
  checkTicketRateLimit,
  isTicketKind,
  isTicketStatus,
  rateLimitMessage,
  ticketImageExtension,
  validateTicketDescription,
  validateTicketImages,
  validateTicketReply
} from "@/lib/support-tickets-core.mjs";

// Ajuda e chamados (REGRA OFICIAL — dono, 2026-11-13; regras puras em lib/support-tickets-core.mjs, migration
// 20261113120000_support_tickets.sql). Toda leitura/escrita passa por aqui com a service role; RLS sem policy pública.
// Fila e resposta: SÓ O DONO (conta real, fora de "Alterar conta"); o autor vê só os próprios chamados; anexos em bucket
// PRIVADO com URL assinada curta. Sem IA e sem serviço externo.
//
// GANCHO (depois, fora desta fase): aviso da resposta pelo WhatsApp oficial = `sendOfficialAlert({ userId, text, crm: false })`
// de lib/official-alert.js (só com a janela de 24 h aberta). Hoje o aviso é só sino + push (replySupportTicket).

export class SupportTicketError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "SupportTicketError";
    this.status = status;
  }
}

const TABLE = "support_tickets";
export const SUPPORT_BUCKET = "support-tickets";
const QUEUE_LIMIT = 200;
const OWN_LIMIT = 30;

function db() {
  if (!hasSupabaseAdminConfig) throw new SupportTicketError("Supabase não configurado.", 503);
  return getSupabaseAdminClient();
}

// Fila/resposta: SÓ o dono, conta real, fora de "Alterar conta" (gestor e demais perfis NÃO veem a fila de ninguém).
export function isSupportQueueViewer(auth) {
  return canSeeSupportQueue({ accountSwitchMode: Boolean(auth?.accountSwitchMode), isOwner: isOwnerAdminEmail(auth?.user?.email) });
}

export function assertSupportQueueAccess(auth) {
  if (!isSupportQueueViewer(auth)) throw new AdminPermissionError("A fila de chamados é só do administrador principal, na conta real (fora de \"Alterar conta\").");
}

function missingTable(error) {
  return /support_tickets|schema cache|does not exist/i.test(error?.message || "");
}

function wrap(error, fallback) {
  if (missingTable(error)) return new SupportTicketError("A Ajuda ainda não está disponível (falta aplicar a migration 20261113120000).", 503);
  console.error(`[support] ${fallback}:`, error?.message || error);
  return new SupportTicketError(fallback, 500);
}

async function signAttachments(attachments = []) {
  const list = Array.isArray(attachments) ? attachments : [];
  const signed = await Promise.all(list.map(async (item) => {
    const { data, error } = await db().storage.from(SUPPORT_BUCKET).createSignedUrl(item.path, SUPPORT_SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return { url: data.signedUrl, type: item.type, size: item.size };
  }));
  return signed.filter(Boolean);
}

// O autor não recebe o contexto técnico, o tipo (classificação do dono) nem quem respondeu.
function toAuthorView(row, attachments = []) {
  return {
    id: row.id,
    created_at: row.created_at,
    screen_path: row.screen_path,
    screen_title: row.screen_title,
    description: row.description,
    status: row.status,
    reply_text: row.reply_text || "",
    replied_at: row.replied_at || null,
    attachments
  };
}

function toOwnerView(row, authorName = "", attachments = []) {
  return { ...toAuthorView(row, attachments), kind: row.kind || null, context: row.context || {}, created_by: row.created_by, author_name: authorName, replied_by: row.replied_by || null };
}

// files: [{ bytes: Uint8Array, type: string }] (a assinatura real é conferida aqui, sem confiar no MIME informado).
export async function createSupportTicket(auth, { description, client = {}, files = [] } = {}) {
  const text = validateTicketDescription(description);
  if (!text.ok) throw new SupportTicketError(text.error, 400);

  const images = [];
  for (const file of files) {
    const type = detectImageType(file.bytes);
    if (!type) throw new SupportTicketError("Anexe apenas imagens (JPG, PNG ou WEBP).", 400);
    images.push({ bytes: file.bytes, type, size: file.bytes.length });
  }
  const batch = validateTicketImages(images);
  if (!batch.ok) throw new SupportTicketError(batch.error, 400);

  const userId = auth.profile.id;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await db().from(TABLE).select("created_at").eq("created_by", userId).gte("created_at", since).order("created_at", { ascending: false }).limit(50);
  if (recentError) throw wrap(recentError, "Não consegui enviar o chamado agora.");
  const limit = checkTicketRateLimit((recent || []).map((row) => row.created_at));
  if (!limit.ok) throw new SupportTicketError(rateLimitMessage(limit), 429);

  const context = buildTicketContext({
    user: {
      id: userId,
      name: auth.profile.name || "",
      role: auth.profile.role || "",
      viaAccountSwitch: Boolean(auth.accountSwitchMode),
      realId: auth.realProfile?.id || "",
      realName: auth.realProfile?.name || ""
    },
    client
  });

  const id = randomUUID();
  const attachments = [];
  try {
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const path = `${id}/${index + 1}.${ticketImageExtension(image.type)}`;
      const { error } = await db().storage.from(SUPPORT_BUCKET).upload(path, Buffer.from(image.bytes), { contentType: image.type, upsert: false });
      if (error) throw error;
      attachments.push({ path, type: image.type, size: image.size });
    }
    const { data, error } = await db().from(TABLE).insert({
      id,
      created_by: userId,
      screen_path: context.screen.path,
      screen_title: context.screen.title,
      description: text.value,
      context,
      attachments,
      status: TICKET_STATUS.OPEN
    }).select("*").single();
    if (error) throw error;
    return toAuthorView(data);
  } catch (error) {
    if (attachments.length) await db().storage.from(SUPPORT_BUCKET).remove(attachments.map((item) => item.path)).catch(() => {});
    throw error instanceof SupportTicketError ? error : wrap(error, "Não consegui enviar o chamado agora.");
  }
}

// "Meus chamados": só os do próprio usuário (conta efetiva).
export async function listOwnSupportTickets(auth) {
  const { data, error } = await db().from(TABLE).select("id, created_at, screen_path, screen_title, description, status, reply_text, replied_at")
    .eq("created_by", auth.profile.id).order("created_at", { ascending: false }).limit(OWN_LIMIT);
  if (error) throw wrap(error, "Não consegui carregar seus chamados.");
  return (data || []).map((row) => toAuthorView(row));
}

// Fila do dono (conta real). `status` opcional filtra; "all"/vazio = todos.
export async function listSupportQueue(auth, { status = "" } = {}) {
  assertSupportQueueAccess(auth);
  let query = db().from(TABLE).select("id, created_by, created_at, screen_path, screen_title, description, status, kind, reply_text, replied_at, attachments").order("created_at", { ascending: false }).limit(QUEUE_LIMIT);
  if (isTicketStatus(status)) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw wrap(error, "Não consegui carregar a fila de chamados.");
  const names = await authorNames((data || []).map((row) => row.created_by));
  return (data || []).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    screen_path: row.screen_path,
    screen_title: row.screen_title,
    description: row.description,
    status: row.status,
    kind: row.kind || null,
    author_name: names.get(row.created_by) || "",
    has_reply: Boolean(row.reply_text),
    attachment_count: Array.isArray(row.attachments) ? row.attachments.length : 0
  }));
}

async function authorNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await db().from("admin_users").select("id, name").in("id", unique);
  if (error) throw wrap(error, "Não consegui carregar os nomes dos autores.");
  return new Map((data || []).map((row) => [row.id, row.name || ""]));
}

async function loadTicket(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""))) throw new SupportTicketError("Chamado não encontrado.", 404);
  const { data, error } = await db().from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw wrap(error, "Não consegui abrir o chamado.");
  return data || null;
}

// Ficha: o dono (pela fila) vê tudo; o autor vê a própria; qualquer outro recebe 404 (não revela que existe).
export async function getSupportTicket(auth, id) {
  const row = await loadTicket(id);
  const queueViewer = isSupportQueueViewer(auth);
  if (!canReadSupportTicket({ viewerId: auth?.profile?.id || "", queueViewer, ticket: row })) throw new SupportTicketError("Chamado não encontrado.", 404);
  const attachments = await signAttachments(row.attachments);
  if (!queueViewer) return toAuthorView(row, attachments);
  const names = await authorNames([row.created_by]);
  return toOwnerView(row, names.get(row.created_by) || "", attachments);
}

export async function setSupportTicketKind(auth, id, kind) {
  assertSupportQueueAccess(auth);
  if (kind !== null && !isTicketKind(kind)) throw new SupportTicketError("Tipo inválido.", 400);
  const row = await loadTicket(id);
  if (!row) throw new SupportTicketError("Chamado não encontrado.", 404);
  const { error } = await db().from(TABLE).update({ kind }).eq("id", id);
  if (error) throw wrap(error, "Não consegui marcar o tipo do chamado.");
  return { id, kind };
}

// "Enviar ao corretor": grava a resposta, muda para "respondido" e avisa o autor pelo sistema que já existe (sino + push).
export async function replySupportTicket(auth, id, replyText) {
  assertSupportQueueAccess(auth);
  const reply = validateTicketReply(replyText);
  if (!reply.ok) throw new SupportTicketError(reply.error, 400);
  const row = await loadTicket(id);
  if (!row) throw new SupportTicketError("Chamado não encontrado.", 404);
  const repliedAt = new Date().toISOString();
  const { error } = await db().from(TABLE).update({ reply_text: reply.value, replied_at: repliedAt, replied_by: auth.profile.id, status: TICKET_STATUS.ANSWERED }).eq("id", id);
  if (error) throw wrap(error, "Não consegui salvar a resposta.");
  const notified = await notifyAuthor(row.created_by, reply.value, id);
  return { id, status: TICKET_STATUS.ANSWERED, replied_at: repliedAt, notified };
}

// Sino (crm_notifications, tipo support_reply) + push, só ao autor. Falha aqui não desfaz a resposta (já gravada).
async function notifyAuthor(userId, replyText, ticketId) {
  const { title, description } = buildReplyNotice(replyText);
  let bell = true;
  const { error } = await db().from("crm_notifications").insert({
    recipient_user_id: userId,
    title,
    description,
    notification_type: NOTIFICATION_KIND.SUPPORT_REPLY,
    link: SUPPORT_NOTICE_LINK,
    scheduled_at: new Date().toISOString()
  });
  if (error) {
    bell = false;
    console.error("[support] aviso da resposta não entrou no sino (migration 20261113120000?):", error.message || error);
  }
  await sendPushToUser(userId, { kind: NOTIFICATION_KIND.SUPPORT_REPLY, title, body: description, url: SUPPORT_NOTICE_LINK, tag: `support:${ticketId}` })
    .catch((pushError) => console.error("[support] push da resposta falhou:", pushError?.message || pushError));
  return { bell };
}
