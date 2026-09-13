import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { sendWebPush, WebPushError } from "./web-push";

export async function savePushSubscription({ userId, endpoint, keys, userAgent }) {
  if (!userId) throw new Error("Usuário não identificado.");
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Error("Assinatura de push inválida.");

  const { error } = await getSupabaseAdminClient()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: String(userAgent || "").slice(0, 300),
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "endpoint" }
    );
  if (error) throw error;
  return { ok: true };
}

export async function deletePushSubscription({ userId, endpoint }) {
  let query = getSupabaseAdminClient().from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (userId) query = query.eq("user_id", userId);
  const { error } = await query;
  if (error) throw error;
  return { ok: true };
}

export async function listPushSubscriptionsForUser(userId) {
  if (!userId) return [];
  const { data, error } = await getSupabaseAdminClient().from("push_subscriptions").select("*").eq("user_id", userId);
  if (error) throw error;
  return (data || []).map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
}

// Envia a mesma notificação para todas as assinaturas do usuário (ele pode ter
// mais de um aparelho/navegador). Assinaturas que o navegador já invalidou
// (404/410) são removidas automaticamente — não afeta as demais.
export async function sendPushToUser(userId, payload, options = {}) {
  const subscriptions = await listPushSubscriptionsForUser(userId);
  if (!subscriptions.length) return { sent: 0, failed: 0, removed: 0 };

  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const subscription of subscriptions) {
    try {
      await sendWebPush(subscription, payload, options);
      sent += 1;
    } catch (error) {
      failed += 1;
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
        await deletePushSubscription({ endpoint: subscription.endpoint }).catch(() => {});
        removed += 1;
      } else {
        console.error("Falha ao enviar push.", error);
      }
    }
  }

  return { sent, failed, removed };
}
