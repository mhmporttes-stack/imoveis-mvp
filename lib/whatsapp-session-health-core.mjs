// Painel de SAÚDE POR NÚMERO do WhatsApp individual (REGRA OFICIAL — dono, 2026-10-10, WA-21). Funções PURAS
// (testes: tests/whatsapp-session-health.test.mjs). Servidor: lib/whatsapp-session-health.js (SOMENTE LEITURA).
// Uma linha por corretor + número (slot): status atual, último connected_at, último código de erro, quedas por dia
// (últimos 7 dias, fuso America/Sao_Paulo) e tamanho da fila pendente da Meta Diária. Sem telefone, sem credencial,
// sem texto de mensagem: só ids/códigos técnicos e nomes dos corretores.

import { normalizeSlot, slotDisplayName } from "./whatsapp-session-slots.mjs";
import { parseAttentionReason } from "./whatsapp-session-attention-core.mjs";

export const HEALTH_DAYS = 7;
export const FREQUENT_DROPS_24H = 3; // a partir daqui o número entra em "precisa de atenção" mesmo conectado
const DAY_MS = 24 * 60 * 60 * 1000;
const DOWN_STATUSES = new Set(["error", "disconnected", "reconnecting"]);

const DISCONNECT_CODE_LABELS = Object.freeze({
  401: "Aparelho desvinculado no celular (401)",
  403: "WhatsApp recusou a conexão (403)",
  408: "Tempo esgotado (408)",
  411: "Incompatibilidade de multi-aparelho (411)",
  428: "Conexão fechada (428)",
  440: "Outra conexão assumiu a sessão (440)",
  500: "Erro de comunicação com o WhatsApp (500)",
  503: "Serviço do WhatsApp indisponível (503)"
});
const REASON_LABELS = Object.freeze({
  repeated_drops: "Muitas quedas em poucas horas — reconexão automática parada",
  repeated_stream_errors: "Erros de comunicação repetidos — reconexão automática parada",
  retry_limit: "Limite de reconexões automáticas atingido",
  forbidden: "WhatsApp recusou a conexão",
  connection_replaced: "Outra conexão assumiu a sessão",
  multidevice_mismatch: "Incompatibilidade de multi-aparelho",
  restart_loop: "Reinício repetido sem estabilizar",
  logged_out: "Aparelho desvinculado no celular",
  qr_expired: "QR Code expirou sem ser lido"
});

export function describeDisconnectCode(code) {
  if (code === null || code === undefined || code === "") return "";
  const n = Number(code);
  if (!Number.isInteger(n)) return "";
  return DISCONNECT_CODE_LABELS[n] || `Código ${n}`;
}

const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
export const saoPauloDay = (ms) => dayFormatter.format(new Date(ms));

// 7 dias terminando hoje (mais antigo primeiro), no fuso de São Paulo.
export function lastDays(now = Date.now(), days = HEALTH_DAYS) {
  return Array.from({ length: days }, (_, i) => saoPauloDay(now - (days - 1 - i) * DAY_MS));
}

const toMs = (value) => {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
};

// Desconexão que conta como "queda": qualquer evento 'disconnected' da telemetria, menos o reinício normal (515).
export function isDropEvent(event) {
  if (!event) return false;
  if (Number(event.status_code) === 515 || event.reason === "restart_required" || event.kind === "restart") return false;
  return true;
}

// sessions: linhas de whatsapp_individual_sessions; telemetry: eventos 'disconnected'; queueByBroker: { brokerId: n };
// users: perfis do escopo ({ id, name, status, disabled_at }) — só quem está aqui aparece (recorte já feito no servidor).
export function buildSessionHealthRows({ sessions = [], telemetry = [], queueByBroker = {}, users = [], now = Date.now() } = {}) {
  const byUser = new Map(users.filter((user) => user?.id).map((user) => [user.id, user]));
  const days = lastDays(now);
  const since24h = now - DAY_MS;

  const dropsByKey = new Map();
  for (const event of telemetry) {
    if (!event?.user_id || !isDropEvent(event)) continue;
    const slot = normalizeSlot(event.session_slot) || 1;
    const key = `${event.user_id}:${slot}`;
    const list = dropsByKey.get(key) || [];
    list.push(event);
    dropsByKey.set(key, list);
  }

  const rows = [];
  for (const session of sessions) {
    const user = byUser.get(session?.user_id);
    if (!user || user.status === "inactive" || user.disabled_at) continue;
    const slot = normalizeSlot(session.slot) || 1;
    const events = (dropsByKey.get(`${session.user_id}:${slot}`) || []).sort((a, b) => (toMs(b.occurred_at) || 0) - (toMs(a.occurred_at) || 0));
    const perDay = Object.fromEntries(days.map((day) => [day, 0]));
    let drops24h = 0;
    for (const event of events) {
      const at = toMs(event.occurred_at);
      if (!at) continue;
      const day = saoPauloDay(at);
      if (day in perDay) perDay[day] += 1;
      if (at >= since24h) drops24h += 1;
    }
    const dropsTotal = days.reduce((sum, day) => sum + perDay[day], 0);
    const lastEvent = events[0] || null;
    const asCode = (value) => (value === null || value === undefined || value === "" || !Number.isInteger(Number(value)) ? null : Number(value));
    const lastErrorCode = asCode(session.last_disconnect_code) ?? asCode(lastEvent?.status_code);
    const attentionReason = parseAttentionReason(session.last_error) || (session.last_error === "logged_out" || session.last_error === "qr_expired" ? session.last_error : "");
    const status = session.status || "disconnected";
    rows.push({
      key: `${session.user_id}:${slot}`,
      brokerId: session.user_id,
      brokerName: user.name || "Sem nome",
      slot,
      slotName: slotDisplayName(slot),
      status,
      lastConnectedAt: session.last_connected_at || null,
      lastErrorCode,
      lastErrorLabel: describeDisconnectCode(lastErrorCode),
      lastErrorReason: attentionReason ? (REASON_LABELS[attentionReason] || "Reconexão automática parada") : "",
      lastErrorAt: session.last_disconnect_at || lastEvent?.occurred_at || null,
      drops: days.map((day) => ({ day, count: perDay[day] })),
      dropsTotal,
      drops24h,
      queuePending: Number.isFinite(Number(queueByBroker[session.user_id])) ? Number(queueByBroker[session.user_id]) : null,
      needsAttention: DOWN_STATUSES.has(status) || drops24h >= FREQUENT_DROPS_24H
    });
  }
  return rows.sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || b.dropsTotal - a.dropsTotal
    || a.brokerName.localeCompare(b.brokerName, "pt-BR") || a.slot - b.slot);
}
