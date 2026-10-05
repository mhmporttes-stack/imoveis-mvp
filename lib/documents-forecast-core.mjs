// "Previsão de envio dos documentos" da apresentação interativa (round 4) — regras PURAS, sem banco e sem "server-only"
// (o player no navegador usa a janela de datas; o servidor usa o resto). Testado em tests/documents-forecast.test.mjs.
//
// REGRAS (docs/BUSINESS_RULES.md PRES-17, confirmadas pelo dono em 2026-10-05):
//  - o cliente escolhe uma data entre os PRÓXIMOS 10 DIAS (hoje + 9, fuso America/Sao_Paulo; hoje é o 1º dia) e um
//    período (manhã, tarde, noite); o servidor valida a MESMA janela e recusa qualquer outra data;
//  - a confirmação leva o cliente ao WhatsApp do corretor responsável com uma mensagem pronta (montada no servidor);
//  - o status do cliente vai para "Aguardando documentação" SÓ a partir de uma lista fechada de origens (nunca regride);
//  - o corretor recebe uma atividade na agenda (09:00 manhã, 14:00 tarde, 19:00 noite, horário de Brasília).
import { CLIENT_STATUS, normalizeClientStatus } from "./client-status.js";

export const FORECAST_TIME_ZONE = "America/Sao_Paulo";
export const FORECAST_WINDOW_DAYS = 10;
export const FORECAST_PERIODS = ["manha", "tarde", "noite"];
export const FORECAST_PERIOD_LABEL = { manha: "manhã", tarde: "tarde", noite: "noite" };
// Hora marcada na agenda por período (America/Sao_Paulo; o Brasil não tem horário de verão desde 2019: sempre -03:00).
export const FORECAST_PERIOD_HOUR = { manha: 9, tarde: 14, noite: 19 };
export const FORECAST_UTC_OFFSET = "-03:00";

export const FORECAST_ACTIVITY_TYPE = "documentos";
export const FORECAST_ACTIVITY_TITLE = "Cliente previu enviar documentos";
export const FORECAST_STATUS_SOURCE = "apresentacao_cliente";
export const FORECAST_STATUS_CHANGED_BY = "sistema";
export const FORECAST_JOURNEY_EVENT = "document_forecast_set";
export const DOCUMENTS_LIST_SENT_EVENT = "documents_list_sent";

// Origens que a confirmação do cliente pode mover para "Aguardando documentação" (lista FECHADA). Qualquer outro status
// (inclusive "Tentando contato", que tem trava própria, e todos os que estão à frente no funil) não muda.
export const FORECAST_STATUS_SOURCES = [CLIENT_STATUS.COMPLETED, CLIENT_STATUS.SIMULATION_SENT, CLIENT_STATUS.IN_SERVICE];
export const FORECAST_TARGET_STATUS = CLIENT_STATUS.DOCUMENTATION;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo, independentemente do fuso do servidor ou do aparelho do cliente. */
export function todayInSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: FORECAST_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseIsoDate(value) {
  const match = DATE_PATTERN.exec(String(value ?? ""));
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // recusa datas que o JS "corrige" sozinho (30/02 vira 02/03)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function toIsoDate(date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** As 10 datas disponíveis (hoje + 9 seguintes, no calendário de São Paulo), em ordem. A conta é em UTC puro: sem horário de verão. */
export function forecastWindow(now = new Date()) {
  const start = parseIsoDate(todayInSaoPaulo(now));
  return Array.from({ length: FORECAST_WINDOW_DAYS }, (_, offset) => toIsoDate(new Date(start.getTime() + offset * 86_400_000)));
}

/** A data está na janela? Formato estrito AAAA-MM-DD; passado, futuro distante e datas inexistentes são recusados. */
export function isDateInForecastWindow(value, now = new Date()) {
  if (typeof value !== "string" || !parseIsoDate(value)) return false;
  return forecastWindow(now).includes(value);
}

/** Dados de exibição de uma data (pt-BR): dia da semana, dia, mês. Só apresentação. */
export function describeForecastDate(value) {
  const date = parseIsoDate(value);
  if (!date) return null;
  const weekday = date.getUTCDay();
  const month = date.getUTCMonth();
  return {
    iso: value,
    day: date.getUTCDate(),
    weekday: WEEKDAYS[weekday],
    weekdayShort: WEEKDAYS_SHORT[weekday],
    month: MONTHS[month],
    monthShort: MONTHS_SHORT[month],
    year: date.getUTCFullYear()
  };
}

/** dd/mm */
export function formatForecastDayMonth(value) {
  const date = parseIsoDate(value);
  if (!date) return "";
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const BODY_KEYS = new Set(["data", "periodo"]);

/**
 * Valida o corpo do POST público. Allowlist estrita: chave desconhecida, data fora da janela ou período fora da lista → null.
 * @returns {{ data: string, periodo: string } | null}
 */
export function parseForecastBody(body, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => !BODY_KEYS.has(key))) return null;
  if (!isDateInForecastWindow(body.data, now)) return null;
  if (typeof body.periodo !== "string" || !FORECAST_PERIODS.includes(body.periodo)) return null;
  return { data: body.data, periodo: body.periodo };
}

/** Instante (ISO UTC) da atividade: data escolhida + hora do período em Brasília (manhã 09:00, tarde 14:00, noite 19:00). */
export function forecastScheduledAt(data, periodo) {
  if (!parseIsoDate(data) || !FORECAST_PERIODS.includes(periodo)) return null;
  const hour = String(FORECAST_PERIOD_HOUR[periodo]).padStart(2, "0");
  return new Date(`${data}T${hour}:00:00${FORECAST_UTC_OFFSET}`).toISOString();
}

function cleanFirstName(value) {
  // só o primeiro nome, sem quebra de linha nem caractere de controle (o texto vai para uma URL do WhatsApp)
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().split(" ")[0].slice(0, 40);
}

/** Mensagem pronta do cliente para o corretor. Só o primeiro nome; nenhum dado sensível. */
export function buildForecastMessage({ fullName = "", firstName = "", data, periodo } = {}) {
  const name = cleanFirstName(firstName || fullName);
  const when = `${formatForecastDayMonth(data)}, no período da ${FORECAST_PERIOD_LABEL[periodo] || ""}`;
  return `Olá! ${name ? `Aqui é ${name}. ` : ""}Vi minha simulação e acredito que consigo enviar toda a documentação até ${when}. Pode me mandar a lista de documentos?`;
}

/** Link do WhatsApp do corretor com a mensagem pronta (o servidor só o devolve na confirmação). */
export function buildBrokerWhatsappUrl(phoneDigits, text) {
  const digits = String(phoneDigits ?? "").replace(/\D/g, "");
  if (!/^55\d{10,11}$/.test(digits)) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(String(text ?? ""))}`;
}

/** Novo status do cliente na confirmação: só a partir da lista fechada de origens; senão null (nada muda). Nunca regride. */
export function nextStatusOnForecast(currentStatus) {
  return FORECAST_STATUS_SOURCES.includes(normalizeClientStatus(currentStatus)) ? FORECAST_TARGET_STATUS : null;
}

/** "Não contactar": nada é gravado e nada é devolvido ao cliente. */
export function isForecastBlocked(status) {
  return normalizeClientStatus(status) === CLIENT_STATUS.DO_NOT_CONTACT;
}

/** Cliente arquivado e "Não contactar" não ganham atividade nem mudam de status. */
export function canTouchClientOnForecast(status) {
  const normalized = normalizeClientStatus(status);
  return normalized !== CLIENT_STATUS.DO_NOT_CONTACT && normalized !== CLIENT_STATUS.ARCHIVED;
}

/** Campos da atividade da agenda (calendar_activities). `created_by` null = criada pelo sistema, nunca por uma pessoa. */
export function buildForecastActivity({ clientId, responsibleUserId, data, periodo }) {
  const scheduledAt = forecastScheduledAt(data, periodo);
  if (!scheduledAt || !clientId || !responsibleUserId) return null;
  return {
    client_id: clientId,
    responsible_user_id: responsibleUserId,
    title: FORECAST_ACTIVITY_TITLE,
    activity_type: FORECAST_ACTIVITY_TYPE,
    scheduled_at: scheduledAt,
    note: `Previsão de envio: ${FORECAST_PERIOD_LABEL[periodo]}`.slice(0, 500),
    priority: null,
    status: "pending",
    created_by: null
  };
}

/** Texto do evento da jornada (timeline do cliente). */
export function forecastJourneyText({ data, periodo }) {
  return `Cliente previu enviar documentos até ${formatForecastDayMonth(data)} (${FORECAST_PERIOD_LABEL[periodo] || ""})`;
}

// ---------- botão "Enviar lista de documentos" da ficha ----------

/** Link público da imagem personalizada da lista (mesmo token da apresentação; ?baixar=1 como combinado). */
export function documentsListLink(token, origin = "") {
  const base = String(origin || "").replace(/\/$/, "") || "https://www.matheusmachadoimoveis.com.br";
  return `${base}/s/${token}/documentos?baixar=1`;
}

/** Mensagem que o CORRETOR envia ao cliente: texto + link (nunca anexo). Só o primeiro nome. */
export function buildDocumentsListMessage({ fullName = "", link = "" } = {}) {
  const name = cleanFirstName(fullName);
  return `Olá${name ? `, ${name}` : ""}! Segue a lista de documentos para validarmos a sua simulação junto à Caixa: ${link}`;
}

/** Acrescenta `text=` ao link externo escolhido por decideCardWhatsapp (wa.me/<n> ou web.whatsapp.com/send?phone=<n>). */
export function withWhatsappText(url, text) {
  const base = String(url ?? "");
  if (!base) return "";
  return `${base}${base.includes("?") ? "&" : "?"}text=${encodeURIComponent(String(text ?? ""))}`;
}
