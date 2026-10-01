// Períodos falados da Alexa V2. Tudo em datas civis de São Paulo (AAAA-MM-DD),
// sem depender do fuso da máquina. Alinhado ao CRM: "este mês" = dia 1 até
// hoje (igual ao período "month" do Desempenho); "esta semana" = segunda até
// hoje; "semana passada" = segunda a domingo anteriores (a mesma semana
// fechada pelo campeão da semana).

export const PERIOD_IDS = ["hoje", "ontem", "amanha", "esta_semana", "semana_passada", "este_mes", "mes_passado"];

const SPOKEN = {
  hoje: "hoje",
  ontem: "ontem",
  amanha: "amanhã",
  esta_semana: "esta semana",
  semana_passada: "na semana passada",
  este_mes: "este mês",
  mes_passado: "no mês passado"
};

function parts(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return { year, month, day };
}

function toDate(dateKey) {
  const { year, month, day } = parts(dateKey);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateKey, amount) {
  const date = toDate(dateKey);
  date.setUTCDate(date.getUTCDate() + amount);
  return fromDate(date);
}

// 0 = domingo ... 6 = sábado
export function weekdayOf(dateKey) {
  return toDate(dateKey).getUTCDay();
}

export function mondayOf(dateKey) {
  const weekday = weekdayOf(dateKey);
  return addDays(dateKey, -((weekday + 6) % 7));
}

function monthStart(dateKey) {
  return `${dateKey.slice(0, 7)}-01`;
}

function previousMonthRange(dateKey) {
  const firstOfThisMonth = monthStart(dateKey);
  const lastOfPrevious = addDays(firstOfThisMonth, -1);
  return { startDate: monthStart(lastOfPrevious), endDate: lastOfPrevious };
}

// today = data civil de hoje em São Paulo.
export function resolvePeriod(id, today) {
  const period = PERIOD_IDS.includes(id) ? id : "hoje";
  let startDate = today;
  let endDate = today;
  if (period === "ontem") {
    startDate = addDays(today, -1);
    endDate = startDate;
  } else if (period === "amanha") {
    startDate = addDays(today, 1);
    endDate = startDate;
  } else if (period === "esta_semana") {
    startDate = mondayOf(today);
  } else if (period === "semana_passada") {
    startDate = addDays(mondayOf(today), -7);
    endDate = addDays(startDate, 6);
  } else if (period === "este_mes") {
    startDate = monthStart(today);
  } else if (period === "mes_passado") {
    ({ startDate, endDate } = previousMonthRange(today));
  }
  return { id: period, startDate, endDate, spoken: SPOKEN[period], isSingleDay: startDate === endDate, isPast: endDate < today, isFuture: startDate > today };
}

// Reconhece o período a partir de um texto falado (quando o slot não resolveu).
export function periodFromText(text) {
  const value = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  if (!value) return "";
  if (value.includes("semana passada") || value.includes("semana anterior")) return "semana_passada";
  if (value.includes("mes passado") || value.includes("mes anterior")) return "mes_passado";
  if (value.includes("semana")) return "esta_semana";
  if (value.includes("mes")) return "este_mes";
  if (value.includes("ontem")) return "ontem";
  if (value.includes("amanha")) return "amanha";
  if (value.includes("hoje") || value.includes("agora")) return "hoje";
  return "";
}
