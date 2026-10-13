import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { createAlertDeliveries, getAlertDefinition, resolveAlertDeliveriesByPrefix } from "./crm-alerts";
import {
  FALSE_CONNECTION_ALERT_KEY, FLAP_STATUS_CODES, FLAP_WINDOW_MS, RECENT_DROPS_WINDOW_MS, brokerDedupeKey, brokerKeyPrefix, buildFalseConnectionDeliveries,
  classifyFalseConnection, staffDedupeKey, staffKeyPrefix
} from "./whatsapp-false-connection-core.mjs";
import { resolveResponsibleManager } from "./whatsapp-connection-alert-core.mjs";
import { alertSubjectKey, normalizeSlot } from "./whatsapp-session-slots.mjs";

// Detector da "conexão falsa" (REGRA OFICIAL — dono, 2026-10-13). Chamado pelo cron `whatsapp-flows` (a cada 2 min).
// Só LÊ sessões/telemetria/mensagens; escreve apenas silent_since/silent_reason da sessão e as entregas da Central.
// Marcou -> avisa o corretor (repete a cada 2 h até resolver), a gestora e os administradores (uma vez).
// Resolveu (voltou a receber, reconectou ou caiu de vez) -> limpa a marca e encerra os alertas pendentes.
// NUNCA desconecta sozinho e NUNCA lança.
export async function checkFalseConnections(now = Date.now()) {
  try {
    const db = getSupabaseAdminClient();
    if (!db) return { checked: 0, reason: "sem_banco" };
    const sessionsResult = await db.from("whatsapp_individual_sessions").select("user_id, slot, status, last_connected_at, silent_since, silent_reason");
    if (sessionsResult.error) {
      // Migration 20261013210000 ainda não aplicada (sem as colunas): nada a medir.
      return { checked: 0, reason: "colunas_indisponiveis" };
    }
    const sessions = sessionsResult.data || [];
    const connected = sessions.filter((row) => row.status === "connected");
    const sinceIso = new Date(now - RECENT_DROPS_WINDOW_MS).toISOString();
    const flapSince = now - FLAP_WINDOW_MS;
    const drops = new Map(); // última hora (loop)
    const recent = new Map(); // últimas 6 h (reconexão automática)
    if (connected.length) {
      const { data: telemetry } = await db.from("whatsapp_session_telemetry").select("user_id, session_slot, occurred_at")
        .eq("event_type", "disconnected").in("status_code", FLAP_STATUS_CODES).gte("occurred_at", sinceIso).limit(2000);
      for (const event of telemetry || []) {
        const key = `${event.user_id}:${normalizeSlot(event.session_slot) || 1}`;
        recent.set(key, (recent.get(key) || 0) + 1);
        if (new Date(event.occurred_at).getTime() >= flapSince) drops.set(key, (drops.get(key) || 0) + 1);
      }
    }

    const verdicts = [];
    for (const row of sessions) {
      const slot = normalizeSlot(row.slot) || 1;
      const key = `${row.user_id}:${slot}`;
      let verdict = { suspect: false, reason: null };
      if (row.status === "connected") {
        const flapDrops = drops.get(key) || 0;
        let inbound = { count: 0, last: null };
        if (flapDrops < 3) inbound = await loadInboundStats(db, row.user_id, slot, now);
        verdict = classifyFalseConnection({ session: row, flapDrops, recentDrops: recent.get(key) || 0, inboundCount7d: inbound.count, lastInboundAt: inbound.last, now });
      }
      verdicts.push({ row, slot, verdict });
    }

    const needsNotify = verdicts.filter(({ verdict }) => verdict.suspect);
    let users = [];
    let definition = null;
    if (needsNotify.length) {
      const { data } = await db.from("admin_users").select("id, name, role, status, manager_id, linked_broker_id, disabled_at");
      users = data || [];
      definition = await getAlertDefinition(FALSE_CONNECTION_ALERT_KEY).catch(() => null);
    }

    let marked = 0;
    let cleared = 0;
    let alerted = 0;
    for (const { row, slot, verdict } of verdicts) {
      const keyId = alertSubjectKey(row.user_id, slot);
      if (verdict.suspect) {
        let since = row.silent_since;
        if (!since || row.silent_reason !== verdict.reason) {
          since = new Date(now).toISOString();
          await db.from("whatsapp_individual_sessions").update({ silent_since: since, silent_reason: verdict.reason }).eq("user_id", row.user_id).eq("slot", slot);
          marked += 1;
        }
        const broker = users.find((user) => user.id === row.user_id);
        if (!broker || broker.status === "inactive" || broker.disabled_at) continue;
        const staffIds = [resolveResponsibleManager(users, row.user_id), ...users.filter((user) => user.role === "admin" && user.status !== "inactive" && !user.disabled_at).map((user) => user.id)].filter(Boolean);
        const deliveries = buildFalseConnectionDeliveries({
          definition, brokerId: row.user_id, brokerName: broker.name, slot, staffIds,
          brokerKey: brokerDedupeKey(keyId, now), staffKey: staffDedupeKey(keyId, since), reason: verdict.reason
        });
        if (deliveries.length) alerted += (await createAlertDeliveries(deliveries)).length;
      } else if (row.silent_since) {
        await db.from("whatsapp_individual_sessions").update({ silent_since: null, silent_reason: null }).eq("user_id", row.user_id).eq("slot", slot);
        await resolveAlertDeliveriesByPrefix(brokerKeyPrefix(keyId));
        await resolveAlertDeliveriesByPrefix(staffKeyPrefix(keyId));
        cleared += 1;
      }
    }
    return { checked: sessions.length, marked, cleared, alerted };
  } catch (error) {
    console.error("Falha ao verificar conexões falsas do WhatsApp:", error?.message || error);
    return { checked: 0, reason: "erro" };
  }
}

// O que o número RECEBEU: contagem dos últimos 7 dias e a mensagem mais recente (created_at: sent_at vem vazio no inbound).
async function loadInboundStats(db, userId, slot, now) {
  const since = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  let query = db.from("whatsapp_messages").select("created_at", { count: "exact" })
    .eq("channel", "whatsapp_individual").eq("direction", "inbound").eq("session_user_id", userId).gte("created_at", since);
  query = slot === 2 ? query.eq("session_slot", 2) : query.or("session_slot.is.null,session_slot.eq.1");
  const { data, count, error } = await query.order("created_at", { ascending: false }).limit(1);
  if (error) return { count: 0, last: null };
  return { count: count || 0, last: data?.[0]?.created_at || null };
}
