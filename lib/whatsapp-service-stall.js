import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { createAlertDeliveries, getAlertDefinition, resolveAlertDeliveriesByPrefix } from "./crm-alerts";
import { LEASE_SERVICE_ID, isLeaseUnavailableError } from "./whatsapp-service-lease-core.mjs";
import {
  SERVICE_STALL_ALERT_KEY, STALL_KEY_PREFIX, buildServiceStallDeliveries, decideServiceStall, resolveServiceStallRecipients
} from "./whatsapp-service-stall-core.mjs";

// Detecção do serviço do WhatsApp parado (REGRA OFICIAL — dono, 2026-10-10, WA-22). Chamada pelo cron existente
// `whatsapp-flows` (a cada 2 min). SOMENTE LEITURA do lease; a única escrita é a entrega na Central de Alertas
// (idempotente) e o encerramento automático do alerta quando o serviço volta. Nunca lança.
// Sem a tabela do lease (migration 20261004213000 não aplicada) ou sem linha: nada a medir, não alerta.
export async function checkWhatsappServiceStalled() {
  try {
    const db = getSupabaseAdminClient();
    if (!db) return { alerted: false, reason: "sem_banco" };
    const { data: lease, error } = await db.from("whatsapp_service_lease").select("heartbeat_at").eq("id", LEASE_SERVICE_ID).maybeSingle();
    if (error) {
      if (isLeaseUnavailableError(error)) return { alerted: false, reason: "lease_indisponivel" };
      throw error;
    }
    const decision = decideServiceStall({ lease });
    if (!decision.stalled) {
      if (!lease) return { alerted: false, reason: "sem_lease" };
      // Serviço voltou a renovar: encerra (sem ciência humana) o alerta pendente do episódio.
      const closed = await resolveAlertDeliveriesByPrefix(STALL_KEY_PREFIX);
      return { alerted: false, reason: "saudavel", closed };
    }
    const definition = await getAlertDefinition(SERVICE_STALL_ALERT_KEY).catch(() => null);
    const { data: users, error: usersError } = await db.from("admin_users").select("id, role, status, disabled_at");
    if (usersError) throw usersError;
    const deliveries = buildServiceStallDeliveries({ definition, recipientIds: resolveServiceStallRecipients(users || []), decision });
    if (!deliveries.length) return { alerted: false, stalled: true, reason: definition?.enabled === false ? "definicao_desligada" : "sem_destinatario" };
    const created = await createAlertDeliveries(deliveries);
    return { alerted: created.length > 0, stalled: true, reason: created.length ? "ok" : "duplicado" };
  } catch (err) {
    console.error("Falha ao verificar o serviço do WhatsApp:", err?.message || err);
    return { alerted: false, reason: "erro" };
  }
}
