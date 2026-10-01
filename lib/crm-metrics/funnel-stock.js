import "server-only";
import { getSupabaseAdminClient } from "../supabase";
import { CLIENT_STATUS_FILTER_GROUPS, normalizeClientStatus } from "../client-status";
import { aggregateStatusCounts } from "./status-counts-core.mjs";

// Fotografia do funil AGORA: clientes por status e por grupo da tela
// Clientes. Preferência pela função de banco crm_status_counts() (1 consulta
// agrupada); se ela ainda não existir, lê só a coluna status (mesmo padrão de
// getSimulationClientCounters). As regras de etapa/grupo continuam em
// lib/client-status.js — aqui só se conta.
async function fetchRawStatusRows(supabase) {
  const rpc = await supabase.rpc("crm_status_counts");
  if (!rpc.error && Array.isArray(rpc.data)) return rpc.data;

  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("simulation_registrations").select("status").order("id", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []).map((row) => ({ status: row.status, total: 1 })));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function fetchStatusCounts() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Banco indisponível.");
  const rows = await fetchRawStatusRows(supabase);
  return aggregateStatusCounts(rows, normalizeClientStatus, CLIENT_STATUS_FILTER_GROUPS);
}
