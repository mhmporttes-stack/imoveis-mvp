// Núcleo puro do Chat do Marketplace (MKT-2, dono, 2026-10-20). Sem banco nem rede — testado em
// tests/marketplace-chat-core.test.mjs. A extensão do PC do dono espelha só conversas do Marketplace; as respostas dos
// corretores saem por uma fila (nunca resposta automática).

// firstSyncAssigneeId/firstSyncDate: "Atribuir conversas novas com mensagem do dia a: [corretor]" (dono, 2026-10-20 —
// nesse dia, à Jennyfer Zorzato, em vez da roleta/admin). Só vale na data configurada (São Paulo).
export const DEFAULT_CHAT_SETTINGS = {
  syncEnabled: true,
  startHour: 7,
  endHour: 22,
  maxSendsPerHour: 20,
  firstSyncAssigneeId: "3fdc31e6-9c4c-4e8a-a50f-95567fc022ec",
  firstSyncDate: "2026-10-20"
};
export const CHAT_SETTINGS_ID = "marketplace_chat";
export const MAX_SYNC_CONVERSATIONS = 30;
// 1ª leitura de uma conversa traz o histórico inteiro (dono, 2026-10-20); depois só as novas.
export const MAX_SYNC_MESSAGES = 500;
export const DISTRIBUTE_RECENT_MS = 24 * 60 * 60 * 1000;
export const MAX_OUTBOUND_LENGTH = 2000;
export const MAX_SEND_ATTEMPTS = 2;
// Mesmo prazo da regra "REDISTRIBUIÇÃO DE LEADS" de hoje (10 min, ROL-4b/2026-10-12): conversa recebida pela roleta sem
// resposta de ninguém da equipe nesse prazo vai para o próximo corretor on-line.
export const REDISTRIBUTION_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_REDISTRIBUTIONS = 3;
export const STALE_SENDING_MS = 10 * 60 * 1000;

export class MarketplaceChatError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const clean = (value, max) => String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

export function normalizeChatSettings(raw = {}) {
  const hour = (value, fallback) => (Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 24 ? Number(value) : fallback);
  const startHour = hour(raw.startHour, DEFAULT_CHAT_SETTINGS.startHour);
  const endHour = hour(raw.endHour, DEFAULT_CHAT_SETTINGS.endHour);
  const max = Number(raw.maxSendsPerHour);
  return {
    syncEnabled: raw.syncEnabled !== false,
    startHour: Math.min(startHour, endHour),
    endHour: Math.max(startHour, endHour),
    maxSendsPerHour: Number.isInteger(max) && max >= 1 && max <= 60 ? max : DEFAULT_CHAT_SETTINGS.maxSendsPerHour,
    firstSyncAssigneeId: raw.firstSyncAssigneeId === undefined ? DEFAULT_CHAT_SETTINGS.firstSyncAssigneeId : (UUID.test(String(raw.firstSyncAssigneeId || "")) ? String(raw.firstSyncAssigneeId) : ""),
    firstSyncDate: raw.firstSyncDate === undefined ? DEFAULT_CHAT_SETTINGS.firstSyncDate : (/^\d{4}-\d{2}-\d{2}$/.test(String(raw.firstSyncDate || "")) ? String(raw.firstSyncDate) : "")
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function saoPauloDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

// Para onde vai uma conversa NOVA com mensagem do cliente:
// - "assignee": atribuição do dia ligada (data de hoje) e a última mensagem é de hoje → direto à pessoa configurada;
// - "roulette": última mensagem do cliente nas últimas 24 h → roleta;
// - "admin": mais antiga (histórico da 1ª sincronização) → fica sem atendente, com o admin.
export function routeNewConversation({ lastActivityAt = null, now = new Date(), settings = {} } = {}) {
  const at = lastActivityAt ? new Date(lastActivityAt) : now;
  const today = saoPauloDateKey(now);
  if (settings.firstSyncAssigneeId && settings.firstSyncDate === today && saoPauloDateKey(at) === today) return { kind: "assignee", userId: settings.firstSyncAssigneeId };
  if (now.getTime() - at.getTime() <= DISTRIBUTE_RECENT_MS) return { kind: "roulette" };
  return { kind: "admin" };
}

// O Messenger não mostra a hora de cada mensagem: a última recebe a hora da última atividade da conversa (lida na caixa
// do Marketplace) e as anteriores ficam 1 s antes, cada uma, para manter a ordem.
export function assignMessageTimes(messages = [], lastAt = new Date()) {
  const base = new Date(lastAt).getTime();
  return messages.map((message, index) => ({ ...message, at: message.at || new Date(base - (messages.length - 1 - index) * 1000).toISOString() }));
}

function isFacebookUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && /(^|\.)(facebook|messenger)\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}

const THREAD_KEY = /^[A-Za-z0-9_.:-]{1,120}$/;

function normalizeAttachment(item) {
  const url = String(item?.url || "").trim();
  if (!isHttpsUrl(url)) return null;
  const type = ["image", "file", "link"].includes(item?.type) ? item.type : "link";
  return { type, url: url.slice(0, 1000), name: clean(item?.name, 120) };
}

// Valida o que a extensão manda. Descarta (não falha) item malformado: a sincronização seguinte reenvia.
export function normalizeSyncPayload(body = {}) {
  const list = Array.isArray(body?.conversations) ? body.conversations.slice(0, MAX_SYNC_CONVERSATIONS) : [];
  const conversations = [];
  for (const raw of list) {
    const threadKey = String(raw?.threadKey || "").trim();
    if (!THREAD_KEY.test(threadKey)) continue;
    const messages = [];
    for (const message of (Array.isArray(raw.messages) ? raw.messages : []).slice(-MAX_SYNC_MESSAGES)) {
      const externalId = String(message?.externalId || "").trim().slice(0, 200);
      const direction = message?.direction === "outbound" ? "outbound" : message?.direction === "inbound" ? "inbound" : "";
      const text = clean(message?.body, 4000);
      const attachments = (Array.isArray(message?.attachments) ? message.attachments : []).map(normalizeAttachment).filter(Boolean).slice(0, 10);
      const at = new Date(message?.at || "");
      if (!externalId || !direction || (!text && !attachments.length)) continue;
      messages.push({ externalId, direction, body: text, attachments, at: Number.isFinite(at.getTime()) ? at.toISOString() : null });
    }
    const lastActivity = new Date(raw.lastActivityAt || "");
    const lastActivityAt = Number.isFinite(lastActivity.getTime()) && lastActivity.getTime() <= Date.now() + 5 * 60 * 1000 && lastActivity.getTime() > Date.now() - 400 * 24 * 60 * 60 * 1000 ? lastActivity.toISOString() : null;
    conversations.push({
      threadKey,
      lastActivityAt,
      threadUrl: isFacebookUrl(raw.threadUrl) ? String(raw.threadUrl).slice(0, 500) : "",
      contactName: clean(raw.contactName, 120) || "Contato do Marketplace",
      contactPhotoUrl: isHttpsUrl(raw.contactPhotoUrl) ? String(raw.contactPhotoUrl).slice(0, 1000) : "",
      listingTitle: clean(raw.listingTitle, 200),
      listingUrl: isFacebookUrl(raw.listingUrl) ? String(raw.listingUrl).slice(0, 500) : "",
      messages
    });
  }
  return conversations;
}

function plain(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Liga a conversa ao anúncio do CRM: link do Marketplace igual, senão título igual (sem acento/caixa).
export function matchListing({ listingUrl = "", listingTitle = "" } = {}, listings = []) {
  const itemId = (url) => String(url || "").match(/\/marketplace\/item\/(\d+)/)?.[1] || "";
  const id = itemId(listingUrl);
  if (id) {
    const byUrl = listings.find((listing) => itemId(listing.marketplace_url) === id);
    if (byUrl) return byUrl;
  }
  const title = plain(listingTitle);
  return title ? listings.find((listing) => plain(listing.title) === title) || null : null;
}

export function messagePreview(message) {
  const text = String(message?.body || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 140);
  return message?.attachments?.length ? "[Anexo]" : "";
}

// Conversa recebida pela roleta e ninguém da equipe respondeu no prazo → próximo corretor on-line.
export function shouldRedistribute(conversation, now = new Date()) {
  if (!conversation?.assigned_user_id || !conversation.assigned_at) return false;
  if (Number(conversation.redistributions || 0) >= MAX_REDISTRIBUTIONS) return false;
  const assignedAt = new Date(conversation.assigned_at).getTime();
  const replied = conversation.last_human_reply_at && new Date(conversation.last_human_reply_at).getTime() >= assignedAt;
  return !replied && now.getTime() - assignedAt >= REDISTRIBUTION_TIMEOUT_MS;
}

export function validateOutboundText(text) {
  const body = String(text || "").trim();
  if (!body) throw new MarketplaceChatError("Digite uma mensagem.");
  if (body.length > MAX_OUTBOUND_LENGTH) throw new MarketplaceChatError(`A mensagem passa do limite de ${MAX_OUTBOUND_LENGTH} caracteres.`);
  return body;
}

export function evaluateOutboxGate({ syncEnabled = true, sentLastHour = 0, maxSendsPerHour = DEFAULT_CHAT_SETTINGS.maxSendsPerHour, hasSending = false } = {}) {
  if (!syncEnabled) return { allowed: false, reason: "chat_desligado" };
  if (hasSending) return { allowed: false, reason: "envio_em_andamento" };
  if (sentLastHour >= maxSendsPerHour) return { allowed: false, reason: "limite_por_hora" };
  return { allowed: true, reason: null };
}

// Retorno da extensão para uma resposta da fila. retry=true só quando nada foi enviado (falhou antes do Enter).
export function planOutboundResult(message, body = {}, now = new Date()) {
  if (message?.status !== "sending") throw new MarketplaceChatError("Esta mensagem não está em envio.", 409);
  const iso = now.toISOString();
  if (body.status === "sent") return { status: "sent", sent_at: iso, error: null, external_id: body.externalId ? String(body.externalId).slice(0, 200) : message.external_id || null };
  if (body.status === "failed") {
    const canRetry = body.retry === true && Number(message.attempts || 0) < MAX_SEND_ATTEMPTS;
    return { status: canRetry ? "queued" : "failed", error: clean(body.error, 500) || "Falha sem descrição.", claimed_at: canRetry ? null : message.claimed_at };
  }
  throw new MarketplaceChatError("Resultado inválido.");
}

// O que a extensão recebe para enviar. Nada além disso.
export function toOutboxPayload(message, conversation) {
  return { id: message.id, threadKey: conversation.thread_key, threadUrl: conversation.thread_url, body: message.body, attempt: Number(message.attempts || 0) };
}

// Mensagem de saída vista no Facebook que é a MESMA resposta enviada pelo CRM (ainda sem id do Facebook): liga em vez de
// duplicar. Mesmo texto, enviada pelo CRM há até 2 h.
export function findOutboundEcho(synced, candidates = [], now = new Date()) {
  if (synced?.direction !== "outbound") return null;
  const text = plain(synced.body);
  if (!text) return null;
  return candidates.find((row) => !row.external_id && row.direction === "outbound" && ["sent", "sending"].includes(row.status)
    && plain(row.body) === text && now.getTime() - new Date(row.sent_at || row.created_at).getTime() <= 2 * 60 * 60 * 1000) || null;
}
