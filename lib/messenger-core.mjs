import { createHmac, timingSafeEqual } from "node:crypto";

// Messenger oficial da Página do Facebook (MSG-1, REGRA OFICIAL — dono, 2026-10-25). Regras PURAS: assinatura do
// webhook, leitura dos eventos, janela de resposta da Meta e montagem do envio. Servidor em lib/messenger.js; projeção
// no Chat Marketplace (mesmas tabelas, conversa com thread_key `messenger:<PSID>`) em lib/marketplace-chat.js.
// Fase 1: só receber e responder pelo CRM — nenhuma mensagem automática.

export const MESSENGER_THREAD_PREFIX = "messenger:";
export const MESSENGER_WINDOW_MS = 24 * 60 * 60 * 1000;
// Anúncio de clique para o Messenger: a Meta permite responder até 7 dias depois (só resposta humana; automática nunca
// fora das 24 h — e a fase 1 não tem automática).
export const MESSENGER_AD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MESSENGER_MAX_TEXT = 2000; // limite da Send API para texto
export const MESSENGER_ORIGIN_KIND = "facebook_messenger";
export const MESSENGER_TAG = "Messenger";
export const DEFAULT_MESSENGER_GRAPH_VERSION = "v23.0";

export class MessengerError extends Error {
  constructor(message, status = 400, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function messengerThreadKey(psid) {
  const id = String(psid || "").trim();
  return /^\d{1,40}$/.test(id) ? `${MESSENGER_THREAD_PREFIX}${id}` : "";
}

export function isMessengerThreadKey(threadKey) {
  return String(threadKey || "").startsWith(MESSENGER_THREAD_PREFIX);
}

export function psidFromThreadKey(threadKey) {
  return isMessengerThreadKey(threadKey) ? String(threadKey).slice(MESSENGER_THREAD_PREFIX.length) : "";
}

export function normalizeMessengerGraphVersion(value) {
  const version = String(value || DEFAULT_MESSENGER_GRAPH_VERSION).trim();
  return /^v\d+\.\d+$/.test(version) ? version : DEFAULT_MESSENGER_GRAPH_VERSION;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Falha fechado (mesmo padrão do whatsapp-master): sem segredo configurado nada é aceito.
export function verifyMessengerSignature(rawBody, signature, secret) {
  if (!secret || !String(signature || "").startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeEqual(signature, expected);
}

export function verifyMessengerChallenge(searchParams, expectedToken) {
  const mode = searchParams.get("hub.mode") || "";
  const token = searchParams.get("hub.verify_token") || "";
  const challenge = searchParams.get("hub.challenge") || "";
  return expectedToken && mode === "subscribe" && challenge && safeEqual(token, expectedToken) ? challenge : null;
}

function isAdReferral(referral) {
  if (!referral || typeof referral !== "object") return false;
  return String(referral.source || "").toUpperCase() === "ADS" || Boolean(referral.ad_id);
}

function toIso(timestamp, fallback) {
  const ms = Number(timestamp);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : fallback;
}

function readAttachments(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      const url = String(item?.payload?.url || "").trim();
      if (!/^https:\/\//i.test(url)) return null;
      const type = item?.type === "image" ? "image" : "file";
      const name = type === "image" ? "Foto" : item?.type === "video" ? "Vídeo" : item?.type === "audio" ? "Áudio" : "Arquivo";
      return { type, url, name, source: "messenger" };
    })
    .filter(Boolean);
}

// Lê o webhook (object = "page") e devolve os eventos da Página configurada, um por item de `messaging`, sem
// repetir mid (a Meta pode reenviar o mesmo evento: a idempotência final é o índice único conversa+external_id).
// type: message (do cliente ou eco da Página), delivery, read, referral. Postback (botão) vira mensagem com o título.
export function parseMessengerWebhook(payload, pageId, now = new Date()) {
  const events = [];
  if (!payload || payload.object !== "page" || !pageId) return events;
  const seen = new Set();
  const fallbackAt = now.toISOString();
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    if (String(entry?.id || "") !== String(pageId)) continue;
    for (const item of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const senderId = String(item?.sender?.id || "");
      const recipientId = String(item?.recipient?.id || "");
      const at = toIso(item?.timestamp, fallbackAt);
      if (item.message) {
        const echo = Boolean(item.message.is_echo);
        const psid = echo ? recipientId : senderId;
        const mid = String(item.message.mid || "");
        if (!messengerThreadKey(psid) || !mid || seen.has(mid)) continue;
        seen.add(mid);
        const referral = item.message.referral || item.referral || null;
        events.push({
          type: "message",
          psid,
          mid,
          echo,
          appId: echo && item.message.app_id ? String(item.message.app_id) : "",
          text: String(item.message.text || "").slice(0, 4000),
          attachments: readAttachments(item.message.attachments),
          at,
          adReferral: isAdReferral(referral)
        });
      } else if (item.postback) {
        const psid = senderId;
        const mid = String(item.postback.mid || `pb:${psid}:${item.timestamp || ""}`);
        if (!messengerThreadKey(psid) || seen.has(mid)) continue;
        seen.add(mid);
        events.push({ type: "message", psid, mid, echo: false, appId: "", text: String(item.postback.title || item.postback.payload || "").slice(0, 4000), attachments: [], at, adReferral: isAdReferral(item.postback.referral) });
      } else if (item.delivery) {
        if (!messengerThreadKey(senderId)) continue;
        events.push({ type: "delivery", psid: senderId, at: toIso(item.delivery.watermark, at) });
      } else if (item.read) {
        if (!messengerThreadKey(senderId)) continue;
        events.push({ type: "read", psid: senderId, at: toIso(item.read.watermark, at) });
      } else if (item.referral) {
        if (!messengerThreadKey(senderId) || !isAdReferral(item.referral)) continue;
        events.push({ type: "referral", psid: senderId, at, adReferral: true });
      }
    }
  }
  return events;
}

// Janela de resposta da Meta: 24 h desde a última mensagem do cliente; até 7 dias se a conversa veio de anúncio de
// clique para o Messenger. Fora dela o CRM bloqueia (sem tags de mensagem — as antigas foram descontinuadas).
export function messengerWindow({ lastInboundAt = null, adReferralAt = null } = {}, now = new Date()) {
  const nowMs = now.getTime();
  const inboundMs = Date.parse(lastInboundAt || "");
  const adMs = Date.parse(adReferralAt || "");
  const ends = [];
  if (Number.isFinite(inboundMs)) ends.push({ at: inboundMs + MESSENGER_WINDOW_MS, kind: "24h" });
  if (Number.isFinite(adMs) && Number.isFinite(inboundMs)) ends.push({ at: adMs + MESSENGER_AD_WINDOW_MS, kind: "7d" });
  if (!ends.length) return { open: false, endsAt: null, kind: null };
  const best = ends.reduce((a, b) => (b.at > a.at ? b : a));
  return { open: nowMs < best.at, endsAt: new Date(best.at).toISOString(), kind: best.kind };
}

export function messengerWindowClosedMessage() {
  return "A janela do Messenger está fechada: o cliente escreveu há mais de 24 horas (7 dias se veio de anúncio). Pela regra da Meta, só dá para responder quando ele mandar uma nova mensagem.";
}

export function validateMessengerText(text) {
  const body = String(text || "").trim();
  if (!body) throw new MessengerError("Digite uma mensagem.");
  if (body.length > MESSENGER_MAX_TEXT) throw new MessengerError(`Pelo Messenger a mensagem pode ter até ${MESSENGER_MAX_TEXT} caracteres.`);
  return body;
}

// Corpo da Send API (/me/messages). messaging_type RESPONSE (resposta dentro da janela); nunca tag.
export function buildMessengerSendBody(psid, { text = "", imageUrl = "" } = {}) {
  const message = imageUrl
    ? { attachment: { type: "image", payload: { url: imageUrl, is_reusable: false } } }
    : { text };
  return { recipient: { id: String(psid) }, messaging_type: "RESPONSE", message };
}

// Erro da Graph API → texto para o corretor (sem token, sem detalhe técnico além do código).
export function describeMessengerSendError(error = {}) {
  const code = Number(error?.code);
  const subcode = Number(error?.error_subcode);
  if (code === 10 && subcode === 2018278) return messengerWindowClosedMessage();
  if (code === 551 || subcode === 1545041) return "Esta pessoa não está disponível no Messenger agora (pode ter bloqueado a Página).";
  if (code === 190) return "O acesso do CRM à Página do Facebook expirou. Gere um novo token da Página (docs/MESSENGER.md).";
  if (code === 200 || code === 10) return "A Página não deu permissão de envio ao CRM (pages_messaging). Confira o app na Meta.";
  if (code === 613 || code === 4 || code === 32) return "A Meta limitou os envios por alguns minutos. Tente de novo daqui a pouco.";
  return `O Messenger recusou o envio${Number.isFinite(code) ? ` (código ${code})` : ""}.`;
}

// Projeção de uma mensagem do webhook numa linha de marketplace_messages (sem conversation_id).
export function messengerMessageRow(event, { contactName = "" } = {}) {
  return {
    external_id: event.mid,
    direction: event.echo ? "outbound" : "inbound",
    sender_name: event.echo ? "Página (enviada fora do CRM)" : contactName || "Cliente Messenger",
    body: event.text,
    attachments: event.attachments,
    status: event.echo ? "sent" : "received",
    sent_at: event.echo ? event.at : null,
    message_at: event.at
  };
}

// Status visto pelo corretor numa resposta do CRM pelo Messenger, a partir das marcas de entrega/leitura da conversa.
export function messengerReceiptLabel(row = {}, { deliveredAt = null, readAt = null } = {}) {
  if (row.direction !== "outbound" || row.status !== "sent") return "";
  const at = Date.parse(row.message_at || "");
  if (!Number.isFinite(at)) return "";
  if (readAt && Date.parse(readAt) >= at) return "Lida";
  if (deliveredAt && Date.parse(deliveredAt) >= at) return "Entregue";
  return "";
}

// --- Distribuição (MSG-1, REGRA OFICIAL — dono, 2026-10-25: "vai para a roleta, igual ao Marketplace") ------------
// A mensagem do Messenger chega na hora (webhook), nunca é carga antiga: da regra do dia do admin (1ª carga,
// `routeNewConversation`) só vale o par dia → pessoa; "não importar anteriores a", "sem data" e "antiga" não se
// aplicam → roleta.
export function messengerDeliveryRoute(route = {}) {
  return route?.kind === "assignee" && route.userId ? { kind: "assignee", userId: route.userId } : { kind: "roulette" };
}

// Mensagem do CLIENTE numa conversa sem ninguém e fora da fila de espera → entra na distribuição (conversa nova, nova
// tentativa da Meta depois de uma falha, ou conversa que ficou sem responsável e o cliente retomou — como no Marketplace).
export function needsMessengerDistribution(conversation, { echo = false } = {}) {
  return !echo && Boolean(conversation) && !conversation.assigned_user_id && !conversation.waiting_distribution_at;
}
