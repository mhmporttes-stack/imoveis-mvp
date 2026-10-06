// Segurança de envio do WhatsApp individual (reduzir risco de banimento do chip do corretor). Regras PURAS (sem banco),
// testadas em tests/whatsapp-sending-safety.test.mjs. Ligação com o banco: lib/whatsapp-sending-safety.js.
//
// [REGRA OFICIAL DE NEGÓCIO — decidida pelo dono em 2026-10-06] FREIO AUTOMÁTICO: os envios automáticos de um corretor
// PARAM SOZINHOS quando (a) 3+ falhas de envio seguidas, (b) taxa de resposta < 3% numa janela de 50 envios entregues
// (só avalia com a amostra completa), (c) a sessão do WhatsApp exige intervenção (last_error 'needs_attention:').
// A pausa persiste até um admin/gestor liberar; o motivo fica registrado e a gestora é avisada pela Central de Alertas.
//
// [PENDENTE DE VALIDAÇÃO — valores SUGERIDOS em 2026-10-06, o dono ainda pode ajustar] 12 contatos NOVOS por dia e a escada
// de aquecimento (dias 1-7 → 5/dia; 8-14 → 10; 15-21 → 20; 22+ → 30). Mude só as constantes abaixo.

// ---- Contatos novos por dia ---------------------------------------------------------------------------------------
// Contato NOVO = número que nunca teve conversa/mensagem com o chip DAQUELE corretor. O resto do teto diário (30) só
// vai para quem já conversou. O excedente NUNCA é descartado nem enviado: fica para o dia seguinte.
export const NEW_CONTACT_DAILY_CAP = 12;
export const NEW_CONTACT_BLOCK_REASON = "limite_contatos_novos_dia";

// ---- Aquecimento do chip -------------------------------------------------------------------------------------------
// Contado a partir de daily_goal_auto_settings.warmup_start_date (dia 1 = a própria data). Sem data = sem aquecimento
// (teto cheio). O reinício NUNCA é automático: só o dono muda a data. daily_cap_override continua valendo, mas nunca
// acima do teto do estágio (vale o MENOR).
export const WARMUP_STAGES = Object.freeze([
  Object.freeze({ fromDay: 1, toDay: 7, cap: 5 }),
  Object.freeze({ fromDay: 8, toDay: 14, cap: 10 }),
  Object.freeze({ fromDay: 15, toDay: 21, cap: 20 })
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000; // -03:00 fixo (o Brasil não tem horário de verão desde 2019)

function plainDateMs(value) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

// Dia do aquecimento (1 = dia da data de início). null = sem data válida. Data futura = dia 1 (o mais restrito).
export function warmupDayNumber(warmupStartDate, nowMs = Date.now()) {
  const start = plainDateMs(warmupStartDate);
  if (start === null) return null;
  const today = plainDateMs(new Date(nowMs - SAO_PAULO_OFFSET_MS).toISOString());
  return Math.max(1, Math.floor((today - start) / DAY_MS) + 1);
}

// Teto do estágio do aquecimento. Sem data de início (ou aquecimento concluído) = fullCap.
export function warmupCapFor(warmupStartDate, nowMs = Date.now(), fullCap = 30) {
  const day = warmupDayNumber(warmupStartDate, nowMs);
  if (day === null) return fullCap;
  const stage = WARMUP_STAGES.find((item) => day >= item.fromDay && day <= item.toDay);
  return stage ? Math.min(fullCap, stage.cap) : fullCap;
}

// ---- Contatos novos: decisão ----------------------------------------------------------------------------------------
// firstEvidenceMs = instante da PRIMEIRA prova de contato entre este chip e o número (primeira mensagem enviada pela fila
// ou primeira conversa do chip com o número); null = nunca. Novo "hoje" = sem prova ou prova a partir do início do dia.
export function isNewContact(firstEvidenceMs, dayStartMs) {
  return !Number.isFinite(firstEvidenceMs) || firstEvidenceMs >= dayStartMs;
}

// Quantos contatos novos o chip já abordou hoje. `firstEvidenceList` = primeira prova de cada contato enviado hoje.
export function countNewContactsToday(firstEvidenceList, dayStartMs) {
  return (firstEvidenceList || []).filter((ms) => isNewContact(ms, dayStartMs)).length;
}

// Limite de contatos novos do dia: nunca acima do teto efetivo do dia (aquecimento/override).
export function newContactLimit(dailyCap) {
  const cap = Number(dailyCap);
  return Number.isFinite(cap) && cap > 0 ? Math.min(NEW_CONTACT_DAILY_CAP, cap) : NEW_CONTACT_DAILY_CAP;
}

// null = pode enviar; senão o motivo (o item é ADIADO para o dia seguinte, nunca descartado).
export function newContactBlockReason({ isNew, newUsedToday, dailyCap }) {
  if (!isNew) return null;
  return newUsedToday >= newContactLimit(dailyCap) ? NEW_CONTACT_BLOCK_REASON : null;
}

// ---- Freio automático -----------------------------------------------------------------------------------------------
export const BRAKE_MAX_CONSECUTIVE_FAILURES = 3;
export const BRAKE_REPLY_WINDOW = 50;
export const BRAKE_MIN_REPLY_RATE = 0.03;
export const BRAKE_CODE = Object.freeze({
  FAILURES: "falhas_seguidas",
  LOW_REPLY: "taxa_resposta_baixa",
  SESSION: "sessao_exige_atencao"
});
export const BRAKE_REASON_PREFIX = "Freio automático: ";
const NEEDS_ATTENTION_PREFIX = "needs_attention:";

const toMs = (value) => {
  const ms = new Date(value || "").getTime();
  return Number.isNaN(ms) ? null : ms;
};

// Linhas de daily_goal_auto_queue de um envio que SAIU (entrega no WhatsApp aceita).
export function isSuccessfulSendRow(row) {
  return Boolean(row?.wa_message_id) || row?.status === "sent";
}

// Tentativa de envio que FALHOU: começou (send_started_at) e não saiu. Não conta o que é falha interna do próprio
// sistema (recuperação de item preso, erro inesperado) nem item preso sem confirmação (incerto, nunca presumido falha).
export function isFailedSendRow(row) {
  if (!row || isSuccessfulSendRow(row)) return false;
  if (!row.send_started_at || !row.last_error) return false;
  if (row.status !== "error" && row.status !== "pending") return false;
  if (row.skip_reason === "enviando_sem_confirmacao") return false;
  return !/^(Recuperado|Erro inesperado|Redução temporária)/.test(String(row.last_error));
}

// Falhas SEGUIDAS mais recentes (a contagem para na primeira tentativa que saiu). `rows` em qualquer ordem.
// `sinceMs` = só conta tentativas depois da última liberação do freio.
export function countConsecutiveFailures(rows, { sinceMs = null } = {}) {
  const attempts = (rows || [])
    .map((row) => ({ row, at: toMs(row.send_started_at) }))
    .filter((item) => item.at !== null && (sinceMs === null || item.at > sinceMs))
    .sort((a, b) => b.at - a.at);
  let count = 0;
  for (const { row } of attempts) {
    if (isSuccessfulSendRow(row)) break;
    if (isFailedSendRow(row)) count += 1;
    else break; // linha ambígua interrompe a sequência (na dúvida, não conta como falha)
  }
  return count;
}

// Taxa de resposta das últimas `windowSize` mensagens ENTREGUES. `delivered` = [{ sentMs, replied }].
// Sem a amostra completa NÃO avalia (evaluated=false). Só conta envios depois de `sinceMs` (última liberação).
export function evaluateReplyRate(delivered, { windowSize = BRAKE_REPLY_WINDOW, minRate = BRAKE_MIN_REPLY_RATE, sinceMs = null } = {}) {
  const sample = (delivered || [])
    .filter((item) => Number.isFinite(item?.sentMs) && (sinceMs === null || item.sentMs > sinceMs))
    .sort((a, b) => b.sentMs - a.sentMs)
    .slice(0, windowSize);
  if (sample.length < windowSize) return { evaluated: false, total: sample.length, replied: 0, rate: null, below: false };
  const replied = sample.filter((item) => item.replied).length;
  const rate = replied / sample.length;
  return { evaluated: true, total: sample.length, replied, rate, below: rate < minRate };
}

// Sessão que exige intervenção humana: erro com o selo do microsserviço (403/440/...). Status diferente de 'error'
// (ex.: já reconectou) não conta — o last_error antigo sobrevive a um 'connected'.
export function isSessionNeedsAttention(sessionRow) {
  return sessionRow?.status === "error" && String(sessionRow?.last_error || "").startsWith(NEEDS_ATTENTION_PREFIX);
}

// Decisão única do freio. Prioridade: sessão > falhas seguidas > taxa de resposta. null = segue normal.
export function evaluateBrake({ sessionRow = null, consecutiveFailures = 0, replyStats = null } = {}) {
  if (isSessionNeedsAttention(sessionRow)) return { code: BRAKE_CODE.SESSION, reason: brakeReasonText(BRAKE_CODE.SESSION) };
  if (consecutiveFailures >= BRAKE_MAX_CONSECUTIVE_FAILURES) {
    return { code: BRAKE_CODE.FAILURES, reason: brakeReasonText(BRAKE_CODE.FAILURES, { failures: consecutiveFailures }) };
  }
  if (replyStats?.evaluated && replyStats.below) {
    return { code: BRAKE_CODE.LOW_REPLY, reason: brakeReasonText(BRAKE_CODE.LOW_REPLY, replyStats), details: replyStats };
  }
  return null;
}

const percent = (rate) => `${(rate * 100).toFixed(1).replace(".", ",")}%`;

// Texto do motivo (português simples; vira paused_reason e o histórico). Sem telefone nem texto técnico cru.
export function brakeReasonText(code, details = {}) {
  if (code === BRAKE_CODE.SESSION) return `${BRAKE_REASON_PREFIX}o WhatsApp do corretor exige atenção (conexão interrompida pelo WhatsApp).`;
  if (code === BRAKE_CODE.FAILURES) return `${BRAKE_REASON_PREFIX}${details.failures || BRAKE_MAX_CONSECUTIVE_FAILURES} falhas de envio seguidas.`;
  if (code === BRAKE_CODE.LOW_REPLY) {
    return `${BRAKE_REASON_PREFIX}taxa de resposta de ${percent(details.rate ?? 0)} nos últimos ${details.total ?? BRAKE_REPLY_WINDOW} envios entregues (mínimo ${percent(BRAKE_MIN_REPLY_RATE)}).`;
  }
  return `${BRAKE_REASON_PREFIX}envios automáticos pausados por segurança.`;
}

export function isBrakePausedReason(pausedReason) {
  return String(pausedReason || "").startsWith(BRAKE_REASON_PREFIX);
}

// Estado do freio guardado em crm_settings (chave por corretor): { status, code, reason, at, releasedAt, releasedBy, history[] }.
export const BRAKE_STATE_PREFIX = "daily_goal_brake:";
export const brakeStateKey = (brokerId) => `${BRAKE_STATE_PREFIX}${brokerId}`;
const HISTORY_LIMIT = 30;

export function nextBrakeStateOnPause(prev, { code, reason, atIso }) {
  const history = [...(prev?.history || []), { event: "paused", code, reason, at: atIso }].slice(-HISTORY_LIMIT);
  return { status: "paused", code, reason, at: atIso, releasedAt: prev?.releasedAt || null, releasedBy: null, history };
}

export function nextBrakeStateOnRelease(prev, { atIso, byId = null }) {
  if (!prev || prev.status !== "paused") return null; // nada a liberar
  const history = [...(prev.history || []), { event: "released", code: prev.code, at: atIso, by: byId }].slice(-HISTORY_LIMIT);
  return { ...prev, status: "released", releasedAt: atIso, releasedBy: byId, history };
}

// Chave de dedupe do alerta: UMA por pausa (corretor + motivo + instante da pausa). Prefixo próprio (não 'wa_attn:'),
// para a reconexão não "resolver" sozinho um aviso de freio que continua valendo.
export const brakeAlertDedupeKey = (brokerId, code, atIso) => `wa_brake:${brokerId}:${code}:${atIso}`;
