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

/**
 * Empreendimentos ativos com regras de entrada configuradas, prontos para
 * `simularEntrada` — usado pelo Gerador de Simulações.
 */
export async function listActiveEmpreendimentosComRegras() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("empreendimentos")
    .select("id, nome, regras")
    .eq("ativo", true);

  if (error) throw error;
  return (data || []).map((row) => row.regras);
}
