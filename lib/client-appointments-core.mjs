// "Agendar atendimento" da apresentação interativa (/s/<token>, cena "Próximo passo") — regras PURAS, sem banco e sem
// "server-only". Testado em tests/client-appointments.test.mjs. Regra: docs/BUSINESS_RULES.md PRES-22 (dono, 2026-10-08).
//
// Resumo:
//  - janela = a MESMA da previsão de documentos (hoje + 9, America/Sao_Paulo);
//  - horários de 30 min: seg-sex inícios 08:30…18:30; sábado 08:30…12:30; domingo nenhum; hoje, só a partir de agora + 1 h;
//  - ESCASSEZ: o cliente vê ~metade dos horários como "Indisponível". Manhã (< 12:00) e tarde (>= 12:00) são sorteadas
//    separadamente, em BLOCOS contíguos de 2 a 4 horários, nunca alternado; o sorteio é determinístico por
//    (segredo do servidor + gestora + data) — não muda quando o cliente recarrega. Calculado só no servidor;
//  - atendimento REAL (client_appointments 'scheduled') também deixa o horário indisponível — na agenda da GESTORA, que é
//    compartilhada pela equipe dela.
import { FORECAST_TIME_ZONE, cleanFirstName, describeForecastDate, forecastWindow, formatForecastDayMonth, isDateInForecastWindow } from "./documents-forecast-core.mjs";
import { COMPANY_ADDRESS } from "./company-info.mjs";

export const APPOINTMENT_KINDS = ["presencial", "online"];
export const APPOINTMENT_SLOT_MINUTES = 30;
export const APPOINTMENT_LEAD_MS = 60 * 60 * 1000; // hoje: só horários que começam daqui a pelo menos 1 h
export const APPOINTMENT_UTC_OFFSET = "-03:00"; // Brasil sem horário de verão desde 2019
export const APPOINTMENT_ACTIVITY_TYPE = "reuniao";
export const APPOINTMENT_ACTIVITY_TITLE = {
  presencial: "Atendimento presencial agendado pelo cliente",
  online: "Reunião online (Meet) agendada pelo cliente"
};
export const APPOINTMENT_JOURNEY_EVENT = "appointment_scheduled";
export const APPOINTMENT_REQUEST_JOURNEY_EVENT = "appointment_requested";
export const APPOINTMENT_UNAVAILABLE_LABEL = "Indisponível";
export const APPOINTMENT_REQUEST_MAX = 80;
const ICS_HOST = "matheusmachadoimoveis.com.br";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const FIRST_START = 8 * 60 + 30;
const LAST_START_WEEKDAY = 18 * 60 + 30;
const LAST_START_SATURDAY = 12 * 60 + 30;
const AFTERNOON_FROM = 12 * 60;

const pad = (value) => String(value).padStart(2, "0");
const toMinutes = (time) => {
  const match = TIME_PATTERN.exec(String(time ?? ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const toTime = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** Inícios de horário de uma data (AAAA-MM-DD): seg-sex 08:30…18:30, sábado 08:30…12:30, domingo nenhum. */
export function baseSlotsForDate(date) {
  const info = describeForecastDate(date);
  if (!info) return [];
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 0) return [];
  const last = weekday === 6 ? LAST_START_SATURDAY : LAST_START_WEEKDAY;
  const slots = [];
  for (let minutes = FIRST_START; minutes <= last; minutes += APPOINTMENT_SLOT_MINUTES) slots.push(toTime(minutes));
  return slots;
}

/** Instante (ISO UTC) do início de um horário em Brasília. */
export function slotStartsAt(date, time) {
  if (!describeForecastDate(date) || toMinutes(time) === null) return null;
  return new Date(`${date}T${time}:00${APPOINTMENT_UTC_OFFSET}`).toISOString();
}

export function slotEndsAt(startsAt) {
  return new Date(new Date(startsAt).getTime() + APPOINTMENT_SLOT_MINUTES * 60_000).toISOString();
}

/** Horário já passou (ou começa em menos de 1 h)? */
export function isSlotTooSoon(date, time, now = new Date()) {
  const startsAt = slotStartsAt(date, time);
  return !startsAt || new Date(startsAt).getTime() < now.getTime() + APPOINTMENT_LEAD_MS;
}

// ---------- sorteio determinístico ----------
// Hash de texto (xmur3) + gerador mulberry32: puros, iguais no Node e em qualquer lugar, sem crypto.
function hashSeed(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function seededRandom(text) {
  let a = hashSeed(text);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semente da agenda de UMA gestora (o segredo fica no servidor; o id da gestora nunca vai ao navegador). */
export function agendaSeed(secret, managerUserId) {
  return `${String(secret || "")}|${String(managerUserId || "")}`;
}

/**
 * Índices "indisponíveis" de um trecho (manhã ou tarde) com `n` horários: ~metade, em blocos contíguos de 2 a 4,
 * separados por pelo menos 2 horários livres (nunca livre/ocupado/livre nem ocupado/livre/ocupado).
 * Trecho com menos de 4 horários (tarde de sábado: 2): um único bloco com metade (arredondada para baixo).
 */
export function scarcityIndexes(n, random) {
  if (n <= 1) return [];
  if (n < 4) {
    const size = Math.floor(n / 2);
    const start = Math.floor(random() * (n - size + 1));
    return Array.from({ length: size }, (_, i) => start + i);
  }
  const busy = n % 2 === 0 ? n / 2 : random() < 0.5 ? Math.floor(n / 2) : Math.ceil(n / 2);
  const free = n - busy;
  const pick = () => {
    const sizes = [];
    let rest = busy;
    while (rest > 0) {
      const options = [2, 3, 4].filter((size) => size <= rest && (rest - size === 0 || rest - size >= 2));
      const size = options[Math.floor(random() * options.length)];
      sizes.push(size);
      rest -= size;
    }
    return sizes;
  };
  let sizes = pick();
  if (2 * (sizes.length - 1) > free) {
    // poucos livres para separar tantos blocos: blocos maiores (4, e o resto sem sobrar 1)
    sizes = [];
    let rest = busy;
    while (rest > 0) {
      const size = rest === 5 ? 3 : Math.min(4, rest);
      sizes.push(size);
      rest -= size;
    }
  }
  const gaps = sizes.map((_, i) => (i === 0 ? 0 : 2));
  gaps.push(0);
  for (let extra = free - 2 * (sizes.length - 1); extra > 0; extra -= 1) gaps[Math.floor(random() * gaps.length)] += 1;
  const indexes = [];
  let cursor = 0;
  sizes.forEach((size, i) => {
    cursor += gaps[i];
    for (let k = 0; k < size; k += 1) indexes.push(cursor + k);
    cursor += size;
  });
  return indexes;
}

/** Horários (HH:MM) mostrados como "Indisponível" por escassez numa data, para uma semente de gestora. */
export function scarcityBusyTimes(date, seed) {
  const slots = baseSlotsForDate(date);
  const morning = slots.filter((time) => toMinutes(time) < AFTERNOON_FROM);
  const afternoon = slots.filter((time) => toMinutes(time) >= AFTERNOON_FROM);
  const busy = new Set();
  for (const [part, list] of [["manha", morning], ["tarde", afternoon]]) {
    const random = seededRandom(`${seed}|${date}|${part}`);
    for (const index of scarcityIndexes(list.length, random)) busy.add(list[index]);
  }
  return busy;
}

/**
 * Situação de um horário para o CLIENTE: "available" | "unavailable" | "invalid" (não existe nessa data / fora da janela).
 * `busyStarts`: Set de instantes ISO (toISOString) de atendimentos REAIS da agenda da gestora.
 */
export function slotState({ date, time, now = new Date(), seed, busyStarts = new Set() }) {
  if (!isDateInForecastWindow(date, now) || !baseSlotsForDate(date).includes(time)) return "invalid";
  if (isSlotTooSoon(date, time, now)) return "unavailable";
  if (busyStarts.has(slotStartsAt(date, time))) return "unavailable";
  if (scarcityBusyTimes(date, seed).has(time)) return "unavailable";
  return "available";
}

/** Agenda dos 10 dias para o cliente: só "livre" ou não. Nenhum motivo (real x sorteio) sai daqui. */
export function buildClientAgenda({ now = new Date(), seed, busyStarts = new Set() }) {
  return forecastWindow(now).map((date) => ({
    date,
    slots: baseSlotsForDate(date).map((time) => ({ time, available: slotState({ date, time, now, seed, busyStarts }) === "available" }))
  }));
}

/** Agenda de exibição sem servidor (prévia do CRM): todos os horários futuros aparecem livres; nada é sorteado. */
export function buildPreviewAgenda(now = new Date()) {
  return forecastWindow(now).map((date) => ({
    date,
    slots: baseSlotsForDate(date).map((time) => ({ time, available: !isSlotTooSoon(date, time, now) }))
  }));
}

// ---------- quem é a "gestora" (dona da agenda) ----------

/**
 * Agenda que o atendimento ocupa: a gestora do responsável. Sobe a hierarquia a partir do responsável:
 * manager/admin ativo → é ele; associado → corretor vinculado; corretor → manager_id. Sem ninguém acima → o dono
 * (isOwnerEmail). `users`: linhas de admin_users { id, role, status, manager_id, linked_broker_id, email }.
 */
export function resolveAgendaOwnerId({ responsibleUserId, users = [], isOwnerEmail = () => false }) {
  const byId = new Map(users.map((user) => [user.id, user]));
  const isActive = (user) => user && user.status !== "inactive";
  const seen = new Set();
  let current = byId.get(responsibleUserId) || null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (isActive(current) && (current.role === "manager" || current.role === "admin" || isOwnerEmail(current.email))) return current.id;
    const nextId = current.role === "associate" ? current.linked_broker_id || current.manager_id : current.manager_id;
    current = nextId ? byId.get(nextId) || null : null;
  }
  const owner = users.find((user) => isActive(user) && isOwnerEmail(user.email));
  return owner?.id || "";
}

// ---------- corpo das rotas públicas ----------

const BOOK_KEYS = new Set(["tipo", "data", "hora"]);
const REQUEST_KEYS = new Set(["tipo", "data", "texto"]);

/** POST de reserva: { tipo, data, hora } (allowlist estrita; hora tem de existir na data). */
export function parseAppointmentBody(body, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => !BOOK_KEYS.has(key))) return null;
  if (!APPOINTMENT_KINDS.includes(body.tipo)) return null;
  if (!isDateInForecastWindow(body.data, now)) return null;
  if (typeof body.hora !== "string" || !baseSlotsForDate(body.data).includes(body.hora)) return null;
  return { tipo: body.tipo, data: body.data, hora: body.hora };
}

export function cleanRequestText(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, APPOINTMENT_REQUEST_MAX);
}

/** POST "Combinar outro horário": { tipo, data, texto } — qualquer dia da janela (inclusive domingo), texto curto. */
export function parseAppointmentRequestBody(body, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => !REQUEST_KEYS.has(key))) return null;
  if (!APPOINTMENT_KINDS.includes(body.tipo)) return null;
  if (!isDateInForecastWindow(body.data, now)) return null;
  if (typeof body.texto !== "string" || body.texto.length > 300) return null;
  const texto = cleanRequestText(body.texto);
  if (texto.length < 2) return null;
  return { tipo: body.tipo, data: body.data, texto };
}

// ---------- textos ----------

/** "sábado, 10/10" */
export function describeDay(date) {
  const info = describeForecastDate(date);
  return info ? `${info.weekday}, ${formatForecastDayMonth(date)}` : "";
}

export function isMeetLink(value) {
  return /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}(\?[\w=&-]*)?$/i.test(String(value ?? "").trim());
}

/** Normaliza o link do Meet do cadastro: "" (vazio) | link válido | null (inválido). */
export function normalizeMeetLink(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const withScheme = /^meet\.google\.com\//i.test(text) ? `https://${text}` : text;
  return isMeetLink(withScheme) ? withScheme : null;
}


/** Mensagem pronta do cliente para o corretor depois de reservar. Só o primeiro nome. */
export function buildAppointmentMessage({ fullName = "", kind, date, time, meetLink = "" } = {}) {
  const name = cleanFirstName(fullName);
  const what = kind === "presencial" ? "um atendimento presencial" : "uma reunião online";
  const tail = kind === "online" && !isMeetLink(meetLink) ? " Pode me enviar o link da reunião?" : " Pode confirmar?";
  return `Olá! ${name ? `Aqui é ${name}. ` : ""}Agendei pela minha simulação ${what} para ${describeDay(date)}, às ${time}, ${kind === "presencial" ? `na ${COMPANY_ADDRESS}` : "pelo Google Meet"}.${tail}`;
}

/** Mensagem do "Combinar outro horário" (nada é reservado). */
export function buildAppointmentRequestMessage({ fullName = "", kind, date, text } = {}) {
  const name = cleanFirstName(fullName);
  const what = kind === "presencial" ? "um atendimento presencial" : "uma reunião online (Google Meet)";
  return `Olá! ${name ? `Aqui é ${name}. ` : ""}Vi minha simulação e gostaria de agendar ${what}. Nenhum horário disponível serviu para mim: pode ser ${describeDay(date)}, ${cleanRequestText(text)}?`;
}

/** Texto da linha do tempo do cliente. */
export function appointmentJourneyText({ kind, date, time }) {
  return `${APPOINTMENT_ACTIVITY_TITLE[kind] || "Atendimento agendado pelo cliente"}: ${describeDay(date)}, às ${time}`;
}

export function appointmentRequestJourneyText({ kind, date, text }) {
  return `Cliente pediu outro horário (${kind === "presencial" ? "presencial" : "online"}): ${describeDay(date)}, ${cleanRequestText(text)}`;
}

/** Campos da atividade no card do cliente (calendar_activities). `created_by` null = criada pelo sistema. */
export function buildAppointmentActivity({ clientId, responsibleUserId, kind, startsAt, managerName = "", meetLink = "" }) {
  if (!clientId || !responsibleUserId || !APPOINTMENT_KINDS.includes(kind) || !startsAt) return null;
  const place = kind === "presencial" ? COMPANY_ADDRESS : isMeetLink(meetLink) ? meetLink : "Google Meet (enviar o link ao cliente)";
  return {
    client_id: clientId,
    responsible_user_id: responsibleUserId,
    title: APPOINTMENT_ACTIVITY_TITLE[kind],
    activity_type: APPOINTMENT_ACTIVITY_TYPE,
    scheduled_at: startsAt,
    note: `Agendado pelo cliente na apresentação. Local: ${place}.${managerName ? ` Agenda de ${managerName}.` : ""}`.slice(0, 500),
    priority: "important",
    status: "pending",
    created_by: null
  };
}

// ---------- agenda do cliente (.ics e Google Agenda) ----------

function localStamp(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FORECAST_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}${get("month")}${get("day")}T${get("hour")}${get("minute")}${get("second")}`;
}

function utcStamp(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(text) {
  return String(text ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Dobra linhas em até 75 bytes (RFC 5545), sem partir um caractere UTF-8.
function foldLine(line) {
  const encoder = new TextEncoder();
  const out = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = out.length ? 74 : 75;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

function eventTexts({ kind, meetLink, brokerName, brokerPhone }) {
  const summary = `${kind === "presencial" ? "Atendimento presencial" : "Reunião online (Google Meet)"} – Matheus Machado Imóveis`;
  const location = kind === "presencial" ? COMPANY_ADDRESS : isMeetLink(meetLink) ? meetLink : "Google Meet (o link será enviado pelo WhatsApp)";
  const phone = String(brokerPhone || "").replace(/\D/g, "");
  const description = [
    brokerName ? `Seu corretor: ${brokerName}` : "",
    phone ? `WhatsApp: https://wa.me/${phone}` : "",
    kind === "online" && isMeetLink(meetLink) ? `Link da reunião: ${meetLink}` : ""
  ].filter(Boolean).join("\n");
  return { summary, location, description };
}

/** Arquivo .ics do agendamento. UID estável por agendamento (o mesmo arquivo baixado de novo atualiza o evento). */
export function buildAppointmentIcs({ id, startsAt, endsAt, createdAt, kind, meetLink = "", brokerName = "", brokerPhone = "" }) {
  const { summary, location, description } = eventTexts({ kind, meetLink, brokerName, brokerPhone });
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Matheus Machado Imoveis//Agendamento//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    `TZID:${FORECAST_TIME_ZONE}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0300",
    "TZOFFSETTO:-0300",
    "TZNAME:-03",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${id}@${ICS_HOST}`,
    `DTSTAMP:${utcStamp(createdAt || startsAt)}`,
    `DTSTART;TZID=${FORECAST_TIME_ZONE}:${localStamp(startsAt)}`,
    `DTEND;TZID=${FORECAST_TIME_ZONE}:${localStamp(endsAt)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `LOCATION:${icsEscape(location)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    ...(kind === "online" && isMeetLink(meetLink) ? [`URL:${meetLink}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Amanhã: atendimento com seu corretor",
    "TRIGGER:-P1D",
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Em 2 horas: atendimento com seu corretor",
    "TRIGGER:-PT2H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** Link "Adicionar ao Google Agenda" (mesmos textos do .ics). */
export function buildGoogleCalendarUrl({ startsAt, endsAt, kind, meetLink = "", brokerName = "", brokerPhone = "" }) {
  const { summary, location, description } = eventTexts({ kind, meetLink, brokerName, brokerPhone });
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: summary,
    dates: `${localStamp(startsAt)}/${localStamp(endsAt)}`,
    ctz: FORECAST_TIME_ZONE,
    details: description,
    location
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Resumo do agendamento para o cliente (sem ids internos além do id do próprio agendamento, usado no link do .ics). */
export function publicAppointment(row) {
  if (!row?.id || !row.starts_at) return null;
  const startsAt = new Date(row.starts_at).toISOString();
  const local = localStamp(startsAt);
  const date = `${local.slice(0, 4)}-${local.slice(4, 6)}-${local.slice(6, 8)}`;
  return { id: row.id, tipo: row.kind, data: date, hora: `${local.slice(9, 11)}:${local.slice(11, 13)}`, dia: describeDay(date) };
}
