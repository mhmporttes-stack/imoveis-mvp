import "server-only";
import { getSupabaseAdminClient } from "./supabase";

// Código curto → ref longo de atribuição (admin_users.short_ref → simulation_ref / captacao_ref). Sem correspondência
// (ou sem banco), devolve o próprio valor — assim os links antigos /s/{ref-longo} e ?ref={ref-longo} continuam iguais.
export async function resolveShortRef(code, type = "simulation") {
  const clean = String(code || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!clean) return "";
  try {
    const supabase = getSupabaseAdminClient();
    const { data } = await supabase.from("admin_users").select("simulation_ref, captacao_ref").eq("short_ref", clean).maybeSingle();
    const resolved = type === "captacao" ? data?.captacao_ref : data?.simulation_ref;
    return resolved || clean;
  } catch {
    return clean;
  }
}
