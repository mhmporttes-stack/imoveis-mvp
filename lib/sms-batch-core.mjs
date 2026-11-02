// Lote de SMS (REGRA OFICIAL DE NEGÓCIO — dono, 2026-11-02): enviar o link do cadastro por SMS, por TOQUE (iPhone: abre o
// app Mensagens com o texto pronto), a contatos da BASE que ainda NÃO tiveram nenhuma tentativa de contato. Parte pura
// (testada em tests/sms-batch-core.test.mjs); leitura/gravação no banco em lib/sms-batch.js.
import { isValidBrazilianMobile, normalizeBrazilianMobileNational, phoneComparisonKey, toBrazilianE164 } from "./phone-utils.js";

export const SMS_BATCH_DEFAULT_LIMIT = 50;
export const SMS_BATCH_MAX_LIMIT = 200;
export const SMS_BATCH_TEMPLATE_MAX_CHARS = 300;
export const SMS_BATCH_TEMPLATE_SETTING_ID = "sms_batch_template";
export const SMS_BATCH_LIMIT_SETTING_ID = "sms_batch_daily_limit";
export const SMS_BATCH_CAMPAIGN_NAME = "SMS - Lote da base";
// Depois do envio o contato vira "tentado": sai da Prospecção por 30 dias (mesmo padrão PRO-3 de tentativa recente).
export const SMS_BATCH_RECENT_ATTEMPT_DAYS = 30;
export const SMS_BATCH_HISTORY_EVENT = "sms_batch_sent";

export const SMS_BATCH_DEFAULT_TEMPLATE =
  "Oi, [nome]! Aqui é o Matheus Machado, Corretor de Imóveis, de Marília. Quer saber se já pode financiar o seu primeiro imóvel? Faça a simulação grátis em 2 min: [link]. Para parar, responda SAIR.";

// Aviso curto na tela (contato frio): o texto se identifica, é curto e traz o opt-out.
export const SMS_BATCH_COLD_NOTICE =
  "Contato frio: o texto precisa se identificar, ser curto e trazer o aviso \"responda SAIR\". Se a pessoa responder SAIR, toque em \"Respondeu SAIR\".";

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
  DUPLICATE: "telefone_repetido"
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

// null = texto válido; senão a mensagem de erro. O opt-out ("SAIR") e o [link] são obrigatórios.
export function validateSmsTemplate(template) {
  const text = String(template ?? "").trim();
  if (!text) return "Escreva o texto do SMS.";
  if (text.length > SMS_BATCH_TEMPLATE_MAX_CHARS) return `O texto passa de ${SMS_BATCH_TEMPLATE_MAX_CHARS} caracteres.`;
  if (!text.includes("[link]")) return "O texto precisa ter [link].";
  if (!/\bsair\b/i.test(text)) return "O texto precisa trazer o aviso para parar: \"responda SAIR\".";
  return null;
}

export function renderSmsText(template, { name = "", link = "" } = {}) {
  const base = String(template || SMS_BATCH_DEFAULT_TEMPLATE);
  const first = smsFirstName(name);
  let text = base;
  if (first) {
    text = text.replaceAll("[nome]", first);
  } else {
    // Sem nome confiável: "Oi, [nome]!" vira "Olá!".
    text = text.replace(/(?:Oi|Olá|Ola)[,\s]*\[nome\]\s*!/i, "Olá!").replace(/\s*\[nome\]/g, "");
  }
  return text.replaceAll("[link]", link).replace(/ {2,}/g, " ").replace(/\s+([!?.,])/g, "$1").trim();
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

// sends/views/signups: listas de { created_at }. Devolve total e últimos `days` dias (mais recente primeiro).
export function buildSmsMetrics({ sends = [], views = [], signups = [] } = {}, { days = 14, now = new Date() } = {}) {
  const count = (rows) => rows.reduce((map, row) => {
    const key = spDayKey(row?.created_at);
    if (key) map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  const sentByDay = count(sends);
  const viewsByDay = count(views);
  const signupsByDay = count(signups);
  const rate = (signupCount, sentCount) => (sentCount ? signupCount / sentCount : null);
  const byDay = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = spDayKey(new Date(new Date(now).getTime() - offset * 86400000));
    const sent = sentByDay.get(day) || 0;
    const clicks = viewsByDay.get(day) || 0;
    const signupCount = signupsByDay.get(day) || 0;
    byDay.push({ day, sent, clicks, signups: signupCount, rate: rate(signupCount, sent) });
  }
  return { total: { sent: sends.length, clicks: views.length, signups: signups.length, rate: rate(signups.length, sends.length) }, byDay };
}
