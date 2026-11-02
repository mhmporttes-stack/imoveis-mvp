import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { createAlertDeliveries } from "./crm-alerts";
import { LEASE_SERVICE_ID } from "./whatsapp-service-lease-core.mjs";
import { STALL_LINK, resolveServiceStallRecipients, stallDedupeKey } from "./whatsapp-service-stall-core.mjs";
import {
  CACHE_DOWN_MS, CACHE_UP_MS, HEALTH_TIMEOUT_MS, SEND_FAIL_WINDOW_MS, SERVICE_HEALTH_SETTING_ID,
  buildEpisodeNotice, evaluateServiceHealth, isHealthResponseOk, shouldPersistHealth, toPersistedHealth
} from "./whatsapp-service-health-core.mjs";

// Leitura/gravação da detecção ÚNICA do serviço do WhatsApp fora do ar (WA-13d). Regras em
// lib/whatsapp-service-health-core.mjs. Estado do episódio em crm_settings (sem migration), gravado só quando muda
// (queda, volta, contagem de falhas do /health). Aviso ao dono pela Central de Alertas (informativo, sem OK).

let memo = { at: 0, value: null };

async function pingServiceHealth() {
  const base = String(process.env.WHATSAPP_INDIVIDUAL_SERVICE_URL || "").replace(/\/+$/, "");
  if (!base) return null; // serviço não configurado neste ambiente: sem /health, sem sinal
  try {
    const response = await fetch(`${base}/health`, { cache: "no-store", signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response.ok) return false;
    return isHealthResponseOk(await response.json().catch(() => null));
  } catch {
    return false;
  }
}

async function notifyEpisode(db, transition, reasons) {
  const leaseKey = transition.type === "down" && reasons.includes("lease") ? stallDedupeKey(transition.since) : null;
  const notice = buildEpisodeNotice(transition, { leaseEpisodeKey: leaseKey });
  if (!notice) return;
  const { data: users, error } = await db.from("admin_users").select("id, role, status, disabled_at");
  if (error) throw error;
  const deliveries = resolveServiceStallRecipients(users || []).map((recipientId) => ({
    definition_id: null,
    recipient_id: recipientId,
    kind: "informative",
    title: notice.title,
    body: notice.body,
    context: { source: notice.source, since: transition.since, link: STALL_LINK },
    dedupe_key: notice.dedupeKey
  }));
  if (deliveries.length) await createAlertDeliveries(deliveries);
}

async function computeHealth() {
  const db = getSupabaseAdminClient();
  if (!db) return { down: false, since: null, reasons: [] };
  const now = Date.now();
  const failuresSince = new Date(now - SEND_FAIL_WINDOW_MS).toISOString();
  const [leaseResult, prevResult, failuresResult, ping] = await Promise.all([
    db.from("whatsapp_service_lease").select("heartbeat_at").eq("id", LEASE_SERVICE_ID).maybeSingle(),
    db.from("crm_settings").select("setting_value").eq("id", SERVICE_HEALTH_SETTING_ID).maybeSingle(),
    db.from("whatsapp_messages").select("failed_at, error_message").eq("status", "failed").gte("failed_at", failuresSince).order("failed_at", { ascending: false }).limit(50),
    pingServiceHealth()
  ]);
  // Sem a tabela do lease (migration não aplicada) ou sem linha: o lease simplesmente não conta como sinal.
  const lease = leaseResult.error ? null : leaseResult.data;
  const prev = prevResult.error ? null : prevResult.data?.setting_value || null;
  const failureRows = failuresResult.error ? [] : failuresResult.data || [];
  const next = evaluateServiceHealth({ prev, now, lease, ping, failureRows });
  if (shouldPersistHealth(prev, next)) {
    const { error } = await db.from("crm_settings").upsert({ id: SERVICE_HEALTH_SETTING_ID, setting_value: toPersistedHealth(next), updated_at: new Date(now).toISOString() }, { onConflict: "id" });
    if (error) console.error("Falha ao gravar o estado do serviço do WhatsApp:", error.message);
  }
  if (next.transition) {
    await notifyEpisode(db, next.transition, next.reasons).catch((error) => console.error("Falha ao avisar o dono sobre o serviço do WhatsApp:", error?.message || error));
  }
  return { down: next.down, since: next.since, reasons: next.reasons };
}

// -> { down, since, reasons }. Cache de 60 s (30 s fora do ar) por instância; `force` (cron) ignora o cache. Falha de leitura
// mantém o último estado conhecido (nunca derruba a tela) e fica registrada no log.
export async function getWhatsappServiceHealth({ force = false } = {}) {
  const ttl = memo.value?.down ? CACHE_DOWN_MS : CACHE_UP_MS;
  if (!force && memo.value && Date.now() - memo.at < ttl) return memo.value;
  try {
    const value = await computeHealth();
    memo = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.error("Falha ao conferir o serviço do WhatsApp:", error?.message || error);
    return memo.value || { down: false, since: null, reasons: [] };
  }
}

export async function isWhatsappServiceDown() {
  return (await getWhatsappServiceHealth()).down === true;
}

// Último estado conhecido nesta instância, sem consulta (usado só para não repetir aviso durante um episódio já aberto).
export function peekWhatsappServiceDown() {
  return memo.value?.down === true;
}
