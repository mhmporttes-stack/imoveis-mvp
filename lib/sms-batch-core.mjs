// Lote de SMS (REGRA OFICIAL DE NEGÓCIO — dono, 2026-11-02): enviar o link do cadastro por SMS, por TOQUE (iPhone: abre o
// app Mensagens com o texto pronto), a contatos da BASE que ainda NÃO tiveram nenhuma tentativa de contato. Parte pura
// (testada em tests/sms-batch-core.test.mjs); leitura/gravação no banco em lib/sms-batch.js.
import { isValidBrazilianMobile, normalizeBrazilianMobileNational, phoneComparisonKey, phoneLookupCandidates, toBrazilianE164 } from "./phone-utils.js";

export const SMS_BATCH_DEFAULT_LIMIT = 50;
export const SMS_BATCH_MAX_LIMIT = 200;
export const SMS_BATCH_TEMPLATE_MAX_CHARS = 600;
export const SMS_BATCH_TEMPLATE_SETTING_ID = "sms_batch_template";
export const SMS_BATCH_TEMPLATE_2_SETTING_ID = "sms_batch_template_2";
export const SMS_BATCH_LIMIT_SETTING_ID = "sms_batch_daily_limit";
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-11-02] 1ª mensagem DO CORRETOR (ele se apresenta como associado do corretor Matheus Machado).
export const SMS_BATCH_BROKER_TEMPLATE_SETTING_ID = "sms_batch_template_broker";
export const SMS_BATCH_CAMPAIGN_NAME = "SMS - Lote da base";
// Reserva do contato para UM corretor (sms_batch_reservations): vence sozinha em 24 h, sem reserva fantasma.
export const SMS_BATCH_RESERVATION_HOURS = 24;
// Linha do tempo do cliente: "Veio por SMS do corretor X".
export const SMS_BROKER_ORIGIN_EVENT = "sms_broker_origin";
// Depois do envio o contato vira "tentado": sai da Prospecção por 30 dias (mesmo padrão PRO-3 de tentativa recente).
export const SMS_BATCH_RECENT_ATTEMPT_DAYS = 30;
export const SMS_BATCH_HISTORY_EVENT = "sms_batch_sent";
export const SMS_BATCH_HISTORY_EVENT_2 = "sms_batch_sent_2";
// Eventos de sms_batch_sends: 1ª mensagem, 2ª mensagem (migration 20261102140000) e "respondeu SAIR".
export const SMS_EVENT = Object.freeze({ FIRST: "sent", SECOND: "sent_2", OPT_OUT: "opt_out", INVALID: "invalid", INACTIVE: "inactive" });

// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-11-02] Textos definidos pelo dono. [Saudação] vem de getTimeGreeting()
// (lib/daily-report.js, única) — quem monta o texto passa `greeting`; aqui nunca se decide bom dia/boa tarde/boa noite.
// 1ª mensagem (contato frio): sem opt-out por decisão do dono (nota de risco/LGPD em docs/BUSINESS_RULES.md PRO-18);
// o "responda SAIR" fica na 2ª.
export const SMS_BATCH_DEFAULT_TEMPLATE =
  "[Saudação] [nome], tudo bem ?\n\nMeu nome é Matheus Machado, sou Corretor de Imóveis.\nQuer saber o quanto a Caixa aprova para você comprar seu imóvel?\n\nFaça a simulação grátis em menos de 2 min clicando no link dessa mensagem, é rápido, grátis e sem compromisso:\n\n[link]";

export const SMS_BATCH_DEFAULT_TEMPLATE_2 =
  "Saber seu poder de compra é o primeiro passo para sair do aluguel. Esse sistema foi criado para facilitar e levar informações para todos.\nCaso vc já tenha comprado seu imóvel, responda SAIR.\n\nQue vc tenha um dia abençoado!";

export const SMS_BATCH_DEFAULT_TEMPLATE_BROKER =
  "[Saudação] [nome], tudo bem ?\n\nMeu nome é [corretor] e sou associado do corretor Matheus Machado, Corretor de Imóveis.\nQuer saber o quanto a Caixa aprova para você comprar seu imóvel?\n\nFaça a simulação grátis em menos de 2 min clicando no link dessa mensagem, é rápido, grátis e sem compromisso:\n\n[link]";

// Aviso curto na tela (contato frio): a 1ª mensagem se identifica; o opt-out vai na 2ª.
export const SMS_BATCH_COLD_NOTICE =
  "Contato frio: a 1ª mensagem se identifica e a 2ª traz o aviso \"responda SAIR\". Se a pessoa responder SAIR, toque em \"Respondeu SAIR\".";

export const SMS_SKIP_REASON = Object.freeze({
  INVALID_PHONE: "celular_invalido",
  NOT_AVAILABLE: "contato_indisponivel", // fora da fila: reivindicado, tentativa recente/bloqueio de 30 dias, lista fria, não contactar
  OWNED: "base_individual_ou_atribuido",
  RESERVED: "lista_impressa",
  BROKER_RESERVED: "reservado_por_corretor",
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
  DO_NOT_CONTACT: "nao_contactar",
  NO_WHATSAPP: "sem_whatsapp"
});

// --- Checagem de WhatsApp (dono, 2026-11-02) -----------------------------------------------------------------------------
// Antes de montar os 50 do dia o CRM pergunta ao WhatsApp (onWhatsApp, SÓ consulta, nada é enviado) quais telefones têm conta.
// Quem tem entra no lote normalmente (o disparo continua SOMENTE por SMS); quem NÃO tem sai da lista e vai para a aba "Sem
// WhatsApp" (só leitura). Cache em sms_batch_wa_checks; reconsulta só depois de 30 dias.
export const WA_CHECK_TTL_DAYS = 30;
export const WA_CHECK_MAX_PER_ROUND = 100; // teto de consultas por rodada (cada abertura/recarga da lista)
export const WA_CHECK_BUDGET_MS = 16000; // tempo máximo consultando por rodada (a tela continua sozinha na seguinte)
export const WA_CHECK_SPACING_MIN_MS = 1000;
export const WA_CHECK_SPACING_MAX_MS = 2000;
export const WA_CHECK_MAX_NULLS = 2; // respostas vazias seguidas = serviço instável: para de consultar (falha aberta)

// Espaço entre duas consultas (1–2 s). `random` em [0,1) só para teste.
export function waCheckSpacingMs(random = Math.random()) {
  const r = Math.min(0.999999, Math.max(0, Number(random) || 0));
  return Math.round(WA_CHECK_SPACING_MIN_MS + r * (WA_CHECK_SPACING_MAX_MS - WA_CHECK_SPACING_MIN_MS));
}

// A checagem guardada ainda vale (até 30 dias)?
export function waCheckIsFresh(checkedAt, now = new Date()) {
  const time = new Date(checkedAt).getTime();
  if (!Number.isFinite(time)) return false;
  const age = new Date(now).getTime() - time;
  return age >= 0 && age <= WA_CHECK_TTL_DAYS * 86400000;
}

// rows: linhas de sms_batch_wa_checks ({ phone_normalized, has_whatsapp, checked_at }). Devolve true/false (checagem vigente)
// ou undefined (nunca checado / vencido: precisa consultar). Vale qualquer forma de gravação do número (com/sem 9, DDI).
export function resolveWaCache(rows = [], phone, now = new Date()) {
  const wanted = new Set(phoneLookupCandidates(phone));
  let best;
  for (const row of rows) {
    if (!wanted.has(row.phone_normalized) || !waCheckIsFresh(row.checked_at, now) || typeof row.has_whatsapp !== "boolean") continue;
    if (!best || new Date(row.checked_at) > new Date(best.checked_at)) best = row;
  }
  return best ? best.has_whatsapp : undefined;
}

// Qual sessão conectada faz a consulta: a do dono primeiro, depois a de outro admin geral. candidates:
// [{ userId, isOwner, rows: [{ slot, status }] }]. null = nenhuma conectada (a lista sai sem filtrar).
export function pickWaCheckSession(candidates = []) {
  const ordered = [...candidates].sort((a, b) => Number(Boolean(b.isOwner)) - Number(Boolean(a.isOwner)));
  for (const candidate of ordered) {
    const row = (candidate.rows || []).find((item) => item.status === "connected");
    if (row) return { userId: candidate.userId, slot: Number(row.slot) === 2 ? 2 : 1 };
  }
  return null;
}

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

// 1º nome de quem envia ([corretor]); vazio quando não é confiável.
export function smsBrokerName(fullName = "") {
  return smsFirstName(fullName);
}

// [Saudação] (com ou sem acento/maiúscula), [nome], [corretor] e [link]. Sem nome confiável o [nome] some: "Bom dia, tudo bem ?".
// Sem nome do corretor, "Meu nome é [corretor] e sou associado..." vira "Sou associado...". As quebras de linha do texto
// são mantidas (viram %0A no href sms:).
export function renderSmsText(template, { name = "", link = "", greeting = "", broker = "" } = {}) {
  const base = String(template || SMS_BATCH_DEFAULT_TEMPLATE);
  const first = smsFirstName(name);
  let text = base.replace(/\[sauda[cç][aã]o\]/gi, greeting);
  if (first) {
    text = text.replaceAll("[nome]", first);
  } else {
    // "Oi, [nome]!" (texto antigo) vira "Olá!"; nos demais, só tira o [nome] e o espaço que o precede.
    text = text.replace(/(?:Oi|Olá|Ola)[,\s]*\[nome\]\s*!/i, "Olá!").replace(/[ \t]*\[nome\]/g, "");
  }
  const brokerName = smsBrokerName(broker);
  if (brokerName) text = text.replaceAll("[corretor]", brokerName);
  else text = text.replace(/Meu nome é\s*\[corretor\]\s*,?\s*e\s+sou\b/gi, "Sou").replace(/[ \t]*\[corretor\]/g, "");
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
//   brokerReserved     — contato reservado (24 h) para OUTRO corretor no Lote de SMS (a reserva do próprio corretor não conta)
//   hasRound           — qualquer rodada da Meta Diária/Disparar (ativa ou não) para o contato
//   hasManualAttempt   — reivindicação manual real (prospecting_history claimed/prospecting_started que não é reserva)
//   isClientPhone      — o telefone já é de um cadastro do CRM (qualquer status: cobre Não contactar, restrição, arquivado,
//                        lista fria, venda, em atendimento...)
//   hasConversation    — já existe conversa de WhatsApp (mensagem enviada OU recebida) com o telefone
//   smsSent            — já recebeu SMS deste lote
//   isInternalPhone    — telefone de integrante da equipe
//   hasWhatsapp        — checagem do WhatsApp (sms_batch_wa_checks): false = sem conta; true/undefined entram (sem checagem
//                        possível a lista sai como antes — falha aberta). Só `false` tira do lote.
export function smsSkipReason(c = {}) {
  if (!isValidBrazilianMobile(c.phone)) return SMS_SKIP_REASON.INVALID_PHONE;
  if (c.status !== "available") return SMS_SKIP_REASON.NOT_AVAILABLE;
  if (c.assignedUserId || c.ownerUserId) return SMS_SKIP_REASON.OWNED;
  if (c.reserved) return SMS_SKIP_REASON.RESERVED;
  if (c.brokerReserved) return SMS_SKIP_REASON.BROKER_RESERVED;
  if (c.hasRound) return SMS_SKIP_REASON.ACTIVE_ROUND;
  if (c.lastBrokerId || c.lastAttemptAt || c.hasManualAttempt) return SMS_SKIP_REASON.ALREADY_TRIED;
  if (c.registrationId || c.isClientPhone) return SMS_SKIP_REASON.IS_CLIENT;
  if (c.hasConversation) return SMS_SKIP_REASON.HAS_CONVERSATION;
  if (c.smsSent) return SMS_SKIP_REASON.SMS_SENT;
  if (c.isInternalPhone) return SMS_SKIP_REASON.INTERNAL;
  if (c.hasWhatsapp === false) return SMS_SKIP_REASON.NO_WHATSAPP;
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

// --- Lote do corretor (dono, 2026-11-02) -------------------------------------------------------------------------------

// Campanha "SMS - Lote da base" de UM corretor (destino = corretor fixo): o cadastro vindo do link é atribuído direto a ele,
// sem roleta (resolveExternalLinkAssignment), com a origem e a tag da campanha. `campaign` no formato de rowToCampaign.
export function isSmsBrokerCampaign(campaign) {
  return Boolean(campaign)
    && campaign.name === SMS_BATCH_CAMPAIGN_NAME
    && campaign.destinationType === "broker"
    && Boolean(campaign.brokerId)
    && (campaign.status || "active") === "active";
}

// Quem usa qual lote: gestor/admin geral = lote da equipe ("team"); corretor = o próprio ("broker"); associado = nenhum.
export function smsBatchScope({ isGeneralAdmin = false, isManager = false, isBroker = false, isAssociate = false } = {}) {
  if (isGeneralAdmin || isManager) return "team";
  if (isBroker && !isAssociate) return "broker";
  return null;
}

// Escopo das linhas de sms_batch_sends. As linhas de SAIR não têm campanha em registros antigos: pertencem ao lote do
// telefone da 1ª mensagem. mode "team" = tudo o que NÃO é de corretor; mode "campaign" = só o lote daquela campanha.
export function scopeSmsEvents(events = [], { mode = "team", brokerCampaignIds = [], campaignId = "" } = {}) {
  const brokerSet = new Set(brokerCampaignIds);
  const keyOf = (row) => phoneComparisonKey(row.phone_normalized);
  const brokerKeys = new Set();
  const campaignKeys = new Set();
  for (const row of events) {
    if (row.event === SMS_EVENT.OPT_OUT) continue;
    if (row.campaign_id && brokerSet.has(row.campaign_id)) brokerKeys.add(keyOf(row));
    if (campaignId && row.campaign_id === campaignId) campaignKeys.add(keyOf(row));
  }
  if (mode === "campaign") return events.filter((row) => campaignKeys.has(keyOf(row)));
  return events.filter((row) => !brokerKeys.has(keyOf(row)));
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
    const entry = byPhone.get(key) || { phone: row.phone_normalized, sendId: "", contactId: row.contact_id || "", name: "", contactStatus: "", sentAt: "", secondAt: "", secondId: "", optedOut: false, invalid: false, invalidReason: "" };
    if (row.event === SMS_EVENT.FIRST && !entry.sendId) Object.assign(entry, { sendId: row.id, sentAt: row.created_at, contactId: row.contact_id || entry.contactId });
    if (row.event === SMS_EVENT.SECOND) Object.assign(entry, { secondAt: row.created_at, secondId: row.id });
    if (row.event === SMS_EVENT.OPT_OUT) entry.optedOut = true;
    if (row.event === SMS_EVENT.INVALID) Object.assign(entry, { invalid: true, invalidReason: "nonexistent" });
    if (row.event === SMS_EVENT.INACTIVE) Object.assign(entry, { invalid: true, invalidReason: "inactive" });
    entry.name = entry.name || row.name || "";
    entry.contactStatus = row.contactStatus || entry.contactStatus;
    byPhone.set(key, entry);
  }
  const awaiting = [];
  const done = [];
  for (const entry of [...byPhone.values()].filter((item) => item.sendId).sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt))) {
    const reason = entry.invalid ? "numero_invalido" : smsSecondSkipReason({ firstSent: true, secondSent: Boolean(entry.secondAt), optedOut: entry.optedOut, doNotContact: entry.contactStatus === "do_not_contact" });
    (reason ? done : awaiting).push({ ...entry, state: reason ? (entry.invalid ? "invalid" : entry.optedOut || reason === SMS_SKIP_REASON.DO_NOT_CONTACT ? "opt_out" : "complete") : "awaiting" });
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

// --- Período dos resultados (dono, 2026-11-02): Hoje, Ontem, 7 dias, 30 dias e Personalizado (dias de São Paulo) --------------

export const SMS_PERIOD_PRESETS = Object.freeze(["all", "today", "yesterday", "last7", "last30", "custom"]);
export const SMS_PERIOD_MAX_DAYS = 366;
const PERIOD_LABELS = { all: "Todo o período", today: "Hoje", yesterday: "Ontem", last7: "Últimos 7 dias", last30: "Últimos 30 dias" };

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (key) => Date.parse(`${key}T00:00:00Z`);
function addDays(key, delta) {
  return isoDay(dayMs(key) + delta * 86400000);
}
function isRealDay(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key || "")) && Number.isFinite(dayMs(key)) && isoDay(dayMs(key)) === key;
}
const brDay = (key) => key.split("-").reverse().join("/");

// Valida e resolve o período pedido pelo cliente (nunca confia nele): devolve { preset, from, to, label, includesToday } ou
// { error }. "all" (padrão, sem filtro) = sem from/to. Os atalhos são sempre calculados aqui, pela data de hoje em São Paulo;
// só "custom" usa from/to do cliente (datas reais, from <= to, no máximo 366 dias).
export function resolveSmsPeriod({ preset = "", from = "", to = "" } = {}, now = new Date()) {
  const kind = String(preset || "").trim() || "all";
  if (!SMS_PERIOD_PRESETS.includes(kind)) return { error: "Período inválido." };
  const today = spDayKey(now);
  if (kind === "all") return { preset: "all", from: "", to: "", label: PERIOD_LABELS.all, includesToday: true };
  let start = today;
  let end = today;
  if (kind === "yesterday") { start = addDays(today, -1); end = start; }
  else if (kind === "last7") start = addDays(today, -6);
  else if (kind === "last30") start = addDays(today, -29);
  else if (kind === "custom") {
    start = String(from || "").trim();
    end = String(to || "").trim();
    if (!isRealDay(start) || !isRealDay(end)) return { error: "Informe a data inicial e a final do período." };
    if (start > end) return { error: "A data inicial não pode ser depois da final." };
    if ((dayMs(end) - dayMs(start)) / 86400000 + 1 > SMS_PERIOD_MAX_DAYS) return { error: `O período pode ter no máximo ${SMS_PERIOD_MAX_DAYS} dias.` };
  }
  const label = kind === "custom" ? (start === end ? brDay(start) : `${brDay(start)} a ${brDay(end)}`) : PERIOD_LABELS[kind];
  return { preset: kind, from: start, to: end, label, includesToday: end >= today && start <= today };
}

// Linha ({ created_at }) dentro do período (dia de São Paulo). Período "all"/ausente = tudo.
export function inSmsPeriod(row, period) {
  if (!period?.from) return true;
  const key = spDayKey(row?.created_at);
  return Boolean(key) && key >= period.from && key <= period.to;
}

// sends (1ª)/sends2 (2ª)/views/signups: listas de { created_at }. Devolve total e por dia, mais recente primeiro:
// sem `period` = últimos `days` dias a partir de agora (como sempre); com `period` = só os dias do período, e o total
// conta apenas o que caiu nele.
export function buildSmsMetrics({ sends = [], sends2 = [], views = [], signups = [] } = {}, { days = 14, now = new Date(), period = null } = {}) {
  const ranged = Boolean(period?.from);
  if (ranged) {
    sends = sends.filter((row) => inSmsPeriod(row, period));
    sends2 = sends2.filter((row) => inSmsPeriod(row, period));
    views = views.filter((row) => inSmsPeriod(row, period));
    signups = signups.filter((row) => inSmsPeriod(row, period));
  }
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
  const dayKeys = [];
  if (ranged) {
    for (let key = period.to; key >= period.from && dayKeys.length < SMS_PERIOD_MAX_DAYS; key = addDays(key, -1)) dayKeys.push(key);
  } else {
    for (let offset = 0; offset < days; offset += 1) dayKeys.push(spDayKey(new Date(new Date(now).getTime() - offset * 86400000)));
  }
  const byDay = dayKeys.map((day) => {
    const sent = sentByDay.get(day) || 0;
    const clicks = viewsByDay.get(day) || 0;
    const signupCount = signupsByDay.get(day) || 0;
    return { day, sent, sent2: sent2ByDay.get(day) || 0, clicks, signups: signupCount, rate: rate(signupCount, sent) };
  });
  return { total: { sent: sends.length, sent2: sends2.length, clicks: views.length, signups: signups.length, rate: rate(signups.length, sends.length) }, byDay };
}

// Contatos do lote para salvar no iPhone (vCard 3.0): "Nome (SMS lote)" + celular em +55. Um .vcf com vários contatos abre a
// tela "Adicionar contatos" do iOS. O marcador no nome ajuda a achar e apagar depois.
// "Nome (SMS lote)" (sem nome: "Contato (SMS lote)"): o MESMO nome do vCard e do Google Contatos (PRO-18g).
export function smsContactName(name) {
  return `${String(name || "").trim() || "Contato"} (SMS lote)`;
}

export function buildSmsVcards(items = []) {
  const esc = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, " ");
  return items
    .map((item) => {
      const e164 = toBrazilianE164(item.phone);
      if (!e164) return "";
      const name = smsContactName(item.name);
      return ["BEGIN:VCARD", "VERSION:3.0", `FN:${esc(name)}`, `N:${esc(name)};;;;`, `TEL;TYPE=CELL:${e164}`, "END:VCARD"].join("\r\n");
    })
    .filter(Boolean)
    .join("\r\n") + "\r\n";
}
