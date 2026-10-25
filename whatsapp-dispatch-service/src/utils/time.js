// Datas/horários no fuso da instância (Intl, sem dependência externa).
const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23"
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAY[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};

// A janela {days, start, end} está aberta agora no fuso informado? end é exclusivo.
export function isWithinWindow(window, timeZone, now = new Date()) {
  if (!window || !Array.isArray(window.days) || !window.start || !window.end) return false;
  const p = zonedParts(now, timeZone);
  if (!window.days.includes(p.weekday)) return false;
  return p.minutes >= toMinutes(window.start) && p.minutes < toMinutes(window.end);
}

export function localDate(timeZone, now = new Date()) {
  return zonedParts(now, timeZone).date;
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Backoff exponencial com jitter de ±20%.
export function backoffDelay(attempt, baseMs, maxMs, random = Math.random) {
  const raw = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.8 + random() * 0.4));
}
