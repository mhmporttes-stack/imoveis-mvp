import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { createAlertDeliveries, getAlertDefinition, resolveAlertDeliveriesByPrefix } from "./crm-alerts";
import {
  WHATSAPP_SESSION_ATTENTION_KEY, attentionDedupeKey, attentionKeyPrefix, attentionReasonPrefix, buildAttentionDeliveries,
  classifySessionAttention, inAttentionCooldown, resolveAttentionRecipients
} from "./whatsapp-session-attention-core.mjs";
import { alertSubjectKey, normalizeSlot } from "./whatsapp-session-slots.mjs";

// Detecção do alerta "WhatsApp precisa de atenção" (regras puras em whatsapp-session-attention-core.mjs).
// Chamado por applyIndividualSessionStatus — o ÚNICO caminho de escrita do status, alimentado pelo webhook do
// microsserviço (por isso nada muda no Railway). Recebe a linha ANTERIOR e o evento novo. NUNCA lança: um
// problema aqui jamais pode derrubar a gravação do status da sessão.
// Idempotência: UNIQUE (recipient_id, dedupe_key) da Central + chave por ocorrência + cooldown por corretor/motivo.
// Sem a definição `whatsapp_session_attention` no banco (migration 20261004120000 ainda não aplicada) = não alerta.
// `slot` (2026-10-08): alerta POR NÚMERO — chaves do Número 1 inalteradas; Número 2 = "<id>#2" e "(Número 2)" no nome.
export async function notifyWhatsappSessionAttention(userId, prevRow, { status, error, slot = 1 } = {}) {
  try {
    if (!userId || !status) return { alerted: false, reason: "sem_status" };
    const sessionSlot = normalizeSlot(slot) || 1;
    const keyId = alertSubjectKey(userId, sessionSlot);
    const db = getSupabaseAdminClient();
    if (!db) return { alerted: false, reason: "sem_banco" };

    // Voltou a conectar: encerra (sem ciência humana) os alertas pendentes desse corretor.
    if (status === "connected") {
      if (!prevRow || prevRow.status === "connected") return { alerted: false, reason: "sem_mudanca" };
      const closed = await resolveAlertDeliveriesByPrefix(attentionKeyPrefix(keyId));
      return { alerted: false, reason: "conectado", closed };
    }

    const classification = classifySessionAttention({ status, error, prev: prevRow });
    if (!classification) return { alerted: false, reason: "regra" };

    const definition = await getAlertDefinition(WHATSAPP_SESSION_ATTENTION_KEY);
    if (!definition?.enabled) return { alerted: false, reason: definition ? "definicao_desligada" : "definicao_ausente" };

    const { data: users, error: usersError } = await db.from("admin_users").select("id, name, role, status, manager_id, linked_broker_id, disabled_at");
    if (usersError) throw usersError;
    const recipientIds = resolveAttentionRecipients(users || [], userId);
    if (!recipientIds.length) return { alerted: false, reason: "sem_destinatario" };

    const now = Date.now();
    const dedupeKey = attentionDedupeKey(keyId, classification.reason, prevRow, now);
    const { data: recent } = await db.from("crm_alert_deliveries").select("created_at")
      .like("dedupe_key", `${attentionReasonPrefix(keyId, classification.reason)}%`)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    // Mesma ocorrência já registrada passa direto (o UNIQUE barra); só uma ocorrência NOVA em cima de outra recente espera.
    const { data: same } = await db.from("crm_alert_deliveries").select("id").eq("dedupe_key", dedupeKey).limit(1).maybeSingle();
    if (!same && inAttentionCooldown(recent?.created_at, now)) return { alerted: false, reason: "cooldown" };

    const broker = (users || []).find((user) => user.id === userId);
    const deliveries = buildAttentionDeliveries({
      definition, recipientIds, brokerId: userId,
      brokerName: sessionSlot === 2 && broker?.name ? `${broker.name} (Número 2)` : broker?.name, classification, dedupeKey, at: now
    });
    if (!deliveries.length) return { alerted: false, reason: "sem_entrega" };
    const created = await createAlertDeliveries(deliveries);
    return { alerted: created.length > 0, state: classification.state, reason: created.length ? "ok" : "duplicado" };
  } catch (err) {
    console.error("Falha ao avaliar o alerta de atenção do WhatsApp:", err?.message || err);
    return { alerted: false, reason: "erro" };
  }
}
