import { addDays, isDatePeriod, mondayOf } from "../periods.mjs";
import { firstNameOf } from "../text.mjs";

// Núcleo PURO da agenda do escritório (reuniões). Recebe as linhas já lidas
// (calendar_activities + campo legado de simulation_registrations) e monta
// os itens falados. "Reunião" = activity_type que começa com "reuni" (a tela
// usa o tipo "reuniao"); só atividades pendentes.

const WEEKDAY_NAMES = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

const brFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

export function brParts(isoOrDate) {
  const parts = Object.fromEntries(brFormat.formatToParts(new Date(isoOrDate)).map((part) => [part.type, part.value]));
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, hours: Number(parts.hour), minutes: Number(parts.minute) };
}

function weekdayOfKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function dayDiff(fromKey, toKey) {
  const a = Date.parse(`${fromKey}T00:00:00Z`);
  const b = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

// Faixa [início, fim] (datas de São Paulo) de cada período da agenda.
// "esta semana" na agenda olha para a FRENTE: hoje até domingo.
export function agendaRange(periodId, today) {
  if (isDatePeriod(periodId)) return { startDate: periodId.slice(2), endDate: periodId.slice(2) };
  if (periodId === "amanha") {
    const tomorrow = addDays(today, 1);
    return { startDate: tomorrow, endDate: tomorrow };
  }
  if (periodId === "depois_amanha") {
    const day = addDays(today, 2);
    return { startDate: day, endDate: day };
  }
  if (periodId === "esta_semana") return { startDate: today, endDate: addDays(mondayOf(today), 6) };
  return { startDate: today, endDate: today };
}

// rows: [{ at: ISO, clientId, clientName, brokerId, source }]
export function buildMeetingItems(rows, { today, brokerNames = new Map() }) {
  const seen = new Set();
  const items = [];
  for (const row of rows) {
    const key = `${row.clientId || row.clientName || "?"}|${String(row.at).slice(0, 16)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = brParts(row.at);
    items.push({
      at: row.at,
      hours: parts.hours,
      minutes: parts.minutes,
      dayOffset: Math.max(0, dayDiff(today, parts.dateKey)),
      weekdayName: WEEKDAY_NAMES[weekdayOfKey(parts.dateKey)],
      client: firstNameOf(row.clientName) || "",
      brokerId: row.brokerId || "",
      broker: firstNameOf(brokerNames.get(row.brokerId)) || ""
    });
  }
  return items.sort((a, b) => new Date(a.at) - new Date(b.at));
}

export function nextMeeting(items, now = new Date()) {
  const upcoming = items.find((item) => new Date(item.at) >= now);
  if (!upcoming) return null;
  return { when: { dayOffset: upcoming.dayOffset, hours: upcoming.hours, minutes: upcoming.minutes, weekdayName: upcoming.weekdayName }, client: upcoming.client, broker: upcoming.broker };
}
