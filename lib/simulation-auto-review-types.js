import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { AUTO_REVIEW_STATUS, buildCorrectedSnapshot } from "./simulation-auto-review-core.mjs";
import { caixaIncomeFromTypeReviews, finalReviewStatus, typeReviewsFromRow } from "./simulation-auto-review-types-core.mjs";
import { isAutoReviewSchemaMissing } from "./simulation-auto-reviews";

// Conferência por tipo (👍/👎 sob o novo e o usado — dono, 2026-10-19; regras em lib/simulation-auto-review-types-core.mjs).
// Tabela `simulation_auto_reviews` (sem coluna nova: as marcas ficam em `corrected_snapshot.typeReviews`).
const TABLE = "simulation_auto_reviews";
const OPEN = [AUTO_REVIEW_STATUS.PENDING, AUTO_REVIEW_STATUS.CORRECTING];

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

/** Conferência aberta da simulação: { schemaReady, row, typeReviews }. */
export async function getOpenAutoReview(simulationId) {
  const { data, error } = await db().from(TABLE).select("id, review_status, corrected_snapshot").eq("simulation_id", simulationId)
    .in("review_status", OPEN).order("created_at", { ascending: false }).limit(1);
  if (isAutoReviewSchemaMissing(error)) return { schemaReady: false, row: null, typeReviews: {} };
  if (error) throw error;
  const row = data?.[0] || null;
  return { schemaReady: true, row, typeReviews: typeReviewsFromRow(row) };
}

/**
 * Conferência aberta, criando uma quando a simulação automática não tem nenhuma (simulação anterior à tabela, retrato não
 * gravado): o voto NUNCA se perde sem aviso. Se já existe uma FECHADA e o banco não aceita outra linha (sem a migration
 * 20261019200000), devolve `row: null` — a rota recusa com mensagem clara.
 */
export async function ensureOpenAutoReview(simulation) {
  const open = await getOpenAutoReview(simulation.id);
  if (!open.schemaReady || open.row) return open;
  const { data, error } = await db().from(TABLE).insert({
    registration_id: simulation.registrationId || null,
    simulation_id: simulation.id,
    auto_snapshot: { version: "", origin: "sem_retrato", note: "Conferência criada no voto (a simulação não tinha retrato gravado)." },
    estimate_version: null
  }).select("id, review_status, corrected_snapshot").single();
  if (error?.code === "23505") return { schemaReady: true, row: null, typeReviews: {} };
  if (isAutoReviewSchemaMissing(error)) return { schemaReady: false, row: null, typeReviews: {} };
  if (error) throw error;
  return { schemaReady: true, row: data, typeReviews: {} };
}

/** Grava as marcas por tipo enquanto ainda falta conferir algum tipo. */
export async function saveTypeReviews({ rowId, typeReviews }) {
  const anyCorrection = finalReviewStatus(typeReviews) === "corrected";
  const { data, error } = await db().from(TABLE).update({
    corrected_snapshot: { typeReviews },
    review_status: anyCorrection ? AUTO_REVIEW_STATUS.CORRECTING : AUTO_REVIEW_STATUS.PENDING,
    updated_at: new Date().toISOString()
  }).eq("id", rowId).in("review_status", OPEN).select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/** Fecha a conferência (todos os tipos conferidos): OK ou corrigida, com os valores da Caixa + as marcas por tipo. */
export async function closeAutoReview({ rowId, simulation, typeReviews, auth }) {
  const status = finalReviewStatus(typeReviews) === "corrected" ? AUTO_REVIEW_STATUS.CORRECTED : AUTO_REVIEW_STATUS.OK;
  const caixaIncome = caixaIncomeFromTypeReviews(typeReviews);
  const now = new Date().toISOString();
  const { data, error } = await db().from(TABLE).update({
    review_status: status,
    caixa_income: caixaIncome,
    corrected_snapshot: status === AUTO_REVIEW_STATUS.CORRECTED
      ? { ...buildCorrectedSnapshot(simulation, { caixaIncome }), typeReviews }
      : { typeReviews },
    ...(status === AUTO_REVIEW_STATUS.CORRECTED ? { corrected_at: now } : {}),
    reviewed_by_user_id: auth?.profile?.id || null,
    reviewed_by_email: auth?.user?.email || null,
    reviewed_at: now,
    updated_at: now
  }).eq("id", rowId).in("review_status", OPEN).select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}
