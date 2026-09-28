// Datas civis de São Paulo; o minuto 00:00 de segunda ainda mostra o
// resultado consolidado na semana anterior. Às 00:01 muda para a semana recém encerrada.
export function previousRankingWeek(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const day = new Date(`${values.year}-${values.month}-${values.day}T12:00:00Z`);
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - mondayOffset - 7);
  if (mondayOffset === 0 && values.hour === "00" && values.minute === "00") day.setUTCDate(day.getUTCDate() - 7);
  const startDate = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 6);
  return { startDate, endDate: day.toISOString().slice(0, 10) };
}
