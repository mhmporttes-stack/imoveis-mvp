import "server-only";
import { createHmac } from "node:crypto";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabase";
import { isGeneralAdminAuth } from "@/lib/admin-profiles";
import { sendPushToUser } from "@/lib/push-subscriptions";
import { ALERT_KIND, normalizeAlertKind, onlyOwnRows, resolveAudienceRecipients, splitPendingAlerts } from "@/lib/crm-alerts-core.mjs";

// Central de Alertas (pedido do dono, 2026-10-02). Tabelas
// crm_alert_definitions / crm_alert_deliveries (migration 20261002340000).
// Mesmo padrão de tempo real da Supervisão (lib/supervision-messages.js):
// "ping" sem dados num tópico de Broadcast por usuário; o navegador relê pela
// API autenticada. Escopo de leitura/ciência é SEMPRE o próprio usuário.

export class CrmAlertError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CrmAlertError";
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function db() {
  if (!hasSupabaseAdminConfig) throw new CrmAlertError("Supabase não configurado.", 503);
  return getSupabaseAdminClient();
}

export function getAlertsTopic(userId) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!secret || !userId) return "";
  return `alr-${createHmac("sha256", secret).update(`crm-alerts:${userId}`).digest("hex").slice(0, 24)}`;
}

async function broadcastAlertsChanged(userIds = []) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const topics = [...new Set(userIds.filter(Boolean))].map(getAlertsTopic).filter(Boolean);
  if (!url || !key || !topics.length) return;
  try {
    await fetch(`${url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: topics.map((topic) => ({ topic, event: "changed", payload: { at: Date.now() }, private: false })) }),
      signal: AbortSignal.timeout(4000)
    });
  } catch {
    // Melhor esforço: a tela relê ao voltar para a aba e no intervalo de segurança.
  }
}

// Usuário "real" da sessão: em "Alterar conta" o gate não aparece e a
// ciência não pode ser dada em nome de outra pessoa.
function recipientOf(auth) {
  if (auth?.accountSwitchMode) return "";
  return auth?.profile?.id || "";
}

export async function getAlertDefinition(key) {
  const { data, error } = await db().from("crm_alert_definitions").select("*").eq("key", key).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Grava entregas (idempotente: mesmo destinatário + dedupe_key não duplica) e
// avisa a tela. Importante também vai por push (o app pode estar fechado).
export async function createAlertDeliveries(deliveries = []) {
  const rows = deliveries.filter((row) => row?.recipient_id && normalizeAlertKind(row.kind) && row.dedupe_key && row.body);
  if (!rows.length) return [];
  const { data, error } = await db()
    .from("crm_alert_deliveries")
    .upsert(rows, { onConflict: "recipient_id,dedupe_key", ignoreDuplicates: true })
    .select("id, recipient_id, kind, title, body");
  if (error) throw error;
  const created = data || [];
  if (created.length) {
    await broadcastAlertsChanged(created.map((row) => row.recipient_id));
    for (const row of created.filter((item) => item.kind === ALERT_KIND.IMPORTANT)) {
      try {
        await sendPushToUser(row.recipient_id, { title: row.title, body: row.body, url: "/admin", tag: `crm-alert:${row.id}` });
      } catch {
        // push é extra; a tela é o canal principal.
      }
    }
  }
  return created;
}

export async function listMyPendingAlerts(auth) {
  const me = recipientOf(auth);
  if (!me) return { important: [], informative: [], topic: "" };
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from("crm_alert_deliveries")
    .select("id, recipient_id, kind, title, body, context, created_at, shown_at, acknowledged_at")
    .eq("recipient_id", me)
    .is("acknowledged_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  // Defesa em profundidade: só o que é do próprio destinatário sai daqui, e o
  // id do destinatário não vai para o navegador.
  const own = onlyOwnRows(data || [], me).map(({ recipient_id: _recipient, ...row }) => row);
  return { ...splitPendingAlerts(own), topic: getAlertsTopic(me) };
}

// Registra quando o alerta APARECEU (primeira vez) na tela do destinatário.
export async function markAlertsShown(auth, ids = []) {
  const me = recipientOf(auth);
  const clean = [...new Set((ids || []).filter((id) => UUID.test(String(id))))].slice(0, 50);
  if (!me || !clean.length) return { marked: 0 };
  const { data, error } = await db()
    .from("crm_alert_deliveries")
    .update({ shown_at: new Date().toISOString() })
    .eq("recipient_id", me)
    .in("id", clean)
    .is("shown_at", null)
    .select("id");
  if (error) throw error;
  return { marked: data?.length || 0 };
}

// "Entendi": ciência do próprio destinatário (nunca de outra pessoa nem em
// "Alterar conta"). Idempotente.
export async function acknowledgeAlert(auth, id) {
  const me = recipientOf(auth);
  if (!me) throw new CrmAlertError("Confirmação indisponível neste modo.", 403);
  if (!UUID.test(String(id || ""))) throw new CrmAlertError("Alerta inválido.");
  const now = new Date().toISOString();
  const { data: row, error } = await db().from("crm_alert_deliveries").select("id, recipient_id, shown_at, acknowledged_at, dedupe_key, context").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!row || row.recipient_id !== me) throw new CrmAlertError("Alerta não encontrado.", 404);
  if (row.acknowledged_at) return { acknowledgedAt: row.acknowledged_at };
  const { data: updated, error: updateError } = await db()
    .from("crm_alert_deliveries")
    .update({ acknowledged_at: now, acknowledged_by: me, shown_at: row.shown_at || now })
    .eq("id", id)
    .is("acknowledged_at", null)
    .select("acknowledged_at")
    .maybeSingle();
  if (updateError) throw updateError;
  await recordManualNewsRead(row, me, now);
  await broadcastAlertsChanged([me]);
  return { acknowledgedAt: updated?.acknowledged_at || now };
}

// "Entendi" num alerta de novidade do Manual tambem grava o ledger de leitura (idempotente; nunca derruba a ciencia).
async function recordManualNewsRead(row, userId, at) {
  const newsId = String(row?.dedupe_key || "").startsWith("manual_news:") ? row?.context?.news_id : null;
  if (!newsId) return;
  try {
    await db().from("manual_news_reads").upsert({ news_id: newsId, user_id: userId, read_at: at }, { onConflict: "news_id,user_id", ignoreDuplicates: true });
  } catch (error) {
    console.error("Manual: leitura nao gravada:", error?.message || error);
  }
}

function assertGeneralAdmin(auth) {
  if (!isGeneralAdminAuth(auth) || auth?.accountSwitchMode) throw new CrmAlertError("Apenas o administrador geral.", 403);
}

// Definições (base do futuro construtor): por enquanto, listar e ligar/desligar.
export async function listAlertDefinitions(auth) {
  assertGeneralAdmin(auth);
  const { data, error } = await db().from("crm_alert_definitions").select("id, key, title, body_template, kind, audience, trigger, schedule, repeat, enabled, updated_at").order("created_at");
  if (error) throw error;
  return data || [];
}

export async function setAlertDefinitionEnabled(auth, id, enabled) {
  assertGeneralAdmin(auth);
  if (!UUID.test(String(id || ""))) throw new CrmAlertError("Alerta inválido.");
  const { data, error } = await db().from("crm_alert_definitions").update({ enabled: Boolean(enabled), updated_at: new Date().toISOString() }).eq("id", id).select("id, enabled").maybeSingle();
  if (error) throw error;
  if (!data) throw new CrmAlertError("Alerta não encontrado.", 404);
  return data;
}

// Entrega por audiência explícita (user | team | global): expande a definição
// em UMA entrega por destinatário. "user" nunca vira equipe/hierarquia.
export async function createAlertsForAudience(definition, buildRow) {
  const { data: users, error } = await db().from("admin_users").select("id, role, status, manager_id, linked_broker_id");
  if (error) throw error;
  const ids = resolveAudienceRecipients(definition?.audience, users || []);
  return createAlertDeliveries(ids.map((recipientId) => buildRow(recipientId)));
}

// Teste controlado: manda o alerta SÓ para quem pediu (admin geral), nunca
// para corretores.
export async function sendTestAlertToMe(auth, kind) {
  assertGeneralAdmin(auth);
  const type = normalizeAlertKind(kind);
  if (!type) throw new CrmAlertError("Tipo inválido.");
  const me = auth.profile.id;
  const first = String(auth.profile.name || "").trim().split(/\s+/)[0] || "Olá";
  const [created] = await createAlertDeliveries([{
    recipient_id: me,
    kind: type,
    title: type === ALERT_KIND.IMPORTANT ? "Teste — alerta importante" : "Teste — alerta informativo",
    body: type === ALERT_KIND.IMPORTANT
      ? `${first}, este é um teste da Central de Alertas. O CRM fica bloqueado até você clicar em "Entendi".`
      : `${first}, este é um aviso de teste. Ele some sozinho em alguns segundos.`,
    context: { test: true },
    dedupe_key: `test:${type}:${Date.now()}`
  }]);
  return created || null;
}
