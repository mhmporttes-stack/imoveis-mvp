import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { createAlertDeliveries, getAlertDefinition, resolveAlertDeliveriesByPrefix } from "./crm-alerts";
import {
  BROKER_ALERT_COOLDOWN_MS, FALSE_CONNECTION_ALERT_KEY, FLAP_STATUS_CODES, RECENT_DROPS_WINDOW_MS, RESTART_COOLDOWN_MS, SEND_WINDOW_MS, brokerDedupeKey, brokerKeyPrefix, buildFalseConnectionDeliveries,
  AUTO_DISCONNECT_ERROR, DUPLICATE_NUMBER_ERROR, autoDisconnectKey, buildAutoDisconnectDelivery, buildDuplicateNumberDelivery, canAlertBrokerAgain, decideFalseConnectionStep, detectFailureEvidence, duplicateNumberKey, findDuplicateNumberSessions, shouldAutoDisconnect, staffDedupeKey, staffKeyPrefix
} from "./whatsapp-false-connection-core.mjs";
import { resolveResponsibleManager } from "./whatsapp-connection-alert-core.mjs";
import { disconnectIndividualSession, restartIndividualSession } from "./whatsapp-individual";
import { alertSubjectKey, normalizeSlot } from "./whatsapp-session-slots.mjs";

// Detector da "conexão falsa" (REGRA OFICIAL — dono, 2026-10-13; só com EVIDÊNCIA de falha desde 2026-10-23, ver o core).
// Chamado pelo cron `whatsapp-flows` (a cada 2 min). Só LÊ sessões/telemetria/mensagens; escreve apenas silent_since/silent_reason
// da sessão e as entregas da Central. Evidência -> reinício da sessão no serviço sem QR (nada de marca nem aviso); a evidência
// continua depois do reinício -> marca e avisa o corretor (1 vez por episódio, no máximo 1 a cada 12 h por número), a gestora e
// os administradores. Sinal de vida do WhatsApp, reconexão ou queda de vez -> limpa a marca e encerra os alertas. NUNCA lança.
export async function checkFalseConnections(now = Date.now()) {
  try {
    const db = getSupabaseAdminClient();
    if (!db) return { checked: 0, reason: "sem_banco" };
    const sessionsResult = await db.from("whatsapp_individual_sessions").select("user_id, slot, status, phone_number, last_connected_at, silent_since, silent_reason");
    if (sessionsResult.error) {
      // Migration 20261013210000 ainda não aplicada (sem as colunas): nada a medir.
      return { checked: 0, reason: "colunas_indisponiveis" };
    }
    const sessions = sessionsResult.data || [];
    // Mesma conta de WhatsApp ligada nos dois números do corretor: fica o de menor ordem, o outro é desconectado (o corretor é avisado).
    // Marca o motivo ANTES de desconectar para o aviso ao dono não duplicar este caso. Falha aqui nunca derruba o resto.
    let duplicatesDisconnected = 0;
    for (const dupe of findDuplicateNumberSessions(sessions)) {
      const dupeSlot = normalizeSlot(dupe.slot) || 1;
      try {
        await db.from("whatsapp_individual_sessions").update({ last_error: DUPLICATE_NUMBER_ERROR }).eq("user_id", dupe.user_id).eq("slot", dupeSlot);
        await disconnectIndividualSession(dupe.user_id, { slot: dupeSlot });
        dupe.status = "disconnected";
        const phone = String(dupe.phone_number || "").replace(/\D/g, "");
        const kept = sessions.find((row) => row !== dupe && row.user_id === dupe.user_id && String(row.phone_number || "").replace(/\D/g, "") === phone && row.status === "connected");
        const episode = new Date(dupe.last_connected_at || now).toISOString();
        const notice = buildDuplicateNumberDelivery({ brokerId: dupe.user_id, keepSlot: kept?.slot || 1, slot: dupeSlot, dedupeKey: `${duplicateNumberKey(alertSubjectKey(dupe.user_id, dupeSlot))}:${episode}` });
        if (notice) await createAlertDeliveries([notice]);
        duplicatesDisconnected += 1;
      } catch (error) {
        console.error("Falha ao desconectar número duplicado:", error?.message || error);
      }
    }
    const connected = sessions.filter((row) => row.status === "connected");
    const sinceIso = new Date(now - RECENT_DROPS_WINDOW_MS).toISOString();
    const recent = new Map(); // quedas 500/428 nas últimas 6 h (só para a desconexão automática)
    const stuckAts = new Map(); // `pipeline_stuck` do vigia do serviço
    const restartAts = new Map(); // reinício pedido pelo CRM (`pipeline_restart` kind crm)
    if (connected.length) {
      const { data: telemetry } = await db.from("whatsapp_session_telemetry").select("user_id, session_slot, occurred_at")
        .eq("event_type", "disconnected").in("status_code", FLAP_STATUS_CODES).gte("occurred_at", sinceIso).limit(2000);
      for (const event of telemetry || []) {
        const key = `${event.user_id}:${normalizeSlot(event.session_slot) || 1}`;
        recent.set(key, (recent.get(key) || 0) + 1);
      }
      const { data: guard } = await db.from("whatsapp_session_telemetry").select("user_id, session_slot, occurred_at, reason, kind")
        .eq("event_type", "history_sync").in("reason", ["pipeline_stuck", "pipeline_restart"])
        .gte("occurred_at", new Date(now - RESTART_COOLDOWN_MS).toISOString()).limit(2000);
      for (const event of guard || []) {
        const key = `${event.user_id}:${normalizeSlot(event.session_slot) || 1}`;
        if (event.reason === "pipeline_stuck") stuckAts.set(key, [...(stuckAts.get(key) || []), event.occurred_at]);
        else if (event.kind === "crm") restartAts.set(key, Math.max(restartAts.get(key) || 0, new Date(event.occurred_at).getTime() || 0));
      }
    }

    const decisions = [];
    for (const row of sessions) {
      const slot = normalizeSlot(row.slot) || 1;
      const key = `${row.user_id}:${slot}`;
      let evidence = null;
      let lifeAt = null;
      if (row.status === "connected") {
        const activity = await loadSessionActivity(db, row.user_id, slot, now);
        lifeAt = activity.lifeAt;
        evidence = detectFailureEvidence({ sends: activity.sends, lifeAt, stuckAts: stuckAts.get(key) || [], since: row.last_connected_at, now });
      }
      const step = decideFalseConnectionStep({ row, evidence, lifeAt, lastRestartAt: restartAts.get(key) || null, now });
      decisions.push({ row, slot, step });
    }

    // Recuperação automática primeiro (dono, 2026-10-23): evidência de falha -> reinício da sessão no serviço com as mesmas
    // credenciais (sem QR, sem marcar, sem avisar). Só se o serviço recusar (limite/versão antiga) segue direto para o aviso.
    let restarted = 0;
    for (const item of decisions.filter(({ step }) => step.action === "restart")) {
      let result = null;
      try {
        result = await restartIndividualSession(item.row.user_id, { slot: item.slot });
      } catch (error) {
        console.error("Falha ao reiniciar número sem funcionar:", error?.message || error);
      }
      if (result?.restarted) restarted += 1;
      // Sessão já em transição no serviço (reconectando): nada agora, o próximo ciclo decide de novo.
      else if (result?.status && result.status !== "connected") item.step = { action: "none" };
      else item.step = { action: "alert", reason: item.step.reason };
    }

    const needsNotify = decisions.filter(({ step }) => step.action === "alert");
    let users = [];
    let definition = null;
    const lastBrokerAlert = new Map();
    if (needsNotify.length) {
      const { data } = await db.from("admin_users").select("id, name, role, status, manager_id, linked_broker_id, disabled_at");
      users = data || [];
      definition = await getAlertDefinition(FALSE_CONNECTION_ALERT_KEY).catch(() => null);
      // Teto de 1 aviso ao corretor por número a cada 12 h (inclui os avisos do modelo antigo, chaves por balde de 2 h).
      const { data: previous } = await db.from("crm_alert_deliveries").select("dedupe_key, created_at")
        .like("dedupe_key", "wa_false_b:%").gte("created_at", new Date(now - BROKER_ALERT_COOLDOWN_MS).toISOString()).limit(1000);
      for (const delivery of previous || []) {
        const keyId = String(delivery.dedupe_key || "").slice("wa_false_b:".length).split(":")[0];
        const at = new Date(delivery.created_at).getTime() || 0;
        if (keyId && at > (lastBrokerAlert.get(keyId) || 0)) lastBrokerAlert.set(keyId, at);
      }
    }

    let marked = 0;
    let cleared = 0;
    let alerted = 0;
    let disconnected = 0;
    for (const { row, slot, step } of decisions) {
      const keyId = alertSubjectKey(row.user_id, slot);
      if (step.action === "alert") {
        let since = row.silent_since;
        const newEpisode = !since;
        if (!since || row.silent_reason !== step.reason) {
          since = since || new Date(now).toISOString();
          await db.from("whatsapp_individual_sessions").update({ silent_since: since, silent_reason: step.reason }).eq("user_id", row.user_id).eq("slot", slot);
          if (newEpisode) marked += 1;
        }
        const broker = users.find((user) => user.id === row.user_id);
        if (!broker || broker.status === "inactive" || broker.disabled_at) continue;
        // Um aviso por episódio (chave = silent_since) e, entre episódios, no máximo 1 a cada 12 h por número.
        if (newEpisode && canAlertBrokerAgain(lastBrokerAlert.get(keyId) || null, now)) {
          const staffIds = [resolveResponsibleManager(users, row.user_id), ...users.filter((user) => user.role === "admin" && user.status !== "inactive" && !user.disabled_at).map((user) => user.id)].filter(Boolean);
          const deliveries = buildFalseConnectionDeliveries({
            definition, brokerId: row.user_id, brokerName: broker.name, slot, staffIds,
            brokerKey: brokerDedupeKey(keyId, since), staffKey: staffDedupeKey(keyId, since), reason: step.reason
          });
          if (deliveries.length) alerted += (await createAlertDeliveries(deliveries)).length;
        }
        // Evidência de falha + reinício sem QR que não resolveu + queda repetida: deixa de fingir que está conectado. Mesmo
        // "desconectar" de sempre (sai da sessão, apaga as credenciais, para as reconexões automáticas); o número só volta quando
        // o corretor ler o QR Code. Falha aqui nunca derruba o resto.
        if (shouldAutoDisconnect({ verdict: { suspect: true, reason: step.reason }, recentDrops: recent.get(`${row.user_id}:${slot}`) || 0, silentSince: since, now })) {
          try {
            // Marca ANTES de desconectar: o aviso ao dono (whatsapp-connection-alert) lê isto e não duplica este caso.
            await db.from("whatsapp_individual_sessions").update({ last_error: AUTO_DISCONNECT_ERROR }).eq("user_id", row.user_id).eq("slot", slot);
            await disconnectIndividualSession(row.user_id, { slot });
            await db.from("whatsapp_individual_sessions").update({ last_error: AUTO_DISCONNECT_ERROR, silent_since: null, silent_reason: null }).eq("user_id", row.user_id).eq("slot", slot);
            const notice = buildAutoDisconnectDelivery({ definition, brokerId: row.user_id, slot, dedupeKey: autoDisconnectKey(keyId, since) });
            if (notice) await createAlertDeliveries([notice]);
            await resolveAlertDeliveriesByPrefix(brokerKeyPrefix(keyId));
            await resolveAlertDeliveriesByPrefix(staffKeyPrefix(keyId));
            disconnected += 1;
          } catch (error) {
            console.error("Falha ao desconectar número sem funcionar:", error?.message || error);
          }
        }
      } else if (step.action === "clear" && row.silent_since) {
        await db.from("whatsapp_individual_sessions").update({ silent_since: null, silent_reason: null }).eq("user_id", row.user_id).eq("slot", slot);
        await resolveAlertDeliveriesByPrefix(brokerKeyPrefix(keyId));
        await resolveAlertDeliveriesByPrefix(staffKeyPrefix(keyId));
        cleared += 1;
      }
    }
    return { checked: sessions.length, marked, cleared, alerted, disconnected, duplicatesDisconnected, restarted };
  } catch (error) {
    console.error("Falha ao verificar conexões falsas do WhatsApp:", error?.message || error);
    return { checked: 0, reason: "erro" };
  }
}

// O que passou por este número: mensagens que SAÍRAM nos últimos 90 min (sem histórico) e o último sinal de vida do
// WhatsApp (recebida que entrou, "entregue" ou "lida" que chegou) nas últimas 6 h.
async function loadSessionActivity(db, userId, slot, now) {
  const bySlot = (query) => (slot === 2 ? query.eq("session_slot", 2) : query.or("session_slot.is.null,session_slot.eq.1"));
  const base = () => bySlot(db.from("whatsapp_messages").select("created_at, delivered_at, read_at, conversation_id").eq("channel", "whatsapp_individual").eq("session_user_id", userId));
  const lifeSince = new Date(now - RECENT_DROPS_WINDOW_MS).toISOString();
  const [sendsResult, inboundResult, deliveredResult, readResult] = await Promise.all([
    base().eq("direction", "outbound").is("metadata->history", null).gte("created_at", new Date(now - SEND_WINDOW_MS).toISOString()).limit(500),
    base().eq("direction", "inbound").gte("created_at", lifeSince).order("created_at", { ascending: false }).limit(1),
    base().eq("direction", "outbound").gte("delivered_at", lifeSince).order("delivered_at", { ascending: false }).limit(1),
    base().eq("direction", "outbound").gte("read_at", lifeSince).order("read_at", { ascending: false }).limit(1)
  ]);
  // Leitura falhou: sem dado não há evidência (nunca marca às cegas).
  const failed = [sendsResult, inboundResult, deliveredResult, readResult].find((result) => result.error);
  if (failed) {
    console.error("Falha ao ler a atividade do número (conexão falsa):", failed.error?.message || failed.error);
    return { sends: [], lifeAt: new Date(now).toISOString() };
  }
  const times = [inboundResult.data?.[0]?.created_at, deliveredResult.data?.[0]?.delivered_at, readResult.data?.[0]?.read_at]
    .map((value) => new Date(value || 0).getTime()).filter((value) => Number.isFinite(value) && value > 0);
  return {
    sends: (sendsResult.data || []).map((item) => ({ createdAt: item.created_at, conversationId: item.conversation_id })),
    lifeAt: times.length ? new Date(Math.max(...times)).toISOString() : null
  };
}
