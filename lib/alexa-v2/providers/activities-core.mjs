import { brParts } from "./agenda-core.mjs";
import { PAGE_SIZE, firstNameOf, plural, spokenTime } from "../text.mjs";

// Núcleo PURO da "minha agenda" por voz: atividades PENDENTES de qualquer tipo
// (as mesmas duas fontes da Agenda do CRM: calendar_activities e o campo legado
// de simulation_registrations). Recebe linhas já lidas e monta as frases.
//   rows: [{ at: ISO, type, title, clientName, clientId }]

const normalize = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// tipo -> como falar e qual preposição liga ao cliente.
const TYPES = [
  { test: /^reuni/, label: "reunião", link: "com" },
  { test: /^visit/, label: "visita", link: "com" },
  { test: /^lig/, label: "ligação", link: "para" },
  { test: /^follow|^retorn/, label: "retorno", link: "para" },
  { test: /^document/, label: "documentação", link: "de" }
];

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function typeInfo(type) {
  const key = normalize(type);
  return TYPES.find((entry) => entry.test.test(key)) || null;
}

// Título digitado pelo usuário só entra quando agrega (não repete o tipo nem o nome do cliente).
function customTitle(title, clientName, info) {
  const text = String(title || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!text) return "";
  const key = normalize(text);
  // Título que só repete o tipo ("Ligar", "Follow-up", "Reunião com João") não agrega.
  if (info && (key.includes(normalize(info.label)) || typeInfo(text) === info)) return "";
  const client = normalize(clientName);
  if (client && (key === client || key.includes(client))) return "";
  if (/^atividade do cliente$/.test(key)) return "";
  return text;
}

export function activityLabel({ type, title, clientName }) {
  const info = typeInfo(type);
  const custom = customTitle(title, clientName, info);
  const client = firstNameOf(clientName);
  if (custom) return client ? `${custom}, cliente ${client}` : custom;
  if (!info) return client ? `atividade com ${client}` : "atividade";
  return client ? `${info.label} ${info.link} ${client}` : info.label;
}

export function buildActivityItems(rows, { today }) {
  const seen = new Set();
  const items = [];
  for (const row of rows) {
    const key = `${row.clientId || normalize(row.clientName) || "?"}|${String(row.at).slice(0, 16)}|${normalize(row.type)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = brParts(row.at);
    const dayOffset = Math.round((Date.parse(`${parts.dateKey}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    const weekday = WEEKDAYS[new Date(Date.parse(`${parts.dateKey}T00:00:00Z`)).getUTCDay()];
    items.push({
      at: row.at,
      hours: parts.hours,
      minutes: parts.minutes,
      dayOffset,
      weekday,
      label: activityLabel(row)
    });
  }
  return items.sort((a, b) => new Date(a.at) - new Date(b.at));
}

const lowerFirst = (text) => (text ? text[0].toLocaleLowerCase("pt-BR") + text.slice(1) : "");
const upperFirst = (text) => (text ? text[0].toLocaleUpperCase("pt-BR") + text.slice(1) : "");

function atTime(item) {
  return `${item.hours === 1 ? "À" : "Às"} ${spokenTime(item.hours, item.minutes)}`;
}

function dayWord(item) {
  if (item.dayOffset <= 0) return "hoje";
  if (item.dayOffset === 1) return "amanhã";
  return `na ${item.weekday}`;
}

// "Às 9 horas, reunião com João." (em períodos longos: "Amanhã, às 9 horas, ...")
export function activityPhrase(item, { withDay = false } = {}) {
  const base = `${atTime(item)}, ${item.label}.`;
  return withDay ? `${upperFirst(dayWord(item))}, ${lowerFirst(base)}` : base;
}

export function emptySentence(periodoSpoken) {
  return `Você não tem nenhuma atividade agendada para ${periodoSpoken}.`;
}

// Resposta paginada (5 por vez): cabeçalho só na primeira página; "E ..." antes do último item.
export function activitiesSentence(items, { page = 0, periodoSpoken, withDay = false } = {}) {
  if (!items.length) return { text: emptySentence(periodoSpoken), names: [] };
  const start = page * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);
  const remaining = Math.max(0, items.length - (start + slice.length));
  const phrases = slice.map((item) => activityPhrase(item, { withDay }));
  if (remaining === 0 && phrases.length > 1) {
    const last = phrases.length - 1;
    phrases[last] = `E ${lowerFirst(phrases[last])}`;
  }
  const header = page === 0 ? `${upperFirst(periodoSpoken)} você tem ${plural(items.length, "atividade", "atividades")}. ` : "";
  const more = remaining > 0 ? ` E há mais ${remaining}.` : "";
  return { text: `${header}${phrases.join(" ")}${more}`, names: items.map((item) => activityPhrase(item, { withDay })) };
}

export function firstActivitySentence(items, { periodoSpoken, withDay = false }) {
  if (!items.length) return emptySentence(periodoSpoken);
  return `A primeira é ${lowerFirst(activityPhrase(items[0], { withDay }))}`;
}

export function lastActivitySentence(items, { periodoSpoken, withDay = false }) {
  if (!items.length) return emptySentence(periodoSpoken);
  return `A última é ${lowerFirst(activityPhrase(items[items.length - 1], { withDay }))}`;
}

// "E depois?" logo após a primeira: as seguintes (a partir da segunda).
export function restActivitiesSentence(items, { page = 0, periodoSpoken, withDay = false }) {
  const rest = items.slice(1);
  if (!rest.length) return { text: "Essa é a única atividade.", names: [] };
  const start = page * PAGE_SIZE;
  const slice = rest.slice(start, start + PAGE_SIZE);
  const remaining = Math.max(0, rest.length - (start + slice.length));
  const phrases = slice.map((item) => activityPhrase(item, { withDay }));
  if (remaining === 0 && phrases.length > 1) phrases[phrases.length - 1] = `E ${lowerFirst(phrases[phrases.length - 1])}`;
  return { text: `${phrases.join(" ")}${remaining > 0 ? ` E há mais ${remaining}.` : ""}`, names: rest.map((item) => activityPhrase(item, { withDay })) };
}
