// Lógica pura de ciclo da Mensagem do Dia — sem "server-only"/Supabase, para
// poder ser testada diretamente (mesmo padrão de lib/journey-presentation.js).
const TIME_ZONE = "America/Sao_Paulo";

function getDatePartsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

export function getTodayInSaoPaulo(now = new Date()) {
  const { year, month, day } = getDatePartsInTimeZone(now, TIME_ZONE);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDaysToPlainDate(plainDate, amount) {
  const [year, month, day] = plainDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getTimeZoneOffsetMs(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = values.hour === "24" ? "00" : values.hour;
  const asUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(hour), Number(values.minute), Number(values.second));
  return asUtc - date.getTime();
}

// Mesmo algoritmo de duas passagens (seguro para virada de horário de
// verão) já usado em lib/daily-report.js (zonedPlainDateToUtcIso),
// generalizado para um horário HH:mm arbitrário em vez de sempre meia-noite.
function zonedDateTimeToUtc(plainDate, hh, mm) {
  const [year, month, day] = plainDate.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hh, mm, 0, 0));
  const offset = getTimeZoneOffsetMs(utcGuess);
  const firstPass = new Date(utcGuess.getTime() - offset);
  const secondOffset = getTimeZoneOffsetMs(firstPass);
  return secondOffset === offset ? firstPass : new Date(utcGuess.getTime() - secondOffset);
}

// Ciclo às 08:00 = de 08:00:00 até 07:59:59 do dia seguinte. O cycle_id é a
// data (America/Sao_Paulo) em que o ciclo COMEÇOU — nunca "YYYY-MM-DD à
// meia-noite" puro.
export function computeCycleId(startTime, now = new Date()) {
  const [hh, mm] = (startTime || "08:00").split(":").map(Number);
  const today = getTodayInSaoPaulo(now);
  const todayBoundary = zonedDateTimeToUtc(today, hh, mm);
  return now.getTime() >= todayBoundary.getTime() ? today : addDaysToPlainDate(today, -1);
}

export function nextCycleLabel(startTime, now = new Date()) {
  const [hh, mm] = (startTime || "08:00").split(":").map(Number);
  const today = getTodayInSaoPaulo(now);
  const todayBoundary = zonedDateTimeToUtc(today, hh, mm);
  const isToday = now.getTime() < todayBoundary.getTime();
  const label = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return isToday ? `hoje às ${label}` : `amanhã às ${label}`;
}
