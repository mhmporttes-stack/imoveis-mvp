// Lembrete do formulário não preenchido (regra do dono, 2026-10-09 — BUSINESS_RULES WA-17) e sequência do cliente do
// anúncio de WhatsApp (WA-18: 1 h, 3 h, 10 h, 23 h). PURO, testado em
// tests/whatsapp-form-reminder.test.mjs. Quem lê o banco e envia é lib/whatsapp-form-reminder.js (cron whatsapp-flows).
//
// "Recebeu o link" = mensagem de SAÍDA registrada no Chat (whatsapp_messages) com um link do formulário do site
// (/s, /s/<ref>, /simulacao, /c/<código>) no texto ou no botão de link (metadata.link.url), enviada pela automação
// (Fluxo/resposta automática) ou por uma pessoa PELO CHAT (metadata.actor_ctx). Mensagem digitada no celular do
// corretor não conta (não foi enviada pelo CRM).

import { isSponsoredAdReferral } from "./whatsapp-referral.mjs";

export const FORM_REMINDER_DELAY_MS = 60 * 60 * 1000; // 1 hora depois do link
export const FORM_REMINDER_MAX_LATE_MS = 3 * 60 * 60 * 1000; // passou disso do horário previsto (cron parado): não envia mais
export const FORM_REMINDER_LOOKBACK_MS = 26 * 60 * 60 * 1000; // links das últimas 26 h (última etapa: 23 h + atraso)
export const OFFICIAL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OFFICIAL_WINDOW_SAFETY_MS = 5 * 60 * 1000; // não envia nos últimos 5 min da janela
export const FORM_REMINDER_KIND = "form_reminder";
// Sem horário de silêncio: a automação roda 24 horas (decisão do dono, 2026-10-09 — antes segurava 21:00–08:00).

// BACKLOG (decisão do dono, 2026-10-09): link enviado ANTES da publicação desta regra, cujo cliente escreveu pela última
// vez há menos de 24 h, não preencheu, não respondeu depois do link e não foi atendido por ninguém — a 1ª mensagem sai
// logo depois da publicação (espaçada pelo cron, sem rajada) e as seguintes contam a partir do ENVIO dessa 1ª.
export const FORM_REMINDER_BACKLOG_CUTOFF = "2026-10-09T10:30:00.000Z"; // publicação da sequência do anúncio
export const FORM_REMINDER_BACKLOG_DEADLINE_MS = 12 * 60 * 60 * 1000; // 1ª do backlog só até 12 h depois do corte
export const FORM_REMINDER_BACKLOG_LOOKBACK_MS = 48 * 60 * 60 * 1000; // enquanto há backlog a tratar
export const FORM_REMINDER_BACKLOG_SENDS_PER_RUN = 3; // no máximo 3 primeiras do backlog por rodada (2 min)

// Sequência do cliente do ANÚNCIO de WhatsApp (regra do dono, 2026-10-09 — BUSINESS_RULES WA-18): 1 h, 3 h, 10 h e 23 h.
// Demais clientes: o lembrete único de 1 h (WA-17, etapa "").
export const AD_REMINDER_STEPS = [
  { step: "1h", delayMs: 1 * 60 * 60 * 1000 },
  { step: "3h", delayMs: 3 * 60 * 60 * 1000 },
  { step: "10h", delayMs: 10 * 60 * 60 * 1000 },
  { step: "23h", delayMs: 23 * 60 * 60 * 1000 }
];
const SINGLE_REMINDER_STEPS = [{ step: "", delayMs: FORM_REMINDER_DELAY_MS }];

export function reminderSteps(ad) {
  return ad ? AD_REMINDER_STEPS : SINGLE_REMINDER_STEPS;
}

// Conversa que veio de anúncio patrocinado (origem gravada na conversa pelo webhook).
export function isAdConversation(conversation) {
  return conversation?.origin?.kind === "meta_ad" && isSponsoredAdReferral(conversation.origin.referral);
}

export function isBacklogLink(link) {
  const at = new Date(link?.message_at).getTime();
  return Number.isFinite(at) && at < new Date(FORM_REMINDER_BACKLOG_CUTOFF).getTime();
}

// Chave de idempotência (vai em whatsapp_messages.meta_message_id, índice único): uma mensagem por link e etapa.
// Etapa "" = lembrete único (WA-17), chave antiga "form-reminder:<link>".
export function formReminderClaimKey(linkMessageId, step = "") {
  const id = String(linkMessageId || "").trim();
  return step ? `form-reminder:${id}:${step}` : `form-reminder:${id}`;
}

// Chaves que contam como "esta etapa já saiu". A 1ª da sequência também respeita a chave antiga (lembrete único já
// enviado para o mesmo link antes da publicação). A primeira da lista é a que se grava.
export function claimKeysForStep(linkMessageId, step = "") {
  if (step === "1h") return [formReminderClaimKey(linkMessageId, "1h"), formReminderClaimKey(linkMessageId)];
  return [formReminderClaimKey(linkMessageId, step)];
}

// Etapa que vale AGORA para o link (a mais recente cujo horário já chegou; a anterior não enviada fica para trás).
//  - link novo: horários contados do link;
//  - backlog: a 1ª sai a partir da publicação (no mínimo 1 h depois do link) e as seguintes contam do ENVIO da 1ª
//    (`firstSentAt`); sem a 1ª enviada, não há as seguintes.
// Resultado: { index, step, dueAt, lateUntil, backlog } ou null (nenhuma etapa chegou ainda).
export function currentReminderStep({ link, ad = false, firstSentAt = null }, now = new Date()) {
  const linkAt = new Date(link?.message_at).getTime();
  if (!Number.isFinite(linkAt)) return null;
  const steps = reminderSteps(ad);
  const backlog = isBacklogLink(link);
  const cutoff = new Date(FORM_REMINDER_BACKLOG_CUTOFF).getTime();
  const first = firstSentAt ? new Date(firstSentAt).getTime() : NaN;
  const nowMs = new Date(now).getTime();
  let current = null;
  steps.forEach((item, index) => {
    let due;
    let lateUntil;
    if (!backlog) {
      due = linkAt + item.delayMs;
      lateUntil = due + FORM_REMINDER_MAX_LATE_MS;
    } else if (index === 0) {
      due = Math.max(cutoff, linkAt + item.delayMs);
      lateUntil = cutoff + FORM_REMINDER_BACKLOG_DEADLINE_MS;
    } else {
      if (!Number.isFinite(first)) return;
      due = first + item.delayMs - steps[0].delayMs;
      lateUntil = due + FORM_REMINDER_MAX_LATE_MS;
    }
    if (due <= nowMs) current = { index, step: item.step, dueAt: new Date(due), lateUntil: new Date(lateUntil), backlog };
  });
  return current;
}

const AD_STEP_TEXTS = {
  "1h": (first) => `${first ? `Oi, ${first}, tudo bem?` : "Oi, tudo bem?"} Notei que você ainda não preencheu o formulário. Ficou com alguma dúvida ou teve alguma dificuldade?`,
  "3h": (first) => `${first ? `${first}, leva` : "Leva"} menos de 2 minutos e já te mostro quanto você consegue financiar e os imóveis que cabem no seu bolso. Quer que eu te ajude por aqui?`,
  "10h": (first) => `${first ? `${first}, ainda` : "Ainda"} está aí? Se preferir, me responde aqui mesmo e um associado te atende agora.`,
  "23h": (first) => `${first ? `${first}, vou` : "Vou"} deixar seu atendimento reservado até amanhã. É só me responder quando puder.`
};

export function buildFormReminderText(fullName, step = "") {
  const first = usableFirstName(fullName);
  if (AD_STEP_TEXTS[step]) return AD_STEP_TEXTS[step](first);
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

const SITE_HOST = "matheusmachadoimoveis.com.br";
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

const SKIP_CLIENT_STATUSES = new Set(["archived", "do_not_contact"]);

// Decide o que fazer com UM link. Resultado: { action: "send" | "wait" | "skip", reason, step, claimKey }.
//  - "wait": ainda não é hora (ou algo passageiro: fluxo em andamento) — o cron olha de novo depois;
//  - "skip": não envia (definitivo para esta etapa);
//  - "send": envia a etapa `step` pelo canal informado em `channel`, gravando `claimKey`.
// Entrada (já lida do banco):
//  link            { id, message_at, channel, session_user_id, session_slot }
//  conversation    { client_id, deleted_at, status, last_inbound_at, last_human_reply_at, session_key, origin }
//  client          { status, last_form_submitted_at } | null
//  phoneRegistrations [{ id, status, created_at, last_form_submitted_at }]  (todos os cadastros com o telefone)
//  messagesAfter   mensagens da conversa DEPOIS do link (qualquer direção)
//  auditsAfter     ações de pessoas na conversa depois do link (assumir, atribuir, status, excluir…)
//  claimedKeys     chaves de idempotência já gravadas para este link (ou alreadyClaimed = true)
//  firstSentAt     quando a 1ª da sequência saiu (backlog: as seguintes contam dela)
//  isTeamPhone, isPhoneBlocked, hasLiveFlowSession, chatDisabled
//  channel         { kind: "official" | "individual", officialConfigured, individualAllowed }
export function decideFormReminder(input = {}, now = new Date()) {
  const { link, conversation, client, phoneRegistrations = [], messagesAfter = [], auditsAfter = [], channel = {} } = input;
  if (!link?.id || !conversation) return { action: "skip", reason: "dados_incompletos" };
  const sentAt = new Date(link.message_at);
  if (Number.isNaN(sentAt.getTime())) return { action: "skip", reason: "dados_incompletos" };
  const ad = isAdConversation(conversation);
  const current = currentReminderStep({ link, ad, firstSentAt: input.firstSentAt }, now);
  if (!current) return { action: "wait", reason: "aguardando_horario" };
  const keys = claimKeysForStep(link.id, current.step);
  const claimed = new Set(input.claimedKeys || []);
  const base = { step: current.step, claimKey: keys[0] };
  const skip = (reason) => ({ action: "skip", reason, ...base });
  if (input.alreadyClaimed || keys.some((key) => claimed.has(key))) return skip("ja_enviado");
  const nowMs = new Date(now).getTime();
  if (nowMs > current.lateUntil.getTime()) return skip("atrasado_demais");
  // Backlog: só quem escreveu pela última vez há menos de 24 h (decisão do dono, 2026-10-09).
  if (current.backlog && current.index === 0) {
    const lastInbound = conversation.last_inbound_at ? new Date(conversation.last_inbound_at).getTime() : NaN;
    if (!(nowMs - lastInbound < OFFICIAL_WINDOW_MS)) return skip("backlog_fora_das_24h");
  }

  // Algo aconteceu depois do link: o cliente respondeu, uma pessoa atendeu ou um link novo foi enviado.
  for (const message of messagesAfter) {
    // Sequência do anúncio: reação (👍) não é resposta (mesma regra da entrada na roleta, WA-18).
    if (message.direction === "inbound") {
      if (ad && String(message.message_type || "text") === "reaction") continue;
      return skip("cliente_respondeu");
    }
    if (message.direction === "outbound" && message.sender_type === "user") return skip("humano_respondeu");
    // Lembrete único: um lembrete depois do link = já enviado. Sequência: as etapas anteriores não bloqueiam a próxima.
    if (message.direction === "outbound" && message.metadata?.kind === FORM_REMINDER_KIND) {
      if (ad) continue;
      return skip("ja_enviado");
    }
    if (message.direction === "outbound" && messageFormLink(message)) return skip("link_mais_novo");
  }
  if (auditsAfter.length) return skip("humano_assumiu");
  if (conversation.last_human_reply_at && new Date(conversation.last_human_reply_at) > sentAt) return skip("humano_respondeu");
  if (!ad && conversation.last_inbound_at && new Date(conversation.last_inbound_at) > sentAt) return skip("cliente_respondeu");
  if (conversation.deleted_at) return skip("conversa_excluida");
  if (conversation.status === "finished") return skip("conversa_finalizada");

  // Cliente: precisa existir; arquivado/Não contactar nunca recebe; já preencheu = não envia.
  if (!conversation.client_id || !client) return skip("sem_cliente");
  if (SKIP_CLIENT_STATUSES.has(client.status)) return skip("cliente_arquivado_ou_nao_contactar");
  if (client.last_form_submitted_at) return skip("formulario_preenchido");
  for (const registration of phoneRegistrations) {
    if (registration.status === "do_not_contact") return skip("telefone_nao_contactar");
    if (registration.last_form_submitted_at && new Date(registration.last_form_submitted_at) >= sentAt) return skip("formulario_preenchido");
    if (registration.created_at && new Date(registration.created_at) > sentAt) return skip("cadastro_novo");
  }
  if (input.isTeamPhone) return skip("numero_da_equipe");
  if (input.isPhoneBlocked) return skip("telefone_bloqueado");

  // Canal: o MESMO número que mandou o link.
  if (channel.kind === "official") {
    if (!conversation.last_inbound_at) return skip("janela_fechada");
    const windowEnds = new Date(conversation.last_inbound_at).getTime() + OFFICIAL_WINDOW_MS - OFFICIAL_WINDOW_SAFETY_MS;
    if (nowMs >= windowEnds) return skip("janela_fechada");
  } else if (channel.kind !== "individual") {
    return skip(channel.kind === "numero_mudou" ? "numero_mudou" : "canal_desconhecido");
  }
  // Passageiros: o cron tenta de novo na próxima rodada (até o limite de atraso).
  if (input.chatDisabled) return { action: "wait", reason: "chat_desativado", ...base };
  if (channel.kind === "official" && !channel.officialConfigured) return { action: "wait", reason: "oficial_sem_credencial", ...base };
  if (channel.kind === "individual" && !channel.individualAllowed) return { action: "wait", reason: "whatsapp_pessoal_nao_permitido", ...base };
  if (input.hasLiveFlowSession) return { action: "wait", reason: "fluxo_em_andamento", ...base };
  return { action: "send", reason: "ok", channel: channel.kind, ...base };
}
