import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import {
  benefitToRecord,
  rowToBenefit,
  rowToSimulation,
  rowToSimulationProperty,
  simulationPropertyToRecord,
  simulationToRecord
} from "./simulation-mapper";

export function canManageSimulations() {
  return hasSupabaseAdminConfig;
}

export async function listSimulations() {
  const supabase = getSimulationClient();
  const { data, error } = await supabase
    .from("simulations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data.map((row) => rowToSimulation(row));
}

export async function getSimulation(id) {
  const supabase = getSimulationClient();
  const { data, error } = await supabase
    .from("simulations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const properties = await listSimulationProperties(id);
  return rowToSimulation(data, properties);
}

export async function createSimulation(payload, userEmail = "") {
  const supabase = getSimulationClient();
  const { data, error } = await supabase
    .from("simulations")
    .insert(simulationToRecord(payload, userEmail))
    .select("*")
    .single();

  if (error) throw error;
  await replaceSimulationProperties(data.id, payload.properties || []);
  return getSimulation(data.id);
}

export async function updateSimulation(id, payload, userEmail = "") {
  const supabase = getSimulationClient();
  const { data, error } = await supabase
    .from("simulations")
    .update(simulationToRecord(payload, userEmail))
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  await replaceSimulationProperties(data.id, payload.properties || []);
  return getSimulation(data.id);
}

export async function deleteSimulation(id) {
  const supabase = getSimulationClient();
  const { error } = await supabase.from("simulations").delete().eq("id", id);
  if (error) throw error;
  return true;
}

export function formatSimulationError(error) {
  const message = error?.message || String(error || "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("schema cache") ||
    normalized.includes("relation") ||
    normalized.includes("simulations")
  ) {
    return "A tabela public.simulations ainda não existe no Supabase. Execute a migration supabase/migrations/20260715_simulations.sql no SQL Editor do Supabase.";
  }

  return message || "Não foi possível carregar as simulações.";
}

async function listSimulationProperties(simulationId) {
  const supabase = getSimulationClient();
  const { data, error } = await supabase
    .from("simulation_properties")
    .select("*")
    .eq("simulation_id", simulationId)
    .order("display_order", { ascending: true });

  if (error) throw error;

  const benefitsByProperty = await listBenefitsByProperty(data.map((item) => item.id));
  return data.map((row) => rowToSimulationProperty(row, benefitsByProperty.get(row.id) || []));
}

async function listBenefitsByProperty(propertyIds) {
  const supabase = getSimulationClient();
  const benefitsByProperty = new Map();
  if (!propertyIds.length) return benefitsByProperty;

  const { data, error } = await supabase
    .from("simulation_property_benefits")
    .select("*")
    .in("simulation_property_id", propertyIds)
    .order("display_order", { ascending: true });

  if (error) throw error;

  for (const row of data) {
    const list = benefitsByProperty.get(row.simulation_property_id) || [];
    list.push(rowToBenefit(row));
    benefitsByProperty.set(row.simulation_property_id, list);
  }

  return benefitsByProperty;
}

async function replaceSimulationProperties(simulationId, properties) {
  const supabase = getSimulationClient();
  const { error: deleteError } = await supabase
    .from("simulation_properties")
    .delete()
    .eq("simulation_id", simulationId);

  if (deleteError) throw deleteError;

  for (const [index, property] of properties.entries()) {
    const { data, error } = await supabase
      .from("simulation_properties")
      .insert(simulationPropertyToRecord(property, simulationId, index))
      .select("*")
      .single();

    if (error) throw error;

    const benefitRecords = (property.benefits || [])
      .map((benefit, benefitIndex) => benefitToRecord(benefit, data.id, benefitIndex))
      .filter((benefit) => benefit.benefit_text);

    if (benefitRecords.length) {
      const { error: benefitsError } = await supabase
        .from("simulation_property_benefits")
        .insert(benefitRecords);
      if (benefitsError) throw benefitsError;
    }
  }
}

function getSimulationClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase administrativo não configurado para gerenciar simulações.");
  }
  return supabase;
}
