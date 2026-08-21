import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import {
  benefitToRecord,
  rowToBenefit,
  rowToSimulation,
  rowToSimulationProperty,
  simulationPropertyToRecord,
  simulationToRecord
} from "./simulation-mapper";
import {
  ensureManualSimulationRegistration,
  getSimulationRegistration,
  markRegistrationSimulationCompleted
} from "./simulation-registrations";
import { normalizePersonName } from "./name-utils";
import { simulationModelHasValues } from "./simulation-models";
import { isMissingColumnError } from "./supabase-errors";
import { applyResponsibleUserScope, assertCanAccessResponsibleUser } from "./admin-access";
import { canUseProfileDatabaseScope, isBrokerSchemaError } from "./admin-profiles";

export const SITE_REGISTRATION_SIMULATION_SOURCE = "Cadastro do site";
const CLIENT_WHATSAPP_NOTE_PREFIX = "WhatsApp do cadastro:";

export function canManageSimulations() {
  return hasSupabaseAdminConfig;
}

export async function listSimulations(auth = null) {
  const supabase = getSimulationClient();
  let query = supabase
    .from("simulations")
    .select("*")
    .order("created_at", { ascending: false });

  query = applyResponsibleUserScope(query, auth, "created_by_user_id");

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => rowToSimulation(row));
}

export async function getSimulation(id, auth = null) {
  const supabase = getSimulationClient();
  const { data, error } = await supabase
    .from("simulations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (auth) assertCanAccessResponsibleUser(auth, data.created_by_user_id || "");

  const properties = await listSimulationProperties(id);
  const simulation = rowToSimulation(data, properties);
  if (!simulation.registrationId) return simulation;

  try {
    return {
      ...simulation,
      registration: await getSimulationRegistration(simulation.registrationId, auth)
    };
  } catch {
    return simulation;
  }
}

export async function createSimulation(payload, userEmail = "", auth = null) {
  const supabase = getSimulationClient();
  const payloadWithRegistration = await attachManualRegistration(payload, auth);
  const record = simulationToRecord({
    ...payloadWithRegistration,
    createdByUserId: resolveSimulationOwnerId(payloadWithRegistration, auth)
  }, userEmail);
  let { data, error } = await supabase
    .from("simulations")
    .insert(record)
    .select("*")
    .single();

  if (isMissingColumnError(error, "registration_id")) {
    const fallback = await supabase
      .from("simulations")
      .insert(withoutRegistrationColumn(record))
      .select("*")
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  await replaceSimulationProperties(data.id, payloadWithRegistration.properties || []);
  return getSimulation(data.id, auth);
}

export async function createPendingSimulationFromRegistration(registration) {
  const existing = await findSimulationByRegistration(registration);
  if (existing) return existing;

  return createSimulation(
    {
      registrationId: registration.id,
      registration,
      createdByUserId: registration.responsibleUserId || "",
      clientName: registration.fullName,
      simulationType: "usado",
      financingValue: "",
      subsidyValue: "",
      firstInstallment: "",
      lastInstallment: "",
      downPaymentValue: "",
      fgtsValue: "",
      showExpandedPower: false,
      simulationDate: new Date().toISOString().slice(0, 10),
      publicNote: "",
      internalNote: buildRegistrationInternalNote(registration),
      outputMode: "individual",
      properties: []
    },
    SITE_REGISTRATION_SIMULATION_SOURCE
  );
}

export async function updateSimulation(id, payload, userEmail = "", auth = null) {
  const supabase = getSimulationClient();
  const current = await getSimulation(id, auth);
  if (!current) throw new Error("Simulação não encontrada.");
  const payloadWithRegistration = await attachManualRegistration(payload, auth);
  const record = simulationToRecord({
    ...payloadWithRegistration,
    createdByUserId: current.createdByUserId || resolveSimulationOwnerId(payloadWithRegistration, auth)
  }, userEmail);
  let { data, error } = await supabase
    .from("simulations")
    .update(record)
    .eq("id", id)
    .select("*")
    .single();

  if (isMissingColumnError(error, "registration_id")) {
    const fallback = await supabase
      .from("simulations")
      .update(withoutRegistrationColumn(record))
      .eq("id", id)
      .select("*")
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  await replaceSimulationProperties(data.id, payloadWithRegistration.properties || []);
  if (payloadWithRegistration.registrationId && simulationHasMeaningfulValues(payloadWithRegistration)) {
    await markRegistrationSimulationCompleted(payloadWithRegistration.registrationId, auth);
  }
  return getSimulation(data.id, auth);
}

export async function deleteSimulation(id, auth = null) {
  await getSimulation(id, auth);
  const supabase = getSimulationClient();
  const { error } = await supabase.from("simulations").delete().eq("id", id);
  if (error) throw error;
  return true;
}

export function formatSimulationError(error) {
  const message = error?.message || String(error || "");
  const normalized = message.toLowerCase();

  if (isMissingColumnError(error, "registration_id")) {
    return "A coluna registration_id ainda nao existe na tabela public.simulations. Execute a migration mais recente de simulacoes no SQL Editor do Supabase.";
  }

  if (
    isBrokerSchemaError(error) ||
    normalized.includes("created_by_user_id") ||
    normalized.includes("admin_users")
  ) {
    return "Os campos de corretores ainda não existem no Supabase. Execute a migration supabase/migrations/20260821_broker_users_access.sql no SQL Editor do Supabase.";
  }

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

  const rows = data || [];
  const benefitsByProperty = await listBenefitsByProperty(rows.map((item) => item.id));
  return rows.map((row) => rowToSimulationProperty(row, benefitsByProperty.get(row.id) || []));
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

  for (const row of data || []) {
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

function withoutRegistrationColumn(record = {}) {
  const { registration_id: _registrationId, ...fallbackRecord } = record;
  return fallbackRecord;
}

function buildRegistrationInternalNote(registration) {
  const phone = String(registration.phoneNormalized || registration.phone || "").replace(/\D/g, "");
  return [
    phone ? `${CLIENT_WHATSAPP_NOTE_PREFIX} ${phone}` : "",
    "Aguardando simulação"
  ].filter(Boolean).join("\n");
}

async function attachManualRegistration(payload = {}, auth = null) {
  if (payload.registrationId) {
    try {
      const registration = await getSimulationRegistration(payload.registrationId, auth);
      if (!registration) return payload;
      return {
        ...payload,
        registration,
        clientName: payload.clientName || registration.fullName,
        clientWhatsApp: payload.clientWhatsApp || registration.phone
      };
    } catch {
      return payload;
    }
  }

  const phone = payload.clientWhatsApp || extractRegistrationPhoneFromNote(payload.internalNote);
  const clientName = payload.clientName || "";
  if (!clientName || !phone) return payload;

  try {
    const registration = await ensureManualSimulationRegistration({
      fullName: clientName,
      phone,
      primaryMonthlyIncome: payload.primaryMonthlyIncome,
      availablePurchaseResource: payload.downPaymentValue,
      includeDetails: false
    }, auth);

    return {
      ...payload,
      registrationId: registration.id,
      registration,
      clientName: registration.fullName,
      clientWhatsApp: registration.phone
    };
  } catch (error) {
    console.warn("Manual registration link skipped:", error?.message || error);
    return payload;
  }
}

function resolveSimulationOwnerId(payload = {}, auth = null) {
  if (payload.registration?.responsibleUserId) return payload.registration.responsibleUserId;
  if (payload.createdByUserId) return payload.createdByUserId;
  if (canUseProfileDatabaseScope(auth?.profile)) return auth.profile.id;
  return "";
}

function extractRegistrationPhoneFromNote(note = "") {
  const line = String(note || "")
    .split(/\r?\n/)
    .find((item) => item.toLowerCase().includes(CLIENT_WHATSAPP_NOTE_PREFIX.toLowerCase()));
  return line ? line.replace(CLIENT_WHATSAPP_NOTE_PREFIX, "").trim() : "";
}

async function findSimulationByRegistration(registration) {
  const supabase = getSimulationClient();

  if (registration?.id) {
    const { data, error } = await supabase
      .from("simulations")
      .select("*")
      .eq("registration_id", registration.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return rowToSimulation(data);
  }

  const phone = normalizeComparablePhone(registration?.phoneNormalized || registration?.phone);
  const name = normalizePersonName(registration?.fullName || "").toLowerCase();

  if (!phone && !name) return null;

  const { data, error } = await supabase
    .from("simulations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return null;

  return (data || [])
    .map((row) => rowToSimulation(row))
    .find((simulation) => {
      const notePhone = normalizeComparablePhone(simulation.internalNote || "");
      const simulationName = normalizePersonName(simulation.clientName || "").toLowerCase();
      return (phone && notePhone.includes(phone)) || (name && simulationName === name);
    }) || null;
}

function normalizeComparablePhone(value) {
  let phone = String(value || "").replace(/\D/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.startsWith("55") && phone.length > 11) phone = phone.slice(2);
  if (phone.startsWith("55") && phone.length > 11) phone = phone.slice(2);
  return phone;
}

function simulationHasMeaningfulValues(payload = {}) {
  const models = payload.simulationModels || {};
  if (Object.values(models).some((model) => simulationModelHasValues(model))) return true;

  return [
    payload.financingValue,
    payload.subsidyValue,
    payload.firstInstallment,
    payload.lastInstallment,
    payload.downPaymentValue,
    payload.fgtsValue
  ].some((value) => Number(String(value || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) > 0);
}
