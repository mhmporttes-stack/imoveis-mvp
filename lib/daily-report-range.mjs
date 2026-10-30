// Janela de datas do Relatório diário (prazo: hoje, ontem, 7/30 dias, personalizado).
// Regra pura e testada (tests/daily-report-range.test.mjs): dias em America/Sao_Paulo,
// início 00:00 inclusivo e fim exclusivo (00:00 do dia seguinte), convertidos para UTC.
export const TIME_ZONE = "America/Sao_Paulo";

export const REPORT_PERIODS = {
  TODAY: "today",
  YESTERDAY: "yesterday",
  LAST_7_DAYS: "last7",
  LAST_30_DAYS: "last30",
  CUSTOM: "custom"
};

export function resolveReportRange(params = {}, now = new Date()) {
  const today = getTodayInSaoPaulo(now);
  const period = Object.values(REPORT_PERIODS).includes(params.period) ? params.period : REPORT_PERIODS.TODAY;
  let startDate = today;
  let endDate = today;

  if (period === REPORT_PERIODS.YESTERDAY) {
    startDate = addDaysToPlainDate(today, -1);
    endDate = startDate;
  } else if (period === REPORT_PERIODS.LAST_7_DAYS) {
    startDate = addDaysToPlainDate(today, -6);
  } else if (period === REPORT_PERIODS.LAST_30_DAYS) {
    startDate = addDaysToPlainDate(today, -29);
  } else if (period === REPORT_PERIODS.CUSTOM) {
    startDate = normalizePlainDate(params.startDate) || today;
    endDate = normalizePlainDate(params.endDate) || startDate;
    if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  }

  const endExclusiveDate = addDaysToPlainDate(endDate, 1);
  return {
    period,
    startDate,
    endDate,
    startIso: zonedPlainDateToUtcIso(startDate),
    endIso: zonedPlainDateToUtcIso(endExclusiveDate),
    title: buildRangeTitle(period, startDate, endDate),
    primaryLabel: buildPrimaryLabel(period, startDate, endDate)
  };
}

function buildRangeTitle(period, startDate, endDate) {
  if (period === REPORT_PERIODS.TODAY) return "Relatório de hoje";
  if (period === REPORT_PERIODS.YESTERDAY) return `Relatório de ${formatPlainDateBR(startDate)}`;
  if (startDate === endDate) return `Relatório de ${formatPlainDateBR(startDate)}`;
  return `Relatório de ${formatPlainDateBR(startDate)} a ${formatPlainDateBR(endDate)}`;
}

function buildPrimaryLabel(period, startDate, endDate) {
  if (period === REPORT_PERIODS.TODAY) return "Hoje";
  if (period === REPORT_PERIODS.YESTERDAY) return "Ontem";
  if (startDate === endDate) return formatPlainDateBR(startDate);
  return `${formatPlainDateBR(startDate)} - ${formatPlainDateBR(endDate)}`;
}

export function getTodayInSaoPaulo(now = new Date()) {
  return partsToPlainDate(getDatePartsInTimeZone(now, TIME_ZONE));
}

function getDatePartsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

function partsToPlainDate(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function normalizePlainDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function addDaysToPlainDate(plainDate, amount) {
  const [year, month, day] = plainDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function zonedPlainDateToUtcIso(plainDate) {
  const [year, month, day] = plainDate.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offset = getTimeZoneOffsetMs(utcGuess, TIME_ZONE);
  const firstPass = new Date(utcGuess.getTime() - offset);
  const secondOffset = getTimeZoneOffsetMs(firstPass, TIME_ZONE);
  const result = secondOffset === offset
    ? firstPass
    : new Date(utcGuess.getTime() - secondOffset);

  return result.toISOString();
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = values.hour === "24" ? "00" : values.hour;
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUtc - date.getTime();
}

export function formatPlainDateBR(plainDate) {
  const [year, month, day] = plainDate.split("-");
  return `${day}/${month}/${year}`;
}
