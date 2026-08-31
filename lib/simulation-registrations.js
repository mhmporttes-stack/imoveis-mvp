import { randomUUID } from "crypto";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import {
  calculateFamilyIncome,
  parseCurrencyNumber,
  sanitizeText,
  validateSimulationRegistration
} from "./simulation-registration-schema";
import { CLIENT_STATUS, normalizeClientStatus } from "./client-status";
import { recordClientStatusChange } from "./client-status-history";
import { rowToTag } from "./client-tags";
import { ensureFinancialSaleForRegistration } from "./financial";
import { getAdminDisplayName } from "./admin-users";
import { normalizePersonName } from "./name-utils";
import { digitsOnly, formatBrazilianPhone, toBrazilianE164 } from "./phone-utils";
import {
  PROPERTY_PREFERENCE_STATUS,
  ignoredPropertyPreferencesRecord,
  propertyPreferencesToRecord,
  rowToPropertyPreferences,
  startedPropertyPreferencesRecord
} from "./property-preferences";
import { applyResponsibleUserScope, assertCanAccessResponsibleUser, assertGeneralAdmin } from "./admin-access";
import { canUseProfileDatabaseScope, isBrokerProfile, isBrokerSchemaError, resolveAdminProfileByRef } from "./admin-profiles";

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
  const responsibleUserId = await resolveResponsibleUserIdFromPayload(payload, "simulation");
  const validation = validateSimulationRegistration(payload);
  if (!validation.ok) {
    throw new SimulationRegistrationValidationError(validation);
  }

  const registrationData = { ...validation.data, responsibleUserId };
  const existing = await findMatchingRegistration(registrationData, { responsibleUserId });
  if (existing?.id) {
    const updated = await updateSimulationRegistration(existing.id, {
      ...registrationData,
      status: existing.status || CLIENT_STATUS.PENDING
    });
    return ensureRegistrationPreferenceToken(updated);
  }

  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .insert(registrationToRecord(registrationData))
    .select("*")
    .single();

  if (error) throw error;
  return ensureRegistrationPreferenceToken(rowToSimulationRegistration(data));
}

export async function listSimulationRegistrations({ search = "", auth = null, responsibleUserId = "" } = {}) {
  const supabase = getSimulationRegistrationsClient();
  let query = supabase
    .from("simulation_registrations")
    .select("*, client_tags(tag:tags(*))")
    .order("created_at", { ascending: false });

  query = applyResponsibleUserScope(query, auth, "responsible_user_id", responsibleUserId);

  let { data, error } = await query;
  if (error && isTagsSchemaError(error)) {
    let fallbackQuery = supabase
      .from("simulation_registrations")
      .select("*")
      .order("created_at", { ascending: false });

    fallbackQuery = applyResponsibleUserScope(fallbackQuery, auth, "responsible_user_id", responsibleUserId);
    ({ data, error } = await fallbackQuery);
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

export async function listScheduledActivityRegistrations({ from = "", to = "", auth = null, responsibleUserId = "" } = {}) {
  const supabase = getSimulationRegistrationsClient();
  let query = supabase
    .from("simulation_registrations")
    .select("*")
    .not("scheduled_activity_at", "is", null)
    .order("scheduled_activity_at", { ascending: true });

  query = applyResponsibleUserScope(query, auth, "responsible_user_id", responsibleUserId);

  if (from) query = query.gte("scheduled_activity_at", from);
  if (to) query = query.lte("scheduled_activity_at", to);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => rowToSimulationRegistration(row));
}

export async function getSimulationRegistration(id, auth = null) {
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
  if (!data) return null;

  const registration = rowToSimulationRegistration(data);
  if (auth) assertCanAccessResponsibleUser(auth, registration.responsibleUserId);
  return registration;
}

export async function updateSimulationRegistration(id, updates = {}, auth = null) {
  const supabase = getSimulationRegistrationsClient();
  const record = {};
  const adminEmail = normalizeAdminEmail(updates.adminEmail);
  let currentRegistration = null;
  let nextStatus = null;
  let statusChangedAt = "";

  if (adminEmail) {
    Object.assign(record, getAdminActivityRecord(adminEmail));
  }

  if (auth || updates.status !== undefined || updates.responsibleUserId !== undefined) {
    const { data: current, error: readError } = await supabase
      .from("simulation_registrations")
      .select("id, status, last_admin_email, responsible_user_id")
      .eq("id", id)
      .maybeSingle();

    if (readError) throw readError;
    currentRegistration = current;
    if (auth) assertCanAccessResponsibleUser(auth, current?.responsible_user_id || "");
  }

  if (updates.status !== undefined) {
    nextStatus = normalizeClientStatus(updates.status);

    if (normalizeClientStatus(currentRegistration?.status) !== nextStatus) {
      statusChangedAt = new Date().toISOString();
      record.status = nextStatus;
      record.last_status_change_at = statusChangedAt;
      if (nextStatus === CLIENT_STATUS.APPROVED) {
        record.approved_at = statusChangedAt;
      }
    }
  }

  if (updates.responsibleUserId !== undefined) {
    if (auth) assertGeneralAdmin(auth);
    record.responsible_user_id = updates.responsibleUserId || null;
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
  if (updates.scheduledActivityAt !== undefined) {
    record.scheduled_activity_at = normalizeScheduledActivityAt(updates.scheduledActivityAt);
    record.scheduled_activity_notified_at = null;
    record.scheduled_activity_completed_at = null;
    record.scheduled_activity_completed_by = null;
  }
  if (updates.scheduledActivityDate !== undefined || updates.scheduledActivityTime !== undefined) {
    record.scheduled_activity_at = normalizeScheduledActivityDateTime(updates.scheduledActivityDate, updates.scheduledActivityTime);
    record.scheduled_activity_notified_at = null;
    record.scheduled_activity_completed_at = null;
    record.scheduled_activity_completed_by = null;
  }
  if (updates.scheduledActivityNote !== undefined) record.scheduled_activity_note = sanitizeText(updates.scheduledActivityNote).slice(0, 240);
  if (updates.scheduledActivityType !== undefined) record.scheduled_activity_type = normalizeScheduledActivityType(updates.scheduledActivityType);
  if (updates.scheduledActivityCompleted !== undefined || updates.scheduledActivityCompletedAt !== undefined) {
    const shouldComplete = updates.scheduledActivityCompleted === true || Boolean(updates.scheduledActivityCompletedAt);
    record.scheduled_activity_completed_at = shouldComplete
      ? normalizeScheduledActivityAt(updates.scheduledActivityCompletedAt) || new Date().toISOString()
      : null;
    record.scheduled_activity_completed_by = shouldComplete ? auth?.user?.id || null : null;
  }

  if (!Object.keys(record).length) return getSimulationRegistration(id, auth);

  const { data, error } = await supabase
    .from("simulation_registrations")
    .update(record)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  if (statusChangedAt) {
    await recordClientStatusChange({
      supabase,
      clientId: id,
      previousStatus: currentRegistration?.status || null,
      newStatus: nextStatus,
      changedAt: statusChangedAt,
      changedBy: adminEmail || currentRegistration?.last_admin_email || ""
    });
  }

  const updatedRegistration = rowToSimulationRegistration(data);

  if (nextStatus === CLIENT_STATUS.SALE_COMPLETED) {
    try {
      await ensureFinancialSaleForRegistration(updatedRegistration, adminEmail);
    } catch (financialError) {
      console.error("Nao foi possivel criar a venda financeira automaticamente.", financialError);
    }
  }

  return updatedRegistration;
}

export async function ensureManualSimulationRegistration(payload = {}, auth = null) {
  const responsibleUserId = await resolveResponsibleUserIdFromPayload(payload, "simulation", auth);
  const draft = { ...buildManualSimulationRegistration(payload), responsibleUserId };
  if (!draft.fullName) {
    throw new Error("Informe o nome do cliente para criar o cadastro.");
  }
  if (!draft.phoneNormalized) {
    throw new Error("Informe um WhatsApp valido do cliente para criar o cadastro.");
  }

  const existing = payload.registrationId
    ? await getSimulationRegistration(payload.registrationId, auth)
    : await findMatchingRegistration(draft, { auth, responsibleUserId });

  if (existing?.id) {
    const minimalUpdates = {
      fullName: draft.fullName,
      phone: draft.phoneNormalized,
      adminEmail: payload.adminEmail
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
          ...(responsibleUserId !== undefined ? { responsibleUserId } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {})
        }
      : {
          ...minimalUpdates,
          ...(responsibleUserId !== undefined ? { responsibleUserId } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {})
        };

    return updateSimulationRegistration(existing.id, updates, auth);
  }

  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .insert(registrationToRecord({ ...draft, status: payload.status || CLIENT_STATUS.PENDING, adminEmail: payload.adminEmail }))
    .select("*")
    .single();

  if (error) throw error;
  if (normalizeClientStatus(data?.status) !== CLIENT_STATUS.PENDING) {
    await recordClientStatusChange({
      supabase,
      clientId: data.id,
      previousStatus: null,
      newStatus: data.status,
      changedAt: data.last_status_change_at || data.created_at,
      changedBy: payload.adminEmail || ""
    });
  }

  return rowToSimulationRegistration(data);
}

export async function markRegistrationSimulationCompleted(id, auth = null) {
  const current = await getSimulationRegistration(id, auth);
  const manualStatuses = [
    CLIENT_STATUS.DOCUMENTATION,
    CLIENT_STATUS.SIMULATION_SENT,
    CLIENT_STATUS.IN_SERVICE,
    CLIENT_STATUS.AWAITING_RETURN,
    CLIENT_STATUS.DOCUMENTS_PENDING,
    CLIENT_STATUS.APPROVAL_PENDING,
    CLIENT_STATUS.SHIELDING,
    CLIENT_STATUS.APPROVED,
    CLIENT_STATUS.REJECTED,
    CLIENT_STATUS.SALE_COMPLETED,
    CLIENT_STATUS.ARCHIVED
  ];
  if (
    !current ||
    manualStatuses.includes(current.status)
  ) {
    return current;
  }
  return updateSimulationRegistration(id, { status: CLIENT_STATUS.COMPLETED }, auth);
}

export async function deleteSimulationRegistration(id, auth = null) {
  if (auth) await getSimulationRegistration(id, auth);
  const supabase = getSimulationRegistrationsClient();
  const { error } = await supabase.from("simulation_registrations").delete().eq("id", id);
  if (error) throw error;
  return true;
}

export async function markSimulationRegistrationAdminActivity(id, adminEmail = "", auth = null) {
  const email = normalizeAdminEmail(adminEmail);
  if (!email) return getSimulationRegistration(id, auth);
  if (auth) await getSimulationRegistration(id, auth);

  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .update(getAdminActivityRecord(email))
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return rowToSimulationRegistration(data);
}

export async function markSimulationRegistrationWhatsAppContact(id, adminEmail = "", auth = null) {
  if (auth) await getSimulationRegistration(id, auth);
  const email = normalizeAdminEmail(adminEmail);
  const now = new Date().toISOString();
  const record = {
    last_whatsapp_contact_at: now,
    last_admin_activity_at: now
  };

  if (email) record.last_admin_email = email;

  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .update(record)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return rowToSimulationRegistration(data);
}

export async function listDueScheduledActivityNotifications({ now = new Date(), limit = 50 } = {}) {
  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .select("*, client_tags(tag:tags(*))")
    .not("scheduled_activity_at", "is", null)
    .is("scheduled_activity_notified_at", null)
    .is("scheduled_activity_completed_at", null)
    .lte("scheduled_activity_at", now.toISOString())
    .order("scheduled_activity_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(rowToSimulationRegistration);
}

export async function markScheduledActivityNotificationSent(id, sentAt = new Date()) {
  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .update({ scheduled_activity_notified_at: sentAt.toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return rowToSimulationRegistration(data);
}

export async function updateSimulationRegistrationPreferences(id, payload = {}) {
  const supabase = getSimulationRegistrationsClient();
  const { data: current, error: readError } = await supabase
    .from("simulation_registrations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (readError) throw readError;
  if (!current?.id) throw new Error("Cadastro nÃ£o encontrado.");

  const token = sanitizeText(payload.token);
  if (!token || token !== current.preferences_access_token) {
    throw new Error("NÃ£o foi possÃ­vel validar este cadastro.");
  }

  let record = null;
  if (payload.status === PROPERTY_PREFERENCE_STATUS.IGNORED) {
    record = ignoredPropertyPreferencesRecord();
  } else if (payload.status === PROPERTY_PREFERENCE_STATUS.STARTED) {
    record = startedPropertyPreferencesRecord();
  } else {
    record = propertyPreferencesToRecord(payload.preferences || payload, PROPERTY_PREFERENCE_STATUS.COMPLETED);
  }

  const { data, error } = await supabase
    .from("simulation_registrations")
    .update(record)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return rowToSimulationRegistration(data);
}

export function formatSimulationRegistrationError(error) {
  const message = error?.message || String(error || "");
  const normalized = message.toLowerCase();

  if (
    isBrokerSchemaError(error) ||
    normalized.includes("responsible_user_id") ||
    normalized.includes("admin_users")
  ) {
    return "Os campos de corretores ainda não existem no Supabase. Execute a migration supabase/migrations/20260821_broker_users_access.sql no SQL Editor do Supabase.";
  }

  if (
    normalized.includes("preferences_access_token") ||
    normalized.includes("property_preferences") ||
    normalized.includes("preferred_property") ||
    normalized.includes("preferred_regions") ||
    normalized.includes("rents_currently") ||
    normalized.includes("rent_price_range") ||
    normalized.includes("purchase_timeline") ||
    normalized.includes("property_priorities") ||
    normalized.includes("must_have_features")
  ) {
    return "Os campos de preferÃªncias do imÃ³vel ainda nÃ£o existem no Supabase. Execute a migration supabase/migrations/20260806_property_preferences.sql no SQL Editor do Supabase.";
  }

  if (
    normalized.includes("scheduled_activity") ||
    normalized.includes("scheduled activity")
  ) {
    return "Os campos de atividade agendada ainda não existem no Supabase. Execute as migrations supabase/migrations/20260826_client_scheduled_activities.sql, supabase/migrations/20260826_scheduled_activity_notifications.sql e supabase/migrations/20260829_scheduled_activity_completion.sql no SQL Editor do Supabase.";
  }

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
    responsibleUserId: row.responsible_user_id || "",
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
    lastWhatsappContactAt: row.last_whatsapp_contact_at || "",
    lastAdminEmail: row.last_admin_email || "",
    lastAdminName: getAdminDisplayName(row.last_admin_email),
    lastAdminActivityAt: row.last_admin_activity_at || "",
    scheduledActivityAt: row.scheduled_activity_at || "",
    scheduledActivityType: row.scheduled_activity_type || "follow_up",
    scheduledActivityNote: row.scheduled_activity_note || "",
    scheduledActivityNotifiedAt: row.scheduled_activity_notified_at || "",
    scheduledActivityCompletedAt: row.scheduled_activity_completed_at || "",
    scheduledActivityCompletedBy: row.scheduled_activity_completed_by || "",
    scheduledActivityCompleted: Boolean(row.scheduled_activity_completed_at),
    preferencesAccessToken: row.preferences_access_token || "",
    propertyPreferences: rowToPropertyPreferences(row),
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
  if (registration.responsibleUserId !== undefined) record.responsible_user_id = registration.responsibleUserId || null;
  if (registration.scheduledActivityAt !== undefined) {
    record.scheduled_activity_at = normalizeScheduledActivityAt(registration.scheduledActivityAt);
    record.scheduled_activity_notified_at = null;
    record.scheduled_activity_completed_at = null;
    record.scheduled_activity_completed_by = null;
  }
  if (registration.scheduledActivityNote !== undefined) record.scheduled_activity_note = sanitizeText(registration.scheduledActivityNote).slice(0, 240);
  if (registration.scheduledActivityType !== undefined) record.scheduled_activity_type = normalizeScheduledActivityType(registration.scheduledActivityType);
  const adminEmail = normalizeAdminEmail(registration.adminEmail);
  if (adminEmail) Object.assign(record, getAdminActivityRecord(adminEmail));
  return record;
}

function getSimulationRegistrationsClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase administrativo não configurado para gerenciar cadastros de simulação.");
  }
  return supabase;
}

async function ensureRegistrationPreferenceToken(registration) {
  if (!registration?.id || registration.preferencesAccessToken) return registration;

  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .update({ preferences_access_token: randomUUID() })
    .eq("id", registration.id)
    .select("*")
    .single();

  if (error) {
    const message = String(error?.message || "").toLowerCase();
    if (
      message.includes("preferences_access_token") ||
      message.includes("schema cache") ||
      message.includes("could not find")
    ) {
      return registration;
    }
    throw error;
  }

  return rowToSimulationRegistration(data);
}

function isTagsSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("client_tags") || message.includes("tags") || message.includes("schema cache");
}

async function findMatchingRegistration(draft, options = {}) {
  let registrations = await listSimulationRegistrations({ auth: options.auth || null });
  if (options.responsibleUserId !== undefined) {
    const expectedResponsibleUserId = options.responsibleUserId || "";
    registrations = registrations.filter((registration) => (
      (registration.responsibleUserId || "") === expectedResponsibleUserId
    ));
  }

  const draftPhone = normalizeComparablePhone(draft.phoneNormalized || draft.phone);
  const draftName = normalizePersonName(draft.fullName).toLowerCase();

  return registrations.find((registration) => {
    const phone = normalizeComparablePhone(registration.phoneNormalized || registration.phone);
    return draftPhone && phone && (phone === draftPhone || phone.endsWith(draftPhone) || draftPhone.endsWith(phone));
  }) || registrations.find((registration) => (
    draftName && normalizePersonName(registration.fullName).toLowerCase() === draftName
  )) || null;
}

async function resolveResponsibleUserIdFromPayload(payload = {}, type = "simulation", auth = null) {
  if (isBrokerProfile(auth?.profile) && canUseProfileDatabaseScope(auth.profile)) {
    return auth.profile.id;
  }

  if (payload.responsibleUserId !== undefined) {
    if (auth) assertGeneralAdmin(auth);
    return payload.responsibleUserId || null;
  }

  if (auth?.profile && canUseProfileDatabaseScope(auth.profile)) {
    return auth.profile.id;
  }

  const ref = sanitizeText(payload.brokerRef || payload.ref || payload.responsibleRef || "");
  if (!ref) return null;

  const profile = await resolveAdminProfileByRef(ref, type);
  return canUseProfileDatabaseScope(profile) ? profile.id : null;
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

function normalizeScheduledActivityDateTime(dateValue, timeValue) {
  const date = normalizeDate(dateValue);
  const time = sanitizeText(timeValue);
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return null;
  return normalizeScheduledActivityAt(`${date}T${time}:00-03:00`);
}

function normalizeScheduledActivityAt(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeScheduledActivityType(value) {
  const type = sanitizeText(value).toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80);
  return type || "follow_up";
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

function normalizeAdminEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function getAdminActivityRecord(adminEmail) {
  return {
    last_admin_email: adminEmail,
    last_admin_activity_at: new Date().toISOString()
  };
}
