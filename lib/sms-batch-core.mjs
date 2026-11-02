// Lote de SMS (REGRA OFICIAL DE NEGÓCIO — dono, 2026-11-02): enviar o link do cadastro por SMS, por TOQUE (iPhone: abre o
// app Mensagens com o texto pronto), a contatos da BASE que ainda NÃO tiveram nenhuma tentativa de contato. Parte pura
// (testada em tests/sms-batch-core.test.mjs); leitura/gravação no banco em lib/sms-batch.js.
import { isValidBrazilianMobile, normalizeBrazilianMobileNational, phoneComparisonKey, toBrazilianE164 } from "./phone-utils.js";

export const SMS_BATCH_DEFAULT_LIMIT = 50;
export const SMS_BATCH_MAX_LIMIT = 200;
export const SMS_BATCH_TEMPLATE_MAX_CHARS = 600;
export const SMS_BATCH_TEMPLATE_SETTING_ID = "sms_batch_template";
export const SMS_BATCH_TEMPLATE_2_SETTING_ID = "sms_batch_template_2";
export const SMS_BATCH_LIMIT_SETTING_ID = "sms_batch_daily_limit";
export const SMS_BATCH_CAMPAIGN_NAME = "SMS - Lote da base";
// Depois do envio o contato vira "tentado": sai da Prospecção por 30 dias (mesmo padrão PRO-3 de tentativa recente).
export const SMS_BATCH_RECENT_ATTEMPT_DAYS = 30;
export const SMS_BATCH_HISTORY_EVENT = "sms_batch_sent";
export const SMS_BATCH_HISTORY_EVENT_2 = "sms_batch_sent_2";
// Eventos de sms_batch_sends: 1ª mensagem, 2ª mensagem (migration 20261102140000) e "respondeu SAIR".
export const SMS_EVENT = Object.freeze({ FIRST: "sent", SECOND: "sent_2", OPT_OUT: "opt_out" });

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-11-02] Textos definidos pelo dono. [Saudação] vem de getTimeGreeting()
// (lib/daily-report.js, única) — quem monta o texto passa `greeting`; aqui nunca se decide bom dia/boa tarde/boa noite.
// 1ª mensagem (contato frio): sem opt-out por decisão do dono (nota de risco/LGPD em docs/BUSINESS_RULES.md PRO-18);
// o "responda SAIR" fica na 2ª.
export const SMS_BATCH_DEFAULT_TEMPLATE =
  "[Saudação] [nome], tudo bem ?\n\nMeu nome é Matheus Machado, sou Corretor de Imóveis.\nQuer saber o quanto a Caixa aprova para você comprar seu imóvel?\n\nFaça a simulação grátis em menos de 2 min clicando no link abaixo, é rápido, grátis e sem compromisso:\n\n[link]";

export const SMS_BATCH_DEFAULT_TEMPLATE_2 =
  "Saber seu poder de compra é o primeiro passo para sair do aluguel. Esse sistema foi criado para facilitar e levar informações para todos.\nCaso você já tenha comprado seu imóvel, responda SAIR.\n\nQue você tenha um dia abençoado 🙏🏼";

// Aviso curto na tela (contato frio): a 1ª mensagem se identifica; o opt-out vai na 2ª.
export const SMS_BATCH_COLD_NOTICE =
  "Contato frio: a 1ª mensagem se identifica e a 2ª traz o aviso \"responda SAIR\". Se a pessoa responder SAIR, toque em \"Respondeu SAIR\".";

export const SMS_SKIP_REASON = Object.freeze({
  INVALID_PHONE: "celular_invalido",
  NOT_AVAILABLE: "contato_indisponivel", // fora da fila: reivindicado, tentativa recente/bloqueio de 30 dias, lista fria, não contactar
  OWNED: "base_individual_ou_atribuido",
  RESERVED: "lista_impressa",
  ALREADY_TRIED: "ja_houve_tentativa",
  ACTIVE_ROUND: "rodada_ativa",
  IS_CLIENT: "telefone_ja_e_cliente",
  HAS_CONVERSATION: "ja_houve_mensagem",
  SMS_SENT: "sms_ja_enviado",
  INTERNAL: "equipe_interna",
  DUPLICATE: "telefone_repetido",
  NO_FIRST: "sem_primeira_mensagem",
  SECOND_SENT: "segunda_ja_enviada",
  OPTED_OUT: "respondeu_sair",
  DO_NOT_CONTACT: "nao_contactar"
});

// --- Texto ---------------------------------------------------------------------------------------------------------

const NON_NAMES = new Set(["cliente", "contato", "sem", "nome", "senhor", "senhora", "sr", "sra", "dr", "dra", "whatsapp", "unknown", "null", "undefined"]);

// Só o 1º nome, com inicial maiúscula; vazio quando não é confiável (número no lugar do nome, 1 letra, "Cliente WhatsApp"...).
export function smsFirstName(fullName = "") {
  const first = String(fullName ?? "").trim().split(/\s+/)[0] || "";
  if (!/^[\p{L}][\p{L}'-]+$/u.test(first)) return "";
  if (NON_NAMES.has(first.toLowerCase())) return "";
  return first.charAt(0).toLocaleUpperCase("pt-BR") + first.slice(1).toLocaleLowerCase("pt-BR");
}

// null = texto válido; senão a mensagem de erro. 1ª mensagem: precisa do [link]. 2ª mensagem: precisa do aviso
// "responda SAIR" (o opt-out do lote mora nela).
export function validateSmsTemplate(template, { second = false } = {}) {
  const text = String(template ?? "").trim();
  if (!text) return "Escreva o texto do SMS.";
  if (text.length > SMS_BATCH_TEMPLATE_MAX_CHARS) return `O texto passa de ${SMS_BATCH_TEMPLATE_MAX_CHARS} caracteres.`;
  if (second) return /\bsair\b/i.test(text) ? null : "A 2ª mensagem precisa trazer o aviso para parar: \"responda SAIR\".";
  return text.includes("[link]") ? null : "O texto precisa ter [link].";
}

// [Saudação] (com ou sem acento/maiúscula), [nome] e [link]. Sem nome confiável o [nome] some: "Bom dia, tudo bem ?".
// As quebras de linha do texto são mantidas (viram %0A no href sms:).
export function renderSmsText(template, { name = "", link = "", greeting = "" } = {}) {
  const base = String(template || SMS_BATCH_DEFAULT_TEMPLATE);
  const first = smsFirstName(name);
  let text = base.replace(/\[sauda[cç][aã]o\]/gi, greeting);
  if (first) {
    text = text.replaceAll("[nome]", first);
  } else {
    // "Oi, [nome]!" (texto antigo) vira "Olá!"; nos demais, só tira o [nome] e o espaço que o precede.
    text = text.replace(/(?:Oi|Olá|Ola)[,\s]*\[nome\]\s*!/i, "Olá!").replace(/[ \t]*\[nome\]/g, "");
  }
  return text.replaceAll("[link]", link).replace(/[ \t]{2,}/g, " ").trim();
}

// Link do app Mensagens. iOS: `sms:<numero>&body=<texto>`; fallback (Android/outros): `sms:<numero>?body=<texto>`.
// O "+" do número fica literal (é o formato que o iOS aceita); só o texto é codificado.
export function buildSmsHrefs(phone, body) {
  const e164 = toBrazilianE164(phone);
  if (!e164) return { primary: "", fallback: "" };
  const encoded = encodeURIComponent(String(body ?? ""));
  return { primary: `sms:${e164}&body=${encoded}`, fallback: `sms:${e164}?body=${encoded}` };
}

// (14) 9****-1234
export function maskSmsPhone(phone) {
  const national = normalizeBrazilianMobileNational(phone);
  if (national.length !== 11) return "";
  return `(${national.slice(0, 2)}) 9****-${national.slice(7)}`;
}

// --- Elegibilidade ÚNICA ---------------------------------------------------------------------------------------------

// Motivo para NÃO oferecer o contato (null = elegível). `c` junta a linha de prospecting_contacts com os fatos lidos no banco:
//   status, assignedUserId, ownerUserId, lastBrokerId, lastAttemptAt, registrationId  — da linha do contato
//   reserved           — contato numa lista manual impressa
//   hasRound           — qualquer rodada da Meta Diária/Disparar (ativa ou não) para o contato
//   hasManualAttempt   — reivindicação manual real (prospecting_history claimed/prospecting_started que não é reserva)
//   isClientPhone      — o telefone já é de um cadastro do CRM (qualquer status: cobre Não contactar, restrição, arquivado,
//                        lista fria, venda, em atendimento...)
//   hasConversation    — já existe conversa de WhatsApp (mensagem enviada OU recebida) com o telefone
//   smsSent            — já recebeu SMS deste lote
//   isInternalPhone    — telefone de integrante da equipe
export function smsSkipReason(c = {}) {
  if (!isValidBrazilianMobile(c.phone)) return SMS_SKIP_REASON.INVALID_PHONE;
  if (c.status !== "available") return SMS_SKIP_REASON.NOT_AVAILABLE;
  if (c.assignedUserId || c.ownerUserId) return SMS_SKIP_REASON.OWNED;
  if (c.reserved) return SMS_SKIP_REASON.RESERVED;
  if (c.hasRound) return SMS_SKIP_REASON.ACTIVE_ROUND;
  if (c.lastBrokerId || c.lastAttemptAt || c.hasManualAttempt) return SMS_SKIP_REASON.ALREADY_TRIED;
  if (c.registrationId || c.isClientPhone) return SMS_SKIP_REASON.IS_CLIENT;
  if (c.hasConversation) return SMS_SKIP_REASON.HAS_CONVERSATION;
  if (c.smsSent) return SMS_SKIP_REASON.SMS_SENT;
  if (c.isInternalPhone) return SMS_SKIP_REASON.INTERNAL;
  return null;
}

export function isSmsEligible(candidate) {
  return smsSkipReason(candidate) === null;
}

// Cota do dia: limite configurado menos o que já foi enviado hoje.
export function smsRemainingToday(limit, sentToday) {
  const max = Math.min(SMS_BATCH_MAX_LIMIT, Math.max(0, Math.floor(Number(limit) || 0)));
  return Math.max(0, max - Math.max(0, Math.floor(Number(sentToday) || 0)));
}

export function normalizeSmsLimit(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) return SMS_BATCH_DEFAULT_LIMIT;
  return Math.min(SMS_BATCH_MAX_LIMIT, number);
}

// Escolhe o lote: candidatos já em ordem (mais antigos na base primeiro); um telefone = uma linha (9º dígito/DDI não duplicam).
export function planSmsBatch(candidates = [], { limit = SMS_BATCH_DEFAULT_LIMIT, sentToday = 0 } = {}) {
  const room = smsRemainingToday(limit, sentToday);
  const items = [];
  const skipped = {};
  const seen = new Set();
  for (const candidate of candidates) {
    if (items.length >= room) break;
    const reason = smsSkipReason(candidate);
    if (reason) {
      skipped[reason] = (skipped[reason] || 0) + 1;
      continue;
    }
    const key = phoneComparisonKey(candidate.phone);
    if (seen.has(key)) {
      skipped[SMS_SKIP_REASON.DUPLICATE] = (skipped[SMS_SKIP_REASON.DUPLICATE] || 0) + 1;
      continue;
    }
    seen.add(key);
    items.push(candidate);
  }
  return { items, skipped };
}

// Telefone digitado/guardado do jeito que a fila usa (+55DDNNNNNNNNN).
export function smsContactPhone(value) {
  return toBrazilianE164(value);
}

// --- 2ª mensagem ------------------------------------------------------------------------------------------------------

// Motivo para NÃO oferecer a 2ª mensagem (null = pode enviar): só depois da 1ª enviada, uma única vez por telefone, e
// nunca para quem respondeu SAIR ou foi marcado como Não contactar (contato da fila ou cadastro de cliente).
export function smsSecondSkipReason({ firstSent = false, secondSent = false, optedOut = false, doNotContact = false } = {}) {
  if (!firstSent) return SMS_SKIP_REASON.NO_FIRST;
  if (optedOut) return SMS_SKIP_REASON.OPTED_OUT;
  if (doNotContact) return SMS_SKIP_REASON.DO_NOT_CONTACT;
  if (secondSent) return SMS_SKIP_REASON.SECOND_SENT;
  return null;
}

// events: linhas de sms_batch_sends ({ id, phone_normalized, event, created_at, contact_id, name, contactStatus }), qualquer
// ordem. Agrupa por telefone e separa: aguardando a 2ª (1ª enviada, sem 2ª, sem SAIR, sem Não contactar) e concluídos
// (2ª enviada, SAIR ou Não contactar). `sendId` = a linha da 1ª (serve para a 2ª e para o SAIR).
export function groupSmsConversations(events = []) {
  const byPhone = new Map();
  for (const row of [...events].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
    const key = phoneComparisonKey(row.phone_normalized);
    if (!key) continue;
    const entry = byPhone.get(key) || { phone: row.phone_normalized, sendId: "", contactId: row.contact_id || "", name: "", contactStatus: "", sentAt: "", secondAt: "", secondId: "", optedOut: false };
    if (row.event === SMS_EVENT.FIRST && !entry.sendId) Object.assign(entry, { sendId: row.id, sentAt: row.created_at, contactId: row.contact_id || entry.contactId });
    if (row.event === SMS_EVENT.SECOND) Object.assign(entry, { secondAt: row.created_at, secondId: row.id });
    if (row.event === SMS_EVENT.OPT_OUT) entry.optedOut = true;
    entry.name = entry.name || row.name || "";
    entry.contactStatus = row.contactStatus || entry.contactStatus;
    byPhone.set(key, entry);
  }
  const awaiting = [];
  const done = [];
  for (const entry of [...byPhone.values()].filter((item) => item.sendId).sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt))) {
    const reason = smsSecondSkipReason({ firstSent: true, secondSent: Boolean(entry.secondAt), optedOut: entry.optedOut, doNotContact: entry.contactStatus === "do_not_contact" });
    (reason ? done : awaiting).push({ ...entry, state: reason ? (entry.optedOut || reason === SMS_SKIP_REASON.DO_NOT_CONTACT ? "opt_out" : "complete") : "awaiting" });
  }
  done.reverse();
  return { awaiting, done };
}

// --- Dia (São Paulo) e medição ----------------------------------------------------------------------------------------

const SP_TZ = "America/Sao_Paulo";

export function spDayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { timeZone: SP_TZ });
}

// Início do dia de São Paulo (UTC-3, sem horário de verão desde 2019) como ISO.
export function spDayStartIso(now = new Date()) {
  return new Date(`${spDayKey(now)}T00:00:00-03:00`).toISOString();
}

// sends (1ª)/sends2 (2ª)/views/signups: listas de { created_at }. Devolve total e últimos `days` dias (mais recente primeiro).
export function buildSmsMetrics({ sends = [], sends2 = [], views = [], signups = [] } = {}, { days = 14, now = new Date() } = {}) {
  const count = (rows) => rows.reduce((map, row) => {
    const key = spDayKey(row?.created_at);
    if (key) map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  const sentByDay = count(sends);
  const sent2ByDay = count(sends2);
  const viewsByDay = count(views);
  const signupsByDay = count(signups);
  const rate = (signupCount, sentCount) => (sentCount ? signupCount / sentCount : null);
  const byDay = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = spDayKey(new Date(new Date(now).getTime() - offset * 86400000));
    const sent = sentByDay.get(day) || 0;
    const clicks = viewsByDay.get(day) || 0;
    const signupCount = signupsByDay.get(day) || 0;
    byDay.push({ day, sent, sent2: sent2ByDay.get(day) || 0, clicks, signups: signupCount, rate: rate(signupCount, sent) });
  }
  return { total: { sent: sends.length, sent2: sends2.length, clicks: views.length, signups: signups.length, rate: rate(signups.length, sends.length) }, byDay };
}
