import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { SPONSORED_ORIGIN_FILTER } from "./simulation-list-query";
import { buildSponsoredCostIndex } from "./sponsored-cost-core.mjs";

// Índice de custo de patrocinado (pedido do dono, 2026-10-08): origens PAGAS de todos os clientes + gasto por anúncio da Meta
// (tabela meta_ad_insights, nível "ad"). Poucas centenas de linhas; fica em memória por 60 s para não pesar a lista de
// Clientes. Só é usado para o ADMINISTRADOR (custo de anúncio não aparece para corretor/gestor). Regra em sponsored-cost-core.mjs.
const TTL_MS = 60 * 1000;
const PAGE = 1000;
let cached = null;

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function getSponsoredCostIndex() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.index;
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  const [origins, insights] = await Promise.all([
    fetchAll((from, to) => supabase
      .from("client_origins")
      .select("client_id, source_metadata, created_at")
      .or(SPONSORED_ORIGIN_FILTER)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)),
    fetchAll((from, to) => supabase
      .from("meta_ad_insights")
      .select("entity_id, spend")
      .eq("entity_type", "ad")
      .order("entity_id", { ascending: true })
      .order("date", { ascending: true })
      .range(from, to))
  ]);
  const index = buildSponsoredCostIndex({ origins, insights });
  cached = { at: Date.now(), index };
  return index;
}
