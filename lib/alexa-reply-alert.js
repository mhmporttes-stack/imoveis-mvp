import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { speakAlexa } from "./alexa-voice";
import { loadAlexaSettings } from "./alexa-service";
import { createAlertDeliveries, getAlertDefinition } from "./crm-alerts";
import { buildReplyWaitingDelivery } from "./crm-alerts-core.mjs";
import {
  REPLY_ALERT_MINUTES,
  composeGroupedReplyAlertSpeech,
  findUnansweredStreaks,
  groupReplyAlertsByBroker,
  isReplyAlertHour,
  normalizeReplyAlertSettings
} from "./alexa-reply-alert-core.mjs";

// Chamado a cada minuto. Nunca lança erro. Uma espera (conversa + primeira
// mensagem sem resposta) só é "nova" uma vez, controlado por whatsapp_reply_alerts.
// O aviso é agrupado por corretor: um anúncio por corretor com espera nova.
export async function processReplyAlerts(now = new Date()) {
  try {
    const db = getSupabaseAdminClient();
    if (!db) return { alerted: 0, reason: "sem_banco" };
    const { data: settingsRow } = await db.from("whatsapp_reply_alert_settings").select("*").eq("id", 1).maybeSingle();
    const config = normalizeReplyAlertSettings(settingsRow);
    if (!isReplyAlertHour(now, config)) return { alerted: 0, reason: "fora_do_horario" };

    const { settings } = await loadAlexaSettings();
    if (!settings?.enabled) return { alerted: 0, reason: "alexa_desligada" };

    const since = new Date(now.getTime() - (config.maxAgeMinutes + 120) * 60000).toISOString();
    const { data: messages, error } = await db
      .from("whatsapp_messages")
      .select("conversation_id, direction, sender_type, status, message_at")
      .in("direction", ["inbound", "outbound"])
      .gte("message_at", since)
      .order("message_at", { ascending: true })
      .limit(5000);
    if (error) return { alerted: 0, reason: "erro_leitura" };

    const due = findUnansweredStreaks(messages, now, { maxAgeMinutes: config.maxAgeMinutes });
    if (!due.length) return { alerted: 0 };

    const ids = due.map((item) => item.conversationId);
    const [{ data: done }, { data: conversations }] = await Promise.all([
      db.from("whatsapp_reply_alerts").select("conversation_id, streak_started_at").in("conversation_id", ids),
      db.from("whatsapp_conversations").select("id, contact_name, assigned_user_id, account_user_id, session_key, status, deleted_at").in("id", ids)
    ]);
    const doneKeys = new Set((done || []).map((row) => `${row.conversation_id}|${new Date(row.streak_started_at).toISOString()}`));
    const conversationById = new Map((conversations || []).map((row) => [row.id, row]));

    // Todas as esperas vencidas e ativas entram na contagem; só as ainda não avisadas disparam anúncio.
    const waiting = due
      .map((item) => {
        const row = conversationById.get(item.conversationId);
        if (!row || row.deleted_at || row.status === "finished") return null;
        return {
          ...item,
          brokerId: (row.session_key && row.session_key !== "00000000-0000-0000-0000-000000000000" ? row.session_key : null) || row.assigned_user_id || row.account_user_id || null,
          clientName: row.contact_name,
          isNew: !doneKeys.has(`${item.conversationId}|${item.streakStartedAt}`)
        };
      })
      .filter(Boolean);
    const groups = groupReplyAlertsByBroker(waiting).filter((group) => group.items.some((item) => item.isNew));
    if (!groups.length) return { alerted: 0 };

    const brokerIds = groups.map((group) => group.brokerId).filter(Boolean);
    const { data: brokers } = brokerIds.length ? await db.from("admin_users").select("id, name, gender").in("id", brokerIds) : { data: [] };
    const brokerById = new Map((brokers || []).map((row) => [row.id, row]));

    // Central de Alertas (2026-10-02): a MESMA espera reservada abaixo vira
    // também um alerta IMPORTANTE na tela do corretor, se o dono ligou
    // "reply_waiting" na Central. Detector único (este) — a chave da entrega
    // é conversa + início da espera, então nunca duplica.
    const centralDefinition = await getAlertDefinition("reply_waiting").catch(() => null);

    let alerted = 0;
    for (const group of groups) {
      // Reserva as esperas novas antes de falar (execução simultânea não repete).
      const claimed = [];
      for (const item of group.items.filter((entry) => entry.isNew)) {
        const { data: inserted, error: claimError } = await db
          .from("whatsapp_reply_alerts")
          .upsert({ conversation_id: item.conversationId, streak_started_at: item.streakStartedAt }, { onConflict: "conversation_id,streak_started_at", ignoreDuplicates: true })
          .select("conversation_id");
        if (!claimError && inserted?.length) claimed.push(item);
      }
      if (!claimed.length) continue;

      if (centralDefinition?.enabled) {
        const broker = brokerById.get(group.brokerId) || null;
        const deliveries = claimed
          .map((item) => buildReplyWaitingDelivery({ definition: centralDefinition, broker, clientName: item.clientName, minutes: REPLY_ALERT_MINUTES, conversationId: item.conversationId, streakStartedAt: item.streakStartedAt }))
          .filter(Boolean);
        try {
          await createAlertDeliveries(deliveries);
        } catch (centralError) {
          console.warn(`[alexa-reply-alert] Central de Alertas: ${centralError?.message || "erro"}.`);
        }
      }

      const text = composeGroupedReplyAlertSpeech({
        brokerName: brokerById.get(group.brokerId)?.name,
        brokerGender: brokerById.get(group.brokerId)?.gender,
        count: group.items.length,
        clientName: group.items[0].clientName
      });
      const result = await speakAlexa(text);
      alerted += claimed.length;
      if (result?.ok) {
        await db.from("whatsapp_reply_alerts").update({ spoken: true }).in("conversation_id", claimed.map((item) => item.conversationId)).in("streak_started_at", claimed.map((item) => item.streakStartedAt));
      }
    }
    return { alerted };
  } catch (error) {
    console.warn(`[alexa-reply-alert] erro inesperado: ${error?.name || "erro"}.`);
    return { alerted: 0, reason: "erro" };
  }
}
