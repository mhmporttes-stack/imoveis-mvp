// Puro, sem banco — monta os intervalos (dia/semana/mês) do gráfico de
// tendência do Ranking da equipe (Desempenho), terminando hoje. Cada bucket
// vira uma chamada a getPerformanceOverview({period:"custom", startDate,
// endDate}) em lib/performance-overview.js — mesmo motor de pontuação de
// sempre (recalculado a cada leitura, nunca armazenado), nunca um cálculo
// paralelo que pudesse divergir do resto do painel.
//
// Datas em "AAAA-MM-DD" (plain date, sem fuso) — a resolução pra
// America/Sao_Paulo já acontece dentro de getPerformanceOverview
// (zonedPlainDateToUtcIso), igual ao resto do painel. Sem import de
// lib/daily-report.js de propósito: aquele arquivo puxa admin-access/
// admin-profiles/crm (cadeia pesada, server-only) — este módulo precisa
// continuar 100% puro pra rodar em teste isolado (node --test).

export const TREND_GRANULARITIES = ["day", "week", "month"];
export const TREND_BUCKET_COUNT = { day: 14, week: 8, month: 6 };
const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function normalizeTrendGranularity(value) {
  return TREND_GRANULARITIES.includes(value) ? value : "month";
}

function addDaysPlain(plainDate, amount) {
  const [year, month, day] = plainDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addMonthsPlain(plainDate, amount) {
  const [year, month] = plainDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function lastDayOfMonthPlain(plainDate) {
  const [year, month] = plainDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0)); // dia 0 do mês seguinte = último dia deste mês
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

// Segunda-feira da semana que contém plainDate (convenção BR de semana).
function startOfWeekPlain(plainDate) {
  const [year, month, day] = plainDate.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=domingo..6=sábado
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return addDaysPlain(plainDate, diffToMonday);
}

function dayLabel(plainDate) {
  const [, month, day] = plainDate.split("-");
  return `${day}/${month}`;
}

function monthLabel(plainDate) {
  const [year, month] = plainDate.split("-");
  return `${MONTH_LABELS[Number(month) - 1]}/${year.slice(2)}`;
}

// count é opcional — cada granularidade tem um padrão razoável pra caber num
// gráfico (TREND_BUCKET_COUNT), sempre limitado entre 1 e 60 buckets.
export function buildTrendBuckets(granularity, today, count) {
  const safeGranularity = normalizeTrendGranularity(granularity);
  const total = Math.max(1, Math.min(Number(count) || TREND_BUCKET_COUNT[safeGranularity], 60));

  if (safeGranularity === "day") {
    return Array.from({ length: total }, (_, index) => {
      const day = addDaysPlain(today, -(total - 1 - index));
      return { startDate: day, endDate: day, label: dayLabel(day) };
    });
  }

  if (safeGranularity === "week") {
    const currentWeekStart = startOfWeekPlain(today);
    return Array.from({ length: total }, (_, index) => {
      const start = addDaysPlain(currentWeekStart, -7 * (total - 1 - index));
      const end = addDaysPlain(start, 6);
      return { startDate: start, endDate: end, label: dayLabel(start) };
    });
  }

  const currentMonthStart = `${today.slice(0, 7)}-01`;
  return Array.from({ length: total }, (_, index) => {
    const start = addMonthsPlain(currentMonthStart, -(total - 1 - index));
    const end = lastDayOfMonthPlain(start);
    return { startDate: start, endDate: end, label: monthLabel(start) };
  });
}
