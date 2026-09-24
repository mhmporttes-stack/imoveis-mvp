import { randomUUID } from "crypto";
import { buildLeadOrigin } from "./lead-origin";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import {
  calculateFamilyIncome,
  parseCurrencyNumber,
  sanitizeText,
  validateSimulationRegistration
} from "./simulation-registration-schema";
import { CLIENT_STATUS, normalizeClientStatus } from "./client-status";
import { syncCrmClientAttendance } from "./crm-clients";
import { recordClientStatusChange } from "./client-status-history";
import { addTagToClient, rowToTag } from "./client-tags";
import { CAMPAIGN_DESTINATION, CAMPAIGN_STATUS, getCampaign, getOfficialCampaignForBroker, recordCampaignDuplicateSubmission } from "./campaigns";
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
import { applyResponsibleUserScope, assertCanAccessResponsibleUser, assertGeneralAdminOrManager, assertOwnerAdmin } from "./admin-access";
import {
  AdminPermissionError,
  canUseProfileDatabaseScope,
  isBrokerProfile,
  isBrokerSchemaError,
  isOwnerAdminEmail,
  listAdminProfiles,
  normalizeBrokerRef,
  resolveAdminProfileByRef
} from "./admin-profiles";
import { autoReturnStaleProspectingContacts } from "./prospecting-auto-return";
import { assignRoundRobinLead, recordLeadDistributionHistory } from "./lead-distribution";
import { sendMetaLeadEvent } from "./meta-conversions-api";
import { incomeBracketLabel } from "./meta-pixel-shared";

const LEGACY_PROFESSION_PLACEHOLDER = "Nao informado";
const MANUAL_DEFAULT_BIRTH_DATE = "1900-01-01";
const DEFAULT_SIMULATION_BROKER_REF = "matheus";
const MANUAL_DEFAULT_INCOME_TYPE = "self_employed_unregistered";
const MANUAL_DEFAULT_MARITAL_STATUS = "single";
const SALE_PIPELINE_STATUSES = new Set([
  CLIENT_STATUS.SALE_COMPLETED,
  CLIENT_STATUS.SALE_FORMS,
  CLIENT_STATUS.SALE_RESERVATION,
  CLIENT_STATUS.SALE_CONTRACT,
  CLIENT_STATUS.SALE_CAIXA_SIGNATURE,
  CLIENT_STATUS.SALE_ITBI,
  CLIENT_STATUS.SALE_REGISTRY,
  CLIENT_STATUS.SALE_PAYMENT
]);

export function canViewDoNotContact(auth) {
  if (!auth) return true;
  return isOwnerAdminEmail(auth?.user?.email) || isOwnerAdminEmail(auth?.profile?.email);
}

export function applyDoNotContactScope(query, auth) {
  return canViewDoNotContact(auth) ? query : query.neq("status", CLIENT_STATUS.DO_NOT_CONTACT);
}

function assertCanViewDoNotContact(auth, status) {
  if (auth && normalizeClientStatus(status) === CLIENT_STATUS.DO_NOT_CONTACT && !canViewDoNotContact(auth)) {
    throw new AdminPermissionError();
  }
}

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

// Fonte única de resolução de destino para QUALQUER cadastro externo vindo de
// um link público (Gerador de Links / /simulacao) — usada tanto pelo
// formulário completo de Simulação quanto pelo Atendimento Rápido, para as
// duas jornadas SEMPRE respeitarem exatamente a mesma configuração do link
// (campanha > ref pessoal/roleta > padrão), nunca uma lógica de distribuição
// paralela. Prioridade igual à de sempre: campanha ativa (?c=) > ref (?ref=,
// "equipe" = roleta) > corretor padrão do site.
async function resolveExternalLinkAssignment(payload = {}) {
  const campaign = await resolveCampaignFromPayload(payload);
  const isActiveCampaign = Boolean(campaign) && campaign.status === CAMPAIGN_STATUS.ACTIVE;
  const isTeamDistribution = !isActiveCampaign
    && normalizeBrokerRef(payload.brokerRef || payload.ref || payload.responsibleRef) === "equipe";

  let responsibleUserId;
  let distributionType = "";
  let isRouletteAssignment = false;
  let officialCampaign = null;
  let rouletteMeta = null;

  // Cliente que entra pelo link pessoal de simulação de um corretor (?ref=<simulationRef>,
  // sem passar por campanha do Gerador de Links nem pela roleta "equipe") já chega
  // diretamente atribuído àquele corretor — para o funil comercial, isso conta
  // como prospecção feita pelo próprio corretor e cliente já em atendimento.
  const providedRef = sanitizeText(payload.brokerRef || payload.ref || payload.responsibleRef || "");
  const isDirectBrokerLink = !isActiveCampaign && Boolean(providedRef) && !isTeamDistribution;

  if (isActiveCampaign && campaign.destinationType === CAMPAIGN_DESTINATION.BROKER) {
    responsibleUserId = campaign.brokerId;
  } else if (isActiveCampaign) {
    const roulette = await assignRoundRobinLead();
    if (!roulette.brokerId) throw new Error("Nenhum corretor está ativo na distribuição de leads.");
    rouletteMeta = { tier: roulette.tier, skippedNames: roulette.skippedNames };
    responsibleUserId = roulette.brokerId;
    distributionType = "round_robin";
    isRouletteAssignment = true;
  } else {
    const teamMeta = {};
    responsibleUserId = await resolveResponsibleUserIdFromPayload(payload, "simulation", null, teamMeta);
    if (teamMeta.roulette) rouletteMeta = teamMeta.roulette;
    distributionType = isTeamDistribution ? "round_robin" : "";
    isRouletteAssignment = isTeamDistribution;
  }

  // Link pessoal do corretor: liga a conversão ao MESMO link oficial que
  // aparece no Gerador de Links (lib/campaigns.js), reaproveitando o pipeline
  // de client_origins/contagem histórica sem duplicar lógica — buildLeadOrigin
  // (abaixo) já garante que isso NUNCA reclassifica o evento como "campanha"
  // (kind continua "broker_link"), só preenche campaign_id/campaign_name.
  if (isDirectBrokerLink && responsibleUserId) {
    try {
      officialCampaign = await getOfficialCampaignForBroker(responsibleUserId);
    } catch (officialCampaignError) {
      console.warn("Falha ao localizar o link oficial do corretor:", officialCampaignError?.message || officialCampaignError);
    }
  }

  return { campaign: officialCampaign || campaign, isActiveCampaign, isTeamDistribution, providedRef, isDirectBrokerLink, responsibleUserId, distributionType, isRouletteAssignment, rouletteMeta };
}

// Efeitos colaterais do cadastro externo (histórico da roleta + tag da
// campanha) — mesmos para as duas jornadas, aplicados depois do insert.
async function finalizeExternalClientOrigin(registration, assignment) {
  const { campaign, isActiveCampaign, isRouletteAssignment, responsibleUserId, rouletteMeta } = assignment;

  if (isRouletteAssignment) {
    try {
      await recordLeadDistributionHistory({
        registration,
        toUserId: responsibleUserId,
        eventType: "assigned",
        // Camada usada (online/ausente/offline) e quem foi pulado — auditoria da roleta por presença.
        details: rouletteMeta ? { presenceTier: rouletteMeta.tier, skipped: rouletteMeta.skippedNames } : {}
      });
    } catch (historyError) {
      console.warn("Lead distribution history failed:", historyError?.message || historyError);
    }
  }

  if (isActiveCampaign) {
    try {
      await addTagToClient(registration.id, campaign.name);
    } catch (tagError) {
      console.warn("Campaign tag assignment failed:", tagError?.message || tagError);
    }
  }
}

export async function createSimulationRegistration(payload, requestMetadata = {}) {
  const validation = validateSimulationRegistration(payload);
  if (!validation.ok) {
    throw new SimulationRegistrationValidationError(validation);
  }

  const totalIncome = Number(validation.data.primaryMonthlyIncome || 0) + Number(validation.data.secondaryMonthlyIncome || 0);
  fireMetaLeadEvent({ phone: validation.data.phoneNormalized, eventId: payload.metaEventId, incomeBracket: incomeBracketLabel(totalIncome), requestMetadata });

  const assignment = await resolveExternalLinkAssignment(payload);
  const { campaign, isTeamDistribution, providedRef, isDirectBrokerLink, isRouletteAssignment, responsibleUserId, distributionType } = assignment;

  // Mesmo telefone nao significa necessariamente o mesmo atendimento. Um
  // link pessoal de outro corretor abre uma nova oportunidade e preserva a
  // carteira anterior; o mesmo link continua atualizando o atendimento
  // existente sem duplicar a pessoa.
  const existing = await findMatchingRegistration({ fullName: validation.data.fullName, phoneNormalized: validation.data.phoneNormalized }, {});
  const hasDifferentDirectAttendance = Boolean(
    existing?.id &&
    isDirectBrokerLink &&
    responsibleUserId &&
    existing.responsibleUserId &&
    existing.responsibleUserId !== responsibleUserId
  );
  if (existing?.id && !hasDifferentDirectAttendance) {
    // O preenchimento do link de simulacao e uma nova interacao do mesmo
    // atendimento: preserva responsavel/origem e avanca a etapa para
    // "Aguardando simulacao" sem criar cliente duplicado.
    const updated = await updateSimulationRegistration(existing.id, {
      ...validation.data,
      status: CLIENT_STATUS.PENDING
    }, null);
    await recordCampaignDuplicateSubmission({ campaignId: campaign?.id, clientId: existing.id, journeyType: "simulation" });
    try {
      await syncCrmClientAttendance(updated);
    } catch (syncError) {
      console.error("CRM client/attendance sync failed:", syncError?.message || syncError);
    }
    return ensureRegistrationPreferenceToken(updated);
  }

  const registrationData = {
    ...validation.data,
    responsibleUserId,
    distributionType,
    directBrokerLink: isDirectBrokerLink,
    journeyType: "simulation",
    acquisitionContext: buildLeadOrigin({ campaign, direct: isDirectBrokerLink, team: isTeamDistribution, ref: providedRef, roulette: isRouletteAssignment, attribution: payload.attribution })
  };

  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .insert(registrationToRecord(registrationData))
    .select("*")
    .single();

  if (error) throw error;
  const registration = rowToSimulationRegistration(data);
  try {
    await syncCrmClientAttendance(registration);
  } catch (syncError) {
    console.error("CRM client/attendance sync failed:", syncError?.message || syncError);
  }
  await finalizeExternalClientOrigin(registration, assignment);

  return ensureRegistrationPreferenceToken(registration);
}

// Dispara o evento "Lead" para a Meta (Conversions API) — nunca com o valor
// exato da renda, só a faixa (ver lib/meta-pixel-shared.js), e nunca bloqueia
// o cadastro real se a Meta estiver fora do ar/sem token configurado.
function fireMetaLeadEvent({ phone, eventId, incomeBracket = "", requestMetadata = {} }) {
  sendMetaLeadEvent({
    phone,
    eventId,
    incomeBracket,
    eventSourceUrl: requestMetadata.eventSourceUrl,
    clientIp: requestMetadata.clientIp,
    userAgent: requestMetadata.userAgent
  }).catch(() => {});
}

// Jornada "Atendimento Rápido": mesma etapa de link (campanha/ref/roleta) do
// formulário completo, só que com o mínimo de campos (nome, WhatsApp,
// preferência de contato) — nunca uma lógica de cliente/distribuição
// paralela, é um cliente normal do CRM com menos dados iniciais. Dedup
// reaproveita a mesma regra por telefone/nome já usada no cadastro manual
// (findMatchingRegistration) — se já existe um cadastro com esse telefone,
// ATUALIZA esse cadastro (nome/preferência de contato) em vez de criar outro
// nem consumir uma nova posição da roleta (evita duplo-clique/reenvio/retry
// de rede gerando dois cards). Responsável e origem original nunca mudam
// aqui — mesma regra do formulário completo (createSimulationRegistration).
export async function createQuickAttendanceRegistration(payload = {}, requestMetadata = {}) {
  const fullName = normalizePersonName(sanitizeText(payload.fullName));
  const phoneNormalized = toBrazilianE164(payload.phone || "");
  const contactPreference = payload.contactPreference === "call" ? "call" : "whatsapp";

  if (!fullName || fullName.length < 2) throw new Error("Informe seu nome.");
  if (!phoneNormalized) throw new Error("Informe um WhatsApp válido com DDD.");

  // Atendimento Rápido não coleta renda — evento vai sem faixa de renda.
  fireMetaLeadEvent({ phone: phoneNormalized, eventId: payload.metaEventId, requestMetadata });

  const assignment = await resolveExternalLinkAssignment(payload);
  const { campaign, isTeamDistribution, providedRef, isDirectBrokerLink, isRouletteAssignment, responsibleUserId, distributionType } = assignment;
  const existing = await findMatchingRegistration({ fullName, phoneNormalized }, {});
  const hasDifferentDirectAttendance = Boolean(
    existing?.id &&
    isDirectBrokerLink &&
    responsibleUserId &&
    existing.responsibleUserId &&
    existing.responsibleUserId !== responsibleUserId
  );
  if (existing?.id && !hasDifferentDirectAttendance) {
    const updated = await updateSimulationRegistration(existing.id, { fullName, phone: payload.phone, contactPreference }, null);
    await recordCampaignDuplicateSubmission({ campaignId: campaign?.id, clientId: existing.id, journeyType: "quick_service" });
    try { await syncCrmClientAttendance(updated); } catch (syncError) { console.error("CRM client/attendance sync failed:", syncError?.message || syncError); }
    return ensureRegistrationPreferenceToken(updated);
  }

  const registrationData = {
    fullName,
    phone: formatBrazilianPhone(phoneNormalized),
    phoneNormalized,
    responsibleUserId,
    distributionType,
    directBrokerLink: isDirectBrokerLink,
    journeyType: "quick_service",
    contactPreference,
    acquisitionContext: buildLeadOrigin({ campaign, direct: isDirectBrokerLink, team: isTeamDistribution, ref: providedRef, roulette: isRouletteAssignment, attribution: payload.attribution })
  };

  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .insert(registrationToRecord(registrationData))
    .select("*")
    .single();

  if (error) throw error;
  const registration = rowToSimulationRegistration(data);
  try { await syncCrmClientAttendance(registration); } catch (syncError) { console.error("CRM client/attendance sync failed:", syncError?.message || syncError); }
  await finalizeExternalClientOrigin(registration, assignment);

  return ensureRegistrationPreferenceToken(registration);
}

async function resolveCampaignFromPayload(payload = {}) {
  const campaignId = String(payload.campaignId || payload.campaign_id || "").trim();
  if (!campaignId) return null;

  try {
    return await getCampaign(campaignId);
  } catch (campaignError) {
    console.warn("Campaign lookup failed:", campaignError?.message || campaignError);
    return null;
  }
}

export async function listSimulationRegistrations({ search = "", auth = null, responsibleUserId = "" } = {}) {
  await autoReturnStaleProspectingContacts();
  const supabase = getSimulationRegistrationsClient();
  let query = supabase
    .from("simulation_registrations")
    .select("*, client_tags(tag:tags(*))")
    .order("created_at", { ascending: false });

  query = applyResponsibleUserScope(query, auth, "responsible_user_id", responsibleUserId);
  query = applyDoNotContactScope(query, auth);

  let { data, error } = await query;
  if (error && isTagsSchemaError(error)) {
    let fallbackQuery = supabase
      .from("simulation_registrations")
      .select("*")
      .order("created_at", { ascending: false });

    fallbackQuery = applyResponsibleUserScope(fallbackQuery, auth, "responsible_user_id", responsibleUserId);
    fallbackQuery = applyDoNotContactScope(fallbackQuery, auth);
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
    return name.includes(searchQuery) || registration.clientCode.toLowerCase().includes(searchQuery) || (phoneQuery ? phone.includes(phoneQuery) : false);
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
  query = applyDoNotContactScope(query, auth);

  if (from) query = query.gte("scheduled_activity_at", from);
  if (to) query = query.lte("scheduled_activity_at", to);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => rowToSimulationRegistration(row));
}

export async function listBirthdayRegistrations({ auth = null, responsibleUserId = "" } = {}) {
  const supabase = getSimulationRegistrationsClient();
  let query = supabase
    .from("simulation_registrations")
    .select("*")
    .not("oldest_birth_date", "is", null)
    .neq("oldest_birth_date", MANUAL_DEFAULT_BIRTH_DATE)
    .order("oldest_birth_date", { ascending: true });

  query = applyResponsibleUserScope(query, auth, "responsible_user_id", responsibleUserId);
  query = applyDoNotContactScope(query, auth);

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
  assertCanViewDoNotContact(auth, registration.status);
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

  // Campos "relevantes para o usuário" (linha do tempo de auditoria, item 16
  // da tarefa) — mudança em qualquer um deles gera UM evento "data_updated"
  // resumido depois do update, comparando com o valor ANTES de sobrescrever
  // (por isso precisam entrar na leitura de "estado atual" abaixo).
  const trackedDiffFields = ["phone", "primaryMonthlyIncome", "secondaryMonthlyIncome", "primaryMaritalStatus", "hasOverThreeYearsRegisteredWork", "contactPreference"];
  const hasTrackedDiff = trackedDiffFields.some((field) => updates[field] !== undefined);

  if (auth || updates.status !== undefined || updates.responsibleUserId !== undefined || hasTrackedDiff) {
    const { data: current, error: readError } = await supabase
      .from("simulation_registrations")
      .select("id, status, last_admin_email, responsible_user_id, phone_normalized, primary_monthly_income, secondary_monthly_income, primary_marital_status, has_over_three_years_registered_work, contact_preference")
      .eq("id", id)
      .maybeSingle();

    if (readError) throw readError;
    currentRegistration = current;
    assertCanViewDoNotContact(auth, current?.status);
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
    const previousResponsibleUserId = currentRegistration?.responsible_user_id || null;
    const nextResponsibleUserId = updates.responsibleUserId || null;
    if (auth) {
      if (nextResponsibleUserId) assertCanAccessResponsibleUser(auth, nextResponsibleUserId);
      else assertGeneralAdminOrManager(auth);
    }
    record.responsible_user_id = nextResponsibleUserId;
    if (previousResponsibleUserId && nextResponsibleUserId && previousResponsibleUserId !== nextResponsibleUserId) {
      record.previous_responsible_user_id = previousResponsibleUserId;
      record.responsible_changed_at = new Date().toISOString();
    }
  }

  if (updates.fullName !== undefined) record.full_name = normalizePersonName(updates.fullName);
  if (updates.phone !== undefined) {
    record.phone_normalized = toBrazilianE164(updates.phone) || updates.phone;
    record.phone = formatBrazilianPhone(record.phone_normalized) || sanitizeText(updates.phone);
  }
  if (updates.contactPreference !== undefined) record.contact_preference = updates.contactPreference === "call" ? "call" : "whatsapp";
  if (updates.simulationType !== undefined) record.simulation_type = normalizeSimulationType(updates.simulationType);
  if (updates.oldestBirthDate !== undefined) record.oldest_birth_date = normalizeDate(updates.oldestBirthDate) || MANUAL_DEFAULT_BIRTH_DATE;
  if (updates.serviceStartedAt !== undefined) record.service_started_at = normalizeDate(updates.serviceStartedAt) || null;
  if (updates.saleCompletedAt !== undefined) record.sale_completed_at = normalizeDate(updates.saleCompletedAt) || null;
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
  // Usados pela folha de identificação do módulo de Documentação/CCA — só
  // preenchidos quando informados (nunca sobrescreve com vazio sem pedido
  // explícito).
  if (updates.cpf !== undefined) record.cpf = String(updates.cpf || "").replace(/\D/g, "").slice(0, 14) || null;
  if (updates.pis !== undefined) record.pis = String(updates.pis || "").replace(/\D/g, "").slice(0, 20) || null;
  if (updates.email !== undefined) record.email = String(updates.email || "").trim().slice(0, 200) || null;
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
    // Sem `adminEmail` explícito E sem um `auth` autenticado (ex.: a ação
    // "change_status" de uma regra de automação do CRM, chamada pelo cron
    // sem ator humano nenhum), NUNCA cai de volta no último humano que
    // editou o cliente — isso atribuiria pontuação de uma mudança 100%
    // automática a uma pessoa que não a fez. "sistema" é a mesma marca já
    // usada pelo marco automático de Reunião (ver ensureMeetingMilestoneBeforeSale),
    // reconhecida por performance-overview.js como automação = 0 pontos
    // sempre. Um humano autenticado que só esqueceu de repassar adminEmail
    // continua caindo no último e-mail conhecido, como antes.
    const changedBy = adminEmail || (auth?.ok && currentRegistration?.last_admin_email) || (auth?.ok ? "" : "sistema");
    await recordClientStatusChange({
      supabase,
      clientId: id,
      previousStatus: currentRegistration?.status || null,
      newStatus: nextStatus,
      changedAt: statusChangedAt,
      changedBy,
      source: updates.statusSource || (auth?.ok ? "manual" : "system")
    });
  }

  const updatedRegistration = rowToSimulationRegistration(data);

  // Linha do tempo de auditoria: transferência de responsável e alteração de
  // dados relevantes nunca são a mesma coisa — uma edição de cadastro comum
  // NUNCA aparece como transferência (só quando responsible_user_id de fato
  // mudou, já garantido pela mesma condição usada acima pra gravar
  // previous_responsible_user_id). Best-effort (logClientJourneyEvent já
  // nunca lança), nunca bloqueia a resposta real do update.
  try {
    const { logClientJourneyEvent, resolveActorSnapshot } = await import("./client-journey");
    const actor = resolveActorSnapshot(auth);

    // Transferência AUTOMÁTICA (SLA/roleta, sem `auth` — vem do cron de
    // automações) já é registrada por recordLeadDistributionHistory
    // (mesclada na leitura da timeline via "distribution:auto_transferred");
    // logar de novo aqui duplicaria o mesmo evento. Só o caminho MANUAL
    // (admin/gestor trocando o responsável pela tela) grava aqui.
    if (auth?.ok && record.responsible_user_id !== undefined && currentRegistration?.responsible_user_id && record.responsible_user_id && currentRegistration.responsible_user_id !== record.responsible_user_id) {
      const [{ data: fromProfile }, { data: toProfile }] = await Promise.all([
        supabase.from("admin_users").select("name").eq("id", currentRegistration.responsible_user_id).maybeSingle(),
        supabase.from("admin_users").select("name").eq("id", record.responsible_user_id).maybeSingle()
      ]);
      await logClientJourneyEvent({
        clientId: id,
        eventType: "responsible_transferred",
        actor,
        details: { fromId: currentRegistration.responsible_user_id, fromName: fromProfile?.name || "", toId: record.responsible_user_id, toName: toProfile?.name || "", transferType: "manual" }
      });
    }

    if (hasTrackedDiff && currentRegistration) {
      const changedFields = [];
      if (record.phone_normalized !== undefined && record.phone_normalized !== currentRegistration.phone_normalized) {
        changedFields.push({ field: "phone", fromLast4: (currentRegistration.phone_normalized || "").slice(-4), toLast4: (record.phone_normalized || "").slice(-4) });
      }
      if (record.primary_monthly_income !== undefined && Number(record.primary_monthly_income) !== Number(currentRegistration.primary_monthly_income)) changedFields.push({ field: "primaryMonthlyIncome" });
      if (record.secondary_monthly_income !== undefined && Number(record.secondary_monthly_income || 0) !== Number(currentRegistration.secondary_monthly_income || 0)) changedFields.push({ field: "secondaryMonthlyIncome" });
      if (record.primary_marital_status !== undefined && record.primary_marital_status !== currentRegistration.primary_marital_status) changedFields.push({ field: "primaryMaritalStatus" });
      if (record.has_over_three_years_registered_work !== undefined && record.has_over_three_years_registered_work !== currentRegistration.has_over_three_years_registered_work) changedFields.push({ field: "hasOverThreeYearsRegisteredWork" });
      if (record.contact_preference !== undefined && record.contact_preference !== currentRegistration.contact_preference) changedFields.push({ field: "contactPreference" });

      if (changedFields.length) {
        await logClientJourneyEvent({ clientId: id, eventType: "data_updated", actor, details: { fields: changedFields } });
      }
    }
  } catch (timelineError) {
    console.warn("Falha ao registrar evento na linha do tempo do cliente:", timelineError?.message || timelineError);
  }

  const enteredSalePipeline = statusChangedAt
    && SALE_PIPELINE_STATUSES.has(nextStatus)
    && !SALE_PIPELINE_STATUSES.has(normalizeClientStatus(currentRegistration?.status));
  if (enteredSalePipeline) {
    // Regra do funil: Venda sem Reunião registrada antes gera automaticamente
    // o marco "Reunião realizada" (para não quebrar a consistência matemática
    // do funil de 8 etapas) — sem inventar as etapas anteriores (Simulação,
    // Documentação, Aprovação), só a Reunião, exatamente ligada a Venda.
    try {
      await ensureMeetingMilestoneBeforeSale(supabase, id, statusChangedAt);
    } catch (meetingError) {
      console.error("Nao foi possivel registrar o marco automatico de reuniao.", meetingError);
    }

    try {
      const saleDate = updatedRegistration.saleCompletedAt || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(statusChangedAt));
      await ensureFinancialSaleForRegistration(updatedRegistration, adminEmail, saleDate);
      const { logClientJourneyEvent, resolveActorSnapshot } = await import("./client-journey");
      await logClientJourneyEvent({ clientId: id, eventType: "sale_registered", actor: resolveActorSnapshot(auth), details: {} });
    } catch (financialError) {
      console.error("Nao foi possivel criar a venda financeira automaticamente.", financialError);
    }
  }

  if (updates.saleCompletedAt !== undefined && updatedRegistration.saleCompletedAt) {
    await ensureFinancialSaleForRegistration(updatedRegistration, adminEmail, updatedRegistration.saleCompletedAt, { updateExistingDate: true });
  }

  return updatedRegistration;
}

// Regra de negócio: nenhum cliente pode ficar sem corretor responsável — todo
// caminho de entrada (formulário, cadastro manual, roleta, importação de
// prospecção etc.) já define um responsável; se por qualquer motivo alguém
// ficar sem (ex.: broker excluído, reatribuição manual para "sem
// responsável", falha do round-robin), cai automaticamente para o
// administrador principal. Não recalcula previous_responsible_user_id/
// responsible_changed_at aqui — esses campos registram transferência REAL
// entre dois responsáveis, não a captura de um órfão (mesma convenção já
// usada em updateSimulationRegistration).
export async function reassignOrphanedClientsToOwner() {
  const supabase = getSimulationRegistrationsClient();
  const profiles = await listAdminProfiles();
  const owner = profiles.find((profile) => isOwnerAdminEmail(profile.email));
  if (!owner) return { reassigned: 0, ownerId: "" };

  const { data, error } = await supabase
    .from("simulation_registrations")
    .update({ responsible_user_id: owner.id })
    .is("responsible_user_id", null)
    .select("id");
  if (error) throw error;
  return { reassigned: (data || []).length, ownerId: owner.id };
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
    // EDITAR um cliente já existente NUNCA transfere o responsável sozinho —
    // responsibleUserId só entra no update quando o chamador pediu
    // EXPLICITAMENTE (payload.responsibleUserId, ex.: o seletor de
    // responsável do card do cliente). O valor calculado acima por
    // resolveResponsibleUserIdFromPayload já cai de volta no usuário logado
    // quando o payload não traz nada — fallback correto para CRIAR um
    // cadastro novo (mais abaixo), mas nunca para editar um já existente:
    // sem esta distinção, um gestor/admin só editando dados cadastrais ou
    // registrando uma simulação de um cliente de outro corretor virava
    // "dono" dele silenciosamente.
    const explicitResponsibleUserId = payload.responsibleUserId !== undefined ? responsibleUserId : undefined;

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
          serviceStartedAt: draft.serviceStartedAt,
          saleCompletedAt: draft.saleCompletedAt,
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
          ...(explicitResponsibleUserId !== undefined ? { responsibleUserId: explicitResponsibleUserId } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {})
        }
      : {
          ...minimalUpdates,
          ...(explicitResponsibleUserId !== undefined ? { responsibleUserId: explicitResponsibleUserId } : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {})
        };

    const updated = await updateSimulationRegistration(existing.id, updates, auth);
    try { await syncCrmClientAttendance(updated); } catch (syncError) { console.error("CRM client/attendance sync failed:", syncError?.message || syncError); }
    return updated;
  }

  const supabase = getSimulationRegistrationsClient();
  const { data, error } = await supabase
    .from("simulation_registrations")
    .insert(registrationToRecord({ ...draft, status: payload.status || CLIENT_STATUS.PENDING, adminEmail: payload.adminEmail,
      acquisitionContext: payload.acquisitionContext || { kind: "manual", label: `Cadastro manual — ${auth?.profile?.name || payload.adminEmail || "Equipe"}`, actor: auth?.user?.email || payload.adminEmail || null, destination: "broker" }
    }))
    .select("*")
    .single();

  if (error) throw error;
  try { await syncCrmClientAttendance(data); } catch (syncError) { console.error("CRM client/attendance sync failed:", syncError?.message || syncError); }
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
    CLIENT_STATUS.RESTRICTION,
    CLIENT_STATUS.SHIELDING,
    CLIENT_STATUS.APPROVED,
    CLIENT_STATUS.REJECTED,
    CLIENT_STATUS.SALE_COMPLETED,
    CLIENT_STATUS.SALE_FORMS,
    CLIENT_STATUS.SALE_RESERVATION,
    CLIENT_STATUS.SALE_CONTRACT,
    CLIENT_STATUS.SALE_CAIXA_SIGNATURE,
    CLIENT_STATUS.SALE_ITBI,
    CLIENT_STATUS.SALE_REGISTRY,
    CLIENT_STATUS.SALE_PAYMENT,
    CLIENT_STATUS.ARCHIVED,
    CLIENT_STATUS.DO_NOT_CONTACT
  ];
  if (
    !current ||
    manualStatuses.includes(current.status)
  ) {
    return current;
  }
  return updateSimulationRegistration(id, { status: CLIENT_STATUS.COMPLETED }, auth);
}

// Excluir um cliente é irreversível e definitivo (diferente de arquivar/
// marcar "não contactar") — restrito só ao administrador principal, nunca
// gestor/corretor, mesmo quem já podia editar/arquivar o cadastro.
export async function deleteSimulationRegistration(id, auth = null) {
  if (auth) {
    assertOwnerAdmin(auth);
    await getSimulationRegistration(id, auth);
  }
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

  if (error?.code === "23505" || normalized.includes("duplicate key")) {
    return "Não foi possível registrar este novo envio devido a uma restrição de duplicidade. Entre em contato com o atendimento.";
  }
  if (error?.code === "23514" || normalized.includes("violates check constraint")) {
    return "Um dos dados informados não foi aceito. Confira telefone, data de nascimento e valores antes de enviar novamente.";
  }
  if (error?.code === "23503" || normalized.includes("violates foreign key constraint")) {
    return "Não foi possível vincular o cadastro ao responsável. Solicite um link atualizado ao atendimento.";
  }

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
    (error?.code === "42P01" || error?.code === "PGRST205" || normalized.includes("does not exist")) &&
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
    clientCode: row.client_code || "",
    prospectingContactId: row.prospecting_contact_id || "",
    prospectingAssignedPending: row.prospecting_assigned_pending === true,
    prospectingAssignedByUserId: row.prospecting_assigned_by_user_id || "",
    responsibleUserId: row.responsible_user_id || "",
    simulationType: row.simulation_type || "individual",
    fullName: normalizePersonName(row.full_name || ""),
    phone: row.phone || "",
    phoneNormalized: row.phone_normalized || "",
    oldestBirthDate: row.oldest_birth_date || "",
    serviceStartedAt: row.service_started_at || "",
    saleCompletedAt: row.sale_completed_at || "",
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
    cpf: row.cpf || "",
    pis: row.pis || "",
    email: row.email || "",
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
    journeyType: row.journey_type || "",
    contactPreference: row.contact_preference || "",
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
    service_started_at: normalizeDate(registration.serviceStartedAt) || null,
    sale_completed_at: normalizeDate(registration.saleCompletedAt) || null,
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
  if (registration.acquisitionContext) record.acquisition_context = registration.acquisitionContext;
  if (registration.responsibleUserId !== undefined) record.responsible_user_id = registration.responsibleUserId || null;
  if (registration.distributionType) record.distribution_type = registration.distributionType;
  if (registration.directBrokerLink !== undefined) record.direct_broker_link = Boolean(registration.directBrokerLink);
  if (registration.journeyType !== undefined) record.journey_type = registration.journeyType || null;
  if (registration.contactPreference !== undefined) record.contact_preference = registration.contactPreference || null;
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

const MEETING_STATUSES = [CLIENT_STATUS.MEETING_PENDING, CLIENT_STATUS.MEETING_DONE];

// Cliente que pula direto para Venda sem nunca ter passado por Reunião ganha
// o marco "Reunião realizada" automaticamente, 1s antes do evento de venda,
// marcado com origem "automatico_por_venda" para auditoria — não fabricamos
// nenhuma outra etapa (simulação/documentação/aprovação) por trás disso.
async function ensureMeetingMilestoneBeforeSale(supabase, clientId, saleChangedAt) {
  const { data: existingMeeting, error: checkError } = await supabase
    .from("client_status_history")
    .select("id")
    .eq("client_id", clientId)
    .in("new_status", MEETING_STATUSES)
    .limit(1)
    .maybeSingle();
  if (checkError) throw checkError;
  if (existingMeeting) return;

  const autoMeetingAt = new Date(new Date(saleChangedAt).getTime() - 1000).toISOString();
  await recordClientStatusChange({
    supabase,
    clientId,
    previousStatus: null,
    newStatus: CLIENT_STATUS.MEETING_DONE,
    changedAt: autoMeetingAt,
    changedBy: "sistema",
    source: "automatico_por_venda"
  });
}

async function resolveResponsibleUserIdFromPayload(payload = {}, type = "simulation", auth = null, meta = null) {
  if (isBrokerProfile(auth?.profile) && canUseProfileDatabaseScope(auth.profile)) {
    return auth.profile.id;
  }

  if (payload.responsibleUserId !== undefined) {
    if (auth) {
      if (payload.responsibleUserId) assertCanAccessResponsibleUser(auth, payload.responsibleUserId);
      else assertGeneralAdminOrManager(auth);
    }
    return payload.responsibleUserId || null;
  }

  if (auth?.profile && canUseProfileDatabaseScope(auth.profile)) {
    return auth.profile.id;
  }

  const ref = sanitizeText(payload.brokerRef || payload.ref || payload.responsibleRef || "");
  if (!ref) {
    const defaultProfile = await resolveAdminProfileByRef(DEFAULT_SIMULATION_BROKER_REF, type);
    return canUseProfileDatabaseScope(defaultProfile) ? defaultProfile.id : null;
  }
  if (normalizeBrokerRef(ref) === "equipe") {
    const roulette = await assignRoundRobinLead();
    if (!roulette.brokerId) throw new Error("Nenhum corretor está ativo na distribuição de leads.");
    if (meta) meta.roulette = { tier: roulette.tier, skippedNames: roulette.skippedNames };
    return roulette.brokerId;
  }

  const profile = await resolveAdminProfileByRef(ref, type);
  if (!canUseProfileDatabaseScope(profile) || profile.status !== "active") {
    throw new Error("Este link de corretor é inválido ou está inativo.");
  }
  return profile.id;
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
    serviceStartedAt: normalizeDate(payload.serviceStartedAt),
    saleCompletedAt: normalizeDate(payload.saleCompletedAt),
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
