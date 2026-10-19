import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { scenarioValuesKey } from "./simulation-scenarios-core.mjs";

// Histórico de cenários (aba "Comparar simulações", dono 2026-10-19). Tabela `simulation_scenarios` (migration
// 20261019210000). Sem a tabela: nada é gravado (aviso no log) e a aba mostra só a simulação atual. Nunca apaga cenário.
const TABLE = "simulation_scenarios";
export const SCENARIOS_SCHEMA_MESSAGE = "O histórico de cenários ainda não está ativado no banco (migration 20261019210000).";

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

export function isScenarioSchemaMissing(error) {
  return error?.code === "42P01" || error?.code === "PGRST205" || (/simulation_scenarios/.test(String(error?.message || "")) && /does not exist|schema cache/.test(String(error?.message || "")));
}

async function latestScenario(registrationId) {
  const { data, error } = await db().from(TABLE).select("id, values_key, checked_by_caixa, simulation_id, origin, created_by_email, created_at").eq("registration_id", registrationId)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

/**
 * Grava um cenário. `dedupe`: não grava se for igual (mesmos valores) ao último cenário do cliente — salvamento do
 * corretor sem mudança. Devolve "missing_schema" | "duplicate" | "saved". Nunca derruba quem chamou.
 */
// `mergeWindowMinutes`: edição contínua do corretor (autosave a cada digitação, sem botão Salvar) vira UM cenário —
// se o último cenário é do mesmo corretor, da mesma simulação, origem "corretor" e mais novo que a janela, ele é
// atualizado em vez de criar outro.
export async function recordScenario({ registrationId, simulationId, origin, checked = false, data, actor = {}, dedupe = false, mergeWindowMinutes = 0 }) {
  if (!registrationId || !data) return "skipped";
  try {
    const valuesKey = scenarioValuesKey(data);
    if (dedupe || mergeWindowMinutes > 0) {
      const last = await latestScenario(registrationId);
      if (last?.values_key === valuesKey) return "duplicate";
      const recent = last && Date.now() - Date.parse(last.created_at) < mergeWindowMinutes * 60000;
      if (recent && last.origin === origin && last.simulation_id === (simulationId || null) && (last.created_by_email || "") === (actor.email || "")) {
        const { error: mergeError } = await db().from(TABLE).update({ data, values_key: valuesKey }).eq("id", last.id);
        if (mergeError) throw mergeError;
        return "merged";
      }
    }
    const { error } = await db().from(TABLE).insert({
      registration_id: registrationId,
      simulation_id: simulationId || null,
      origin,
      checked_by_caixa: Boolean(checked),
      checked_at: checked ? new Date().toISOString() : null,
      data,
      values_key: valuesKey,
      created_by_email: actor.email || null,
      created_by_user_id: actor.userId || null
    });
    if (isScenarioSchemaMissing(error)) { console.warn(SCENARIOS_SCHEMA_MESSAGE); return "missing_schema"; }
    if (error) throw error;
    return "saved";
  } catch (error) {
    if (isScenarioSchemaMissing(error)) { console.warn(SCENARIOS_SCHEMA_MESSAGE); return "missing_schema"; }
    console.warn("Falha ao gravar cenário de simulação:", error?.message || error);
    return "failed";
  }
}

/** "Simulação OK": o último cenário do cliente com os MESMOS valores passa a "Conferida na Caixa". Senão grava um novo. */
export async function markScenarioChecked({ registrationId, simulationId, data, actor = {}, origin = "correcao_caixa" }) {
  try {
    const last = await latestScenario(registrationId);
    if (last && last.values_key === scenarioValuesKey(data)) {
      if (last.checked_by_caixa) return "already";
      const { error } = await db().from(TABLE).update({ checked_by_caixa: true, checked_at: new Date().toISOString() }).eq("id", last.id);
      if (error) throw error;
      return "checked";
    }
  } catch (error) {
    if (isScenarioSchemaMissing(error)) { console.warn(SCENARIOS_SCHEMA_MESSAGE); return "missing_schema"; }
    console.warn("Falha ao marcar cenário conferido:", error?.message || error);
    return "failed";
  }
  return recordScenario({ registrationId, simulationId, origin, checked: true, data, actor });
}

/** Cenários do cliente (mais recente primeiro). `schemaReady: false` quando a tabela não existe. */
export async function listScenarios(registrationId) {
  const { data, error } = await db().from(TABLE)
    .select("id, simulation_id, origin, checked_by_caixa, checked_at, data, created_by_email, created_at")
    .eq("registration_id", registrationId).order("created_at", { ascending: false }).limit(50);
  if (isScenarioSchemaMissing(error)) return { schemaReady: false, items: [] };
  if (error) throw error;
  return {
    schemaReady: true,
    items: (data || []).map((row) => ({
      id: row.id, simulationId: row.simulation_id, origin: row.origin, checked: row.checked_by_caixa, checkedAt: row.checked_at,
      data: row.data, createdByEmail: row.created_by_email, createdAt: row.created_at
    }))
  };
}

export async function getScenario(registrationId, scenarioId) {
  const { data, error } = await db().from(TABLE).select("id, origin, checked_by_caixa, data").eq("id", scenarioId).eq("registration_id", registrationId).maybeSingle();
  if (isScenarioSchemaMissing(error)) return { schemaReady: false, scenario: null };
  if (error) throw error;
  return { schemaReady: true, scenario: data ? { id: data.id, origin: data.origin, checked: data.checked_by_caixa, data: data.data } : null };
}
