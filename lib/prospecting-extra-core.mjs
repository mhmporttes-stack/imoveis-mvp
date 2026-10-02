// Prospecção extra pelo botão "Disparar" (pedido do dono, 2026-10-02) —
// regras PURAS, testadas em tests/prospecting-extra-core.test.mjs. Banco e
// envio ficam em lib/prospecting-extra-dispatch.js e lib/daily-goal-auto.js.
//
// Não existe "lote": cada clique adiciona UM cliente à fila contínua do
// corretor. Até 10 clientes por ciclo; com os 10 processados, 1 h de pausa.

export const EXTRA_DISPATCH_LIMIT = 10;
export const EXTRA_DISPATCH_COOLDOWN_MINUTES = 60;

// A fila extra pode rodar fora da janela da Meta Diária, mas nunca de
// madrugada/à noite: 07:00–21:00 (São Paulo), e só em dia útil quando a
// automação do corretor está configurada para dias úteis.
export const EXTRA_DISPATCH_START_MINUTES = 7 * 60;
export const EXTRA_DISPATCH_END_MINUTES = 21 * 60;

export const EXTRA_LOCK_REASON = {
  META: "meta_incompleta",
  LIMIT: "limite_em_processamento",
  COOLDOWN: "cooldown",
  AUTOMATION: "automacao_inativa",
  WHATSAPP: "whatsapp_desconectado"
};

export const EXTRA_LOCK_MESSAGE = {
  [EXTRA_LOCK_REASON.META]: "Conclua 100% da Meta Diária para liberar novos disparos.",
  [EXTRA_LOCK_REASON.LIMIT]: "Limite de disparos em processamento.",
  [EXTRA_LOCK_REASON.AUTOMATION]: "Disparos automáticos pausados para o seu número.",
  [EXTRA_LOCK_REASON.WHATSAPP]: "Conecte seu WhatsApp ao CRM para disparar."
};

export function cooldownMinutesLeft(cooldownUntil, now = new Date()) {
  const untilMs = new Date(cooldownUntil || "").getTime();
  if (Number.isNaN(untilMs)) return 0;
  return Math.max(0, Math.ceil((untilMs - new Date(now).getTime()) / 60000));
}

export function cooldownMessage(minutes) {
  return `Novos disparos disponíveis em ${Math.max(1, minutes)} min.`;
}

// Estado do botão/cadeado. A ordem segue o pedido: Meta abaixo de 100% vem
// primeiro; depois a pausa de 1 h e o limite dos 10; por fim as condições
// técnicas do número (automação ativa e WhatsApp conectado).
export function extraDispatchAvailability({
  metaUnlocked = false,
  automationActive = false,
  sessionConnected = false,
  cycleCount = 0,
  openCount = 0,
  cooldownUntil = null,
  now = new Date(),
  limit = EXTRA_DISPATCH_LIMIT
} = {}) {
  const count = Math.max(0, Number(cycleCount) || 0);
  const base = { count, limit, open: Math.max(0, Number(openCount) || 0) };
  const lock = (reason, extra = {}) => ({ ...base, available: false, reason, message: EXTRA_LOCK_MESSAGE[reason] || "", ...extra });
  if (!metaUnlocked) return lock(EXTRA_LOCK_REASON.META);
  const minutes = cooldownUntil ? cooldownMinutesLeft(cooldownUntil, now) : 0;
  if (minutes > 0) return lock(EXTRA_LOCK_REASON.COOLDOWN, { minutesLeft: minutes, message: cooldownMessage(minutes) });
  if (count >= limit) return lock(EXTRA_LOCK_REASON.LIMIT);
  if (!automationActive) return lock(EXTRA_LOCK_REASON.AUTOMATION);
  if (!sessionConnected) return lock(EXTRA_LOCK_REASON.WHATSAPP);
  return { ...base, available: true, reason: null, message: "" };
}

// Erro do banco (enqueue_extra_prospecting_dispatch) -> mensagem curta.
export function extraDispatchErrorMessage(rawMessage) {
  const message = String(rawMessage || "");
  const cooldown = message.match(/EXTRA_COOLDOWN:(\d+)/);
  if (cooldown) return cooldownMessage(Number(cooldown[1]));
  if (message.includes("EXTRA_LIMIT_REACHED")) return EXTRA_LOCK_MESSAGE[EXTRA_LOCK_REASON.LIMIT];
  if (message.includes("CONTACT_UNAVAILABLE")) return "Este contato já foi assumido, está bloqueado ou já está em prospecção.";
  if (message.includes("EXTRA_MESSAGE_EMPTY")) return "Modelo da 1ª mensagem vazio — confira os modelos em Gestão › Meta Diária › Automação.";
  return "";
}

// Intervalo exigido antes de um item da fila extra, sempre dentro de
// [minGap, maxGap] da cadência do corretor, variando por item (sem padrão
// fixo) mas estável entre ciclos do cron (o mesmo item sempre pede o mesmo).
export function extraGapMinutes(seed, minGapMinutes, maxGapMinutes) {
  const min = Math.max(1, Number(minGapMinutes) || 1);
  const max = Math.max(min, Number(maxGapMinutes) || min);
  let hash = 0;
  for (const char of String(seed || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return min + (hash % (max - min + 1));
}

// Minutos que ainda faltam para o número poder enviar de novo (0 = pode).
// Considera o ÚLTIMO envio do número, viesse da Meta Diária ou da fila extra.
export function minutesUntilNextSendAllowed({ lastSendAt, now = new Date(), gapMinutes }) {
  const lastMs = new Date(lastSendAt || "").getTime();
  if (Number.isNaN(lastMs)) return 0;
  const waitMs = lastMs + Number(gapMinutes || 0) * 60000 - new Date(now).getTime();
  return waitMs > 0 ? Math.ceil(waitMs / 60000) : 0;
}

function saoPauloClock(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short"
  }).formatToParts(new Date(now)).map((part) => [part.type, part.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: weekdayMap[parts.weekday] ?? 1 };
}

// Trava final do envio de um item da fila extra (relida no momento do envio).
export function extraSendBlockReason({ now = new Date(), settings }) {
  if (!settings || !settings.enabled) return "automacao_desligada";
  if (settings.paused) return "automacao_pausada";
  const clock = saoPauloClock(now);
  if (clock.minutes < EXTRA_DISPATCH_START_MINUTES || clock.minutes > EXTRA_DISPATCH_END_MINUTES) return "fora_do_horario_extra";
  if (settings.business_days_only && (clock.weekday < 1 || clock.weekday > 5)) return "fim_de_semana";
  return null;
}

// "claimed" gravado pela reserva automática (Meta Diária) ou pelo Disparar
// é RESERVA do contato, não ação: a atividade só conta quando a mensagem
// sai de verdade (daily_goal_attempts). Evita contar 2 vezes o mesmo cliente
// na Meta, no fechamento do dia e no Ranking.
export const RESERVATION_CLAIM_SOURCES = new Set(["daily_goal", "extra_dispatch"]);

export function isReservationClaim(details) {
  return RESERVATION_CLAIM_SOURCES.has(details?.source);
}
