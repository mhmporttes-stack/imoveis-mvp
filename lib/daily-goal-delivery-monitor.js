import "server-only";
import { aggregateSessionStatus, groupSessionRowsByUser } from "./whatsapp-session-slots.mjs";
import { getSupabaseAdminClient } from "./supabase";
import {
  runDeliveryMonitor,
  DELIVERY_CONFIG_SETTING_ID,
  DELIVERY_STATE_SETTING_ID
} from "./daily-goal-delivery-monitor-core.mjs";

// Ligação do monitor de taxa de entrega (regras puras em daily-goal-delivery-monitor-core.mjs) com o banco e o Resend.
// Roda a partir do cron já existente (whatsapp-meta-diaria-dispatch, a cada 2 min), no máximo 1 vez por hora.
// SOMENTE LÊ a fila e AVISA por e-mail: nunca pausa, nunca altera fila/sessão. Sem migration: a marca de "já
// alertado hoje" e o estado ficam em crm_settings (chave primária = idempotência).

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

// Mesmo mecanismo de e-mail interno do projeto (Resend, remetente já configurado — ver lib/admin-user-invitation.js).
// Configuração ausente NÃO é sucesso: devolve skipped e o alerta é tentado de novo na próxima avaliação.
export async function sendDeliveryAlertEmailViaResend({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.RESEND_FROM_EMAIL || "";
  if (!apiKey || !from) return { skipped: true, reason: "resend_nao_configurado" };
  if (!to) return { skipped: true, reason: "sem_destinatario" };
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text, html })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Falha ao enviar o alerta de entrega (${response.status}). ${detail}`.trim());
  }
  return { sent: true };
}

async function readSetting(id) {
  const { data, error } = await db().from("crm_settings").select("setting_value").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.setting_value || null;
}

export function buildMonitorDeps({ sendEmail = sendDeliveryAlertEmailViaResend } = {}) {
  return {
    loadConfig: () => readSetting(DELIVERY_CONFIG_SETTING_ID),
    loadState: () => readSetting(DELIVERY_STATE_SETTING_ID),
    saveState: async (state) => {
      const { error } = await db().from("crm_settings").upsert({ id: DELIVERY_STATE_SETTING_ID, setting_value: state, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) throw error;
    },
    // Quem tem automação ligada (o monitor roda sempre, independente da chave v2).
    loadBrokers: async () => {
      const { data, error } = await db().from("daily_goal_auto_settings")
        .select("broker_id, broker:admin_users!daily_goal_auto_settings_broker_id_fkey(id, name, manager_id, disabled_at)")
        .eq("enabled", true);
      if (error) throw error;
      return (data || []).filter((row) => row.broker && !row.broker.disabled_at).map((row) => ({ id: row.broker.id, name: row.broker.name || "Corretor", managerId: row.broker.manager_id || null }));
    },
    loadSessions: async (ids) => {
      const map = new Map();
      if (!ids.length) return map;
      const { data, error } = await db().from("whatsapp_individual_sessions").select("user_id, slot, status, last_disconnect_at").in("user_id", ids);
      if (error) throw error;
      // Até 2 números por corretor (2026-10-08): status agregado (conectado se algum estiver) e a queda mais recente.
      for (const [userId, rows] of groupSessionRowsByUser(data || [])) {
        const times = rows.map((row) => (row.last_disconnect_at ? new Date(row.last_disconnect_at).getTime() : NaN)).filter((ms) => !Number.isNaN(ms));
        map.set(userId, { status: aggregateSessionStatus(rows), lastDisconnectAtMs: times.length ? Math.max(...times) : null });
      }
      return map;
    },
    loadQueueRows: async (sinceIso, untilIso) => {
      const { data, error } = await db().from("daily_goal_auto_queue")
        .select("broker_id, source, status, sent_at, delivered_at")
        .eq("source", "meta").eq("status", "sent")
        .gte("sent_at", sinceIso).lte("sent_at", untilIso)
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
    // Destinatária: a gestora (role manager, ativa) do corretor; sem gestora vinculada (ex.: a própria gestora),
    // todas as gestoras ativas. Hoje só existe uma (Caroline Mayumi). O e-mail nunca é impresso em log.
    loadRecipients: async (broker) => {
      let query = db().from("admin_users").select("name, email").eq("role", "manager").eq("status", "active").is("disabled_at", null);
      if (broker.managerId) {
        const { data: own, error: ownError } = await query.eq("id", broker.managerId);
        if (ownError) throw ownError;
        if (own?.length) return own.filter((row) => row.email).map((row) => ({ email: row.email, name: String(row.name || "").split(/\s+/)[0] }));
        query = db().from("admin_users").select("name, email").eq("role", "manager").eq("status", "active").is("disabled_at", null);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).filter((row) => row.email).map((row) => ({ email: row.email, name: String(row.name || "").split(/\s+/)[0] }));
    },
    // Idempotência: a chave primária de crm_settings recusa o segundo insert (23505) = já alertado hoje.
    claimAlert: async (key, payload) => {
      const { error } = await db().from("crm_settings").insert({ id: key, setting_value: payload });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw error;
    },
    releaseAlert: async (key) => {
      const { error } = await db().from("crm_settings").delete().eq("id", key);
      if (error) console.error("Falha ao liberar a marca do alerta de entrega:", error.message);
    },
    sendEmail
  };
}

export async function runDeliveryMonitorForCron(options = {}) {
  return runDeliveryMonitor({ nowMs: Date.now(), deps: buildMonitorDeps(options) });
}
