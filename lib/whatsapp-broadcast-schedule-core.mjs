// Núcleo PURO das Rotinas de disparo (sem banco): horário de Brasília, "venceu agora?" e o freio por falhas.
// Testes: tests/whatsapp-broadcast-schedule-core.test.mjs.

export const DEFAULT_MIN_DAYS_SINCE_CONTACT = 60;
// Depois do horário marcado a rotina ainda pode rodar por até 6h (se o cron atrasou); depois disso pula o dia.
export const RUN_GRACE_MINUTES = 6 * 60;
export const BRAKE_MIN_MESSAGES = 10;

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Data (AAAA-MM-DD), dia da semana (0 = domingo) e minutos desde 00:00 no horário de Brasília.
export function brtNowParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

export function normalizeRunTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "08:00";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "08:00";
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export function normalizeDaysOfWeek(value) {
  const days = [...new Set((Array.isArray(value) ? value : []).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  return days.length ? days : [0, 1, 2, 3, 4, 5, 6];
}

function runTimeToMinutes(runTime) {
  const [hour, minute] = normalizeRunTime(runTime).split(":").map(Number);
  return hour * 60 + minute;
}

// A rotina deve rodar agora? Hoje é um dia marcado, ainda não rodou hoje e o horário chegou (sem passar da tolerância).
export function isScheduleDueNow({ runTime, daysOfWeek, lastRunDate, dateKey, weekday, minutes }) {
  if (!normalizeDaysOfWeek(daysOfWeek).includes(weekday)) return false;
  if (lastRunDate && String(lastRunDate).slice(0, 10) >= dateKey) return false;
  const target = runTimeToMinutes(runTime);
  return minutes >= target && minutes < target + RUN_GRACE_MINUTES;
}

// Freio: com o lote anterior já terminado, se a fração de falhas passar do limite, a rotina pausa sozinha.
export function evaluateFailureBrake({ status, sent = 0, failed = 0, maxFailureRate = 0.3 } = {}) {
  if (!["completed", "failed"].includes(String(status || ""))) return { pause: false };
  const total = Number(sent || 0) + Number(failed || 0);
  if (total < BRAKE_MIN_MESSAGES) return { pause: false };
  const rate = Number(failed || 0) / total;
  if (rate >= maxFailureRate) {
    return { pause: true, rate, reason: `O lote anterior teve ${Math.round(rate * 100)}% de falhas (${failed} de ${total}). Confira o número/qualidade na Meta antes de religar.` };
  }
  return { pause: false, rate };
}
