import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { normalizeSlot } from "./whatsapp-session-slots.mjs";
import {
  SETTLE_LOOKBACK_MS,
  SETTLE_SERVICE_DROP_EVENT_TYPES,
  SETTLE_SESSION_EVENT_TYPES,
  needsSettleTelemetry,
  settleAnchorFor
} from "./daily-goal-reconnect-settle-core.mjs";

// Início da espera pós-conexão de 2 h por NÚMERO (REGRA OFICIAL — dono, 2026-10-16; regra pura em
// lib/daily-goal-reconnect-settle-core.mjs). Devolve as MESMAS linhas de whatsapp_individual_sessions com dois campos a
// mais, só em memória: `settle_anchor_at` (ISO ou null = nada segura) e `settle_anchor_reason`. A política
// (lib/daily-goal-policy-core.mjs) usa `settle_anchor_at` no lugar de `last_connected_at` quando ele existe.
// Só leitura. Telemetria só é lida para número que (re)conectou há menos de ~2 h.
// Falha ao ler a telemetria NÃO libera nada: cai na regra antiga (espera conta da última conexão) e registra o erro.
//
// rows: linhas (com user_id, slot, last_connected_at) de 1+ corretores. controlsByUser: Map(userId -> slot_controls).
export async function attachSettleAnchors(rows, controlsByUser = new Map(), nowMs = Date.now()) {
  const list = (rows || []).filter(Boolean);
  const resumedAtOf = (row) => controlsByUser.get(row.user_id)?.[normalizeSlot(row.slot) || 1]?.resumedAt || null;
  const fallback = (row, reason) => {
    const resumedAt = resumedAtOf(row);
    const anchor = [row.last_connected_at, resumedAt].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
    return { ...row, settle_anchor_at: anchor, settle_anchor_reason: reason };
  };
  const needing = list.filter((row) => row.user_id && needsSettleTelemetry({ lastConnectedAt: row.last_connected_at, nowMs }));
  if (!needing.length) return list.map((row) => fallback(row, "old_connection"));

  const client = getSupabaseAdminClient();
  const since = new Date(nowMs - SETTLE_LOOKBACK_MS).toISOString();
  const userIds = [...new Set(needing.map((row) => row.user_id))];
  let sessionEvents;
  let serviceDrops;
  try {
    if (!client) throw new Error("Supabase administrativo não configurado.");
    const [sessionResult, serviceResult] = await Promise.all([
      client.from("whatsapp_session_telemetry")
        .select("user_id, session_slot, event_type, status_code, trigger, occurred_at")
        .in("user_id", userIds).in("event_type", SETTLE_SESSION_EVENT_TYPES).gte("occurred_at", since)
        .order("occurred_at", { ascending: false }).limit(5000),
      client.from("whatsapp_session_telemetry")
        .select("event_type, occurred_at")
        .is("user_id", null).in("event_type", SETTLE_SERVICE_DROP_EVENT_TYPES).gte("occurred_at", since)
        .order("occurred_at", { ascending: false }).limit(200)
    ]);
    if (sessionResult.error) throw sessionResult.error;
    if (serviceResult.error) throw serviceResult.error;
    sessionEvents = sessionResult.data || [];
    serviceDrops = (serviceResult.data || []).map((row) => ({ type: "service_drop", occurredAt: row.occurred_at }));
  } catch (error) {
    console.error("Espera pós-conexão: telemetria indisponível; a espera conta da última conexão (regra antiga).", error?.message || error);
    return list.map((row) => fallback(row, "telemetry_unavailable"));
  }

  const eventsByNumber = new Map();
  for (const row of sessionEvents) {
    const key = `${row.user_id}:${normalizeSlot(row.session_slot) || 1}`;
    if (!eventsByNumber.has(key)) eventsByNumber.set(key, []);
    eventsByNumber.get(key).push({ type: row.event_type, statusCode: row.status_code ?? null, trigger: row.trigger ?? null, occurredAt: row.occurred_at });
  }
  const needingSet = new Set(needing);
  return list.map((row) => {
    if (!needingSet.has(row)) return fallback(row, "old_connection");
    const events = [...(eventsByNumber.get(`${row.user_id}:${normalizeSlot(row.slot) || 1}`) || []), ...serviceDrops];
    const { anchorMs, reason } = settleAnchorFor({ lastConnectedAt: row.last_connected_at, events, resumedAt: resumedAtOf(row) });
    return { ...row, settle_anchor_at: anchorMs === null ? null : new Date(anchorMs).toISOString(), settle_anchor_reason: reason };
  });
}
