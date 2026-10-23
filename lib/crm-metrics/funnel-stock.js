import "server-only";
import { getSupabaseAdminClient } from "../supabase";
import { CLIENT_STATUS, CLIENT_STATUS_FILTER_GROUPS, normalizeClientStatus } from "../client-status";
import { applyAllTabExclusions } from "../client-all-tab-core.mjs";
import { loadAllTabExcludedTagClientIds } from "../client-all-tab";
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
  const [rows, allTab] = await Promise.all([fetchRawStatusRows(supabase), countAllTabClients(supabase)]);
  const result = aggregateStatusCounts(rows, normalizeClientStatus, CLIENT_STATUS_FILTER_GROUPS);
  result.byGroup.all = allTab;
  return result;
}

// Grupo "all" = o contador da aba Todos da tela Clientes na visão do admin geral (getSimulationClientCounters): sem
// Particular, sem Pago e sem status/etiquetas negativos (CLI-12a, regra do dono 2026-10-23) — para não divergirem.
async function countAllTabClients(supabase) {
  let query = supabase.from("simulation_registrations").select("id", { count: "exact", head: true }).is("private_contact_at", null);
  query = applyAllTabExclusions(query, { tagClientIds: await loadAllTabExcludedTagClientIds(supabase) });
  const { count, error } = await query.neq("status", CLIENT_STATUS.SALE_PAID);
  if (error) throw error;
  return count || 0;
}
