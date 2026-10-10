import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { createAlertDeliveries, getAlertDefinition, resolveAlertDeliveriesByPrefix } from "./crm-alerts";
import {
  SELF_CONNECTION_ALERT_KEY, WHATSAPP_CONNECTION_ALERT_KEY, buildBrokerSelfDelivery, buildConnectionDelivery, decideBrokerSelfAlert,
  decideConnectionAlert, disconnectDedupeKey, resolveResponsibleManager, selfKeyPrefix
} from "./whatsapp-connection-alert-core.mjs";
import { alertSubjectKey, normalizeSlot } from "./whatsapp-session-slots.mjs";

// Detecção do alerta de conexão do WhatsApp (REGRA OFICIAL — dono, 2026-10-02). Chamado por
// applyIndividualSessionStatus (único caminho de escrita do status, via webhook do microsserviço) com a
// linha ANTERIOR e o status novo. NUNCA lança: um problema aqui jamais pode derrubar o status da sessão.
// Idempotência: UNIQUE (recipient_id, dedupe_key) da Central + chave por episódio (last_connected_at) +
// cooldown de 10 min contra flapping. Sem gestora responsável -> ninguém é alertado.
// `slot` (2026-10-08): o alerta é POR NÚMERO. Número 1 usa as chaves de sempre (id do corretor); o Número 2 usa
// "<id>#2" nas chaves e "(Número 2)" no nome — a gestora sabe qual dos dois caiu.
export async function notifyWhatsappConnectionChange(userId, prevRow, nextStatus, { slot = 1 } = {}) {
  try {
    const sessionSlot = normalizeSlot(slot) || 1;
    const keyId = alertSubjectKey(userId, sessionSlot);
    if (!userId || !nextStatus || !prevRow || prevRow.status === nextStatus) return { alerted: false, reason: "sem_mudanca" };
    if (nextStatus !== "disconnected" && nextStatus !== "connected") return { alerted: false, reason: "estado_ignorado" };
    const db = getSupabaseAdminClient();
    if (!db) return { alerted: false, reason: "sem_banco" };

    const { data: users, error: usersError } = await db.from("admin_users").select("id, name, role, status, manager_id, linked_broker_id, disabled_at");
    if (usersError) throw usersError;
    const managerId = resolveResponsibleManager(users || [], userId);
    if (!managerId) return { alerted: false, reason: "sem_gestora" };

    const definition = await getAlertDefinition(WHATSAPP_CONNECTION_ALERT_KEY);
    if (!definition?.enabled) return { alerted: false, reason: "definicao_desligada" };

    let recentDisconnectAt = null;
    let disconnectEmitted = false;
    if (nextStatus === "disconnected") {
      const { data: recent } = await db.from("crm_alert_deliveries").select("created_at")
        .eq("recipient_id", managerId).like("dedupe_key", `wa_disc:${keyId}:%`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      recentDisconnectAt = recent?.created_at || null;
    } else if (prevRow.last_connected_at) {
      const { data: sent } = await db.from("crm_alert_deliveries").select("id")
        .eq("recipient_id", managerId).eq("dedupe_key", disconnectDedupeKey(keyId, prevRow.last_connected_at)).limit(1).maybeSingle();
      disconnectEmitted = Boolean(sent);
    }

    const decision = decideConnectionAlert({ userId: keyId, prev: prevRow, nextStatus, recentDisconnectAt, disconnectEmitted });
    if (!decision) return { alerted: false, reason: "regra" };

    const broker = (users || []).find((user) => user.id === userId);
    const delivery = buildConnectionDelivery({
      definition, action: decision.action, managerId, brokerId: userId,
      brokerName: sessionSlot === 2 && broker?.name ? `${broker.name} (Número 2)` : broker?.name, dedupeKey: decision.dedupeKey
    });
    if (!delivery) return { alerted: false, reason: "sem_entrega" };
    const created = await createAlertDeliveries([delivery]);
    return { alerted: created.length > 0, action: decision.action, reason: created.length ? "ok" : "duplicado" };
  } catch (error) {
    console.error("Falha ao avaliar o alerta de conexão do WhatsApp:", error?.message || error);
    return { alerted: false, reason: "erro" };
  }
}

// Alerta DIRETO ao corretor dono do número (REGRA OFICIAL — dono, 2026-10-10, WA-20). Chamado por
// applyIndividualSessionStatus logo depois do alerta da gestora, com a mesma linha ANTERIOR. NUNCA lança.
// Destinatário = só o dono da sessão (AL-PRIV). Central de Alertas (Importante) + push (kind `whatsapp_connection`
// declarado no contexto). Dedupe por episódio (UNIQUE da Central) + 10 min entre alertas do mesmo número.
// Voltou a conectar: encerra sozinho o alerta pendente (o problema deixou de existir).
// Definição `whatsapp_connection_self` ausente (migration não aplicada) = usa o texto padrão, ligado.
export async function notifyBrokerOwnConnection(userId, prevRow, { status, error, slot = 1 } = {}) {
  try {
    const sessionSlot = normalizeSlot(slot) || 1;
    const keyId = alertSubjectKey(userId, sessionSlot);
    if (!userId || !status || !prevRow || prevRow.status === status) return { alerted: false, reason: "sem_mudanca" };
    const db = getSupabaseAdminClient();
    if (!db) return { alerted: false, reason: "sem_banco" };

    if (status === "connected") {
      const closed = await resolveAlertDeliveriesByPrefix(selfKeyPrefix(keyId));
      return { alerted: false, reason: "conectado", closed };
    }
    if (status !== "disconnected" && status !== "error") return { alerted: false, reason: "estado_ignorado" };

    const { data: user, error: userError } = await db.from("admin_users").select("id, status, disabled_at").eq("id", userId).maybeSingle();
    if (userError) throw userError;
    if (!user || user.status === "inactive" || user.disabled_at) return { alerted: false, reason: "usuario_inativo" };

    const { data: recent } = await db.from("crm_alert_deliveries").select("created_at")
      .eq("recipient_id", userId).like("dedupe_key", `${selfKeyPrefix(keyId)}%`)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const decision = decideBrokerSelfAlert({ userId: keyId, prev: prevRow, nextStatus: status, error, recentAt: recent?.created_at || null });
    if (!decision) return { alerted: false, reason: "regra" };

    const definition = await getAlertDefinition(SELF_CONNECTION_ALERT_KEY).catch(() => null);
    const delivery = buildBrokerSelfDelivery({ definition, brokerId: userId, slot: sessionSlot, dedupeKey: decision.dedupeKey, episode: decision.episode });
    if (!delivery) return { alerted: false, reason: "definicao_desligada" };
    const created = await createAlertDeliveries([delivery]);
    return { alerted: created.length > 0, reason: created.length ? "ok" : "duplicado" };
  } catch (err) {
    console.error("Falha ao avaliar o alerta direto de conexão do WhatsApp:", err?.message || err);
    return { alerted: false, reason: "erro" };
  }
}
