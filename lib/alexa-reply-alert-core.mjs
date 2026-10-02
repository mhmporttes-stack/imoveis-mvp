// Alerta "cliente sem resposta": a espera começa na primeira mensagem do cliente
// que ainda não teve resposta HUMANA enviada. Abrir/ler a conversa não conta;
// só uma mensagem realmente enviada pelo corretor (direction outbound,
// sender_type user, não falha) encerra a espera. Automação não encerra.

export const REPLY_ALERT_MINUTES = 10;
export const REPLY_ALERT_MAX_AGE_MINUTES = 60; // não fala de fila antiga (ex.: depois de a Alexa ficar fora do ar)
export const REPLY_ALERT_MAX_PER_RUN = 3;

const ts = (value) => new Date(value).getTime();

// messages: [{ conversation_id, direction, sender_type, status, message_at }]
// Retorna [{ conversationId, streakStartedAt, waitingMinutes }] já vencidos.
export function findUnansweredStreaks(messages, now = new Date(), { minutes = REPLY_ALERT_MINUTES, maxAgeMinutes = REPLY_ALERT_MAX_AGE_MINUTES } = {}) {
  const byConversation = new Map();
  for (const message of messages || []) {
    if (!message?.conversation_id || !message.message_at) continue;
    if (!byConversation.has(message.conversation_id)) byConversation.set(message.conversation_id, []);
    byConversation.get(message.conversation_id).push(message);
  }

  const due = [];
  for (const [conversationId, list] of byConversation) {
    list.sort((a, b) => ts(a.message_at) - ts(b.message_at));
    let start = null;
    for (const message of list) {
      if (message.direction === "inbound" && message.sender_type === "customer") {
        if (!start) start = message.message_at;
      } else if (message.direction === "outbound" && message.sender_type === "user" && message.status !== "failed") {
        start = null;
      }
    }
    if (!start) continue;
    const waited = (now.getTime() - ts(start)) / 60000;
    if (waited >= minutes && waited <= maxAgeMinutes) {
      due.push({ conversationId, streakStartedAt: new Date(start).toISOString(), waitingMinutes: Math.floor(waited) });
    }
  }
  return due.sort((a, b) => ts(a.streakStartedAt) - ts(b.streakStartedAt));
}

function safeFirst(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function clientLabel(rawName) {
  const name = String(rawName || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name || /\d{4,}/.test(name)) return "um cliente";
  return `o cliente ${name}`;
}

// "Atenção, corretora Carol. O cliente João Silva está aguardando uma resposta há 10 minutos."
export function composeReplyAlertSpeech({ brokerName, brokerGender, clientName, waitingMinutes }) {
  const first = safeFirst(brokerName);
  const title = brokerGender === "female" ? "corretora " : brokerGender === "male" ? "corretor " : "";
  const who = first ? `Atenção, ${title}${first}.` : "Atenção.";
  const minutes = Math.max(REPLY_ALERT_MINUTES, Math.floor(waitingMinutes || REPLY_ALERT_MINUTES));
  const client = clientLabel(clientName);
  return `${who} ${client[0].toUpperCase()}${client.slice(1)} está aguardando uma resposta há ${minutes} minutos.`;
}

export const REPLY_ALERT_DEFAULTS = { startHour: 7, endHour: 20, maxAgeMinutes: REPLY_ALERT_MAX_AGE_MINUTES, maxPerRun: REPLY_ALERT_MAX_PER_RUN };

const intIn = (value, min, max, fallback) => (Number.isInteger(value) && value >= min && value <= max ? value : fallback);

// Linha de whatsapp_reply_alert_settings -> configuração válida (valor inválido cai no padrão).
export function normalizeReplyAlertSettings(row) {
  const d = REPLY_ALERT_DEFAULTS;
  const startHour = intIn(row?.start_hour, 0, 23, d.startHour);
  const endHour = intIn(row?.end_hour, 1, 24, d.endHour);
  return {
    startHour: endHour > startHour ? startHour : d.startHour,
    endHour: endHour > startHour ? endHour : d.endHour,
    maxAgeMinutes: intIn(row?.max_age_minutes, REPLY_ALERT_MINUTES, 1440, d.maxAgeMinutes),
    maxPerRun: intIn(row?.max_per_run, 1, 10, d.maxPerRun)
  };
}

// Só fala dentro do horário configurado (hora de São Paulo).
export function isReplyAlertHour(now = new Date(), { startHour = REPLY_ALERT_DEFAULTS.startHour, endHour = REPLY_ALERT_DEFAULTS.endHour } = {}) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now));
  return hour >= startHour && hour < endHour;
}
