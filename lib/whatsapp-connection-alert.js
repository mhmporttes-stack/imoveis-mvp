import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { createAlertDeliveries, getAlertDefinition } from "./crm-alerts";
import {
  WHATSAPP_CONNECTION_ALERT_KEY, buildConnectionDelivery, decideConnectionAlert, disconnectDedupeKey, resolveResponsibleManager
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
