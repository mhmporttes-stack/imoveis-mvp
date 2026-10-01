import "server-only";
import { getSupabaseAdminClient } from "../supabase";
import { cacheFreshness } from "./status-counts-core.mjs";

// Cache de métricas pesadas (tabela crm_metric_cache). Se a tabela ainda não
// existir (migration pendente) ou o banco falhar, as funções devolvem null/
// false — quem chama decide o fallback. Nunca lançam erro para a voz.
const TABLE = "crm_metric_cache";

export async function readCache(key, validMinutes) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from(TABLE).select("payload, computed_at, status, compute_ms").eq("cache_key", key).maybeSingle();
  if (error || !data) return null;
  const { fresh, ageMinutes } = cacheFreshness(data.computed_at, validMinutes);
  return { payload: data.payload, computedAt: data.computed_at, status: data.status, computeMs: data.compute_ms, fresh, ageMinutes };
}

export async function writeCache(key, payload, { computeMs = null, status = "ok", errorCode = null } = {}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return false;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from(TABLE)
    .upsert({ cache_key: key, payload, computed_at: now, compute_ms: computeMs, status, error_code: errorCode, updated_at: now }, { onConflict: "cache_key" });
  return !error;
}

// Marca falha sem apagar o último valor bom (a voz continua lendo o antigo).
export async function markCacheError(key, errorCode) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return false;
  const { error } = await supabase
    .from(TABLE)
    .update({ status: "error", error_code: String(errorCode || "erro").slice(0, 60), updated_at: new Date().toISOString() })
    .eq("cache_key", key);
  return !error;
}

// Trava simples entre execuções do job (evita dois ciclos pesados juntos).
export async function acquireLock(name, seconds = 120) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return false;
  const key = `lock:${name}`;
  await supabase.from(TABLE).upsert({ cache_key: key, payload: {}, valid_until: new Date(0).toISOString() }, { onConflict: "cache_key", ignoreDuplicates: true });
  const now = new Date();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ valid_until: new Date(now.getTime() + seconds * 1000).toISOString(), updated_at: now.toISOString() })
    .eq("cache_key", key)
    .or(`valid_until.is.null,valid_until.lt.${now.toISOString()}`)
    .select("cache_key");
  return !error && Boolean(data?.length);
}

export async function releaseLock(name) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;
  await supabase.from(TABLE).update({ valid_until: new Date(0).toISOString() }).eq("cache_key", `lock:${name}`);
}
