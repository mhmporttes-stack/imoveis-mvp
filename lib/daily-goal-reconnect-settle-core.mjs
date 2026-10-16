// Início da ESPERA PÓS-CONEXÃO (30 min desde 2026-10-16; eram 2 h) da automação (Meta Diária e fila "Disparar") — regras PURAS (sem banco).
// Testes: tests/daily-goal-reconnect-settle.test.mjs. Ligação com o banco: lib/daily-goal-reconnect-settle.js.
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16, refina a de 2026-10-13] A espera (30 min desde 2026-10-16, eram 2 h — RECONNECT_SETTLE_MINUTES,
// lib/daily-goal-policy-core.mjs) conta a partir de uma CONEXÃO QUE EXIGE CAUTELA, não de toda volta a "connected":
//   (1) conexão pedida por uma pessoa (pareamento novo por QR/código, botão Conectar);
//   (2) conexão depois de 401 (logout) ou 403 (e de qualquer queda que o serviço não reconecta sozinho);
//   (3) retomada manual de número pausado (403, logout, entrega baixa) — `slot_controls[n].resumedAt`;
//   (4) conexão depois de queda LONGA (>= 30 min fora; mesmo corte da entrega baixa, LOW_DELIVERY_LONG_OUTAGE_MS).
// Reconexão AUTOMÁTICA RÁPIDA (< 30 min fora) por queda comum (428, 500, 503, 408, 515 e demais 5xx/sem código) NÃO
// recomeça a espera: antes ela recomeçava a cada ~50 min e a fila quase parou (14/10 = 7 envios, 15/10 = 2).
// Itens (3) e (4) nasceram como proteção extra da coordenação e foram CONFIRMADOS pelo dono em 2026-10-16 (REGRA OFICIAL).
//
// Fonte: telemetria JÁ GRAVADA (`whatsapp_session_telemetry`, append-only, por número) — tentativa (com gatilho), conexão e
// queda (com código). Sem migration. Na dúvida, segura: telemetria ausente/atrasada para a conexão atual, queda sem
// registro ou sem código conhecido => a conexão conta como início da espera (comportamento antigo, mais restritivo).

import { LOW_DELIVERY_LONG_OUTAGE_MS } from "./daily-goal-protection-core.mjs";
import { RECONNECT_SETTLE_MINUTES } from "./daily-goal-policy-core.mjs";

const MINUTE_MS = 60 * 1000;
// Quanto da telemetria é lido: espera (30 min) + queda longa (30 min) + folga. Conexão mais antiga que isso já cumpriu a espera.
export const SETTLE_LOOKBACK_MS = RECONNECT_SETTLE_MINUTES * MINUTE_MS + LOW_DELIVERY_LONG_OUTAGE_MS + 30 * MINUTE_MS;
// Diferença aceita entre `last_connected_at` (gravado pelo CRM ao receber o status) e o `connected` da telemetria (enviada
// em lote a cada ~5 s). Maior que isso = a telemetria não cobre a conexão atual -> conta como início da espera.
export const SETTLE_TELEMETRY_MATCH_TOLERANCE_MS = 2 * MINUTE_MS;
// Eventos do número e eventos do serviço que derrubam todas as sessões dele (encerramento/perda do lease).
export const SETTLE_SESSION_EVENT_TYPES = Object.freeze(["connect_attempt", "connected", "disconnected", "intervention_required"]);
export const SETTLE_SERVICE_DROP_EVENT_TYPES = Object.freeze(["service_shutdown", "lease_lost"]);

export const SETTLE_REASON = Object.freeze({
  MANUAL: "manual_connect",
  SERIOUS_DROP: "serious_drop",
  LONG_OUTAGE: "long_outage",
  UNKNOWN_DROP: "unknown_drop",
  QUICK_AUTO: "quick_auto_reconnect",
  NO_TELEMETRY: "no_telemetry",
  RESUMED: "resumed"
});

const msOf = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const ms = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

// Queda comum que o próprio serviço reconecta sozinho (reconnect-policy.js: TRANSIENT/RESTART). 401, 403, 440, 411 e
// códigos não reconhecidos exigem pessoa -> nunca contam como reconexão rápida.
export function isQuickReconnectDropCode(code) {
  if (code === null || code === undefined || code === "") return true; // erro sem código: o serviço trata como transitório
  const n = Number(code);
  if (!Number.isFinite(n)) return false;
  if (n === 408 || n === 428 || n === 515) return true;
  return n >= 500 && n <= 599;
}

// events: [{ type, statusCode, trigger, occurredAt }] DE UM NÚMERO + [{ type: "service_drop", occurredAt }] do serviço.
// -> [{ atMs, startsWait, reason }] uma entrada por `connected`, em ordem cronológica.
export function classifyConnections(events = []) {
  const list = (events || [])
    .map((event) => ({ ...event, atMs: msOf(event?.occurredAt) }))
    .filter((event) => event.atMs !== null)
    .sort((a, b) => a.atMs - b.atMs);
  const out = [];
  // Número estava conectado? null = ainda não se sabe (conexão anterior à janela lida): a queda do serviço conta.
  let up = null;
  let dropMs = null; // início da queda (1ª queda depois da última conexão)
  let serious = false;
  let manual = false;
  for (const event of list) {
    if (event.type === "connect_attempt") {
      if (event.trigger === "manual") manual = true;
    } else if (event.type === "disconnected" || event.type === "intervention_required") {
      if (event.type === "intervention_required" || !isQuickReconnectDropCode(event.statusCode)) serious = true;
      if (dropMs === null) dropMs = event.atMs;
      up = false;
    } else if (event.type === "service_drop") {
      if (up !== false && dropMs === null) dropMs = event.atMs;
      up = false;
    } else if (event.type === "connected") {
      let reason;
      if (manual) reason = SETTLE_REASON.MANUAL;
      else if (serious) reason = SETTLE_REASON.SERIOUS_DROP;
      else if (dropMs === null) reason = SETTLE_REASON.UNKNOWN_DROP;
      else if (event.atMs - dropMs >= LOW_DELIVERY_LONG_OUTAGE_MS) reason = SETTLE_REASON.LONG_OUTAGE;
      else reason = SETTLE_REASON.QUICK_AUTO;
      out.push({ atMs: event.atMs, startsWait: reason !== SETTLE_REASON.QUICK_AUTO, reason });
      up = true;
      dropMs = null;
      serious = false;
      manual = false;
    }
  }
  return out;
}

// Início da espera de UM número. lastConnectedAt = `whatsapp_individual_sessions.last_connected_at`; resumedAt =
// `slot_controls[n].resumedAt`. -> { anchorMs, reason } — anchorMs null = nada recente segura o número (livre).
export function settleAnchorFor({ lastConnectedAt = null, events = [], resumedAt = null } = {}) {
  const lastMs = msOf(lastConnectedAt);
  const candidates = [];
  const connections = classifyConnections(events);
  const latestConnectedMs = connections.length ? connections[connections.length - 1].atMs : null;
  if (lastMs !== null && (latestConnectedMs === null || lastMs - latestConnectedMs > SETTLE_TELEMETRY_MATCH_TOLERANCE_MS)) {
    candidates.push({ atMs: lastMs, reason: SETTLE_REASON.NO_TELEMETRY });
  }
  for (const item of connections) if (item.startsWait) candidates.push({ atMs: item.atMs, reason: item.reason });
  const resumedMs = msOf(resumedAt);
  if (resumedMs !== null) candidates.push({ atMs: resumedMs, reason: SETTLE_REASON.RESUMED });
  if (!candidates.length) return { anchorMs: null, reason: lastMs === null ? null : SETTLE_REASON.QUICK_AUTO };
  const latest = candidates.reduce((best, item) => (item.atMs > best.atMs ? item : best));
  return { anchorMs: latest.atMs, reason: latest.reason };
}

// Precisa ler a telemetria? Só se a última conexão (ou retomada) ainda pode estar dentro da espera.
export function needsSettleTelemetry({ lastConnectedAt = null, nowMs = Date.now() } = {}) {
  const lastMs = msOf(lastConnectedAt);
  return lastMs !== null && nowMs - lastMs < RECONNECT_SETTLE_MINUTES * MINUTE_MS + SETTLE_TELEMETRY_MATCH_TOLERANCE_MS;
}
