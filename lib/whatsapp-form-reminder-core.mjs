// Lembrete do formulário não preenchido (regra do dono, 2026-10-09 — BUSINESS_RULES WA-17) e sequência do cliente do
// anúncio de WhatsApp (WA-18: 1 h, 3 h, 10 h — a de 23 h foi cortada pelo dono em 2026-10-12). PURO, testado em
// tests/whatsapp-form-reminder.test.mjs. Quem lê o banco e envia é lib/whatsapp-form-reminder.js (cron whatsapp-flows).
//
// "Recebeu o link" = mensagem de SAÍDA registrada no Chat (whatsapp_messages) com um link do formulário do site
// (/s, /s/<ref>, /simulacao, /c/<código>) no texto ou no botão de link (metadata.link.url), enviada pela automação
// (Fluxo/resposta automática) ou por uma pessoa PELO CHAT (metadata.actor_ctx). Mensagem digitada no celular do
// corretor não conta (não foi enviada pelo CRM).

import { isSponsoredAdReferral } from "./whatsapp-referral.mjs";
import { isPresentationToken } from "./simulation-presentation-core.mjs";

export const FORM_REMINDER_DELAY_MS = 60 * 60 * 1000; // 1 hora depois do link
export const FORM_REMINDER_MAX_LATE_MS = 3 * 60 * 60 * 1000; // passou disso do horário previsto (cron parado): não envia mais
export const FORM_REMINDER_LOOKBACK_MS = 26 * 60 * 60 * 1000; // links das últimas 26 h (pior caso: 10 h adiada para as 8 h ≈ 21 h + atraso)
export const OFFICIAL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const OFFICIAL_WINDOW_SAFETY_MS = 5 * 60 * 1000; // não envia nos últimos 5 min da janela
export const FORM_REMINDER_KIND = "form_reminder";
// Resposta automática fora do horário (lib/whatsapp-after-hours-core.mjs): leva o botão do formulário, mas NÃO é um
// "link novo" — não pode reiniciar a sequência de lembretes.
export const AFTER_HOURS_REPLY_KIND = "after_hours_reply";

// MADRUGADA (regra do dono, 2026-10-12 — decisão 8 da Mesa do robô do Chat; desfaz o "roda 24 h" de 09/10 só para os
// lembretes): lembrete que venceria entre 21h e 8h (America/Sao_Paulo) sai às 8 h — várias etapas vencidas viram UMA
// mensagem (a da etapa mais recente, com o texto fixo das 8 h). Entre dois lembretes do mesmo link, no mínimo 2 h
// (decisão 12). Vale para a sequência do anúncio (WA-18) e para o lembrete único (WA-17). Fuso fixo -03:00 (o Brasil não
// tem horário de verão desde 2019, mesmo padrão de lib/daily-goal-policy-core.mjs).
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 8;
export const REMINDER_MIN_GAP_MS = 2 * 60 * 60 * 1000;
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Instante (ms) adiado para as 8 h se cair entre 21h e 8h em São Paulo; senão o próprio instante.
export function deferQuietHours(ms) {
  const local = new Date(ms - SAO_PAULO_OFFSET_MS); // campos UTC = hora local de São Paulo
  const hour = local.getUTCHours();
  if (hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR) return ms;
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + (hour >= QUIET_START_HOUR ? DAY_MS : 0);
  return localMidnight + QUIET_END_HOUR * 60 * 60 * 1000 + SAO_PAULO_OFFSET_MS;
}

// BACKLOG (decisão do dono, 2026-10-09): link enviado ANTES da publicação desta regra, cujo cliente escreveu pela última
// vez há menos de 24 h, não preencheu, não respondeu depois do link e não foi atendido por ninguém — a 1ª mensagem sai
// logo depois da publicação (espaçada pelo cron, sem rajada) e as seguintes contam a partir do ENVIO dessa 1ª.
export const FORM_REMINDER_BACKLOG_CUTOFF = "2026-10-09T10:30:00.000Z"; // publicação da sequência do anúncio
export const FORM_REMINDER_BACKLOG_DEADLINE_MS = 12 * 60 * 60 * 1000; // 1ª do backlog só até 12 h depois do corte
export const FORM_REMINDER_BACKLOG_LOOKBACK_MS = 48 * 60 * 60 * 1000; // enquanto há backlog a tratar
export const FORM_REMINDER_BACKLOG_SENDS_PER_RUN = 3; // no máximo 3 primeiras do backlog por rodada (2 min)

// Sequência do cliente do ANÚNCIO de WhatsApp (regra do dono, 2026-10-09 — BUSINESS_RULES WA-18): 1 h, 3 h e 10 h (a de
// 23 h foi cortada pelo dono em 2026-10-12, decisão 6 — a chave ":23h" nunca mais é gerada).
// Demais clientes: o lembrete único de 1 h (WA-17, etapa "").
export const AD_REMINDER_STEPS = [
  { step: "1h", delayMs: 1 * 60 * 60 * 1000 },
  { step: "3h", delayMs: 3 * 60 * 60 * 1000 },
  { step: "10h", delayMs: 10 * 60 * 60 * 1000 }
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
//  - link novo: horários contados do link; no mínimo 2 h depois do último lembrete enviado (`lastSent` = { index, sentAt })
//    e, se cair entre 21h e 8h, às 8 h (`morning`: a mensagem das 8 h usa o texto fixo e substitui as etapas pendentes);
//  - backlog (links anteriores a 09/10, já encerrado): a 1ª sai a partir da publicação (no mínimo 1 h depois do link) e
//    as seguintes contam do ENVIO da 1ª (`firstSentAt`); sem a 1ª enviada, não há as seguintes. Sem as regras novas.
// Resultado: { index, step, dueAt, lateUntil, backlog, morning } ou null (nenhuma etapa chegou ainda).
export function currentReminderStep({ link, ad = false, firstSentAt = null, lastSent = null }, now = new Date()) {
  const linkAt = new Date(link?.message_at).getTime();
  if (!Number.isFinite(linkAt)) return null;
  const steps = reminderSteps(ad);
  const backlog = isBacklogLink(link);
  const cutoff = new Date(FORM_REMINDER_BACKLOG_CUTOFF).getTime();
  const first = firstSentAt ? new Date(firstSentAt).getTime() : NaN;
  const nowMs = new Date(now).getTime();
  const lastIndex = Number.isInteger(lastSent?.index) ? lastSent.index : -1;
  const lastSentMs = lastSent?.sentAt ? new Date(lastSent.sentAt).getTime() : NaN;
  let current = null;
  let deferredPending = false; // alguma etapa ainda não enviada foi adiada para as 8 h
  steps.forEach((item, index) => {
    let due;
    let lateUntil;
    let deferred = false;
    if (!backlog) {
      const raw = index > lastIndex && Number.isFinite(lastSentMs) ? Math.max(linkAt + item.delayMs, lastSentMs + REMINDER_MIN_GAP_MS) : linkAt + item.delayMs;
      due = deferQuietHours(raw);
      deferred = due !== raw;
      lateUntil = due + FORM_REMINDER_MAX_LATE_MS;
    } else if (index === 0) {
      due = Math.max(cutoff, linkAt + item.delayMs);
      lateUntil = cutoff + FORM_REMINDER_BACKLOG_DEADLINE_MS;
    } else {
      if (!Number.isFinite(first)) return;
      due = first + item.delayMs - steps[0].delayMs;
      lateUntil = due + FORM_REMINDER_MAX_LATE_MS;
    }
    if (due > nowMs) return;
    if (index > lastIndex && deferred) deferredPending = true;
    current = { index, step: item.step, dueAt: new Date(due), lateUntil: new Date(lateUntil), backlog, morning: index > lastIndex && deferredPending };
  });
  return current;
}

// Textos da Mesa do robô do Chat (dossiê §2-C, aprovados pelo dono em 2026-10-12): voz da equipe (plural), com e sem nome.
const AD_STEP_TEXTS = {
  "1h": (first) => `${first ? `${first}, conseguiu` : "Conseguiu"} abrir o link da simulação? Se ficou alguma dúvida, é só mandar aqui, escrita ou em áudio.`,
  "3h": () => "Só lembrando: com a simulação você já fica sabendo quanto pode financiar e a parcela pro seu caso. Não pede CPF e é sem compromisso. É só tocar em Fazer simulação, na primeira mensagem que te mandamos.",
  "10h": (first) => `${first ? `${first}, esse` : "Esse"} é nosso último lembrete sobre o link da simulação. Se você trabalha sem carteira ou não tem nada guardado, pode fazer do mesmo jeito. Se preferir conversar, é só responder aqui que a nossa equipe te responde.`
};
// Texto fixo das 8 h (substitui a etapa pendente da sequência e o lembrete único que cairia de madrugada).
const MORNING_TEXT = (first) => `Bom dia${first ? `, ${first}` : ""}! Passando pra lembrar da simulação que te mandamos: ela mostra quanto você pode financiar e a parcela, sem CPF e sem compromisso. Se ficou alguma dúvida, é só responder aqui, escrita ou em áudio.`;

export function buildFormReminderText(fullName, step = "", { morning = false } = {}) {
  const first = usableFirstName(fullName);
  if (morning) return MORNING_TEXT(first);
  if (AD_STEP_TEXTS[step]) return AD_STEP_TEXTS[step](first);
  return `Oi${first ? `, ${first}` : ""}, tudo bem? Sua simulação ainda está em aberto. Ficou alguma dúvida ou teve dificuldade com o link? Se preferir, a gente te ajuda por aqui.`;
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
  const rawPath = url.pathname.replace(/\/+$/, "");
  // /s/<token> com o formato do token da APRESENTAÇÃO da simulação não é o formulário (2026-10-11: a cliente recebeu
  // "não preencheu o formulário" 1 h depois da apresentação). O token diferencia maiúsculas — testar antes do lowercase.
  if (/^\/s\/[^/]+$/i.test(rawPath) && isPresentationToken(rawPath.slice(3))) return false;
  const path = rawPath.toLowerCase();
  return path === "/s" || path.startsWith("/s/") || path === "/simulacao" || path.startsWith("/c/");
}

export function messageFormLink(message = {}) {
  const candidates = [message.metadata?.link?.url, ...(String(message.body || "").match(URL_PATTERN) || [])];
  return candidates.find((value) => isFormLinkUrl(value)) || "";
}

// A mensagem com link foi enviada PELO CRM (automação ou pessoa pelo Chat)?
export function isCrmSentLinkMessage(message = {}) {
  if (message.direction !== "outbound" || message.status === "failed") return false;
  if (message.metadata?.kind === FORM_REMINDER_KIND || message.metadata?.kind === AFTER_HOURS_REPLY_KIND) return false;
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
//  client          { status, last_form_submitted_at, journey_type } | null
//  phoneRegistrations [{ id, status, created_at, last_form_submitted_at, journey_type }]  (todos os cadastros com o telefone)
//  messagesAfter   mensagens da conversa DEPOIS do link (qualquer direção)
//  auditsAfter     ações de pessoas na conversa depois do link (assumir, atribuir, status, excluir…)
//  claimedKeys     chaves de idempotência já gravadas para este link (ou alreadyClaimed = true)
//  firstSentAt     quando a 1ª da sequência saiu (backlog: as seguintes contam dela)
//  lastSent        { index, sentAt } do último lembrete deste link que saiu de verdade (mínimo de 2 h até o próximo)
//  isTeamPhone, isPhoneBlocked, hasLiveFlowSession, chatDisabled
//  channel         { kind: "official" | "individual", officialConfigured, individualAllowed }
export function decideFormReminder(input = {}, now = new Date()) {
  const { link, conversation, client, phoneRegistrations = [], messagesAfter = [], auditsAfter = [], channel = {} } = input;
  if (!link?.id || !conversation) return { action: "skip", reason: "dados_incompletos" };
  const sentAt = new Date(link.message_at);
  if (Number.isNaN(sentAt.getTime())) return { action: "skip", reason: "dados_incompletos" };
  const ad = isAdConversation(conversation);
  const current = currentReminderStep({ link, ad, firstSentAt: input.firstSentAt, lastSent: input.lastSent }, now);
  if (!current) return { action: "wait", reason: "aguardando_horario" };
  const keys = claimKeysForStep(link.id, current.step);
  const claimed = new Set(input.claimedKeys || []);
  const base = { step: current.step, claimKey: keys[0], ...(current.morning ? { morning: true } : {}) };
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
  // Cadastro criado PELO formulário grava a jornada (journey_type) e pode ficar sem last_form_submitted_at (1º envio).
  if (client.journey_type) return skip("formulario_preenchido");
  for (const registration of phoneRegistrations) {
    if (registration.status === "do_not_contact") return skip("telefone_nao_contactar");
    if (registration.journey_type) return skip("formulario_preenchido");
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
