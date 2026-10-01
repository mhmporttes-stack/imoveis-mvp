import "server-only";
import { getSupabaseAdminClient } from "../../supabase";
import { getUnattendedClientIds } from "../../simulation-list-query";
import { getOwnerAuth } from "../../crm-metrics/owner-auth";
import { firstNameOf } from "../text.mjs";

// Atendimento: "sem atendimento humano" usa a MESMA função do filtro da tela
// Clientes (getUnattendedClientIds, visão do dono); a fila da roleta é a
// contagem de clientes aguardando distribuição (pending_distribution_at).
export async function atendimentoProvider(q) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Banco indisponível.");

  if (q.topic === "fila_roleta") {
    const { count, error } = await supabase.from("simulation_registrations").select("id", { count: "exact", head: true }).not("pending_distribution_at", "is", null);
    if (error) throw error;
    return { count: count || 0 };
  }

  const auth = await getOwnerAuth();
  const ids = await getUnattendedClientIds(auth);
  if (q.kind !== "list") return { count: ids.length };
  if (!ids.length) return { count: 0, items: [] };

  const { data, error } = await supabase
    .from("simulation_registrations")
    .select("full_name")
    .in("id", ids.slice(0, 150))
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  return { count: ids.length, items: (data || []).map((row) => ({ name: firstNameOf(row.full_name) })).filter((item) => item.name) };
}
