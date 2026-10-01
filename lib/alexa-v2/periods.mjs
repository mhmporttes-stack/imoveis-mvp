// Períodos falados da Alexa V2. Tudo em datas civis de São Paulo (AAAA-MM-DD),
// sem depender do fuso da máquina. Alinhado ao CRM: "este mês" = dia 1 até
// hoje (igual ao período "month" do Desempenho); "esta semana" = segunda até
// hoje; "semana passada" = segunda a domingo anteriores (a mesma semana
// fechada pelo campeão da semana).

export const PERIOD_IDS = ["hoje", "ontem", "amanha", "depois_amanha", "esta_semana", "semana_passada", "este_mes", "mes_passado"];

const SPOKEN = {
  hoje: "hoje",
  ontem: "ontem",
  amanha: "amanhã",
  depois_amanha: "depois de amanhã",
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
export function isDatePeriod(id) {
  return /^d:\d{4}-\d{2}-\d{2}$/.test(String(id || ""));
}

export function resolvePeriod(id, today) {
  if (isDatePeriod(id)) {
    const dateKey = id.slice(2);
    return { id, startDate: dateKey, endDate: dateKey, spoken: dateSpoken(dateKey, today), isSingleDay: true, isPast: dateKey < today, isFuture: dateKey > today };
  }
  const period = PERIOD_IDS.includes(id) ? id : "hoje";
  let startDate = today;
  let endDate = today;
  if (period === "ontem") {
    startDate = addDays(today, -1);
    endDate = startDate;
  } else if (period === "amanha") {
    startDate = addDays(today, 1);
    endDate = startDate;
  } else if (period === "depois_amanha") {
    startDate = addDays(today, 2);
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
  if (value.includes("depois de amanha")) return "depois_amanha";
  if (value.includes("amanha")) return "amanha";
  if (value.includes("hoje") || value.includes("agora")) return "hoje";
  return "";
}

// --- Datas específicas e dias da semana (agenda) ------------------------------------
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAY_NAMES = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const WEEKDAY_KEYS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

const plain = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

function validDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}
const key = (year, month, day) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

// Próxima data >= hoje com este dia/mês (29/02 espera o próximo ano bissexto).
function nextMonthDay(month, day, today) {
  const [year] = today.split("-").map(Number);
  for (let y = year; y <= year + 8; y += 1) {
    if (validDate(y, month, day) && key(y, month, day) >= today) return key(y, month, day);
  }
  return null;
}

// Próximo dia do mês (>= hoje) com este número (pula meses que não têm o dia).
function nextDayOfMonth(day, today) {
  let [year, month] = today.split("-").map(Number);
  for (let i = 0; i < 14; i += 1) {
    if (validDate(year, month, day) && key(year, month, day) >= today) return key(year, month, day);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return null;
}

// Próxima ocorrência do dia da semana (0=domingo..6=sábado), contando hoje.
export function nextWeekday(weekday, today) {
  const diff = (weekday - weekdayOf(today) + 7) % 7;
  return addDays(today, diff);
}

// Valor do slot AMAZON.DATE (ou texto falado) -> data civil AAAA-MM-DD, ou null.
//   "2026-10-08"   -> a própria data; sem ano falado a Alexa usa o ano atual: data JÁ PASSADA
//                     deste ano vira a próxima ocorrência (ano seguinte);
//   "XXXX-10-08"   -> próxima ocorrência; "XXXX-XX-15" -> próximo dia 15;
//   "2026-W41-5"   -> sexta-feira da semana (ISO) / "sexta" por extenso -> próxima sexta.
export function parseDateSlot(value, today) {
  const text = String(value || "").trim();
  if (!text) return null;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (!validDate(year, month, day)) return null;
    const date = key(year, month, day);
    const currentYear = Number(today.slice(0, 4));
    return date < today && year === currentYear ? nextMonthDay(month, day, today) : date;
  }
  match = /^XXXX-(\d{2})-(\d{2})$/i.exec(text);
  if (match) return nextMonthDay(Number(match[1]), Number(match[2]), today);
  match = /^XXXX-XX-(\d{2})$/i.exec(text);
  if (match) return nextDayOfMonth(Number(match[1]), today);
  match = /^(\d{4})-W(\d{2})-(\d)$/.exec(text);
  if (match) {
    const weekday = Number(match[3]) % 7;
    return nextWeekday(weekday, today);
  }
  if (/^\d{4}-\d{2}$/.test(text) || /^\d{4}-W\d{2}$/.test(text)) return null; // só mês ou só semana: não é um dia
  // Texto falado: "sexta", "segunda-feira", "dia 15", "8 de outubro".
  const spoken = plain(text);
  for (const [name, weekday] of Object.entries(WEEKDAY_KEYS)) {
    if (spoken.includes(name)) return nextWeekday(weekday, today);
  }
  const monthIndex = MONTHS.map(plain).findIndex((month) => spoken.includes(month));
  const dayMatch = /(\d{1,2})/.exec(spoken);
  if (dayMatch && monthIndex >= 0) return nextMonthDay(monthIndex + 1, Number(dayMatch[1]), today);
  if (dayMatch) return nextDayOfMonth(Number(dayMatch[1]), today);
  return null;
}

// "na sexta-feira, dia 9 de outubro" (para frases: "Na sexta-feira, dia 9 de outubro, você tem...").
export function dateSpoken(dateKey, today = "") {
  const [, month, day] = dateKey.split("-").map(Number);
  const weekday = weekdayOf(dateKey);
  const article = weekday === 0 || weekday === 6 ? "no" : "na";
  const base = `${article} ${WEEKDAY_NAMES[weekday]}, dia ${day} de ${MONTHS[month - 1]}`;
  const sameYear = !today || dateKey.slice(0, 4) === today.slice(0, 4);
  return sameYear ? base : `${base} de ${dateKey.slice(0, 4)}`;
}
