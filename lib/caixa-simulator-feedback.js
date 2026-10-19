import "server-only";
import { getSupabaseAdminClient } from "./supabase";

// Votos do "Simulador Caixa" (dono, 2026-10-19). Tabela `caixa_simulator_feedback` (migration 20261019230000); sem
// ela, o voto não é gravado e a tela avisa.
export const CAIXA_FEEDBACK_SCHEMA_MESSAGE = "O registro dos votos ainda não está ativado no banco (migration 20261019230000).";

export function isCaixaFeedbackSchemaMissing(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || (/caixa_simulator_feedback/.test(String(error?.message || "")) && /does not exist|schema cache/.test(String(error?.message || "")));
}

export async function saveCaixaSimulatorFeedback({ vote, inputs, outputs, caixaValues, version, auth }) {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  const { data, error } = await client.from("caixa_simulator_feedback").insert({
    vote,
    inputs,
    outputs,
    caixa_values: caixaValues || null,
    estimate_version: version || null,
    created_by_user_id: auth?.profile?.id || null,
    created_by_email: auth?.user?.email || null
  }).select("id").single();
  if (isCaixaFeedbackSchemaMissing(error)) return { saved: false, schemaReady: false };
  if (error) throw error;
  return { saved: true, schemaReady: true, id: data?.id || null };
}

/** Valores da Caixa informados DEPOIS do 👎 (opcional): só no voto "down" do próprio autor. */
export async function updateCaixaSimulatorFeedbackValues({ id, caixaValues, auth }) {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  const userId = auth?.profile?.id;
  if (!id || !userId) return { saved: false, schemaReady: true };
  const { data, error } = await client
    .from("caixa_simulator_feedback")
    .update({ caixa_values: caixaValues })
    .eq("id", id)
    .eq("vote", "down")
    .eq("created_by_user_id", userId)
    .select("id");
  if (isCaixaFeedbackSchemaMissing(error)) return { saved: false, schemaReady: false };
  if (error) throw error;
  return { saved: Array.isArray(data) && data.length > 0, schemaReady: true };
}
