// "Conexão falsa" do WhatsApp individual (REGRA OFICIAL — dono, 2026-10-13): a sessão diz "conectado", mas o
// WhatsApp não entrega nada (caso Bruna Nº1: 500/428 em loop e 26 h sem receber). Regras PURAS (testes:
// tests/whatsapp-false-connection.test.mjs). Servidor: lib/whatsapp-false-connection.js (cron whatsapp-flows).
// NUNCA desconecta sozinho: só marca (silent_since), avisa e pinta a tela.

export const FALSE_CONNECTION_ALERT_KEY = "whatsapp_false_connection";
export const FLAP_WINDOW_MS = 60 * 60 * 1000;
export const FLAP_MIN_DROPS = 3; // quedas 500/428 na última hora
export const FLAP_STATUS_CODES = Object.freeze([500, 428]);
export const MIN_CONNECTED_BUSINESS_HOURS = 1; // 1 h útil conectado: dá tempo de chegar mensagem após reparear (e noite/fim de semana não contam)
export const SILENCE_BUSINESS_HOURS = 6; // horas úteis (seg–sex 08–19, Marília) sem receber nada
export const MIN_BASELINE_INBOUND_7D = 5; // número que quase não recebe nunca é "suspeito"
export const BROKER_REPEAT_MS = 2 * 60 * 60 * 1000; // lembrete ao corretor até reconectar
export const BUSINESS_START_HOUR = 8;
export const BUSINESS_END_HOUR = 19;

// Marília = America/Sao_Paulo = UTC-3 o ano todo (sem horário de verão desde 2019).
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const toMs = (value) => {
  const time = typeof value === "number" ? value : new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? time : 0;
};

// Quantas horas ÚTEIS (seg–sex, 08–19 em Marília) existem entre dois instantes.
export function businessHoursBetween(fromValue, toValue) {
  const from = toMs(fromValue);
  const to = toMs(toValue);
  if (!from || to <= from) return 0;
  let total = 0;
  // Dia local de Marília = dia UTC deslocado em 3 h.
  let dayStart = Math.floor((from - SP_OFFSET_MS) / DAY_MS) * DAY_MS + SP_OFFSET_MS;
  for (; dayStart < to; dayStart += DAY_MS) {
    const weekday = new Date(dayStart - SP_OFFSET_MS).getUTCDay(); // 0 dom … 6 sáb
    if (weekday === 0 || weekday === 6) continue;
    const open = dayStart + BUSINESS_START_HOUR * HOUR_MS;
    const close = dayStart + BUSINESS_END_HOUR * HOUR_MS;
    const start = Math.max(open, from);
    const end = Math.min(close, to);
    if (end > start) total += end - start;
  }
  return total / HOUR_MS;
}

// session: { status, last_connected_at }. flapDrops: quedas 500/428 na última hora. inboundCount7d / lastInboundAt: o que o
// número RECEBEU (mensagens de cliente). -> { suspect, reason: "flapping"|"silence"|null }
export function classifyFalseConnection({ session = null, flapDrops = 0, inboundCount7d = 0, lastInboundAt = null, now = Date.now() } = {}) {
  if (!session || session.status !== "connected") return { suspect: false, reason: null };
  if (Number(flapDrops) >= FLAP_MIN_DROPS) return { suspect: true, reason: "flapping" };
  const connectedAt = toMs(session.last_connected_at);
  if (!connectedAt || businessHoursBetween(connectedAt, now) < MIN_CONNECTED_BUSINESS_HOURS) return { suspect: false, reason: null };
  if (Number(inboundCount7d) < MIN_BASELINE_INBOUND_7D) return { suspect: false, reason: null };
  // Silêncio conta desde a última RECEBIDA (reconexão automática no meio do caminho não zera: caso Bruna Nº1, 2026-10-13).
  const reference = toMs(lastInboundAt) || connectedAt;
  if (businessHoursBetween(reference, now) >= SILENCE_BUSINESS_HOURS) return { suspect: true, reason: "silence" };
  return { suspect: false, reason: null };
}

// Estado exibido na tela para o número de uma sessão: "down" (desconectado de verdade), "silent" (conexão falsa) ou "ok".
// "reconnecting"/"connecting" é tentativa automática: não pinta nada (evita piscar rosa a cada oscilação).
const DOWN_STATUSES = new Set(["disconnected", "error", "qr_required", "pairing_code_required"]);
export function sessionUiState(row) {
  if (!row) return "ok";
  const status = row.status || "disconnected";
  if (DOWN_STATUSES.has(status)) return "down";
  if (status === "connected" && row.silent_since) return "silent";
  return "ok";
}
export const isSessionImpaired = (state) => state === "down" || state === "silent";

// Chaves da Central. Corretor: repete a cada 2 h (balde). Gestora/administração: UMA vez por suspeita (silent_since).
export const brokerKeyPrefix = (keyId) => `wa_false_b:${keyId}:`;
export const brokerDedupeKey = (keyId, now = Date.now()) => `${brokerKeyPrefix(keyId)}${Math.floor(now / BROKER_REPEAT_MS)}`;
export const staffKeyPrefix = (keyId) => `wa_false_s:${keyId}:`;
export const staffDedupeKey = (keyId, since) => `${staffKeyPrefix(keyId)}${new Date(toMs(since) || 0).toISOString()}`;

const DEFAULT_BODY = "O WhatsApp{numero} de {corretor} aparece como conectado, mas não está recebendo mensagens. Abra o ícone do WhatsApp no topo da tela, desconecte e conecte de novo pelo QR Code.";
const OWN_BODY = "Seu WhatsApp{numero} aparece como conectado, mas não está recebendo mensagens. Toque no ícone do WhatsApp no topo da tela, desconecte e conecte de novo pelo QR Code.";

// Entregas: o corretor (texto em 2ª pessoa) e os destinatários da equipe (gestora + administradores).
// definition ausente = texto padrão ligado; definition.enabled === false = desligado pelo dono.
export function buildFalseConnectionDeliveries({ definition = null, brokerId, brokerName = "", slot = 1, staffIds = [], brokerKey, staffKey, reason = "silence" } = {}) {
  if (!brokerId || definition?.enabled === false) return [];
  const numero = Number(slot) === 2 ? " (Número 2)" : "";
  const name = String(brokerName || "").trim() || "um corretor";
  const title = definition?.title || "WhatsApp conectado, mas sem receber";
  const template = definition?.body_template || DEFAULT_BODY;
  const context = (extra) => ({ source: FALSE_CONNECTION_ALERT_KEY, broker_id: brokerId, slot: Number(slot) === 2 ? 2 : 1, reason, ...extra });
  const rows = [];
  if (brokerKey) {
    rows.push({
      definition_id: definition?.id || null, recipient_id: brokerId, kind: "important", title,
      body: OWN_BODY.replace(/\{numero\}/g, numero), context: context({ link: "/admin/chat", push_kind: "whatsapp_connection" }), dedupe_key: brokerKey
    });
  }
  if (staffKey) {
    for (const recipientId of [...new Set(staffIds)].filter((id) => id && id !== brokerId)) {
      rows.push({
        definition_id: definition?.id || null, recipient_id: recipientId, kind: "important", title,
        body: template.replace(/\{numero\}/g, numero).replace(/\{corretor\}/g, name), context: context({ link: "/admin/meta-diaria" }), dedupe_key: staffKey
      });
    }
  }
  return rows;
}
