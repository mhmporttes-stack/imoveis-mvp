import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import {
  calculateFamilyIncome,
  sanitizeText,
  validateSimulationRegistration
} from "./simulation-registration-schema";

const LEGACY_PROFESSION_PLACEHOLDER = "Nao informado";

export class SimulationRegistrationValidationError extends Error {
  constructor(validation) {
    super(validation.formError || "Revise as informações enviadas.");
    this.name = "SimulationRegistrationValidationError";
    this.fieldErrors = validation.fieldErrors || {};
  }
}

export function canManageSimulationRegistrations() {
  return hasSupabaseAdminConfig;
}

export async function createSimulationRegistration(payload) {
  const validation = validateSimulationRegistration(payload);
  if (!validation.ok) {
    throw new SimulationRegistrationValidationError(validation);
  }

  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .insert(registrationToRecord(validation.data))
    .select("*")
    .single();

  if (error) throw error;
  return rowToSimulationRegistration(data);
}

export async function listSimulationRegistrations({ search = "" } = {}) {
  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const registrations = (data || []).map((row) => rowToSimulationRegistration(row));
  const query = sanitizeText(search).toLowerCase();
  const phoneQuery = String(search || "").replace(/\D/g, "");

  if (!query && !phoneQuery) return registrations;

  return registrations.filter((registration) => {
    const name = registration.fullName.toLowerCase();
    const phone = registration.phoneNormalized || "";
    return name.includes(query) || (phoneQuery ? phone.includes(phoneQuery) : false);
  });
}

export async function getSimulationRegistration(id) {
  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? rowToSimulationRegistration(data) : null;
}

export async function deleteSimulationRegistration(id) {
  const supabase = getSimulationRegistrationsClient();
  const { error } = await supabase.from("simulation_registrations").delete().eq("id", id);
  if (error) throw error;
  return true;
}

export function formatSimulationRegistrationError(error) {
  const message = error?.message || String(error || "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("schema cache") ||
    normalized.includes("relation") ||
    normalized.includes("simulation_registrations")
  ) {
    return "A tabela public.simulation_registrations ainda não existe no Supabase. Execute a migration supabase/migrations/20260721_simulation_registrations.sql no SQL Editor do Supabase.";
  }

  return message || "Não foi possível carregar os cadastros de simulação.";
}

export function rowToSimulationRegistration(row = {}) {
  const registration = {
    id: row.id,
    simulationType: row.simulation_type || "individual",
    fullName: row.full_name || "",
    phone: row.phone || "",
    phoneNormalized: row.phone_normalized || "",
    oldestBirthDate: row.oldest_birth_date || "",
    primaryIncomeType: row.primary_income_type || "",
    primaryProfession: row.primary_profession || "",
    primaryMonthlyIncome: Number(row.primary_monthly_income || 0),
    secondaryIncomeType: row.secondary_income_type || null,
    secondaryProfession: row.secondary_profession || null,
    secondaryMonthlyIncome: row.secondary_monthly_income === null ? null : Number(row.secondary_monthly_income || 0),
    hasOverThreeYearsRegisteredWork: row.has_over_three_years_registered_work,
    hasChildrenUnder18: row.has_children_under_18,
    primaryMaritalStatus: row.primary_marital_status || "",
    secondaryMaritalStatus: row.secondary_marital_status || null,
    hasResidentialProperty: row.has_residential_property,
    availablePurchaseResource: Number(row.available_purchase_resource || 0),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };

  return {
    ...registration,
    familyIncome: calculateFamilyIncome(registration)
  };
}

function registrationToRecord(registration = {}) {
  return {
    simulation_type: registration.simulationType,
    full_name: registration.fullName,
    phone: registration.phone,
    phone_normalized: registration.phoneNormalized,
    oldest_birth_date: registration.oldestBirthDate,
    primary_income_type: registration.primaryIncomeType,
    primary_profession: sanitizeText(registration.primaryProfession) || LEGACY_PROFESSION_PLACEHOLDER,
    primary_monthly_income: registration.primaryMonthlyIncome,
    secondary_income_type: registration.secondaryIncomeType,
    secondary_profession:
      registration.simulationType === "joint"
        ? sanitizeText(registration.secondaryProfession) || LEGACY_PROFESSION_PLACEHOLDER
        : null,
    secondary_monthly_income: registration.secondaryMonthlyIncome,
    has_over_three_years_registered_work: registration.hasOverThreeYearsRegisteredWork,
    has_children_under_18: registration.hasChildrenUnder18,
    primary_marital_status: registration.primaryMaritalStatus,
    secondary_marital_status: registration.secondaryMaritalStatus,
    has_residential_property: registration.hasResidentialProperty,
    available_purchase_resource: registration.availablePurchaseResource
  };
}

function getSimulationRegistrationsClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase administrativo não configurado para gerenciar cadastros de simulação.");
  }
  return supabase;
}
