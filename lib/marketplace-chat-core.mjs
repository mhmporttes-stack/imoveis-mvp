// Núcleo puro do Chat do Marketplace (MKT-2, dono, 2026-10-20). Sem banco nem rede — testado em
// tests/marketplace-chat-core.test.mjs. A extensão do PC do dono espelha só conversas do Marketplace; as respostas dos
// corretores saem por uma fila. Única resposta automática: a de disponibilidade (MKT-2l, dono 2026-10-24), pela mesma fila.

import { officialWhatsappUrl } from "./official-whatsapp.mjs";
import { withContactCode } from "./whatsapp-contact-code-core.mjs";

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
  firstLoadIgnoreBefore: "2026-10-20",
  // MKT-2l (REGRA OFICIAL — dono, 2026-10-24): resposta automática à pergunta padrão "ainda está disponível?". Nasce ligada.
  availabilityAutoReply: true
};
export const MAX_FIRST_LOAD_RULES = 10;
export const CHAT_SETTINGS_ID = "marketplace_chat";
export const MAX_SYNC_CONVERSATIONS = 30;
// 1ª leitura de uma conversa traz o histórico inteiro (dono, 2026-10-20); depois só as novas.
export const MAX_SYNC_MESSAGES = 500;
export const DISTRIBUTE_RECENT_MS = 24 * 60 * 60 * 1000;
// Acumulado da extensão desligada (REGRA OFICIAL — dono, 2026-10-26, MKT-2m): "Existem vários clientes aguardando resposta
// no Marketplace, porém a extensão está fora... O que eu quero: que os clientes sejam respondidos automaticamente por
// automação." Refinado no mesmo dia: "Isso é válido apenas para as mensagens 'esse item ainda está disponível'. Se o
// cliente enviar alguma coisa diferente não recebe mensagem automática, e o Henry depois na cena de bom dia me diz: 'Dos 10,
// 8 eu já iniciei o atendimento e transferi para seus associados; 2 clientes eu estou aguardando sua aprovação para
// atender.'" Conversa NOVA lida pela 1ª vez com a última mensagem do cliente entre 30 min e 7 dias atrás = ACUMULADO
// (chegou com a extensão sem ler): só a pergunta padrão → resposta automática + roleta; qualquer outro texto → sem
// automática e fora da roleta, "aguardando aprovação do dono" (planBacklogConversation). Mais antiga que 7 dias continua
// com o admin (MKT-2 decisão 4). 30 min (= o aviso de extensão sem sinal, MKT-2g) e 7 dias são escolhas técnicas.
export const MARKETPLACE_BACKLOG_MS = 7 * 24 * 60 * 60 * 1000;
export const MARKETPLACE_BACKLOG_MIN_AGE_MS = 30 * 60 * 1000;
export const MAX_OUTBOUND_LENGTH = 2000;
// Envio pelo Facebook (dono, 2026-10-22: os corretores dependem 100% do envio pelo CRM). MAX_SEND_ATTEMPTS = teto antigo
// (3 tentativas), que hoje só vale para o reprocessamento manual (reprocessMarketplaceOutboundFailures).
export const MAX_SEND_ATTEMPTS = 3;
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] Mensagem não entregue (MKT-2e): "se a mensagem não foi enviada, você
// espera 30 segundos e tenta enviar de novo, até ela ser concluída." Reenvio automático pela fila da extensão a cada
// 30 s, no ritmo da extensão e dentro do limite por hora (cada reenvio conta). Para — e fica "Não enviada", com alerta —
// quando o Facebook bloqueou/encerrou a conversa, quando o cliente está em "Não contactar"/telefone bloqueado ou depois de
// AUTO_RESEND_MAX_MS desde que o corretor escreveu (teto de segurança). Nunca reenvia no escuro: depois de uma tentativa
// que chegou a apertar Enter (ou ficou sem retorno), a extensão 1.9.6+ CONFERE a conversa antes de digitar de novo
// (`verify` no pedido); a extensão antiga, que não sabe conferir, mantém a regra de antes ("Não enviada" na hora).
export const SEND_RETRY_INTERVAL_MS = 30 * 1000;
export const STALE_SENDING_MS = 10 * 60 * 1000;
export const AUTO_RESEND_MAX_MS = 24 * 60 * 60 * 1000;
export const AUTO_RESEND_MIN_VERSION = "1.9.6";
// Motivo da parada do reenvio, gravado no começo do `error` (texto interno; o corretor vê só a frase de RESEND_STOP_LABELS).
export const RESEND_STOP = Object.freeze({ CLOSED: "conversa_bloqueada", DO_NOT_CONTACT: "nao_contactar", TIMEOUT: "prazo_24h" });
export const RESEND_STOP_LABELS = Object.freeze({
  conversa_bloqueada: "o Facebook bloqueou ou encerrou esta conversa",
  nao_contactar: "cliente em Não contactar",
  prazo_24h: "não saiu em 24 h de tentativas"
});
export const UNDELIVERED_LABEL = "Mensagem não entregue — reenviando automaticamente";
// Registro das tentativas da última hora (o limite por hora conta cada reenvio — dono, 2026-10-24).
export const OUTBOX_ATTEMPTS_ID = "marketplace_outbox_attempts";
const HOUR_MS = 60 * 60 * 1000;
// Origem da atribuição da conversa (MKT-2e, dono 2026-10-22). Só "roulette" tem prazo de resposta: 1ª carga (escolha
// explícita do dono), transferência manual e "quem respondeu assumiu" nunca são redistribuídas. Vazio = conversa
// atribuída antes da coluna existir → tratada como 1ª carga (fora do prazo).
// "roulette_stalled" = girou pela equipe inteira em 24 h (mesma trava da roleta): fica com quem está, sem novo prazo.
export const ASSIGNMENT_SOURCE = Object.freeze({ ROULETTE: "roulette", ROULETTE_STALLED: "roulette_stalled", FIRST_LOAD: "first_load", MANUAL: "manual", REPLY: "reply" });
// Monitoramento do job (MKT-2e): sem rodar com sucesso há mais disto → alerta aos admins gerais. O job roda a cada 2 min
// no cron `scheduled-activities`; 10 min = 5 rodadas perdidas seguidas.
export const REDISTRIBUTION_JOB_ID = "marketplace_redistribution_job";
export const REDISTRIBUTION_STALL_MS = 10 * 60 * 1000;

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
    firstLoadIgnoreBefore: raw.firstLoadIgnoreBefore === undefined ? DEFAULT_CHAT_SETTINGS.firstLoadIgnoreBefore : (DATE_KEY.test(String(raw.firstLoadIgnoreBefore || "")) ? String(raw.firstLoadIgnoreBefore) : ""),
    availabilityAutoReply: raw.availabilityAutoReply !== false
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
// - "roulette": últimos 7 dias (MARKETPLACE_BACKLOG_MS; era 24 h até 2026-10-26, MKT-2m: acumulado da extensão desligada) → roleta;
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
  if (now.getTime() - at.getTime() <= MARKETPLACE_BACKLOG_MS) return { kind: "roulette" };
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
// Avisos do Facebook (pt/en). A mesma lista existe na extensão (MP.inbox.systemPatterns, selectors.js).
const SYSTEM_MESSAGE_RE = [
  /est[aá] aguardando (a )?sua resposta/i, /is waiting for (your|a) (reply|response)/i, /^(voc[eê] enviou|you sent)\b/i, /^(visto por|seen by)\b/i,
  /\biniciou esta conversa\b/i, /\bstarted this (conversation|chat)\b/i,
  /\bmarcou (.+ )?como (vendido|pendente|disponivel|disponível)\b/i, /\bmarked (.+ )?as (sold|pending|available)\b/i,
  /^(voc[eê]|voce) (agora )?pode (enviar|mandar) mensage(m|ns)\b/i, /^you can (now )?send messages\b/i, /^you can now (message|reply)\b/i,
  /^envie uma resposta r[aá]pida\b/i, /^toque em uma resposta para envi[aá]-la/i, /^send a quick reply\b/i, /^tap a reply to send\b/i
];
// Sugestão de resposta rápida do Facebook PARA O VENDEDOR (o chip do painel "Envie uma resposta rápida"), que o Facebook
// guarda na conversa com id próprio (data-message-id) logo depois da pergunta do comprador — 18 conversas gravadas como
// "mensagem do cliente" de 22 a 24/10/2026 (casos Debora e Andreza). Comprador nunca escreve isso: inbound com esse texto
// exato não é mensagem. A mesma lista existe na extensão (MP.inbox.quickReplySuggestions, selectors.js).
const QUICK_REPLY_SUGGESTION_RE = [/^sim,? voce tem interesse\??$/, /^yes,? are you interested\??$/];
export function isQuickReplySuggestion(text) {
  const value = plainText(text).replace(/[.!]+$/, "").trim();
  return Boolean(value) && QUICK_REPLY_SUGGESTION_RE.some((pattern) => pattern.test(value));
}
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
  if (direction === "inbound" && isQuickReplySuggestion(body)) return null;
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
    // Conversa lida pela estrutura real (há data-message-id): o que não tem id do Facebook não é mensagem — painel de
    // respostas rápidas, chips e avisos que versões antigas da extensão liam pela geometria (caso Debora, 2026-10-22).
    if (messages.some((message) => message.externalId.startsWith("fb:"))) {
      for (let i = messages.length - 1; i >= 0; i -= 1) if (!messages[i].externalId.startsWith("fb:")) messages.splice(i, 1);
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
  if (!message?.attachments?.length) return "";
  return message.attachments[0]?.type === "image" ? "[Foto]" : message.attachments[0]?.type === "file" ? "[Arquivo]" : "[Anexo]";
}

// Conversa recebida pela ROLETA e ninguém da equipe respondeu no prazo da roleta → próximo corretor on-line (MKT-2e).
// `deadlineMs` = prazo da regra "REDISTRIBUIÇÃO DE LEADS" do banco (fonte única, getRouletteRedistributionDeadlineMs);
// sem regra ligada (null) a roleta não redistribui ninguém, e o Marketplace também não. "Respondeu" (REGRA OFICIAL —
// dono, 2026-10-22: "quando o corretor responder, ele tem que ser fidelizado a esse corretor") = resposta humana escrita
// depois de receber: vista no Facebook (`last_human_reply_at`) OU escrita pelo Chat do CRM (`humanReplySince` = a mais
// recente outbound com sender_user_id), em QUALQUER status de envio — na fila, enviando, enviada ou FALHOU. Falha da
// extensão nunca tira o cliente de quem respondeu. Mensagem interna (MKT-2i) não conta (fica fora da consulta).
export function shouldRedistribute(conversation, now = new Date(), { deadlineMs = null, humanReplySince = null } = {}) {
  if (!conversation?.assigned_user_id || !conversation.assigned_at) return false;
  if (conversation.assignment_source !== ASSIGNMENT_SOURCE.ROULETTE) return false;
  if (!(Number(deadlineMs) > 0)) return false;
  const assignedAt = new Date(conversation.assigned_at).getTime();
  if (!Number.isFinite(assignedAt)) return false;
  const after = (value) => Boolean(value) && new Date(value).getTime() >= assignedAt;
  if (after(conversation.last_human_reply_at) || after(humanReplySince)) return false;
  return now.getTime() - assignedAt >= Number(deadlineMs);
}

// Mesma trava da roleta (return_to_round_robin, lib/crm-automations.js): o cliente já girou pela equipe elegível inteira
// nas últimas 24 h → para de transferir sozinho e avisa o dono.
export function roundRobinCycleComplete({ recentHops = 0, poolSize = 0 } = {}) {
  return Number(poolSize) > 0 && Number(recentHops || 0) >= Number(poolSize);
}

// Job sem rodar com sucesso há mais de REDISTRIBUTION_STALL_MS (falhando ou sem ser chamado) → alerta. Referência = último
// sucesso; se nunca teve sucesso, a 1ª rodada registrada. Sem registro algum: nada a medir.
export function decideRedistributionStall(heartbeat = null, now = Date.now(), thresholdMs = REDISTRIBUTION_STALL_MS) {
  const reference = new Date(heartbeat?.last_ok_at || heartbeat?.first_seen_at || 0).getTime();
  if (!Number.isFinite(reference) || reference <= 0) return { stalled: false };
  const silentMs = now - reference;
  if (silentMs <= thresholdMs) return { stalled: false };
  const episode = new Date(reference).toISOString();
  return { stalled: true, episode, minutes: Math.floor(silentMs / 60_000), lastError: String(heartbeat?.last_error || "").slice(0, 300), dedupeKey: `${REDISTRIBUTION_JOB_ID}:${episode}` };
}

// --- Sinal da extensão (REGRA OFICIAL — dono, 2026-10-22, MKT-2g) ----------------------------------------------
// A extensão chama a sincronização em todo ciclo, mesmo sem conversa nova: cada chamada grava `last_sync_at` em
// crm_settings (EXTENSION_SIGNAL_ID). O cron `whatsapp-flows` confere: mais de 30 min sem sinal DENTRO do horário da
// sincronização (padrão 7h–22h, São Paulo) → 1 aviso aos admins por episódio (episódio = o último sinal); quando o sinal
// volta depois de um aviso → aviso de volta. O tempo fora do horário não conta (ex.: sem sinal desde 21h50 só avisa às
// 7h30 do dia seguinte). Sincronização desligada → nada a avisar.
export const EXTENSION_SIGNAL_ID = "marketplace_extension_signal";
export const EXTENSION_ALERT_STATE_ID = "marketplace_extension_alert";
export const EXTENSION_SILENT_MS = 30 * 60 * 1000;
export const EXTENSION_SILENT_KEY_PREFIX = "marketplace_extension_silent:";
export const EXTENSION_BACK_KEY_PREFIX = "marketplace_extension_back:";

function saoPauloMinutesOfDay(ms) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return get("hour") * 60 + get("minute") + get("second") / 60;
}

// Estado da rodada (extensão 1.9.8+, campo `round` da sincronização): { ok, stage, error }. Problema real de 24–25/10/2026:
// a extensão só chamava o CRM depois de LER o Facebook; com a leitura falhando (página oculta atrás de uma janela em tela
// cheia) ficava em silêncio total, sem motivo. Agora toda rodada chama com o estado; o CRM guarda `last_round` e só a rodada
// ok conta como leitura (`last_read_ok_at`). Sem `round` (extensão antiga) nada muda: leitura = última chamada.
export const EXTENSION_ROUND_ERROR_MAX = 300;

export function normalizeExtensionRound(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.ok !== "boolean") return null;
  const text = (value, max) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  return { ok: raw.ok, stage: text(raw.stage, 40), error: text(raw.error, EXTENSION_ROUND_ERROR_MAX) };
}

// Próximo valor de crm_settings `marketplace_extension_signal` a partir do anterior (mantém a última leitura ok).
export function nextExtensionSignal(previous = null, { iso, version = "", round = null } = {}) {
  const next = { ...(previous && typeof previous === "object" ? previous : {}), last_sync_at: iso };
  const clean = /^\d{1,3}(\.\d{1,4}){0,3}$/.test(String(version || "")) ? String(version) : "";
  if (clean) next.extension_version = clean;
  else delete next.extension_version;
  const status = normalizeExtensionRound(round);
  if (status) {
    next.last_round = { ...status, at: iso };
    if (status.ok) next.last_read_ok_at = iso;
    else if (!next.last_read_ok_at) next.last_read_ok_at = previous?.last_sync_at || iso;
  } else {
    // Extensão sem `round` (anterior à 1.9.8): volta à régua antiga (toda chamada = leitura).
    delete next.last_round;
    delete next.last_read_ok_at;
  }
  return next;
}

// Hora da última LEITURA do Facebook: com estado da rodada, a última rodada ok; sem, a última chamada (régua antiga).
export function extensionReadAt(signal = null) {
  if (!signal) return null;
  return (signal.last_round ? signal.last_read_ok_at : null) || signal.last_sync_at || null;
}

// signal: { last_sync_at, last_round?, last_read_ok_at? } | null; alertState: { episode } | null (episódio já avisado e ainda sem volta).
// -> { action: "none" } | { action: "silent", episode, minutes, dedupeKey } | { action: "back", episode, dedupeKey, closePrefix }
// 1.9.8: o relógio é o da última LEITURA (extensionReadAt) — extensão viva mas sem conseguir ler também avisa, com o motivo.
export function decideExtensionSignal({ signal = null, alertState = null, settings = {}, now = Date.now() } = {}) {
  const last = new Date(extensionReadAt(signal) || 0).getTime();
  if (!Number.isFinite(last) || last <= 0) return { action: "none" };
  const episode = new Date(last).toISOString();
  const alerted = alertState?.episode ? new Date(alertState.episode).toISOString() : "";
  if (alerted && alerted !== episode) {
    return { action: "back", episode: alerted, dedupeKey: `${EXTENSION_BACK_KEY_PREFIX}${alerted}`, closePrefix: `${EXTENSION_SILENT_KEY_PREFIX}${alerted}` };
  }
  if (alerted) return { action: "none" };
  const config = normalizeChatSettings(settings || {});
  if (!config.syncEnabled) return { action: "none" };
  const minutesNow = saoPauloMinutesOfDay(now);
  if (minutesNow < config.startHour * 60 || minutesNow >= config.endHour * 60) return { action: "none" };
  const windowStart = now - (minutesNow - config.startHour * 60) * 60_000;
  if (now - Math.max(last, windowStart) <= EXTENSION_SILENT_MS) return { action: "none" };
  return { action: "silent", episode, minutes: Math.floor((now - last) / 60_000), dedupeKey: `${EXTENSION_SILENT_KEY_PREFIX}${episode}` };
}

export function validateOutboundText(text) {
  const body = String(text || "").trim();
  if (!body) throw new MarketplaceChatError("Digite uma mensagem.");
  if (body.length > MAX_OUTBOUND_LENGTH) throw new MarketplaceChatError(`A mensagem passa do limite de ${MAX_OUTBOUND_LENGTH} caracteres.`);
  return body;
}

// sentLastHour = respostas enviadas na última hora; attemptsLastHour = tentativas (1º envio e reenvios) registradas na
// última hora (recentOutboxAttempts). Vale o maior: o reenvio automático conta no limite por hora (dono, 2026-10-24) e
// nada muda para quem só envia uma vez.
export function evaluateOutboxGate({ syncEnabled = true, sentLastHour = 0, attemptsLastHour = 0, maxSendsPerHour = DEFAULT_CHAT_SETTINGS.maxSendsPerHour, hasSending = false } = {}) {
  if (!syncEnabled) return { allowed: false, reason: "chat_desligado" };
  if (hasSending) return { allowed: false, reason: "envio_em_andamento" };
  if (Math.max(Number(sentLastHour || 0), Number(attemptsLastHour || 0)) >= maxSendsPerHour) return { allowed: false, reason: "limite_por_hora" };
  return { allowed: true, reason: null };
}

// Registro das tentativas: só as da última hora, no máximo 200 (ISO). `add` acrescenta a tentativa de agora.
export function recentOutboxAttempts(list = [], now = new Date(), { add = false } = {}) {
  const from = now.getTime() - HOUR_MS;
  const kept = (Array.isArray(list) ? list : []).filter((iso) => {
    const at = new Date(iso).getTime();
    return Number.isFinite(at) && at > from && at <= now.getTime() + 60_000;
  });
  if (add) kept.push(now.toISOString());
  return kept.slice(-200);
}

// A extensão sabe conferir a conversa antes de reenviar (1.9.6+)?
export function supportsAutoResend(version) {
  return versionAtLeast(version, AUTO_RESEND_MIN_VERSION);
}

function versionAtLeast(version, need) {
  if (!String(version || "").trim()) return false;
  const parts = (value) => String(value || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const have = parts(version);
  const required = parts(need);
  for (let index = 0; index < required.length; index += 1) {
    if ((have[index] || 0) !== required[index]) return (have[index] || 0) > required[index];
  }
  return true;
}

// Motivo da parada do reenvio gravado no começo do `error` (ou "").
export function resendStopReason(error = "") {
  const match = /^\[reenvio parado: ([a-z_0-9]+)\]/.exec(String(error || ""));
  return match && Object.values(RESEND_STOP).includes(match[1]) ? match[1] : "";
}

// Parada definitiva do reenvio: fica "Não enviada", com alerta.
export function resendStopPatch(reason, detail = "") {
  return { status: "failed", error: `[reenvio parado: ${reason}] ${clean(detail, 440)}`.trim() };
}

// Passou do teto de segurança do reenvio automático (contado de quando o corretor escreveu)?
export function resendExpired(message, now = new Date()) {
  const created = new Date(message?.created_at || 0).getTime();
  return Number.isFinite(created) && created > 0 && now.getTime() - created >= AUTO_RESEND_MAX_MS;
}

// Retorno da extensão para uma resposta da fila (REGRA OFICIAL — dono, 2026-10-24, reenvio a cada 30 s até concluir):
//  - sent (inclusive `verified`: a conferência achou a mensagem já na conversa) → enviada;
//  - conversa bloqueada/encerrada pelo Facebook (`closed`) ou teto de 24 h → "Não enviada" definitiva (com alerta);
//  - retry=true (nada foi digitado: certamente NÃO saiu) → volta à fila; nova tentativa 30 s depois (claimed_at = agora);
//  - chegou a apertar Enter sem confirmar (unconfirmed / verificação do Facebook depois do Enter): pode ter saído.
//    Extensão 1.9.6+ → volta à fila e a próxima tentativa CONFERE a conversa antes de digitar (nunca duplica no
//    escuro); extensão antiga → "Não enviada" na hora (regra de antes: confirma pelo eco ou "Tentar de novo").
export function planOutboundResult(message, body = {}, now = new Date(), { extensionVersion = "" } = {}) {
  if (message?.status !== "sending") throw new MarketplaceChatError("Esta mensagem não está em envio.", 409);
  const iso = now.toISOString();
  if (body.status === "sent") return { status: "sent", sent_at: iso, error: null, external_id: body.externalId ? String(body.externalId).slice(0, 200) : message.external_id || null };
  if (body.status === "failed") {
    const error = clean(body.error, 500) || "Falha sem descrição.";
    if (body.closed === true) return resendStopPatch(RESEND_STOP.CLOSED, error);
    if (resendExpired(message, now)) return resendStopPatch(RESEND_STOP.TIMEOUT, error);
    if (body.retry === true || supportsAutoResend(extensionVersion)) return { status: "queued", error, claimed_at: iso };
    return { status: "failed", error, claimed_at: message.claimed_at };
  }
  throw new MarketplaceChatError("Resultado inválido.");
}

// Envio sem retorno da extensão há STALE_SENDING_MS: pode ter saído. Extensão que confere (1.9.6+) e dentro do teto →
// volta à fila (a próxima tentativa confere antes); senão "Não enviada" (regra antiga / teto).
export function planStaleSending(message, now = new Date(), { extensionVersion = "" } = {}) {
  if (resendExpired(message, now)) return resendStopPatch(RESEND_STOP.TIMEOUT, "A extensão não deu retorno.");
  if (supportsAutoResend(extensionVersion)) return { status: "queued", error: "A extensão não deu retorno. Conferindo na conversa antes de reenviar.", claimed_at: now.toISOString() };
  return { status: "failed", error: "A extensão não deu retorno. Confira no Facebook antes de reenviar." };
}

// Reenvio automático (já houve tentativa) bloqueado antes de sair? Cliente "Não contactar"/telefone bloqueado
// (doNotContactReason, findDoNotContactInboundBlock) ou teto de 24 h. O 1º envio é o clique do corretor e não passa aqui.
export function resendBlockReason(message, { doNotContactReason = null, now = new Date() } = {}) {
  if (Number(message?.attempts || 0) < 1) return null;
  if (doNotContactReason) return RESEND_STOP.DO_NOT_CONTACT;
  if (resendExpired(message, now)) return RESEND_STOP.TIMEOUT;
  return null;
}

// Resposta do corretor ainda não entregue e em reenvio automático (alerta no chat — dono, 2026-10-24).
export function isUndeliveredRetrying(row = {}) {
  if (row.direction !== "outbound" || !row.sender_user_id) return false;
  const attempts = Number(row.attempts || 0);
  return (row.status === "queued" && attempts > 0 && Boolean(row.error)) || (row.status === "sending" && attempts > 1);
}

// O que o corretor vê sobre a própria resposta (sem texto técnico — dono, 2026-10-22). technical = só admin geral.
export function outboundStatusView(row = {}, { technical = false } = {}) {
  if (row.direction !== "outbound" || !row.sender_user_id) return { statusLabel: "", canRetry: false, error: technical ? row.error || null : null, undelivered: false };
  if (isUndeliveredRetrying(row)) return { statusLabel: UNDELIVERED_LABEL, canRetry: false, error: technical ? row.error || null : null, undelivered: true };
  if (row.status === "failed") {
    const stop = resendStopReason(row.error);
    return { statusLabel: stop ? `Não enviada — ${RESEND_STOP_LABELS[stop]}` : "Não enviada", canRetry: true, error: technical ? row.error || null : null, undelivered: false };
  }
  const labels = { queued: "Na fila de envio", sending: "Enviando…", sent: "Enviada" };
  return { statusLabel: labels[row.status] || "", canRetry: false, error: null, undelivered: false };
}

// Falha que certamente não digitou nada no Facebook (pode ir de novo sem risco de duplicar).
export function isSafeToResend(error = "") {
  return /n[aã]o abriu|no tab with id|n[aã]o encontrad|campo de mensagem|depurador|item da conversa|tempo esgotado esperando a p[aá]gina|etapa .* passou de/i.test(String(error || ""));
}

// O que a extensão recebe para enviar. Nada além disso. `verify` (reenvio, 2026-10-24): a tentativa anterior pode ter
// saído — a extensão 1.9.6+ confere a conversa antes de digitar; `knownSame` = quantas mensagens nossas IGUAIS a esta o
// CRM já tem nas últimas 15 da conversa (a conferência só dá "já está lá" se a conversa mostrar mais que isso).
export function toOutboxPayload(message, conversation, { knownSame = 0 } = {}) {
  const payload = { id: message.id, threadKey: conversation.thread_key, threadUrl: conversation.thread_url, body: message.body, attempt: Number(message.attempts || 0) };
  // Resposta automática (MKT-2l): a extensão 1.9.7+ não digita se o campo do Facebook já tiver texto (alguém digitando).
  if (message.auto_kind) payload.automatic = true;
  const file = outboundAttachmentOf(message);
  if (file) payload.attachment = { type: file.type, url: file.url, name: file.name, mime: file.mime };
  if (needsVerify(message)) {
    payload.verify = true;
    payload.knownSame = Math.max(0, Number(knownSame) || 0);
  }
  return payload;
}

// Já houve tentativa antes desta (na mensagem reservada, `attempts` já conta a de agora) → conferir antes de digitar.
export function needsVerify(message) {
  return Number(message?.attempts || 0) > 1;
}

// --- Arquivos na resposta (dono, 2026-10-23: "Eu quero que possa enviar mais de um arquivo na mesma mensagem") --------
// Cada arquivo é UM item da fila de saída (body vazio + attachments [1 arquivo]); o texto digitado vai antes, como item
// de texto (o Messenger não tem legenda: texto e arquivo são mensagens separadas). Só a extensão 1.9.5+ sabe anexar; com
// versão antiga o arquivo ESPERA na fila (e segura os seguintes da mesma conversa, para não inverter a ordem).
export const MARKETPLACE_MEDIA_MIN_VERSION = "1.9.5";
export const MARKETPLACE_MEDIA_MAX_BYTES = 4 * 1024 * 1024;
const MARKETPLACE_MEDIA_TYPES = { "image/jpeg": "image", "image/png": "image", "image/webp": "image", "image/gif": "image", "application/pdf": "file" };
export const MARKETPLACE_MEDIA_ACCEPT = Object.keys(MARKETPLACE_MEDIA_TYPES).join(",");

export function supportsMarketplaceMedia(version) {
  const parts = (value) => String(value || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const have = parts(version);
  const need = parts(MARKETPLACE_MEDIA_MIN_VERSION);
  if (!String(version || "").trim()) return false;
  for (let index = 0; index < need.length; index += 1) {
    if ((have[index] || 0) !== need[index]) return (have[index] || 0) > need[index];
  }
  return true;
}

export function validateOutboundMedia({ mimeType = "", size = 0, fileName = "" } = {}) {
  const mime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const type = MARKETPLACE_MEDIA_TYPES[mime];
  if (!type) throw new MarketplaceChatError("Pelo Marketplace dá para enviar foto (JPG, PNG, WEBP, GIF) ou PDF.");
  if (!Number(size)) throw new MarketplaceChatError("Arquivo vazio.");
  if (Number(size) > MARKETPLACE_MEDIA_MAX_BYTES) throw new MarketplaceChatError("O arquivo passa de 4 MB. Envie um menor (fotos são reduzidas automaticamente).");
  const name = String(fileName || (type === "image" ? "foto" : "arquivo.pdf")).replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "arquivo";
  return { type, mime, name };
}

export function outboundAttachmentOf(message) {
  const file = Array.isArray(message?.attachments) ? message.attachments[0] : null;
  return file?.url ? file : null;
}

// Próximo item da fila de saída, na ORDEM de criação por conversa: o 1º item ainda na fila de cada conversa segura os
// seguintes dela (esperando nova tentativa ou arquivo sem extensão capaz) — o 3º arquivo nunca sai antes do 2º.
// Resposta automática (MKT-2l) com `send_after` no futuro ainda não sai e NÃO segura a conversa: se o corretor responder
// no meio do atraso, a resposta dele sai primeiro e a automática é cancelada na reserva (autoReplyCancelReason).
// Resposta humana sempre antes da automática (MKT-2m, 2026-10-26): o acumulado de respostas automáticas na reconexão
// nunca atrasa a resposta de um corretor.
export function pickOutboxCandidate(candidates = [], { retryBefore = null, mediaAllowed = false, now = new Date() } = {}) {
  const blocked = new Set();
  const retryLimit = retryBefore ? new Date(retryBefore).getTime() : null;
  const ordered = [...candidates.filter((row) => !row?.auto_kind), ...candidates.filter((row) => row?.auto_kind)];
  for (const row of ordered) {
    if (blocked.has(row.conversation_id)) continue;
    if (row.send_after && new Date(row.send_after).getTime() > now.getTime()) continue;
    const waitingRetry = row.claimed_at && retryLimit !== null && new Date(row.claimed_at).getTime() >= retryLimit;
    if (waitingRetry || (outboundAttachmentOf(row) && !mediaAllowed)) {
      blocked.add(row.conversation_id);
      continue;
    }
    return row;
  }
  return null;
}

// Mensagem de saída vista no Facebook que é a MESMA resposta enviada pelo CRM (ainda sem id do Facebook): liga em vez de
// duplicar. Mesmo texto, enviada pelo CRM há até 2 h.
// Arquivo enviado pelo CRM (body vazio): foto casa com eco só de imagem (sem texto); PDF casa pelo nome do arquivo, que é
// o texto que o Facebook mostra na bolha.
function echoKey(row) {
  const text = plain(row?.body);
  if (text) return text;
  const file = outboundAttachmentOf(row);
  if (!file) return "";
  return file.type === "image" ? "\u0000imagem" : plain(file.name);
}

// Quantas das últimas 15 mensagens da conversa (`recent`, qualquer ordem) são saídas JÁ ENVIADAS iguais a `message`
// (mesmo texto, foto, ou PDF de mesmo nome), sem contar ela mesma. Base da conferência antes do reenvio.
export function sameOutboundCount(message, recent = []) {
  const key = echoKey(message);
  if (!key) return 0;
  return [...(recent || [])]
    .sort((a, b) => new Date(a.message_at || a.created_at).getTime() - new Date(b.message_at || b.created_at).getTime())
    .slice(-15)
    .filter((row) => row.id !== message.id && row.direction === "outbound" && row.status === "sent" && echoKey(row) === key).length;
}

export function findOutboundEcho(synced, candidates = [], now = new Date()) {
  if (synced?.direction !== "outbound") return null;
  const text = plain(synced.body) || (synced.attachments?.some?.((item) => item?.type === "image") ? "\u0000imagem" : "");
  if (!text) return null;
  // Também confirma resposta marcada como falha/na fila de nova tentativa: se o eco apareceu, ela saiu (2026-10-22).
  // Na fila só conta se já foi tentada (attempts > 0); eco com hora conhecida não pode ser anterior à resposta.
  const echoAt = synced.at ? new Date(synced.at).getTime() : null;
  return candidates.find((row) => !row.external_id && row.direction === "outbound" && ["sent", "sending", "failed", "queued"].includes(row.status)
    && (row.status !== "queued" || Number(row.attempts || 0) > 0)
    && (echoAt === null || echoAt >= new Date(row.created_at).getTime() - 2 * 60 * 1000)
    && echoKey(row) === text && now.getTime() - new Date(row.sent_at || row.created_at).getTime() <= 2 * 60 * 60 * 1000) || null;
}

// --- Atalhos de texto e "Nosso WhatsApp" na caixa de resposta (REGRA OFICIAL — dono, 2026-10-22, MKT-2f) ------------
// O texto é COLADO na caixa (editável) e nunca enviado sozinho. Preenchimento na tela: [nome] = 1º nome do cliente,
// [anúncio] = título do anúncio, [corretor] = 1º nome de quem está logado (perfil efetivo). Campo sem valor fica como está
// (o corretor completa à mão); outros [colchetes] também ficam para editar.
const firstNameOf = (value) => String(value || "").trim().split(/\s+/)[0] || "";
const plainKey = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function fillMarketplaceShortcut(body, { clientName = "", listingTitle = "", brokerName = "" } = {}) {
  const values = { nome: firstNameOf(clientName), anuncio: String(listingTitle || "").trim(), corretor: firstNameOf(brokerName) };
  return String(body || "").replace(/\[([^\[\]]{1,20})\]/g, (match, key) => values[plainKey(key).trim()] || match);
}

// "Nosso WhatsApp" (dono, 2026-10-22: "Enviar o número deve enviar o oficial"): link do WhatsApp OFICIAL da empresa
// (OFFICIAL_WHATSAPP_DIGITS, lib/official-whatsapp.mjs — nunca o número pessoal do corretor) com mensagem pronta. Conversa
// ligada a um cliente leva o "Código do atendimento" (PRES-25, lib/whatsapp-contact-code-core.mjs): quando o cliente manda,
// o webhook do oficial liga a conversa ao MESMO cliente e a entrega ao corretor responsável, sem roleta e sem cliente novo.
export function marketplaceOfficialWhatsappText({ clientId = "", listingTitle = "" } = {}) {
  const listing = String(listingTitle || "").trim();
  const ready = `Olá! Vim do Marketplace${listing ? ` (anúncio: ${listing})` : ""}.`;
  return `Pode me chamar também no nosso WhatsApp oficial: ${officialWhatsappUrl(withContactCode(ready, clientId))}`;
}

// --- Mensagem interna (REGRA OFICIAL — dono, 2026-10-22, MKT-2i) ------------------------------------------------------
// "Como a mensagem interna do chat do WhatsApp. Apenas eu, o corretor e a gerente visualizam." Nota que existe SÓ no CRM:
// nunca vai para a fila da extensão (direção `internal` com status `sent` — a fila só pega `queued` de saída), não conta
// como contato/atendimento/resposta/pontuação e não mexe na conversa (última mensagem, prazo da roleta, não lidas).
export const INTERNAL_DIRECTION = "internal";
export const MAX_INTERNAL_LENGTH = 4096; // o mesmo limite da nota interna do Chat do WhatsApp

// Quem lê/escreve: o MESMO critério de `canManageConversation` (lib/whatsapp-chat.js), aplicado DEPOIS do escopo da
// conversa (gestor só abre conversa da equipe): admin geral, gestor, a pessoa atribuída ou o responsável pelo cliente.
// Associado só quando é ele o atribuído/responsável (igual ao WhatsApp).
export function canUseMarketplaceInternal({ generalAdmin = false, manager = false, profileId = "", assignedUserId = "", clientResponsibleId = "" } = {}) {
  if (generalAdmin || manager) return true;
  if (!profileId) return false;
  return assignedUserId === profileId || clientResponsibleId === profileId;
}

// Aviso da mensagem interna (REGRA OFICIAL — dono, 2026-10-22, MKT-2i; exceção à AUT-9 só do Marketplace): sino + push
// para admin geral, corretor responsável/atribuído e gestora da equipe dele. Nunca o autor, nunca associado (nem quando ele
// é o atribuído), nunca usuário inativo e nunca o cliente (o cliente não é usuário do painel). `users` = admin_users
// ({ id, role, manager_id, linked_broker_id, status }). Gestora: a própria dona da conversa ou o manager_id do dono (do
// corretor vinculado, se o dono for associado) — mesma regra do aviso da nota interna do WhatsApp.
export const MARKETPLACE_INTERNAL_LINK_BASE = "/admin/chat/marketplace";

export function marketplaceConversationLink(conversationId) {
  const id = String(conversationId || "").trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? `${MARKETPLACE_INTERNAL_LINK_BASE}?conversa=${id}` : MARKETPLACE_INTERNAL_LINK_BASE;
}

export function resolveMarketplaceInternalRecipients({ users = [], assignedUserId = "", clientResponsibleId = "", authorId = "" } = {}) {
  const byId = new Map((users || []).filter((user) => user?.id).map((user) => [user.id, user]));
  const owners = [...new Set([assignedUserId, clientResponsibleId].filter(Boolean))];
  const managerOf = (userId) => {
    const user = byId.get(userId);
    if (!user) return null;
    if (user.manager_id) return user.manager_id;
    return user.role === "associate" ? byId.get(user.linked_broker_id)?.manager_id || null : null;
  };
  const recipients = new Set();
  for (const user of byId.values()) {
    if (user.status !== "active" || user.role === "associate") continue;
    if (user.role === "admin") recipients.add(user.id);
    else if (owners.includes(user.id)) recipients.add(user.id);
    else if (user.role === "manager" && owners.some((ownerId) => managerOf(ownerId) === user.id)) recipients.add(user.id);
  }
  if (authorId) recipients.delete(authorId);
  return [...recipients];
}

export function buildMarketplaceInternalNotice({ authorName = "", contactName = "" } = {}) {
  const author = String(authorName || "").trim() || "Alguém";
  const contact = String(contactName || "").trim() || "contato";
  return {
    title: "Mensagem interna no Marketplace",
    description: `${author} adicionou uma mensagem interna na conversa do Marketplace com ${contact}.`
  };
}

export function buildMarketplaceInternalNote({ conversationId, text, senderUserId = null, senderName = "", now = new Date() } = {}) {
  const body = String(text || "").trim();
  if (!body) throw new MarketplaceChatError("Digite a mensagem interna.");
  if (body.length > MAX_INTERNAL_LENGTH) throw new MarketplaceChatError(`A mensagem passa do limite de ${MAX_INTERNAL_LENGTH} caracteres.`);
  return {
    conversation_id: conversationId,
    direction: INTERNAL_DIRECTION,
    sender_name: senderName || "Equipe",
    sender_user_id: senderUserId,
    body,
    status: "sent",
    message_at: now.toISOString()
  };
}

// --- Resposta automática de disponibilidade (MKT-2l) -------------------------------------------------------------------
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] "essa resposta eu quero que ele faça, que ele responda automaticamente...
// Bom dia/boa tarde/boa noite, o nome do cliente. Sim, esse item ainda está disponível." Sem ponto de exclamação ("pode
// soar como deboche pelo cliente não ter enviado bom dia antes"). "Automático com cuidados": atraso humano de 30 s a 2 min,
// só na 1ª mensagem do cliente, uma vez por conversa, para se alguém da equipe responder ou digitar, nunca para Não
// contactar/bloqueado. Sai pela MESMA fila da extensão (marketplace_messages outbound `queued`, sem autor), marcada com
// `auto_kind` — não é resposta humana: não segura o prazo da roleta, não vira "Em atendimento", não conta no relógio de
// 3 dias (marketplaceReplyTimes) nem pontua.
export const AUTO_REPLY_KIND = "availability";
export const AUTO_REPLY_MIN_DELAY_MS = 30 * 1000;
export const AUTO_REPLY_MAX_DELAY_MS = 120 * 1000;
// Mensagem do cliente mais velha que isto não recebe resposta automática (conversa antiga lida agora pela 1ª vez).
// MKT-2m (dono, 2026-10-26): o acumulado da extensão desligada é respondido na reconexão → 7 dias (era 24 h).
export const AUTO_REPLY_RECENT_MS = MARKETPLACE_BACKLOG_MS;
// Na fila há mais que isto → cancela. Era 2 h ("extensão parada, a equipe já deve ter visto"); com a MKT-2m a automática
// espera a extensão voltar (extensão parada = nada sai e a equipe não vê a conversa no CRM). Quem respondeu (CRM ou
// Facebook) ou digitou continua cancelando na reserva.
export const AUTO_REPLY_MAX_QUEUE_MS = MARKETPLACE_BACKLOG_MS;
export const AUTO_REPLY_LABEL = "automática";
export const AUTO_REPLY_SENDER_NAME = "Resposta automática";
export const AUTO_REPLY_CANCEL = Object.freeze({
  DISABLED: "desligada",
  HUMAN_REPLIED: "equipe_respondeu",
  HUMAN_TYPING: "equipe_digitando",
  DO_NOT_CONTACT: "nao_contactar",
  PRIVATE: "particular",
  EXPIRED: "expirou",
  FAILED: "falhou"
});

// Pergunta padrão do Marketplace ("Oi, esse item está disponível?", "Isto ainda está disponível?", "Oi, Matheus. Isto
// ainda está disponível?", "Is this still available?"). Só a pergunta (com saudação e um nome opcionais) — qualquer outra
// pergunta junto fica para o corretor.
const AVAILABILITY_WORDS = new Set([
  "oi", "ola", "olaa", "bom", "boa", "dia", "tarde", "noite", "hi", "hello", "hey",
  "esse", "este", "essa", "esta", "isso", "isto", "o", "a", "item", "imovel", "apartamento", "apto", "casa", "terreno", "anuncio",
  "ainda", "ta", "continua", "segue", "e", "disponivel", "is", "this", "it", "still", "available"
]);
const GREETING_WORDS = new Set(["oi", "ola", "olaa", "dia", "tarde", "noite", "hi", "hello", "hey"]);
export function isAvailabilityQuestion(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 80 || /\d/.test(raw)) return false;
  const tokens = plainText(raw).replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 9) return false;
  if (!tokens.includes("disponivel") && !tokens.includes("available")) return false;
  if (tokens.includes("disponivel") && !/\b(esta|ta|continua|segue|e|ainda)\b/.test(tokens.join(" "))) return false;
  if (tokens.includes("available") && !tokens.includes("is")) return false;
  // Um nome (ex.: "Matheus") só logo depois da saudação.
  let names = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    if (AVAILABILITY_WORDS.has(tokens[index])) continue;
    if (index > 0 && GREETING_WORDS.has(tokens[index - 1]) && names === 0) {
      names += 1;
      continue;
    }
    return false;
  }
  return true;
}

// Acumulado (MKT-2m): TODAS as mensagens do cliente são a pergunta padrão (o botão do Facebook manda uma; repetida conta).
export function isOnlyAvailabilityQuestion(messages = []) {
  const inbound = (messages || []).filter((message) => message?.direction === "inbound");
  return inbound.length > 0 && inbound.every((message) => isAvailabilityQuestion(message.body));
}

// Conversa nova lida pela 1ª vez é do ACUMULADO (MKT-2m)? Só na rota da roleta (a 1ª carga por dia, MKT-2c, não muda), sem
// nenhuma saída nossa (alguém já respondeu direto no Facebook → segue o caminho de sempre) e com a última mensagem do
// cliente entre 30 min e 7 dias. → { backlog, awaitingApproval }: awaitingApproval = acumulado com qualquer texto que não
// seja só a pergunta padrão (sem automática, fora da roleta até o dono aprovar).
export function planBacklogConversation({ firstContent = false, route = null, messages = [], now = new Date() } = {}) {
  const none = { backlog: false, awaitingApproval: false };
  if (!firstContent || route?.kind !== "roulette") return none;
  if ((messages || []).some((message) => message?.direction === "outbound")) return none;
  const inbound = (messages || []).filter((message) => message?.direction === "inbound");
  const lastAt = new Date(inbound[inbound.length - 1]?.at || 0).getTime();
  if (!Number.isFinite(lastAt) || lastAt <= 0) return none;
  const age = now.getTime() - lastAt;
  if (age <= MARKETPLACE_BACKLOG_MIN_AGE_MS || age > MARKETPLACE_BACKLOG_MS) return none;
  return { backlog: true, awaitingApproval: !isOnlyAvailabilityQuestion(messages) };
}

// 1º nome confiável do contato do Messenger (só letras, 2+; nunca o nome genérico) — sem isso, a mensagem vai sem nome.
const GENERIC_NAMES = new Set(["contato", "cliente", "usuario", "facebook", "user", "marketplace", "comprador", "buyer", "messenger"]);
export function autoReplyFirstName(contactName) {
  const first = String(contactName || "").trim().split(/\s+/)[0] || "";
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ]{2,30}$/.test(first)) return "";
  if (GENERIC_NAMES.has(plainText(first))) return "";
  const mixed = first !== first.toUpperCase() && first !== first.toLowerCase();
  return mixed ? first : first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// Texto da resposta. `greeting` = getTimeGreeting(now) (lib/daily-report.js, fonte única da saudação por horário de São
// Paulo), calculada na hora do envio real.
export function buildAvailabilityAutoReply({ greeting = "", contactName = "" } = {}) {
  const hello = String(greeting || "").trim() || "Olá";
  const name = autoReplyFirstName(contactName);
  return `${hello}${name ? `, ${name}` : ""}. Sim, esse item ainda está disponível.`;
}

export function autoReplyDelayMs(random = Math.random) {
  const value = Math.min(Math.max(Number(random()) || 0, 0), 1);
  return Math.round(AUTO_REPLY_MIN_DELAY_MS + value * (AUTO_REPLY_MAX_DELAY_MS - AUTO_REPLY_MIN_DELAY_MS));
}

// Ritmo do acumulado (MKT-2m): na reconexão várias conversas novas chegam juntas; cada automática nova sai pelo menos
// 1/limite-por-hora depois da última ainda na fila (20/h → 3 min), em vez de todas de uma vez. O limite por hora e o
// máximo por rodada da extensão continuam valendo por cima.
export function autoReplySpacingMs(maxSendsPerHour = DEFAULT_CHAT_SETTINGS.maxSendsPerHour) {
  const max = Number(maxSendsPerHour);
  return Math.ceil(HOUR_MS / (Number.isFinite(max) && max >= 1 ? max : DEFAULT_CHAT_SETTINGS.maxSendsPerHour));
}

// Conversa NOVA lida pela 1ª vez (`firstContent`), sem nenhuma mensagem nossa, cuja 1ª mensagem do cliente é a pergunta
// padrão e de até 7 dias (MKT-2m) → { body, sendAfter } para a fila; senão { skip: motivo }. `messages` = as mensagens
// desta leitura. `lastQueuedSendAfter` = maior `send_after` das automáticas ainda na fila (ritmo do acumulado).
// `onlyStandard` (acumulado, MKT-2m): todas as mensagens do cliente precisam ser a pergunta padrão.
export function planAvailabilityAutoReply({ settings = {}, firstContent = false, messages = [], contactName = "", greeting = "", now = new Date(), random = Math.random, lastQueuedSendAfter = null, onlyStandard = false } = {}) {
  if (settings.availabilityAutoReply === false) return { skip: AUTO_REPLY_CANCEL.DISABLED };
  if (!firstContent) return { skip: "conversa_ja_conhecida" };
  if (messages.some((message) => message.direction === "outbound")) return { skip: AUTO_REPLY_CANCEL.HUMAN_REPLIED };
  const inbound = messages.filter((message) => message.direction === "inbound");
  if (!inbound.length || !isAvailabilityQuestion(inbound[0].body)) return { skip: "nao_e_pergunta_padrao" };
  if (onlyStandard && !isOnlyAvailabilityQuestion(messages)) return { skip: "nao_e_so_pergunta_padrao" };
  const lastAt = new Date(inbound[inbound.length - 1].at || 0).getTime();
  if (!Number.isFinite(lastAt) || lastAt <= 0 || now.getTime() - lastAt > AUTO_REPLY_RECENT_MS) return { skip: "mensagem_antiga" };
  let sendAt = now.getTime() + autoReplyDelayMs(random);
  const queuedAt = lastQueuedSendAfter ? new Date(lastQueuedSendAfter).getTime() : NaN;
  if (Number.isFinite(queuedAt)) sendAt = Math.max(sendAt, queuedAt + autoReplySpacingMs(settings.maxSendsPerHour));
  return { body: buildAvailabilityAutoReply({ greeting, contactName }), sendAfter: new Date(sendAt).toISOString() };
}

// Na reserva (logo antes de sair): cancela se a regra foi desligada, se alguém da equipe já respondeu (qualquer saída que
// não seja esta, pelo CRM ou direto no Facebook) ou se o cliente está em Não contactar/telefone bloqueado ou Particular
// (`privateContact`, MKT-2m), ou se ficou tempo demais na fila (7 dias). `messages` = mensagens da conversa (qualquer ordem).
export function autoReplyCancelReason(row, { settings = {}, conversation = {}, messages = [], doNotContactReason = null, privateContact = false, now = new Date() } = {}) {
  if (!row?.auto_kind) return null;
  if (settings.availabilityAutoReply === false) return AUTO_REPLY_CANCEL.DISABLED;
  if (doNotContactReason) return AUTO_REPLY_CANCEL.DO_NOT_CONTACT;
  if (privateContact) return AUTO_REPLY_CANCEL.PRIVATE;
  if (conversation?.last_human_reply_at) return AUTO_REPLY_CANCEL.HUMAN_REPLIED;
  if ((messages || []).some((message) => message.id !== row.id && message.direction === "outbound")) return AUTO_REPLY_CANCEL.HUMAN_REPLIED;
  const created = new Date(row.created_at || 0).getTime();
  if (Number.isFinite(created) && created > 0 && now.getTime() - created > AUTO_REPLY_MAX_QUEUE_MS) return AUTO_REPLY_CANCEL.EXPIRED;
  return null;
}

// Cancelada/falhou: fica "failed" com o motivo (sem alerta, sem "Tentar de novo" — não tem autor) e nunca volta à fila.
// O status "failed" mantém a confirmação pelo eco (findOutboundEcho) se, mesmo assim, ela tiver saído.
export function autoReplyCancelPatch(reason, detail = "") {
  return { status: "failed", error: `[automática cancelada: ${reason}]${detail ? ` ${clean(detail, 400)}` : ""}` };
}

export function isAutoReplyRow(row = {}) {
  return Boolean(row?.auto_kind);
}
