import "server-only";
import { createHmac } from "node:crypto";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabase";
import { isGeneralAdminAuth } from "@/lib/admin-profiles";
import { sendPushToUser } from "@/lib/push-subscriptions";
import { NOTIFICATION_KIND } from "@/lib/notification-policy-core.mjs";
import { ALERT_KIND, alertLink, normalizeAlertKind, onlyOwnRows, resolveAudienceRecipients, splitPendingAlerts } from "@/lib/crm-alerts-core.mjs";
import { COOLED_DEDUPE_PREFIX, isCooledDedupeKey, pinCooledHead } from "@/lib/cooled-clients-core.mjs";
import { normalizeSupabaseUrl } from "./supabase-url";

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
  // Só a origem: a variável de produção traz "/rest/v1" e a URL do broadcast saía errada (404, 2026-10-21).
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
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
    .select("id, recipient_id, kind, title, body, context");
  if (error) throw error;
  const created = data || [];
  if (created.length) {
    await broadcastAlertsChanged(created.map((row) => row.recipient_id));
    for (const row of created.filter((item) => item.kind === ALERT_KIND.IMPORTANT)) {
      try {
        // Push só passa pela política de notificações (lib/notification-policy-core.mjs): só o alerta de queda do
        // próprio WhatsApp declara `push_kind` no contexto; todos os demais continuam com o push bloqueado.
        const pushKind = row.context?.push_kind === NOTIFICATION_KIND.WHATSAPP_CONNECTION ? NOTIFICATION_KIND.WHATSAPP_CONNECTION : undefined;
        await sendPushToUser(row.recipient_id, { kind: pushKind, title: row.title, body: row.body, url: alertLink(row.context) || "/admin", tag: `crm-alert:${row.id}` });
      } catch {
        // push é extra; a tela é o canal principal.
      }
    }
  }
  return created;
}

// Encerramento AUTOMÁTICO de alertas pendentes cujo problema deixou de existir (ex.: sessão voltou a
// 'connected'). Não é ciência de ninguém: acknowledged_at é preenchido e acknowledged_by fica NULO (sistema).
// Só mexe em entregas ainda pendentes cuja dedupe_key começa com o prefixo informado.
export async function resolveAlertDeliveriesByPrefix(dedupeKeyPrefix) {
  if (!dedupeKeyPrefix) return 0;
  const { data, error } = await db()
    .from("crm_alert_deliveries")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: null })
    .like("dedupe_key", `${dedupeKeyPrefix}%`)
    .is("acknowledged_at", null)
    .select("id, recipient_id");
  if (error) throw error;
  const closed = data || [];
  if (closed.length) await broadcastAlertsChanged(closed.map((row) => row.recipient_id));
  return closed.length;
}

// Ciência dada pelo SISTEMA em nome do próprio destinatário quando a ação pedida pelo alerta foi feita em outra rota
// (ex.: motivo do cliente que esfriou). Só a entrega daquele destinatário + chave.
export async function acknowledgeAlertByDedupeKey(recipientId, dedupeKey) {
  if (!recipientId || !dedupeKey) return 0;
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("crm_alert_deliveries")
    .update({ acknowledged_at: now, acknowledged_by: recipientId })
    .eq("recipient_id", recipientId)
    .eq("dedupe_key", dedupeKey)
    .is("acknowledged_at", null)
    .select("id");
  if (error) throw error;
  await broadcastAlertsChanged([recipientId]);
  return data?.length || 0;
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
    // A janela do cliente que esfriou (lib/cooled-clients.js) não expira em 7 dias: só sai com o motivo escrito.
    .or(`created_at.gte.${since},dedupe_key.like.${COOLED_DEDUPE_PREFIX}*`)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(50);
  if (error) throw error;
  // Defesa em profundidade: só o que é do próprio destinatário sai daqui, e o
  // id do destinatário não vai para o navegador.
  // Cliente que esfriou: UMA janela por vez (FUN-15e, dono 2026-10-16) — as demais seguem pendentes, na fila. A frente
  // vem de consulta própria e estável (pinCooledHead): fica a MESMA até o motivo ser enviado, em qualquer releitura
  // (foco, tempo real, recarregar, outro aparelho), mesmo com mais pendências que o limite acima.
  const head = await loadFirstPendingCooledAlert(me, "id, kind, title, body, context, created_at, shown_at, acknowledged_at");
  const own = pinCooledHead(onlyOwnRows(data || [], me).map(({ recipient_id: _recipient, ...row }) => row), head);
  // Cliente que esfriou: telefone do cliente na janela do motivo (FUN-15d), respeitando o escopo de quem vê.
  const { attachCooledAlertPhones } = await import("@/lib/cooled-clients");
  const withPhones = await attachCooledAlertPhones(auth, own);
  return { ...splitPendingAlerts(withPhones), topic: getAlertsTopic(me) };
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
  // Cliente que esfriou: "Entendi" não encerra — só o motivo escrito (POST /api/admin/cooled-clients/[id]/reason).
  if (isCooledDedupeKey(row.dedupe_key)) throw new CrmAlertError("Escreva o motivo para continuar.", 409);
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

// Frente da fila do fluxo de clientes que esfriaram: a MESMA para a Central de Alertas e o sino (mais antiga, empate
// pelo id — ordem total, independente do limite das listas). Fica fixa até o motivo ser enviado (FUN-15e).
async function loadFirstPendingCooledAlert(me, columns = "id") {
  const { data, error } = await db()
    .from("crm_alert_deliveries")
    .select(columns)
    .eq("recipient_id", me)
    .is("acknowledged_at", null)
    .like("dedupe_key", `${COOLED_DEDUPE_PREFIX}%`)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Histórico do botão de sino do cabeçalho (2026-10-14): as notificações do PRÓPRIO usuário dos últimos 30 dias, lidas e
// não lidas, mais recentes primeiro. Só o necessário para a tela: nada do contexto interno além do link seguro.
export async function listMyAlertHistory(auth) {
  const me = recipientOf(auth);
  if (!me) return { items: [], pending: 0 };
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from("crm_alert_deliveries")
    .select("id, recipient_id, kind, title, body, context, created_at, acknowledged_at")
    .eq("recipient_id", me)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  // Cliente que esfriou (FUN-15e): no sino também só aparece a janela da frente da fila, a mesma da Central de Alertas.
  const head = await loadFirstPendingCooledAlert(me, "id, kind, title, body, context, created_at, acknowledged_at");
  const alertItems = pinCooledHead(onlyOwnRows(data || [], me), head).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    acknowledged: Boolean(row.acknowledged_at),
    link: alertLink(row.context)
  }));
  // O sino mostra TODAS as notificações do usuário (pedido do dono, 2026-10-16): além dos alertas da Central, as do sino
  // antigo (cliente novo, atividade agendada, clientes transferidos). Melhor esforço: se falhar, só vêm os alertas.
  const notificationItems = await listMyBellNotifications(auth, since);
  const items = [...alertItems, ...notificationItems]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 80);
  return { items, pending: items.filter((item) => !item.acknowledged).length };
}

const NOTIFICATION_TYPE_LABEL = { new_client: "Cliente novo", scheduled_activity: "Atividade agendada", clients_transferred: "Clientes transferidos", official_chat_assigned: "WhatsApp oficial", documents_list_auto: "Lista de documentos" };

// crm_notifications do PRÓPRIO usuário (privadas do destinatário, regra de 2026-10-02) dos últimos 30 dias.
async function listMyBellNotifications(auth, sinceIso) {
  const me = recipientOf(auth); // "Alterar conta": nunca lê as notificações da pessoa emulada
  if (!me) return [];
  try {
    const { data, error } = await db()
      .from("crm_notifications")
      .select("id, client_id, title, description, notification_type, read_at, created_at")
      .eq("recipient_user_id", me)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw error;
    // Aviso da fila de reativação (FUN-15l, dono 2026-10-19): contagem regressiva / "Prazo encerrado".
    const { attachReactivationNoticeStates } = await import("./cooled-clients-reactivation");
    // Só acrescenta o estado do prazo: se a leitura falhar, os avisos aparecem sem ele (erro registrado no log).
    const rows = await attachReactivationNoticeStates(data || [], me).catch((stateError) => {
      console.warn("Avisos: falha ao ler o prazo da fila de reativação:", stateError?.message || stateError);
      return data || [];
    });
    return rows.map((row) => ({
      id: `n-${row.id}`,
      source: "notification",
      notificationId: row.id,
      kind: "informative",
      label: NOTIFICATION_TYPE_LABEL[row.notification_type] || "Aviso",
      title: row.title,
      body: row.description || "",
      createdAt: row.created_at,
      acknowledged: Boolean(row.read_at),
      link: row.client_id ? `/admin/simulacoes?clientId=${row.client_id}` : null,
      ...(row.reactivation ? { reactivation: row.reactivation } : {})
    }));
  } catch (error) {
    console.warn("Sino: falha ao ler as notificações do usuário:", error?.message || error);
    return [];
  }
}
