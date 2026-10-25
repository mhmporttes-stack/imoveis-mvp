import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { recordLeadDistributionHistory } from "./lead-distribution";
import { createMarketplaceRegistration } from "./simulation-registrations";
import { addSystemTagToClient } from "./client-tags";
import { uploadChatMedia } from "./media-storage";
import { messagePreview } from "./marketplace-chat-core.mjs";
import { deliverMessengerConversation } from "./marketplace-chat";
import {
  MESSENGER_ORIGIN_KIND,
  MESSENGER_TAG,
  MessengerError,
  buildMessengerSendBody,
  describeMessengerSendError,
  messengerMessageRow,
  messengerThreadKey,
  needsMessengerDistribution,
  normalizeMessengerGraphVersion,
  parseMessengerWebhook,
  verifyMessengerChallenge,
  verifyMessengerSignature
} from "./messenger-core.mjs";

// Messenger oficial da Página do Facebook (MSG-1, REGRA OFICIAL — dono, 2026-10-25), fase 1: receber e responder pelo
// CRM, sem automação. A conversa é projetada no Chat Marketplace (marketplace_conversations/marketplace_messages, mesmo
// escopo, nota interna, atribuição e cliente) com thread_key `messenger:<PSID>` — a extensão do Marketplace nunca a
// vê (lib/marketplace-chat.js exclui esse prefixo da fila, do reprocessamento e da renormalização).
// Distribuição (REGRA OFICIAL — dono, 2026-10-25): conversa nova vai para a ROLETA, igual ao Marketplace, pelo MESMO
// caminho (`deliverMessengerConversation` → `distribute` de lib/marketplace-chat.js): roleta on-line/ROL-2d/2e/2f/2h,
// fila de espera, prazo de resposta e redistribuição MKT-2e, cliente criado com o corretor sorteado, histórico e aviso.
// Variáveis (só no servidor): MESSENGER_PAGE_ID, MESSENGER_PAGE_ACCESS_TOKEN, MESSENGER_APP_SECRET,
// MESSENGER_VERIFY_TOKEN; opcional MESSENGER_GRAPH_API_VERSION.

const CONVERSATIONS = "marketplace_conversations";
const MESSAGES = "marketplace_messages";
const MESSENGER_TAG_COLOR = "#0866FF";
const GRAPH_TIMEOUT_MS = 15000;
const MEDIA_MAX_BYTES = 10_000_000;

function db() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  return getSupabaseAdminClient();
}

function graphBase() {
  return `https://graph.facebook.com/${normalizeMessengerGraphVersion(process.env.MESSENGER_GRAPH_API_VERSION)}`;
}

export function verifyMessengerWebhookChallenge(searchParams) {
  return verifyMessengerChallenge(searchParams, process.env.MESSENGER_VERIFY_TOKEN || "");
}

export function verifyMessengerWebhookSignature(rawBody, signature) {
  return verifyMessengerSignature(rawBody, signature, process.env.MESSENGER_APP_SECRET || "");
}

export function isMessengerSendConfigured() {
  return Boolean(process.env.MESSENGER_PAGE_ACCESS_TOKEN);
}

// --- Envio (Send API) -----------------------------------------------------------------------------------------
// Uma chamada a /me/messages com o token da Página. Devolve { messageId } ou lança MessengerError com texto para o
// corretor. Quem chama confere a janela antes (lib/marketplace-chat.js); a Meta confere de novo (código 10/2018278).
export async function sendMessengerGraphMessage(psid, { text = "", imageUrl = "" } = {}) {
  const token = process.env.MESSENGER_PAGE_ACCESS_TOKEN || "";
  if (!token) throw new MessengerError("O Messenger da Página ainda não está configurado no CRM (MESSENGER_PAGE_ACCESS_TOKEN).", 503, "not_configured");
  let response;
  try {
    response = await fetch(`${graphBase()}/me/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(buildMessengerSendBody(psid, { text, imageUrl })),
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      cache: "no-store"
    });
  } catch (error) {
    console.warn("[messenger] envio sem resposta da Meta:", error?.name || "erro");
    throw new MessengerError("Sem resposta do Messenger agora. Tente de novo.", 502, "network");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.message_id) {
    console.warn("[messenger] envio recusado:", JSON.stringify({ status: response.status, code: data?.error?.code ?? null, subcode: data?.error?.error_subcode ?? null }));
    throw new MessengerError(describeMessengerSendError(data?.error || {}), 502, `graph_${data?.error?.code ?? response.status}`);
  }
  return { messageId: String(data.message_id) };
}

// Nome e foto do perfil (User Profile API). Sem permissão/erro: segue sem nome ("Cliente Messenger"), nunca trava o
// recebimento da mensagem.
async function fetchMessengerProfile(psid) {
  const token = process.env.MESSENGER_PAGE_ACCESS_TOKEN || "";
  if (!token) return { name: "", photo: "" };
  try {
    const response = await fetch(`${graphBase()}/${encodeURIComponent(psid)}?fields=first_name,last_name,profile_pic`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn("[messenger] perfil do contato indisponível:", JSON.stringify({ status: response.status, code: data?.error?.code ?? null }));
      return { name: "", photo: "" };
    }
    return { name: [data.first_name, data.last_name].filter(Boolean).join(" ").trim().slice(0, 160), photo: /^https:\/\//.test(data.profile_pic || "") ? data.profile_pic : "" };
  } catch (error) {
    console.warn("[messenger] perfil do contato indisponível:", error?.name || "erro");
    return { name: "", photo: "" };
  }
}

// Anexo recebido: o link da Meta expira, então a cópia vai para o bucket do Chat. Falhou → guarda o link original
// (aparece enquanto a Meta mantiver) e registra no log.
async function persistInboundAttachment(attachment, psid) {
  try {
    const response = await fetch(attachment.url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MEDIA_MAX_BYTES) throw new Error("tamanho fora do limite");
    const mime = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
    const { url, path } = await uploadChatMedia({ buffer, contentType: mime, fileName: attachment.name, folder: `messenger/${psid}` });
    return { ...attachment, url, path, mime };
  } catch (error) {
    console.warn("[messenger] anexo recebido não copiado para o CRM:", error?.message || error);
    return attachment;
  }
}

// --- Recebimento (webhook) ------------------------------------------------------------------------------------
async function findConversation(psid) {
  const { data, error } = await db().from(CONVERSATIONS).select("*").eq("thread_key", messengerThreadKey(psid)).maybeSingle();
  if (error) throw error;
  return data;
}

// Conversa nova: só a linha da conversa (sem responsável). Quem recebe é decidido depois de gravar a mensagem
// (`applyMessage` → `deliverMessengerConversation`), pela roleta — nunca fica com o dono por padrão.
async function createConversation(event) {
  const profile = await fetchMessengerProfile(event.psid);
  const { data, error } = await db().from(CONVERSATIONS).insert({
    thread_key: messengerThreadKey(event.psid),
    thread_url: "",
    contact_name: profile.name || "Cliente Messenger",
    contact_photo_url: profile.photo
  }).select("*").single();
  if (error?.code === "23505") return findConversation(event.psid); // outro evento criou ao mesmo tempo
  if (error) throw error;
  return data;
}

export function messengerOrigin(conversation) {
  return {
    kind: MESSENGER_ORIGIN_KIND,
    label: "Messenger — Página do Facebook",
    actor: "sistema",
    destination: "roulette",
    metadata: { threadKey: conversation.thread_key }
  };
}

// Cliente da conversa (vínculo pelo PSID = a própria conversa): criado só com o nome, responsável = quem tem a conversa.
// Só cadastro + vínculo + etiqueta: na roleta, histórico e aviso são do `distribute` (lib/marketplace-chat.js).
export async function createMessengerClient(conversation, responsibleUserId) {
  if (conversation.client_id) return conversation.client_id;
  const registration = await createMarketplaceRegistration({
    fullName: conversation.contact_name,
    responsibleUserId,
    acquisitionContext: messengerOrigin(conversation),
    fallbackName: "Cliente Messenger",
    historySource: MESSENGER_ORIGIN_KIND
  });
  const { data: linked, error } = await db().from(CONVERSATIONS).update({ client_id: registration.id }).eq("id", conversation.id).is("client_id", null).select("id");
  if (error) throw error;
  if (!linked?.length) console.warn("[messenger] conversa já tinha cliente; cadastro novo ficou sem conversa:", registration.id);
  await addSystemTagToClient(registration.id, MESSENGER_TAG, MESSENGER_TAG_COLOR).catch((tagError) => console.warn("[messenger] etiqueta não aplicada:", tagError?.message || tagError));
  return registration.id;
}

// "Adicionar ao CRM" manual (addMarketplaceConversationToCrm): cadastro + histórico + aviso a quem tem a conversa.
export async function ensureMessengerClient(conversation, responsibleUserId) {
  if (conversation.client_id) return conversation.client_id;
  const registration = { id: await createMessengerClient(conversation, responsibleUserId) };
  if (responsibleUserId) {
    await recordLeadDistributionHistory({ registration: { id: registration.id, full_name: conversation.contact_name }, eventType: "assigned", toUserId: responsibleUserId, details: { source: MESSENGER_ORIGIN_KIND, conversationId: conversation.id } })
      .catch((historyError) => console.warn("[messenger] histórico da atribuição falhou:", historyError?.message || historyError));
    const { error: noticeError } = await db().from("crm_notifications").insert({
      recipient_user_id: responsibleUserId,
      client_id: registration.id,
      title: "Novo cliente do Messenger",
      description: `${conversation.contact_name || "Um cliente"} chamou na Página do Facebook (Messenger). Responda pelo Chat Marketplace em até 24 horas.`,
      notification_type: "new_client",
      scheduled_at: new Date().toISOString()
    });
    if (noticeError) console.warn("[messenger] aviso de cliente novo falhou:", noticeError.message || noticeError);
  }
  return registration.id;
}

async function insertMessage(conversationId, row) {
  const { error } = await db().from(MESSAGES).insert({ conversation_id: conversationId, ...row });
  if (error?.code === "23505") return false; // mesmo mid já gravado (reenvio da Meta ou eco do nosso envio)
  if (error) throw error;
  return true;
}

async function applyMessage(event, now) {
  let conversation = await findConversation(event.psid);
  if (!conversation) {
    if (event.echo) return "ignored"; // a Página escreveu primeiro (fora do CRM) e o cliente nunca respondeu
    conversation = await createConversation(event);
  }
  const attachments = event.echo ? event.attachments : await Promise.all(event.attachments.map((item) => persistInboundAttachment(item, event.psid)));
  const row = messengerMessageRow({ ...event, attachments }, { contactName: conversation.contact_name });
  if (!(await insertMessage(conversation.id, row))) {
    // Reenvio da Meta depois de uma falha na distribuição: a mensagem já está gravada, mas a conversa ainda sem ninguém.
    if (needsMessengerDistribution(conversation, event)) await deliverMessengerConversation(conversation, now);
    return "duplicate";
  }
  const patch = { updated_at: now.toISOString() };
  if (!conversation.last_message_at || row.message_at >= conversation.last_message_at) {
    patch.last_message_at = row.message_at;
    patch.last_message_preview = messagePreview(row);
  }
  if (event.echo) {
    // Resposta escrita na caixa da Página (fora do CRM) também é resposta humana.
    if (!conversation.last_human_reply_at || row.message_at > conversation.last_human_reply_at) patch.last_human_reply_at = row.message_at;
  } else {
    patch.unread_count = Number(conversation.unread_count || 0) + 1;
    if (!conversation.last_inbound_at || row.message_at > conversation.last_inbound_at) patch.last_inbound_at = row.message_at;
    if (event.adReferral) patch.messenger_ad_referral_at = row.message_at;
  }
  const { data: updated, error } = await db().from(CONVERSATIONS).update(patch).eq("id", conversation.id).select("*").single();
  if (error) throw error;
  // Roleta (dono, 2026-10-25). Erro LANÇA: a Meta tenta de novo e o caminho do "duplicate" acima entrega.
  if (needsMessengerDistribution(updated, event)) await deliverMessengerConversation(updated, now);
  return event.echo ? "echo" : "inbound";
}

async function applyReceipt(event) {
  const column = event.type === "read" ? "messenger_read_at" : "messenger_delivered_at";
  const conversation = await findConversation(event.psid);
  if (!conversation) return "ignored";
  // Marca d'água: só avança (evento atrasado/repetido não volta o "Lida"/"Entregue").
  if (conversation[column] && Date.parse(conversation[column]) >= Date.parse(event.at)) return "duplicate";
  const { error } = await db().from(CONVERSATIONS).update({ [column]: event.at }).eq("id", conversation.id);
  if (error) throw error;
  return event.type;
}

async function applyReferral(event, now) {
  const { error } = await db().from(CONVERSATIONS).update({ messenger_ad_referral_at: now.toISOString() }).eq("thread_key", messengerThreadKey(event.psid));
  if (error) throw error;
  return "referral";
}

// Processa o webhook já com assinatura conferida. Página diferente da configurada → ignorado. Erro de banco LANÇA
// (a rota responde 500 e a Meta tenta de novo; o mid repetido é ignorado na nova tentativa).
export async function processMessengerWebhook(payload, now = new Date()) {
  const pageId = process.env.MESSENGER_PAGE_ID || "";
  if (!pageId) throw new MessengerError("MESSENGER_PAGE_ID não configurado.", 500, "not_configured");
  const events = parseMessengerWebhook(payload, pageId, now);
  const summary = { received: events.length, inbound: 0, echo: 0, duplicate: 0, delivery: 0, read: 0, referral: 0, ignored: 0 };
  for (const event of events) {
    let outcome;
    if (event.type === "message") outcome = await applyMessage(event, now);
    else if (event.type === "referral") outcome = await applyReferral(event, now);
    else outcome = await applyReceipt(event);
    summary[outcome] = (summary[outcome] || 0) + 1;
  }
  return summary;
}
