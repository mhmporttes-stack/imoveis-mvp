// Lembrete do formulário não preenchido (regra do dono, 2026-10-09 — BUSINESS_RULES WA-17). PURO, testado em
// tests/whatsapp-form-reminder.test.mjs. Quem lê o banco e envia é lib/whatsapp-form-reminder.js (cron whatsapp-flows).
//
// "Recebeu o link" = mensagem de SAÍDA registrada no Chat (whatsapp_messages) com um link do formulário do site
// (/s, /s/<ref>, /simulacao, /c/<código>) no texto ou no botão de link (metadata.link.url), enviada pela automação
// (Fluxo/resposta automática) ou por uma pessoa PELO CHAT (metadata.actor_ctx). Mensagem digitada no celular do
// corretor não conta (não foi enviada pelo CRM).

export const FORM_REMINDER_DELAY_MS = 60 * 60 * 1000; // 1 hora depois do link
export const FORM_REMINDER_MAX_LATE_MS = 3 * 60 * 60 * 1000; // passou disso do horário previsto (cron parado): não envia mais
export const FORM_REMINDER_LOOKBACK_MS = 24 * 60 * 60 * 1000; // links das últimas 24 h
export const OFFICIAL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OFFICIAL_WINDOW_SAFETY_MS = 5 * 60 * 1000; // não envia nos últimos 5 min da janela
// Links enviados antes da publicação não geram lembrete (sem rajada de lembretes atrasados no primeiro deploy).
export const FORM_REMINDER_START_AT = "2026-10-09T10:00:00.000Z";
export const FORM_REMINDER_KIND = "form_reminder";
export const QUIET_START_MINUTES = 21 * 60; // 21:00
export const QUIET_END_MINUTES = 8 * 60; // 08:00
const TIME_ZONE = "America/Sao_Paulo";
const SITE_HOST = "matheusmachadoimoveis.com.br";

// Chave de idempotência (vai em whatsapp_messages.meta_message_id, índice único): um lembrete por envio de link.
export function formReminderClaimKey(linkMessageId) {
  return `form-reminder:${String(linkMessageId || "").trim()}`;
}

export function buildFormReminderText(fullName) {
  const first = usableFirstName(fullName);
  const greeting = first ? `Oi, ${first}, tudo bem?` : "Oi, tudo bem?";
  return `${greeting} Notei que você ainda não preencheu o formulário. Ficou com alguma dúvida ou teve alguma dificuldade? Se preferir, posso te ajudar por aqui.`;
}

// Primeiro nome "apresentável": sem o nome-reserva "Cliente WhatsApp" (sanitizeContactFullName), sem número/emoji.
export function usableFirstName(fullName) {
  const name = String(fullName || "").trim();
  if (!name || /^cliente whatsapp$/i.test(name)) return "";
  const first = name.split(/\s+/)[0] || "";
  if (first.length < 2 || !/^[\p{L}'-]+$/u.test(first)) return "";
  return first.charAt(0).toLocaleUpperCase("pt-BR") + first.slice(1).toLocaleLowerCase("pt-BR");
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

// Link do formulário de simulação/atendimento do site (inclusive o link curto e o de campanha).
export function isFormLinkUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== SITE_HOST) return false;
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  return path === "/s" || path.startsWith("/s/") || path === "/simulacao" || path.startsWith("/c/");
}

export function messageFormLink(message = {}) {
  const candidates = [message.metadata?.link?.url, ...(String(message.body || "").match(URL_PATTERN) || [])];
  return candidates.find((value) => isFormLinkUrl(value)) || "";
}

// A mensagem com link foi enviada PELO CRM (automação ou pessoa pelo Chat)?
export function isCrmSentLinkMessage(message = {}) {
  if (message.direction !== "outbound" || message.status === "failed") return false;
  if (message.metadata?.kind === FORM_REMINDER_KIND) return false;
  if (message.sender_type === "automation") return Boolean(messageFormLink(message));
  if (message.sender_type === "user") return Boolean(message.metadata?.actor_ctx) && Boolean(messageFormLink(message));
  return false;
}

// Só o link MAIS RECENTE de cada conversa vale (o anterior é encerrado pelo novo).
export function latestLinkPerConversation(messages = []) {
  const latest = new Map();
  for (const message of messages) {
    if (!isCrmSentLinkMessage(message)) continue;
    const current = latest.get(message.conversation_id);
    if (!current || new Date(message.message_at) > new Date(current.message_at)) latest.set(message.conversation_id, message);
  }
  return [...latest.values()];
}

function zonedParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

// Instante UTC de "AAAA-MM-DD hh:mm" no horário de São Paulo (calcula o deslocamento real da data).
function zonedTimeToUtc(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const local = zonedParts(new Date(guess));
  const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - guess;
  return new Date(guess - offset);
}

// 1 h depois do link; se cair entre 21:00 e 08:00 (São Paulo), segura até as 08:00.
export function formReminderDueAt(linkSentAt) {
  const sent = new Date(linkSentAt);
  if (Number.isNaN(sent.getTime())) return null;
  const due = new Date(sent.getTime() + FORM_REMINDER_DELAY_MS);
  const local = zonedParts(due);
  const minutes = local.hour * 60 + local.minute;
  if (minutes >= QUIET_END_MINUTES && minutes < QUIET_START_MINUTES) return due;
  const base = Date.UTC(local.year, local.month - 1, local.day);
  const target = new Date(minutes >= QUIET_START_MINUTES ? base + 24 * 60 * 60 * 1000 : base);
  return zonedTimeToUtc(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), 8, 0);
}

const SKIP_CLIENT_STATUSES = new Set(["archived", "do_not_contact"]);

// Decide o que fazer com UM link. Resultado: { action: "send" | "wait" | "skip", reason }.
//  - "wait": ainda não é hora (ou algo passageiro: fluxo em andamento) — o cron olha de novo depois;
//  - "skip": não envia (definitivo para este link);
//  - "send": envia pelo canal informado em `channel`.
// Entrada (já lida do banco):
//  link            { id, message_at, channel, session_user_id, session_slot }
//  conversation    { client_id, deleted_at, status, last_inbound_at, last_human_reply_at, session_key }
//  client          { status, last_form_submitted_at } | null
//  phoneRegistrations [{ id, status, created_at, last_form_submitted_at }]  (todos os cadastros com o telefone)
//  messagesAfter   mensagens da conversa DEPOIS do link (qualquer direção)
//  auditsAfter     ações de pessoas na conversa depois do link (assumir, atribuir, status, excluir…)
//  alreadyClaimed  já existe lembrete deste link
//  isTeamPhone, isPhoneBlocked, hasLiveFlowSession, chatDisabled
//  channel         { kind: "official" | "individual", officialConfigured, individualAllowed }
export function decideFormReminder(input = {}, now = new Date()) {
  const { link, conversation, client, phoneRegistrations = [], messagesAfter = [], auditsAfter = [], channel = {} } = input;
  if (!link?.id || !conversation) return { action: "skip", reason: "dados_incompletos" };
  if (input.alreadyClaimed) return { action: "skip", reason: "ja_enviado" };
  const sentAt = new Date(link.message_at);
  if (Number.isNaN(sentAt.getTime()) || sentAt < new Date(FORM_REMINDER_START_AT)) return { action: "skip", reason: "antes_da_regra" };
  const dueAt = formReminderDueAt(link.message_at);
  const nowMs = new Date(now).getTime();
  if (nowMs < dueAt.getTime()) return { action: "wait", reason: "aguardando_horario", dueAt };
  if (nowMs > dueAt.getTime() + FORM_REMINDER_MAX_LATE_MS) return { action: "skip", reason: "atrasado_demais" };

  // Algo aconteceu depois do link: o cliente respondeu, uma pessoa atendeu ou um link novo foi enviado.
  for (const message of messagesAfter) {
    if (message.direction === "inbound") return { action: "skip", reason: "cliente_respondeu" };
    if (message.direction === "outbound" && message.sender_type === "user") return { action: "skip", reason: "humano_respondeu" };
    if (message.direction === "outbound" && message.metadata?.kind === FORM_REMINDER_KIND) return { action: "skip", reason: "ja_enviado" };
    if (message.direction === "outbound" && messageFormLink(message)) return { action: "skip", reason: "link_mais_novo" };
  }
  if (auditsAfter.length) return { action: "skip", reason: "humano_assumiu" };
  if (conversation.last_human_reply_at && new Date(conversation.last_human_reply_at) > sentAt) return { action: "skip", reason: "humano_respondeu" };
  if (conversation.last_inbound_at && new Date(conversation.last_inbound_at) > sentAt) return { action: "skip", reason: "cliente_respondeu" };
  if (conversation.deleted_at) return { action: "skip", reason: "conversa_excluida" };
  if (conversation.status === "finished") return { action: "skip", reason: "conversa_finalizada" };

  // Cliente: precisa existir; arquivado/Não contactar nunca recebe; já preencheu = não envia.
  if (!conversation.client_id || !client) return { action: "skip", reason: "sem_cliente" };
  if (SKIP_CLIENT_STATUSES.has(client.status)) return { action: "skip", reason: "cliente_arquivado_ou_nao_contactar" };
  if (client.last_form_submitted_at) return { action: "skip", reason: "formulario_preenchido" };
  for (const registration of phoneRegistrations) {
    if (registration.status === "do_not_contact") return { action: "skip", reason: "telefone_nao_contactar" };
    if (registration.last_form_submitted_at && new Date(registration.last_form_submitted_at) >= sentAt) return { action: "skip", reason: "formulario_preenchido" };
    if (registration.created_at && new Date(registration.created_at) > sentAt) return { action: "skip", reason: "cadastro_novo" };
  }
  if (input.isTeamPhone) return { action: "skip", reason: "numero_da_equipe" };
  if (input.isPhoneBlocked) return { action: "skip", reason: "telefone_bloqueado" };

  // Canal: o MESMO número que mandou o link.
  if (channel.kind === "official") {
    if (!conversation.last_inbound_at) return { action: "skip", reason: "janela_fechada" };
    const windowEnds = new Date(conversation.last_inbound_at).getTime() + OFFICIAL_WINDOW_MS - OFFICIAL_WINDOW_SAFETY_MS;
    if (nowMs >= windowEnds) return { action: "skip", reason: "janela_fechada" };
  } else if (channel.kind !== "individual") {
    return { action: "skip", reason: channel.kind === "numero_mudou" ? "numero_mudou" : "canal_desconhecido" };
  }
  // Passageiros: o cron tenta de novo na próxima rodada (até o limite de atraso).
  if (input.chatDisabled) return { action: "wait", reason: "chat_desativado" };
  if (channel.kind === "official" && !channel.officialConfigured) return { action: "wait", reason: "oficial_sem_credencial" };
  if (channel.kind === "individual" && !channel.individualAllowed) return { action: "wait", reason: "whatsapp_pessoal_nao_permitido" };
  if (input.hasLiveFlowSession) return { action: "wait", reason: "fluxo_em_andamento" };
  return { action: "send", reason: "ok", channel: channel.kind };
}
