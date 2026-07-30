import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import {
  calculateFamilyIncome,
  parseCurrencyNumber,
  sanitizeText,
  validateSimulationRegistration
} from "./simulation-registration-schema";
import { CLIENT_STATUS, normalizeClientStatus } from "./client-status";
import { rowToTag } from "./client-tags";
import { normalizePersonName } from "./name-utils";
import { digitsOnly, formatBrazilianPhone, toBrazilianE164 } from "./phone-utils";

const LEGACY_PROFESSION_PLACEHOLDER = "Nao informado";
const MANUAL_DEFAULT_BIRTH_DATE = "1900-01-01";
const MANUAL_DEFAULT_INCOME_TYPE = "self_employed_unregistered";
const MANUAL_DEFAULT_MARITAL_STATUS = "single";

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

  const existing = await findMatchingRegistration(validation.data);
  if (existing?.id) {
    return updateSimulationRegistration(existing.id, {
      ...validation.data,
      status: existing.status || CLIENT_STATUS.PENDING
    });
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
  let query = supabase
    .from("simulation_registrations")
    .select("*, client_tags(tag:tags(*))")
    .order("created_at", { ascending: false });

  let { data, error } = await query;
  if (error && isTagsSchemaError(error)) {
    ({ data, error } = await supabase
      .from("simulation_registrations")
      .select("*")
      .order("created_at", { ascending: false }));
  }

  if (error) throw error;

  const registrations = (data || []).map((row) => rowToSimulationRegistration(row));
  const searchQuery = sanitizeText(search).toLowerCase();
  const phoneQuery = String(search || "").replace(/\D/g, "");

  if (!searchQuery && !phoneQuery) return registrations;

  return registrations.filter((registration) => {
    const name = registration.fullName.toLowerCase();
    const phone = registration.phoneNormalized || "";
    return name.includes(searchQuery) || (phoneQuery ? phone.includes(phoneQuery) : false);
  });
}

export async function getSimulationRegistration(id) {
  const supabase = getSimulationRegistrationsClient();
  let { data, error } = await supabase
    .from("simulation_registrations")
    .select("*, client_tags(tag:tags(*))")
    .eq("id", id)
    .maybeSingle();

  if (error && isTagsSchemaError(error)) {
    ({ data, error } = await supabase
      .from("simulation_registrations")
      .select("*")
      .eq("id", id)
      .maybeSingle());
  }

  if (error) throw error;
  return data ? rowToSimulationRegistration(data) : null;
}

export async function updateSimulationRegistration(id, updates = {}) {
  const supabase = getSimulationRegistrationsClient();
  const record = {};

  if (updates.status !== undefined) {
    const status = normalizeClientStatus(updates.status);
    record.status = status;
    record.last_status_change_at = new Date().toISOString();
    if (status === CLIENT_STATUS.APPROVED) {
      record.approved_at = new Date().toISOString();
    }
  }

  if (updates.fullName !== undefined) record.full_name = normalizePersonName(updates.fullName);
  if (updates.phone !== undefined) {
    record.phone_normalized = toBrazilianE164(updates.phone) || updates.phone;
    record.phone = formatBrazilianPhone(record.phone_normalized) || sanitizeText(updates.phone);
  }
  if (updates.simulationType !== undefined) record.simulation_type = normalizeSimulationType(updates.simulationType);
  if (updates.oldestBirthDate !== undefined) record.oldest_birth_date = normalizeDate(updates.oldestBirthDate) || MANUAL_DEFAULT_BIRTH_DATE;
  if (updates.primaryIncomeType !== undefined) record.primary_income_type = normalizeIncomeType(updates.primaryIncomeType);
  if (updates.primaryMonthlyIncome !== undefined) record.primary_monthly_income = normalizeMoney(updates.primaryMonthlyIncome);
  if (updates.secondaryIncomeType !== undefined) record.secondary_income_type = record.simulation_type === "joint" || updates.simulationType === "joint"
    ? normalizeIncomeType(updates.secondaryIncomeType)
    : null;
  if (updates.secondaryMonthlyIncome !== undefined) record.secondary_monthly_income = record.simulation_type === "joint" || updates.simulationType === "joint"
    ? normalizeNullableMoney(updates.secondaryMonthlyIncome)
    : null;
  if (updates.hasOverThreeYearsRegisteredWork !== undefined) record.has_over_three_years_registered_work = normalizeBoolean(updates.hasOverThreeYearsRegisteredWork);
  if (updates.hasChildrenUnder18 !== undefined) record.has_children_under_18 = normalizeBoolean(updates.hasChildrenUnder18);
  if (updates.primaryMaritalStatus !== undefined) record.primary_marital_status = normalizeMaritalStatus(updates.primaryMaritalStatus);
  if (updates.secondaryMaritalStatus !== undefined) record.secondary_marital_status = record.simulation_type === "joint" || updates.simulationType === "joint"
    ? normalizeMaritalStatus(updates.secondaryMaritalStatus)
    : null;
  if (updates.hasResidentialProperty !== undefined) record.has_residential_property = normalizeBoolean(updates.hasResidentialProperty);
  if (updates.availablePurchaseResource !== undefined) record.available_purchase_resource = normalizeMoney(updates.availablePurchaseResource);

  if (!Object.keys(record).length) return getSimulationRegistration(id);

  const { data, error } = await supabase
    .from("simulation_registrations")
    .update(record)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return rowToSimulationRegistration(data);
}

export async function ensureManualSimulationRegistration(payload = {}) {
  const draft = buildManualSimulationRegistration(payload);
  if (!draft.fullName) {
    throw new Error("Informe o nome do cliente para criar o cadastro.");
  }
  if (!draft.phoneNormalized) {
    throw new Error("Informe um WhatsApp valido do cliente para criar o cadastro.");
  }

  const existing = payload.registrationId
    ? await getSimulationRegistration(payload.registrationId)
    : await findMatchingRegistration(draft);

  if (existing?.id) {
    const minimalUpdates = {
      fullName: draft.fullName,
      phone: draft.phoneNormalized
    };

    const updates = payload.includeDetails
      ? {
          ...minimalUpdates,
          simulationType: draft.simulationType,
          oldestBirthDate: draft.oldestBirthDate,
          primaryIncomeType: draft.primaryIncomeType,
          primaryMonthlyIncome: draft.primaryMonthlyIncome,
          secondaryIncomeType: draft.secondaryIncomeType,
          secondaryMonthlyIncome: draft.secondaryMonthlyIncome,
          hasOverThreeYearsRegisteredWork: draft.hasOverThreeYearsRegisteredWork,
          hasChildrenUnder18: draft.hasChildrenUnder18,
          primaryMaritalStatus: draft.primaryMaritalStatus,
          secondaryMaritalStatus: draft.secondaryMaritalStatus,
          hasResidentialProperty: draft.hasResidentialProperty,
          availablePurchaseResource: draft.availablePurchaseResource,
          ...(payload.status !== undefined ? { status: payload.status } : {})
        }
      : {
          ...minimalUpdates,
          ...(payload.status !== undefined ? { status: payload.status } : {})
        };

    return updateSimulationRegistration(existing.id, updates);
  }

  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .insert(registrationToRecord({ ...draft, status: payload.status || CLIENT_STATUS.PENDING }))
    .select("*")
    .single();

  if (error) throw error;
  return rowToSimulationRegistration(data);
}

export async function markRegistrationSimulationCompleted(id) {
  const current = await getSimulationRegistration(id);
  if (!current || current.status === CLIENT_STATUS.APPROVED) return current;
  return updateSimulationRegistration(id, { status: CLIENT_STATUS.COMPLETED });
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
  const tags = Array.isArray(row.client_tags)
    ? row.client_tags
      .map((item) => item.tag || item.tags)
      .filter(Boolean)
      .map(rowToTag)
    : [];

  const registration = {
    id: row.id,
    simulationType: row.simulation_type || "individual",
    fullName: normalizePersonName(row.full_name || ""),
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
    status: normalizeClientStatus(row.status),
    approvedAt: row.approved_at || "",
    lastStatusChangeAt: row.last_status_change_at || "",
    tags,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };

  return {
    ...registration,
    familyIncome: calculateFamilyIncome(registration)
  };
}

function registrationToRecord(registration = {}) {
  const simulationType = normalizeSimulationType(registration.simulationType);
  const record = {
    simulation_type: simulationType,
    full_name: normalizePersonName(registration.fullName),
    phone: formatBrazilianPhone(registration.phoneNormalized || registration.phone) || sanitizeText(registration.phone),
    phone_normalized: toBrazilianE164(registration.phoneNormalized || registration.phone) || registration.phoneNormalized || registration.phone,
    oldest_birth_date: normalizeDate(registration.oldestBirthDate) || MANUAL_DEFAULT_BIRTH_DATE,
    primary_income_type: normalizeIncomeType(registration.primaryIncomeType),
    primary_profession: sanitizeText(registration.primaryProfession) || LEGACY_PROFESSION_PLACEHOLDER,
    primary_monthly_income: normalizeMoney(registration.primaryMonthlyIncome),
    secondary_income_type: simulationType === "joint" ? normalizeIncomeType(registration.secondaryIncomeType) : null,
    secondary_profession:
      simulationType === "joint"
        ? sanitizeText(registration.secondaryProfession) || LEGACY_PROFESSION_PLACEHOLDER
        : null,
    secondary_monthly_income: simulationType === "joint" ? normalizeNullableMoney(registration.secondaryMonthlyIncome) : null,
    has_over_three_years_registered_work: normalizeBoolean(registration.hasOverThreeYearsRegisteredWork),
    has_children_under_18: normalizeBoolean(registration.hasChildrenUnder18),
    primary_marital_status: normalizeMaritalStatus(registration.primaryMaritalStatus),
    secondary_marital_status: simulationType === "joint" ? normalizeMaritalStatus(registration.secondaryMaritalStatus) : null,
    has_residential_property: normalizeBoolean(registration.hasResidentialProperty),
    available_purchase_resource: normalizeMoney(registration.availablePurchaseResource)
  };

  if (registration.status !== undefined) record.status = normalizeClientStatus(registration.status);
  return record;
}

function getSimulationRegistrationsClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase administrativo não configurado para gerenciar cadastros de simulação.");
  }
  return supabase;
}

function isTagsSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("client_tags") || message.includes("tags") || message.includes("schema cache");
}

async function findMatchingRegistration(draft) {
  const registrations = await listSimulationRegistrations();
  const draftPhone = normalizeComparablePhone(draft.phoneNormalized || draft.phone);
  const draftName = normalizePersonName(draft.fullName).toLowerCase();

  return registrations.find((registration) => {
    const phone = normalizeComparablePhone(registration.phoneNormalized || registration.phone);
    return draftPhone && phone && (phone === draftPhone || phone.endsWith(draftPhone) || draftPhone.endsWith(phone));
  }) || registrations.find((registration) => (
    draftName && normalizePersonName(registration.fullName).toLowerCase() === draftName
  )) || null;
}

function normalizeComparablePhone(value) {
  let phone = digitsOnly(value);
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.startsWith("55") && phone.length > 11) phone = phone.slice(2);
  if (phone.startsWith("55") && phone.length > 11) phone = phone.slice(2);
  return phone;
}

function buildManualSimulationRegistration(payload = {}) {
  const fullName = normalizePersonName(payload.fullName || payload.clientName || "");
  const phoneSource = payload.phone || payload.phoneNormalized || payload.clientWhatsApp || "";
  const phoneNormalized = toBrazilianE164(phoneSource);
  const simulationType = normalizeSimulationType(payload.simulationType);

  return {
    simulationType,
    fullName,
    phone: formatBrazilianPhone(phoneNormalized || phoneSource),
    phoneNormalized,
    oldestBirthDate: normalizeDate(payload.oldestBirthDate) || MANUAL_DEFAULT_BIRTH_DATE,
    primaryIncomeType: normalizeIncomeType(payload.primaryIncomeType),
    primaryProfession: LEGACY_PROFESSION_PLACEHOLDER,
    primaryMonthlyIncome: normalizeMoney(payload.primaryMonthlyIncome),
    secondaryIncomeType: simulationType === "joint" ? normalizeIncomeType(payload.secondaryIncomeType) : null,
    secondaryProfession: simulationType === "joint" ? LEGACY_PROFESSION_PLACEHOLDER : null,
    secondaryMonthlyIncome: simulationType === "joint" ? normalizeNullableMoney(payload.secondaryMonthlyIncome) : null,
    hasOverThreeYearsRegisteredWork: normalizeBoolean(payload.hasOverThreeYearsRegisteredWork),
    hasChildrenUnder18: normalizeBoolean(payload.hasChildrenUnder18),
    primaryMaritalStatus: normalizeMaritalStatus(payload.primaryMaritalStatus),
    secondaryMaritalStatus: simulationType === "joint" ? normalizeMaritalStatus(payload.secondaryMaritalStatus) : null,
    hasResidentialProperty: normalizeBoolean(payload.hasResidentialProperty),
    availablePurchaseResource: normalizeMoney(payload.availablePurchaseResource)
  };
}

function normalizeSimulationType(value) {
  return value === "joint" ? "joint" : "individual";
}

function normalizeIncomeType(value) {
  return ["registered_employment", "income_tax_declarant", "self_employed_unregistered"].includes(value)
    ? value
    : MANUAL_DEFAULT_INCOME_TYPE;
}

function normalizeMaritalStatus(value) {
  return ["married", "single", "divorced", "stable_union", "widowed"].includes(value)
    ? value
    : MANUAL_DEFAULT_MARITAL_STATUS;
}

function normalizeDate(value) {
  const text = sanitizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeBoolean(value) {
  if (value === true || value === "true" || value === "Sim") return true;
  if (value === false || value === "false" || value === "Nao" || value === "Não") return false;
  return false;
}

function normalizeMoney(value) {
  const parsed = parseCurrencyNumber(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeNullableMoney(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return normalizeMoney(value);
}
