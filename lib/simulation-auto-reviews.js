import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { AUTO_REVIEW_STATUS, buildCorrectedSnapshot } from "./simulation-auto-review-core.mjs";

// Gravação da conferência da simulação automática (SIM-AUTO, dono 2026-10-19; regras em
// lib/simulation-auto-review-core.mjs). Tabela `simulation_auto_reviews` (migration 20261019190000). Sem a tabela no
// banco, o cadastro e a simulação seguem normalmente: só a conferência não é gravada (aviso no log; os botões
// respondem que a conferência ainda não está ativada).
const TABLE = "simulation_auto_reviews";
export const AUTO_REVIEW_SCHEMA_MESSAGE = "A conferência da simulação automática ainda não está ativada no banco (migration 20261019190000).";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export function isAutoReviewSchemaMissing(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || /simulation_auto_reviews/.test(String(error?.message || "")) && /does not exist|schema cache/.test(String(error?.message || ""));
}

/** Guarda o retrato do que o site calculou. Reenvio do formulário antes da conferência troca o retrato (ainda é o
 * automático vigente); depois de conferido, nunca mais é tocado. `newRound` ("Refazer simulação automática"): a
 * conferência aberta vira histórico (`superseded`) e entra uma linha nova — nada é apagado. Devolve false quando a
 * tabela não existe. */
export async function saveAutoSnapshot({ registrationId, simulationId, snapshot, newRound = false }) {
  const { data: rows, error } = await db().from(TABLE).select("id, review_status").eq("simulation_id", simulationId)
    .in("review_status", [AUTO_REVIEW_STATUS.PENDING, AUTO_REVIEW_STATUS.CORRECTING]).order("created_at", { ascending: false }).limit(1);
  if (isAutoReviewSchemaMissing(error)) { console.warn(AUTO_REVIEW_SCHEMA_MESSAGE); return false; }
  if (error) throw error;
  const open = rows?.[0] || null;
  const insert = () => db().from(TABLE).insert({ registration_id: registrationId, simulation_id: simulationId, auto_snapshot: snapshot, estimate_version: snapshot.version });
  if (open && !newRound) {
    const { error: updateError } = await db().from(TABLE).update({ auto_snapshot: snapshot, estimate_version: snapshot.version, updated_at: new Date().toISOString() })
      .eq("id", open.id).eq("review_status", AUTO_REVIEW_STATUS.PENDING);
    if (updateError) throw updateError;
    return true;
  }
  if (open) {
    const { error: supersedeError } = await db().from(TABLE).update({ review_status: AUTO_REVIEW_STATUS.SUPERSEDED, updated_at: new Date().toISOString() }).eq("id", open.id);
    if (supersedeError?.code === "23514") {
      // Banco sem a migration 20261019200000 (histórico): mantém a conferência aberta com o retrato novo.
      console.warn("Histórico da conferência precisa da migration 20261019200000; retrato atualizado no lugar.");
      const { error: updateError } = await db().from(TABLE).update({ auto_snapshot: snapshot, estimate_version: snapshot.version, review_status: AUTO_REVIEW_STATUS.PENDING, updated_at: new Date().toISOString() }).eq("id", open.id);
      if (updateError) throw updateError;
      return true;
    }
    if (supersedeError) throw supersedeError;
  }
  const { error: insertError } = await insert();
  if (insertError?.code === "23505") {
    console.warn("Conferência nova não gravada: a migration 20261019200000 (várias conferências por simulação) ainda não foi aplicada.");
    return false;
  }
  if (insertError) throw insertError;
  return true;
}

function reviewer(auth) {
  return { reviewed_by_user_id: auth?.profile?.id || null, reviewed_by_email: auth?.user?.email || null, reviewed_at: new Date().toISOString() };
}

/** "Simulação OK" ou início do "Corrigir simulação" (com a renda usada na Caixa). Só conferência ainda aberta. */
export async function markAutoReview({ simulationId, status, caixaIncome = null, auth }) {
  const patch = { review_status: status, ...reviewer(auth), updated_at: new Date().toISOString() };
  if (caixaIncome !== null) patch.caixa_income = caixaIncome;
  const { data, error } = await db().from(TABLE).update(patch).eq("simulation_id", simulationId)
    .in("review_status", [AUTO_REVIEW_STATUS.PENDING, AUTO_REVIEW_STATUS.CORRECTING]).select("id").maybeSingle();
  if (isAutoReviewSchemaMissing(error)) return { schemaReady: false };
  if (error) throw error;
  return { schemaReady: true, updated: Boolean(data) };
}

/** O corretor salvou no Gerador a simulação que era automática: guarda os valores da Caixa (sem tocar no retrato). */
export async function recordAutoSimulationCorrection({ simulation, userEmail = "", userId = "" }) {
  if (!simulation?.id) return;
  const { data: rows, error } = await db().from(TABLE).select("id, review_status, caixa_income, reviewed_by_email").eq("simulation_id", simulation.id)
    .in("review_status", [AUTO_REVIEW_STATUS.PENDING, AUTO_REVIEW_STATUS.CORRECTING]).order("created_at", { ascending: false }).limit(1);
  if (isAutoReviewSchemaMissing(error)) return;
  if (error) throw error;
  const row = rows?.[0] || null;
  if (!row || ![AUTO_REVIEW_STATUS.PENDING, AUTO_REVIEW_STATUS.CORRECTING].includes(row.review_status)) return;
  const now = new Date().toISOString();
  const { error: updateError } = await db().from(TABLE).update({
    review_status: AUTO_REVIEW_STATUS.CORRECTED,
    corrected_snapshot: buildCorrectedSnapshot(simulation, { caixaIncome: row.caixa_income }),
    corrected_at: now,
    updated_at: now,
    ...(row.reviewed_by_email ? {} : { reviewed_by_email: userEmail || null, reviewed_by_user_id: userId || null, reviewed_at: now })
  }).eq("id", row.id);
  if (updateError) throw updateError;
}
