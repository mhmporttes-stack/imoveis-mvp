import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { assertGeneralAdmin } from "./admin-access";

function db() {
  return getSupabaseAdminClient();
}

// Chamado pelo caller logo após analyzeClientDocumentBatch (sucesso ou
// falha) — nunca lança: um erro ao gravar o log de gasto nunca pode derrubar
// a análise em si.
export async function recordAiUsage({ feature = "client_document_analysis", model, batchId, clientId, triggeredBy, inputTokens = 0, outputTokens = 0, costUsd = 0, success = true, errorMessage = null }) {
  try {
    await db().from("ai_usage_log").insert({
      feature,
      model: model || "unknown",
      batch_id: batchId || null,
      client_id: clientId || null,
      triggered_by: triggeredBy || null,
      input_tokens: Math.max(0, Math.round(inputTokens)),
      output_tokens: Math.max(0, Math.round(outputTokens)),
      estimated_cost_usd: Number(costUsd) || 0,
      success: Boolean(success),
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null
    });
  } catch (logError) {
    console.warn("Falha ao registrar gasto de IA:", logError?.message || logError);
  }
}

// Extrato completo (admin geral apenas — mesmo padrão de acesso do
// Financeiro): traz cada chamada com o nome do cliente/corretor já
// resolvidos, para a tela nunca precisar de outra consulta.
export async function getAiUsageReport(auth) {
  assertGeneralAdmin(auth);

  const { data: rows, error } = await db()
    .from("ai_usage_log")
    .select("id, feature, model, batch_id, client_id, triggered_by, input_tokens, output_tokens, estimated_cost_usd, success, error_message, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;

  const clientIds = Array.from(new Set((rows || []).map((row) => row.client_id).filter(Boolean)));
  const brokerIds = Array.from(new Set((rows || []).map((row) => row.triggered_by).filter(Boolean)));

  const [{ data: clients }, { data: brokers }] = await Promise.all([
    clientIds.length ? db().from("simulation_registrations").select("id, full_name").in("id", clientIds) : Promise.resolve({ data: [] }),
    brokerIds.length ? db().from("admin_users").select("id, name").in("id", brokerIds) : Promise.resolve({ data: [] })
  ]);
  const clientNameById = new Map((clients || []).map((row) => [row.id, row.full_name]));
  const brokerNameById = new Map((brokers || []).map((row) => [row.id, row.name]));

  const entries = (rows || []).map((row) => ({
    id: row.id,
    feature: row.feature,
    model: row.model,
    batchId: row.batch_id,
    clientName: clientNameById.get(row.client_id) || "",
    brokerName: brokerNameById.get(row.triggered_by) || "",
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: Number(row.estimated_cost_usd) || 0,
    success: row.success,
    errorMessage: row.error_message || "",
    createdAt: row.created_at
  }));

  return { entries };
}
