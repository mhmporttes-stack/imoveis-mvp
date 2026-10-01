import "server-only";
import { getSupabaseAdminClient } from "../supabase";
import { normalizeClientStatus } from "../client-status";
import { readCache } from "./cache";
import { aggregateBrokerStatus } from "./broker-stock-core.mjs";

// Estoque de clientes POR CORRETOR (status atual), em UMA consulta agrupada
// (RPC crm_status_counts_by_broker). A regra de etapas continua em
// lib/client-status.js / providers/funil.js; aqui só se conta e se guarda.
export const BROKER_STOCK_CACHE_KEY = "funil:corretores";
export const BROKER_STOCK_VALID_MINUTES = 15;

export async function computeBrokerStock() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Banco indisponível.");
  const { data, error } = await supabase.rpc("crm_status_counts_by_broker");
  if (error) throw error;
  return { ...aggregateBrokerStatus(data || [], normalizeClientStatus), capturedAt: new Date().toISOString() };
}

export async function readBrokerStock() {
  const entry = await readCache(BROKER_STOCK_CACHE_KEY, BROKER_STOCK_VALID_MINUTES);
  if (!entry?.payload?.byBroker) return null;
  return { payload: entry.payload, staleMinutes: entry.fresh ? 0 : entry.ageMinutes || 0 };
}
