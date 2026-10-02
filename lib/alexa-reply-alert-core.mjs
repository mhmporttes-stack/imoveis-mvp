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

// Só fala em horário comercial de São Paulo (07h–20h) para não acordar o escritório vazio.
export function isReplyAlertHour(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now));
  return hour >= 7 && hour < 20;
}
