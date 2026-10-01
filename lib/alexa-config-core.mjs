// Regras puras da Alexa (sem banco, sem rede, sem env): definição dos eventos,
// validação/normalização da configuração, janela de horário e montagem da
// frase. Fica em .mjs para ser testável direto com `node --test`.

export class AlexaSettingsError extends Error {}

export const ALEXA_EVENTS = [
  {
    key: "new_client",
    label: "Novo cliente",
    description: "Um cliente novo se cadastrou e aguarda atendimento.",
    connected: true,
    variables: [
      { name: "cliente", label: "Primeiro nome do cliente" },
      { name: "corretor", label: "Primeiro nome do corretor responsável" }
    ],
    defaults: { enabled: true, phrase: "Novo cliente aguardando atendimento." }
  },
  {
    key: "approved_client",
    label: "Cliente aprovado",
    description: "Um cliente foi aprovado.",
    connected: false,
    variables: [
      { name: "cliente", label: "Primeiro nome do cliente" },
      { name: "corretor", label: "Primeiro nome do corretor responsável" }
    ],
    defaults: { enabled: false, phrase: "Novo cliente aprovado." }
  },
  {
    key: "sale_made",
    label: "Venda realizada",
    description: "Uma venda foi registrada.",
    connected: false,
    variables: [
      { name: "corretor", label: "Primeiro nome do corretor" },
      { name: "cliente", label: "Primeiro nome do cliente" }
    ],
    defaults: { enabled: false, phrase: "Nova venda registrada por {corretor}." }
  },
  {
    key: "daily_goal",
    label: "Meta diária atingida",
    description: "Um corretor concluiu a meta diária.",
    connected: false,
    variables: [{ name: "corretor", label: "Primeiro nome do corretor" }],
    defaults: { enabled: false, phrase: "{corretor} concluiu a meta diária." }
  },
  {
    key: "upcoming_meeting",
    label: "Reunião próxima",
    description: "Há uma reunião ou atividade prestes a começar.",
    connected: false,
    variables: [
      { name: "minutos", label: "Minutos de antecedência" },
      { name: "cliente", label: "Primeiro nome do cliente" },
      { name: "corretor", label: "Primeiro nome do corretor" }
    ],
    defaults: { enabled: false, phrase: "Você tem uma reunião em {minutos} minutos.", leadMinutes: 15 }
  },
  {
    key: "queue",
    label: "Fila de atendimento",
    description: "Há clientes demais esperando atendimento por muito tempo.",
    connected: false,
    variables: [
      { name: "quantidade", label: "Quantidade de clientes aguardando" },
      { name: "minutos", label: "Tempo mínimo aguardando, em minutos" }
    ],
    defaults: {
      enabled: false,
      phrase: "Existem {quantidade} clientes aguardando atendimento há mais de {minutos} minutos.",
      minClients: 3,
      minWaitMinutes: 10
    }
  }
];

export const ALEXA_EVENT_KEYS = ALEXA_EVENTS.map((event) => event.key);
export const MAX_PHRASE_LENGTH = 160;

export function getDefaultAlexaSettings() {
  return {
    enabled: true,
    allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: "00:00",
    endTime: "23:59",
    minIntervalSeconds: 0,
    events: Object.fromEntries(ALEXA_EVENTS.map((event) => [event.key, { ...event.defaults }]))
  };
}

// --- Conteúdo sensível -------------------------------------------------------
// A Alexa fala em voz alta no escritório: nada de CPF, renda, valores de
// financiamento etc., nem na frase configurada nem no texto final.
const SENSITIVE_PATTERNS = [
  /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/,
  /R\s?\$/i,
  /\d{6,}/,
  /\b(cpf|rg|renda|sal[aá]rio|financiamento|financiado|fgts|saldo|cart[aã]o|senha|token)\b/i
];

export function containsSensitiveContent(text) {
  const value = String(text || "");
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
}

// --- Fuso de São Paulo -------------------------------------------------------
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function saoPauloNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short"
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { weekday: WEEKDAYS[get("weekday")] ?? 0, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function toMinutes(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
}

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// --- Validação / normalização -----------------------------------------------
function cleanPhrase(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clampInt(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AlexaSettingsError(`${label} deve ser um número inteiro entre ${min} e ${max}.`);
  }
  return number;
}

function validatePhrase(event, phrase) {
  if (!phrase) throw new AlexaSettingsError(`Escreva a frase do evento "${event.label}".`);
  if (phrase.length > MAX_PHRASE_LENGTH) {
    throw new AlexaSettingsError(`A frase de "${event.label}" pode ter no máximo ${MAX_PHRASE_LENGTH} caracteres.`);
  }
  if (containsSensitiveContent(phrase)) {
    throw new AlexaSettingsError(`A frase de "${event.label}" não pode conter CPF, renda, valores ou outros dados sensíveis.`);
  }
  const allowed = new Set(event.variables.map((variable) => variable.name));
  for (const match of phrase.matchAll(/\{([^{}]*)\}/g)) {
    if (!allowed.has(match[1])) {
      throw new AlexaSettingsError(`A variável {${match[1]}} não existe no evento "${event.label}".`);
    }
  }
  if (/[{}]/.test(phrase.replace(/\{[^{}]*\}/g, ""))) {
    throw new AlexaSettingsError(`A frase de "${event.label}" tem chaves { } sem fechar.`);
  }
}

// Valida a entrada do painel (estrita: erro com mensagem em português).
export function validateAlexaSettingsInput(input) {
  if (!input || typeof input !== "object") throw new AlexaSettingsError("Configuração inválida.");

  const weekdays = Array.isArray(input.allowedWeekdays) ? input.allowedWeekdays.map(Number) : [];
  if (!weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) {
    throw new AlexaSettingsError("Dias da semana inválidos.");
  }
  const allowedWeekdays = [...new Set(weekdays)].sort();
  if (!allowedWeekdays.length) throw new AlexaSettingsError("Selecione ao menos um dia da semana.");

  if (!TIME_PATTERN.test(String(input.startTime || "")) || !TIME_PATTERN.test(String(input.endTime || ""))) {
    throw new AlexaSettingsError("Informe horários válidos no formato HH:MM.");
  }
  if (input.startTime === input.endTime) {
    throw new AlexaSettingsError("O horário final precisa ser diferente do inicial.");
  }

  const rawEvents = input.events && typeof input.events === "object" ? input.events : {};
  const events = {};
  for (const event of ALEXA_EVENTS) {
    const raw = rawEvents[event.key] || {};
    const phrase = cleanPhrase(raw.phrase);
    validatePhrase(event, phrase);
    const next = { enabled: Boolean(raw.enabled), phrase };
    if (event.key === "upcoming_meeting") {
      next.leadMinutes = clampInt(raw.leadMinutes, 1, 240, "A antecedência da reunião (minutos)");
    }
    if (event.key === "queue") {
      next.minClients = clampInt(raw.minClients, 1, 100, "A quantidade mínima de clientes");
      next.minWaitMinutes = clampInt(raw.minWaitMinutes, 1, 1440, "O tempo mínimo aguardando (minutos)");
    }
    events[event.key] = next;
  }

  return {
    enabled: Boolean(input.enabled),
    allowedWeekdays,
    startTime: input.startTime,
    endTime: input.endTime,
    minIntervalSeconds: clampInt(input.minIntervalSeconds, 0, 3600, "O intervalo mínimo entre falas (segundos)"),
    events
  };
}

// Normaliza o que veio do banco (tolerante: nunca lança; completa com defaults).
export function normalizeAlexaSettings(row) {
  const defaults = getDefaultAlexaSettings();
  if (!row || typeof row !== "object") return defaults;

  const weekdays = Array.isArray(row.allowed_weekdays)
    ? [...new Set(row.allowed_weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : defaults.allowedWeekdays;
  const rawEvents = row.events && typeof row.events === "object" ? row.events : {};

  const events = {};
  for (const event of ALEXA_EVENTS) {
    const raw = rawEvents[event.key] && typeof rawEvents[event.key] === "object" ? rawEvents[event.key] : {};
    const merged = { ...event.defaults };
    if (typeof raw.enabled === "boolean") merged.enabled = raw.enabled;
    if (typeof raw.phrase === "string" && cleanPhrase(raw.phrase)) merged.phrase = cleanPhrase(raw.phrase);
    for (const extra of ["leadMinutes", "minClients", "minWaitMinutes"]) {
      if (extra in event.defaults && Number.isInteger(raw[extra]) && raw[extra] > 0) merged[extra] = raw[extra];
    }
    events[event.key] = merged;
  }

  return {
    enabled: typeof row.enabled === "boolean" ? row.enabled : defaults.enabled,
    allowedWeekdays: weekdays.length ? weekdays : defaults.allowedWeekdays,
    startTime: TIME_PATTERN.test(String(row.start_time || "")) ? row.start_time : defaults.startTime,
    endTime: TIME_PATTERN.test(String(row.end_time || "")) ? row.end_time : defaults.endTime,
    minIntervalSeconds: Number.isInteger(row.min_interval_seconds) ? row.min_interval_seconds : defaults.minIntervalSeconds,
    events
  };
}

// --- Decisão de falar --------------------------------------------------------
// Janela de horário no fuso de São Paulo. Início > fim vira janela que cruza a
// meia-noite (ex.: 22:00–06:00).
export function isWithinSchedule(settings, now = new Date()) {
  const current = saoPauloNow(now);
  if (!settings.allowedWeekdays.includes(current.weekday)) return { allowed: false, reason: "dia_nao_permitido" };
  const start = toMinutes(settings.startTime);
  const end = toMinutes(settings.endTime);
  const inside = start < end ? current.minutes >= start && current.minutes < end : current.minutes >= start || current.minutes < end;
  return inside ? { allowed: true } : { allowed: false, reason: "fora_do_horario" };
}

// Valida tudo menos o intervalo mínimo (que depende do estado no banco).
export function evaluateSpeak({ settings, eventKey, now = new Date() }) {
  if (!ALEXA_EVENT_KEYS.includes(eventKey)) return { allow: false, reason: "evento_desconhecido" };
  if (!settings.enabled) return { allow: false, reason: "alexa_inativa" };
  if (!settings.events[eventKey]?.enabled) return { allow: false, reason: "evento_inativo" };
  const schedule = isWithinSchedule(settings, now);
  if (!schedule.allowed) return { allow: false, reason: schedule.reason };
  return { allow: true };
}

export function intervalCutoffIso(settings, now = new Date()) {
  return new Date(now.getTime() - settings.minIntervalSeconds * 1000).toISOString();
}

// --- Frase -------------------------------------------------------------------
export function firstName(value) {
  const name = String(value || "").trim().split(/\s+/)[0] || "";
  return name.replace(/[^\p{L}'-]/gu, "").slice(0, 20);
}

// Substitui {variáveis} pelos valores seguros; variável sem valor some e a
// pontuação sobrando é arrumada. Devolve "" se o texto final for sensível.
export function renderAlexaPhrase(eventKey, phrase, values = {}) {
  const event = ALEXA_EVENTS.find((item) => item.key === eventKey);
  const allowed = new Set(event ? event.variables.map((variable) => variable.name) : []);
  const text = String(phrase || "")
    .replace(/\{([^{}]*)\}/g, (_, name) => (allowed.has(name) && values[name] != null ? String(values[name]) : ""))
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PHRASE_LENGTH);
  if (!text || containsSensitiveContent(text)) return "";
  return text;
}
