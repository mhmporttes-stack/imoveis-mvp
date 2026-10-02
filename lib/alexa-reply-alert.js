import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { speakAlexa } from "./alexa-voice";
import { loadAlexaSettings } from "./alexa-service";
import {
  REPLY_ALERT_MAX_AGE_MINUTES,
  REPLY_ALERT_MAX_PER_RUN,
  composeReplyAlertSpeech,
  findUnansweredStreaks,
  isReplyAlertHour
} from "./alexa-reply-alert-core.mjs";

// Chamado a cada minuto. Nunca lança erro. Cada espera (conversa + primeira
// mensagem sem resposta) só gera UM alerta, controlado por whatsapp_reply_alerts.
export async function processReplyAlerts(now = new Date()) {
  try {
    if (!isReplyAlertHour(now)) return { alerted: 0, reason: "fora_do_horario" };
    const db = getSupabaseAdminClient();
    if (!db) return { alerted: 0, reason: "sem_banco" };

    const { settings } = await loadAlexaSettings();
    if (!settings?.enabled) return { alerted: 0, reason: "alexa_desligada" };

    const since = new Date(now.getTime() - (REPLY_ALERT_MAX_AGE_MINUTES + 120) * 60000).toISOString();
    const { data: messages, error } = await db
      .from("whatsapp_messages")
      .select("conversation_id, direction, sender_type, status, message_at")
      .in("direction", ["inbound", "outbound"])
      .gte("message_at", since)
      .order("message_at", { ascending: true })
      .limit(5000);
    if (error) return { alerted: 0, reason: "erro_leitura" };

    const due = findUnansweredStreaks(messages, now);
    if (!due.length) return { alerted: 0 };

    // Já alertadas (mesma espera) não repetem.
    const ids = due.map((item) => item.conversationId);
    const { data: done } = await db.from("whatsapp_reply_alerts").select("conversation_id, streak_started_at").in("conversation_id", ids);
    const doneKeys = new Set((done || []).map((row) => `${row.conversation_id}|${new Date(row.streak_started_at).toISOString()}`));
    const pending = due.filter((item) => !doneKeys.has(`${item.conversationId}|${item.streakStartedAt}`));
    if (!pending.length) return { alerted: 0 };

    const { data: conversations } = await db
      .from("whatsapp_conversations")
      .select("id, contact_name, assigned_user_id, account_user_id, status, deleted_at")
      .in("id", pending.map((item) => item.conversationId));
    const conversationById = new Map((conversations || []).map((row) => [row.id, row]));
    const active = pending.filter((item) => {
      const row = conversationById.get(item.conversationId);
      return row && !row.deleted_at && row.status !== "finished";
    });

    const batch = active.slice(0, REPLY_ALERT_MAX_PER_RUN);
    if (!batch.length) return { alerted: 0 };

    const brokerIds = [...new Set(batch.map((item) => conversationById.get(item.conversationId).assigned_user_id || conversationById.get(item.conversationId).account_user_id).filter(Boolean))];
    const { data: brokers } = brokerIds.length ? await db.from("admin_users").select("id, name, gender").in("id", brokerIds) : { data: [] };
    const brokerById = new Map((brokers || []).map((row) => [row.id, row]));

    // Reserva antes de falar (outra execução simultânea não repete).
    const claimed = [];
    for (const item of batch) {
      const { data: inserted, error: claimError } = await db
        .from("whatsapp_reply_alerts")
        .upsert({ conversation_id: item.conversationId, streak_started_at: item.streakStartedAt }, { onConflict: "conversation_id,streak_started_at", ignoreDuplicates: true })
        .select("conversation_id");
      if (!claimError && inserted?.length) claimed.push(item);
    }
    if (!claimed.length) return { alerted: 0 };

    const text = claimed
      .map((item) => {
        const row = conversationById.get(item.conversationId);
        const broker = brokerById.get(row.assigned_user_id || row.account_user_id);
        return composeReplyAlertSpeech({ brokerName: broker?.name, brokerGender: broker?.gender, clientName: row.contact_name, waitingMinutes: item.waitingMinutes });
      })
      .join(" ");

    const result = await speakAlexa(text);
    if (result?.ok) {
      await db.from("whatsapp_reply_alerts").update({ spoken: true }).in("conversation_id", claimed.map((item) => item.conversationId)).in("streak_started_at", claimed.map((item) => item.streakStartedAt));
    }
    return { alerted: claimed.length, spoken: Boolean(result?.ok) };
  } catch (error) {
    console.warn(`[alexa-reply-alert] erro inesperado: ${error?.name || "erro"}.`);
    return { alerted: 0, reason: "erro" };
  }
}
