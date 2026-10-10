import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabase";

export function canManageEmpreendimentoRegras() {
  return hasSupabaseAdminConfig;
}

export async function getEmpreendimentoRegras(propertyId) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("empreendimentos")
    .select("*")
    .eq("id", propertyId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function upsertEmpreendimentoRegras({ id, nome, ativo, regras, updatedByEmail }) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo nao configurado.");

  const { data, error } = await supabase
    .from("empreendimentos")
    .upsert(
      {
        id,
        nome,
        ativo,
        regras,
        atualizado_por: updatedByEmail || null
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
