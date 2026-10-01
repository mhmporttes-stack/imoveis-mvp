import "server-only";
import { getSupabaseAdminClient } from "../supabase";

// Histórico diário de métricas (tabela crm_metric_snapshots). Idempotente:
// reexecutar o mesmo dia atualiza as mesmas linhas (chave única).
const TABLE = "crm_metric_snapshots";
export const DEFINITION_VERSION = 1;

export async function upsertSnapshots(rows, source = "cron") {
  const supabase = getSupabaseAdminClient();
  if (!supabase || !rows.length) return { written: 0 };
  const capturedAt = new Date().toISOString();
  const payload = rows.map((row) => ({
    snapshot_date: row.date,
    metric_key: row.metric,
    dimension_type: row.dimensionType || "team",
    dimension_key: row.dimensionKey || "all",
    value_num: row.valueNum ?? null,
    value_json: row.valueJson ?? null,
    definition_version: row.definitionVersion || DEFINITION_VERSION,
    source,
    captured_at: capturedAt
  }));
  let written = 0;
  for (let index = 0; index < payload.length; index += 200) {
    const chunk = payload.slice(index, index + 200);
    const { error } = await supabase.from(TABLE).upsert(chunk, { onConflict: "snapshot_date,metric_key,dimension_type,dimension_key" });
    if (error) throw error;
    written += chunk.length;
  }
  return { written };
}

export async function readSnapshots({ date, metric, dimensionType = null }) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];
  let query = supabase
    .from(TABLE)
    .select("dimension_type, dimension_key, value_num, value_json, captured_at")
    .eq("snapshot_date", date)
    .eq("metric_key", metric);
  if (dimensionType) query = query.eq("dimension_type", dimensionType);
  const { data, error } = await query;
  if (error) return [];
  return data || [];
}
