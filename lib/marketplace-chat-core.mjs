// Núcleo puro do Chat do Marketplace (MKT-2, dono, 2026-10-20). Sem banco nem rede — testado em
// tests/marketplace-chat-core.test.mjs. A extensão do PC do dono espelha só conversas do Marketplace; as respostas dos
// corretores saem por uma fila (nunca resposta automática).

// 1ª carga (REGRA OFICIAL — dono, 2026-10-21: "os clientes de hoje são do Eduardo, os de ontem da Jhenifer, os
// anteriores não carregue"). Lista de pares dia → pessoa (dia da ÚLTIMA mensagem do cliente, São Paulo): conversa
// desse dia vai direto à pessoa (vira cliente com ela, sem roleta). firstLoadIgnoreBefore: conversa cuja última
// mensagem do cliente é anterior a esse dia NÃO é importada (nem conversa nem mensagens) e não é distribuída.
// Substitui firstSyncAssigneeId/firstSyncDate (um dia só, 2026-10-20), que deixam de ser lidos.
export const DEFAULT_CHAT_SETTINGS = {
  syncEnabled: true,
  startHour: 7,
  endHour: 22,
  maxSendsPerHour: 20,
  firstLoadRules: [
    { date: "2026-10-21", userId: "295246ec-17f3-4ca2-9ce7-6369622438a2" }, // Eduardo Bueno
    { date: "2026-10-20", userId: "3fdc31e6-9c4c-4e8a-a50f-95567fc022ec" } // Jennyfer Zorzato
  ],
  firstLoadIgnoreBefore: "2026-10-20"
};
export const MAX_FIRST_LOAD_RULES = 10;
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
    firstLoadRules: Array.isArray(raw.firstLoadRules) ? normalizeFirstLoadRules(raw.firstLoadRules) : DEFAULT_CHAT_SETTINGS.firstLoadRules.map((rule) => ({ ...rule })),
    firstLoadIgnoreBefore: raw.firstLoadIgnoreBefore === undefined ? DEFAULT_CHAT_SETTINGS.firstLoadIgnoreBefore : (DATE_KEY.test(String(raw.firstLoadIgnoreBefore || "")) ? String(raw.firstLoadIgnoreBefore) : "")
  };
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Pares válidos (dia + pessoa), um por dia (o primeiro vence), mais recentes primeiro.
function normalizeFirstLoadRules(list) {
  const byDate = new Map();
  for (const item of list) {
    const date = String(item?.date || "");
    const userId = String(item?.userId || "");
    if (DATE_KEY.test(date) && UUID.test(userId) && !byDate.has(date)) byDate.set(date, { date, userId });
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_FIRST_LOAD_RULES);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function saoPauloDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

// Para onde vai uma conversa NOVA (lastActivityAt = última mensagem do CLIENTE; sem mensagem dele, a última atividade):
// - "ignore": anterior a firstLoadIgnoreBefore → não importa nem distribui (regra da 1ª carga, dono 2026-10-21);
// - "assignee": o dia bate com um par da 1ª carga → direto à pessoa (sem roleta);
// - "roulette": últimas 24 h → roleta;
// - "admin": mais antiga → fica sem atendente, com o admin (MKT-2 decisão 4).
// Data desconhecida (null) com a 1ª carga ligada → "admin" (nunca atribui/ignora no escuro).
export function routeNewConversation({ lastActivityAt = null, now = new Date(), settings = {} } = {}) {
  const rules = Array.isArray(settings.firstLoadRules) ? settings.firstLoadRules : [];
  if (!lastActivityAt && (rules.length || settings.firstLoadIgnoreBefore)) return { kind: "admin", reason: "sem_data" };
  const at = lastActivityAt ? new Date(lastActivityAt) : now;
  const day = saoPauloDateKey(at);
  if (settings.firstLoadIgnoreBefore && day < settings.firstLoadIgnoreBefore) return { kind: "ignore" };
  const rule = rules.find((item) => item.date === day);
  if (rule) return { kind: "assignee", userId: rule.userId };
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

// --- Mensagem do Facebook (2026-10-21) -------------------------------------------------------------------------
// O texto que a extensão lê é o aria-label do balão: "Pressione Enter, Mensagem enviada 10:18 por Você: Bom dia" /
// "Pressione Enter, Mensagem enviada 28 de setembro de 2026 14:25 por Rafael: Oi" (inglês: "Press Enter, Message sent
// … by …: …"). Daqui sai o TEXTO, o QUANDO e o QUEM (fonte principal da direção: "Você"/"You" = nossa). Avatar do
// remetente não é anexo; balão sem texto nem anexo e aviso do Facebook ("… está aguardando a sua resposta.") saem.
// Vale na sincronização (normalizeSyncPayload) e na renormalização do que já foi gravado (lib/marketplace-chat.js).
const LABEL_RE = /^\s*(?:(?:pressione|press)\s+enter\s*,\s*)?(?:mensagem enviada|message sent)\s+(.+?)\s+(?:por|by)\s+([^:]+?)\s*(?::\s*([\s\S]*))?$/i;
const SYSTEM_MESSAGE_RE = [/est[aá] aguardando (a )?sua resposta/i, /is waiting for (your|a) (reply|response)/i, /^(voc[eê] enviou|you sent)\b/i, /^(visto por|seen by)\b/i];
const OWN_SENDER = new Set(["voce", "you"]);
const MONTHS = { jan: 0, janeiro: 0, january: 0, fev: 1, fevereiro: 1, feb: 1, february: 1, mar: 2, marco: 2, march: 2, abr: 3, abril: 3, apr: 3, april: 3, mai: 4, maio: 4, may: 4, jun: 5, junho: 5, june: 5, jul: 6, julho: 6, july: 6, ago: 7, agosto: 7, aug: 7, august: 7, set: 8, setembro: 8, sep: 8, sept: 8, september: 8, out: 9, outubro: 9, oct: 9, october: 9, nov: 10, novembro: 10, november: 10, dez: 11, dezembro: 11, dec: 11, december: 11 };
const WEEKDAYS = { domingo: 0, dom: 0, sunday: 0, sun: 0, segunda: 1, seg: 1, monday: 1, mon: 1, terca: 2, ter: 2, tuesday: 2, tue: 2, quarta: 3, qua: 3, wednesday: 3, wed: 3, quinta: 4, qui: 4, thursday: 4, thu: 4, sexta: 5, sex: 5, friday: 5, fri: 5, sabado: 6, sab: 6, saturday: 6, sat: 6 };

function plainText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Dia (São Paulo) + hora → ISO. Brasil sem horário de verão: -03:00.
function spIso(year, month, day, hour, minute) {
  const pad = (n) => String(n).padStart(2, "0");
  const at = new Date(`${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00-03:00`);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

// "10:18" (hoje), "ontem 14:25", "segunda-feira 14:25", "28 de setembro de 2026 14:25", "28 de set. 14:25",
// "September 28, 2026 2:25 PM", "28/09/2026 14:25". Devolve ISO ou null.
export function parseFacebookWhen(text, now = new Date()) {
  const value = plainText(text).replace(/\b(as|at)\b/g, " ").replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return null;
  const clock = value.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (!clock) return null;
  let hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (clock[3] === "pm" && hour < 12) hour += 12;
  if (clock[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const [y, m, d] = saoPauloDateKey(now).split("-").map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  const shift = (days) => {
    const date = new Date(today.getTime() - days * 86400000);
    return spIso(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
  };
  const rest = value.replace(clock[0], " ").replace(/\s+/g, " ").trim();
  if (!rest || /^(hoje|today)$/.test(rest)) return shift(0);
  if (/^(ontem|yesterday)$/.test(rest)) return shift(1);
  const weekday = rest.replace(/-feira$/, "").split(" ")[0];
  if (weekday in WEEKDAYS && rest.split(" ").length === 1) {
    const back = (today.getUTCDay() - WEEKDAYS[weekday] + 7) % 7 || 7;
    return shift(back);
  }
  let match = rest.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  let day;
  let month;
  let year;
  if (match) [day, month, year] = [Number(match[1]), Number(match[2]) - 1, Number(match[3] || 0)];
  match = !match && rest.match(/^(\d{1,2}) (?:de )?([a-z]+)(?: (?:de )?(\d{4}))?$/);
  if (match) [day, month, year] = [Number(match[1]), MONTHS[match[2]], Number(match[3] || 0)];
  match = day === undefined && rest.match(/^([a-z]+) (\d{1,2})(?: (\d{4}))?$/);
  if (match) [day, month, year] = [Number(match[2]), MONTHS[match[1]], Number(match[3] || 0)];
  if (!(day >= 1 && day <= 31) || !(month >= 0 && month <= 11)) return null;
  if (year && year < 100) year += 2000;
  let iso = spIso(year || y, month, day, hour, minute);
  // Sem ano e "no futuro" → é do ano passado.
  if (iso && !year && new Date(iso).getTime() > now.getTime() + 86400000) iso = spIso(y - 1, month, day, hour, minute);
  return iso;
}

function isAvatarUrl(url, contactPhotoUrl = "") {
  const value = String(url || "");
  if (contactPhotoUrl && value === contactPhotoUrl) return true;
  // Foto de perfil do Facebook (t39.30808-1) e miniaturas ≤ 40 px (p32x32, s40x40…).
  return /\/t39\.30808-1\//.test(value) || /[_/?&=](?:p|s|c)(?:1\d|2\d|3\d|40)x(?:1\d|2\d|3\d|40)(?:[_&/.]|$)/.test(value);
}

// Mensagem lida → { body, direction, at, senderName, attachments } ou null (descartar).
export function normalizeFacebookMessage(message = {}, { contactPhotoUrl = "", now = new Date() } = {}) {
  let body = String(message.body ?? "").replace(/\r\n/g, "\n").trim();
  let direction = message.direction;
  let at = message.at || null;
  let senderName = message.senderName || "";
  const label = body.match(LABEL_RE);
  if (label) {
    const who = label[2].trim();
    body = String(label[3] || "").trim();
    direction = OWN_SENDER.has(plainText(who)) ? "outbound" : "inbound";
    senderName = direction === "inbound" ? who : "";
    at = parseFacebookWhen(label[1], now) || at;
  } else {
    // Só o prefixo de acessibilidade, sem o resto do rótulo.
    body = body.replace(/^\s*(?:pressione|press)\s+enter\s*,\s*/i, "");
  }
  if (body && SYSTEM_MESSAGE_RE.some((pattern) => pattern.test(body))) return null;
  const attachments = (Array.isArray(message.attachments) ? message.attachments : []).filter((item) => !isAvatarUrl(item?.url, contactPhotoUrl));
  if (!body && !attachments.length) return null;
  return { body, direction, at, senderName, attachments };
}

// Valida o que a extensão manda. Descarta (não falha) item malformado: a sincronização seguinte reenvia.
export function normalizeSyncPayload(body = {}, now = new Date()) {
  const list = Array.isArray(body?.conversations) ? body.conversations.slice(0, MAX_SYNC_CONVERSATIONS) : [];
  const conversations = [];
  for (const raw of list) {
    const threadKey = String(raw?.threadKey || "").trim();
    if (!THREAD_KEY.test(threadKey)) continue;
    const messages = [];
    const contactPhotoUrl = isHttpsUrl(raw.contactPhotoUrl) ? String(raw.contactPhotoUrl).slice(0, 1000) : "";
    for (const message of (Array.isArray(raw.messages) ? raw.messages : []).slice(-MAX_SYNC_MESSAGES)) {
      const externalId = String(message?.externalId || "").trim().slice(0, 200);
      const rawDirection = message?.direction === "outbound" ? "outbound" : message?.direction === "inbound" ? "inbound" : "";
      const rawAt = new Date(message?.at || "");
      const parsed = normalizeFacebookMessage({
        body: clean(message?.body, 4500),
        direction: rawDirection,
        at: Number.isFinite(rawAt.getTime()) ? rawAt.toISOString() : null,
        attachments: (Array.isArray(message?.attachments) ? message.attachments : []).map(normalizeAttachment).filter(Boolean).slice(0, 10)
      }, { contactPhotoUrl, now });
      if (!externalId || !parsed || !parsed.direction) continue;
      messages.push({ externalId, direction: parsed.direction, body: clean(parsed.body, 4000), attachments: parsed.attachments, at: parsed.at, senderName: clean(parsed.senderName, 120) });
    }
    // Ordem real da conversa quando todas têm hora (rótulo do Facebook); senão, a ordem da tela.
    if (messages.every((message) => message.at)) messages.sort((a, b) => new Date(a.at) - new Date(b.at));
    const lastActivity = new Date(raw.lastActivityAt || "");
    const lastActivityAt = Number.isFinite(lastActivity.getTime()) && lastActivity.getTime() <= Date.now() + 5 * 60 * 1000 && lastActivity.getTime() > Date.now() - 400 * 24 * 60 * 60 * 1000 ? lastActivity.toISOString() : null;
    conversations.push({
      threadKey,
      lastActivityAt,
      threadUrl: isFacebookUrl(raw.threadUrl) ? String(raw.threadUrl).slice(0, 500) : "",
      contactName: clean(raw.contactName, 120) || "Contato do Marketplace",
      contactPhotoUrl,
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
