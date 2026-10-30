import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { createAlertDeliveries, getAlertDefinition, resolveAlertDeliveriesByPrefix } from "./crm-alerts";
import { LEASE_SERVICE_ID, isLeaseUnavailableError } from "./whatsapp-service-lease-core.mjs";
import {
  SERVICE_STALL_ALERT_KEY, STALL_KEY_PREFIX, STALL_LINK, buildServiceStallDeliveries, decideServiceStall, resolveServiceStallRecipients
} from "./whatsapp-service-stall-core.mjs";
import { serviceUnreachableDedupeKey } from "./whatsapp-chat-assist-core.mjs";

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

// Faixa "WhatsApp fora do ar" do Chat (WA-37, dono, 2026-10-30): leitura de UMA linha do lease, na mesma régua do alerta
// acima (decideServiceStall). Sem lease/tabela ou falha na leitura = false (sem faixa; o alerta do cron continua valendo).
export async function isWhatsappServiceDown() {
  try {
    const db = getSupabaseAdminClient();
    if (!db) return false;
    const { data: lease, error } = await db.from("whatsapp_service_lease").select("heartbeat_at").eq("id", LEASE_SERVICE_ID).maybeSingle();
    if (error) return false;
    return decideServiceStall({ lease }).stalled === true;
  } catch {
    return false;
  }
}

// Envio do Chat falhou por COMUNICAÇÃO com o serviço (isServiceCommError): avisa os administradores gerais no sino
// (Importante da Central) UMA vez por queda — chave por hora de São Paulo (UNIQUE da Central). Nunca lança.
export async function notifyWhatsappServiceUnreachable(errorMessage = "") {
  try {
    const db = getSupabaseAdminClient();
    if (!db) return { alerted: false };
    const { data: users, error } = await db.from("admin_users").select("id, role, status, disabled_at");
    if (error) throw error;
    const dedupeKey = serviceUnreachableDedupeKey();
    const deliveries = resolveServiceStallRecipients(users || []).map((recipientId) => ({
      definition_id: null,
      recipient_id: recipientId,
      kind: "important",
      title: "WhatsApp fora do ar",
      body: "Uma mensagem do Chat não saiu porque o serviço do WhatsApp dos corretores não respondeu. Verifique o serviço no Railway; a mensagem pode ser reenviada no Chat com \"Tentar de novo\".",
      context: { source: "whatsapp_service_unreachable", error: String(errorMessage || "").slice(0, 200), link: STALL_LINK },
      dedupe_key: dedupeKey
    }));
    if (!deliveries.length) return { alerted: false };
    const created = await createAlertDeliveries(deliveries);
    return { alerted: created.length > 0 };
  } catch (err) {
    console.error("Falha ao avisar queda do serviço do WhatsApp:", err?.message || err);
    return { alerted: false };
  }
}
