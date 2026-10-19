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
  markRegistrationAutoSimulation,
  markRegistrationSimulationCompleted
} from "./simulation-registrations";
import { normalizePersonName } from "./name-utils";
import { extractSimulationModelsFromNote, simulationModelHasValues } from "./simulation-models";
import { simulationRequiredFieldsError } from "./simulation-required-fields.mjs";
import { AUTOMATIC_INCOME_NOTE_PREFIX, AUTOMATIC_SIMULATION_SOURCE, isAutomaticSimulationSource } from "./simulation-status-lock-core.mjs";
import { ESTIMATE_DISCLAIMER, estimateFinancing, suggestedInformalIncome, todayInSaoPaulo } from "./financiamento-estimativa-core.mjs";
import { recordAutoSimulationCorrection, saveAutoSnapshot } from "./simulation-auto-reviews";
import { getScenario, markScenarioChecked, recordScenario, SCENARIOS_SCHEMA_MESSAGE } from "./simulation-scenarios";
import { scenarioDataFromSimulation, scenarioModelsForForm } from "./simulation-scenarios-core.mjs";
import { isMissingColumnError } from "./supabase-errors";
import { INTEREST_COLUMN_MISSING_WARNING, isInterestColumnMissingError } from "./interest-rate.mjs";
import { applyResponsibleUserScope, assertCanAccessResponsibleUser, assertOwnerAdmin } from "./admin-access";
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

// Quem criou a simulação (created_by_user_id) nem sempre é o responsável atual
// pelo cliente — simulação criada por admin/gestor para cliente de corretor, cliente
// transferido depois, ou simulação sem dono (created_by_user_id nulo, ~1/3 da base).
// Basta o usuário poder acessar o criador OU o responsável pelo cliente vinculado;
// exigir só o criador bloqueava o corretor dono do cliente com "Acesso negado".
async function assertCanAccessSimulationRow(supabase, auth, row) {
  try {
    assertCanAccessResponsibleUser(auth, row.created_by_user_id || "");
    return;
  } catch (creatorError) {
    if (!row.registration_id) throw creatorError;
    const { data: registration, error } = await supabase
      .from("simulation_registrations")
      .select("responsible_user_id, returned_from_user_id")
      .eq("id", row.registration_id)
      .maybeSingle();
    if (error || !registration) throw creatorError;
    assertCanAccessResponsibleUser(auth, registration.responsible_user_id || registration.returned_from_user_id || "");
  }
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
  if (auth) await assertCanAccessSimulationRow(supabase, auth, data);

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

// Prazo e taxa obrigatórios no salvamento MANUAL do Gerador (regra do dono, 2026-10-18; `lib/simulation-required-fields.mjs`).
// O autosave (`autosave: true`) não é barrado: a edição em andamento e as simulações antigas continuam salvando.
// `storedRate` = taxa já gravada, usada quando o payload não traz o campo (quem não conhece o campo não apaga a taxa).
function assertRequiredSimulationFields(payload = {}, storedRate = null) {
  if (payload?.autosave === true) return;
  const simulationModels = payload.simulationModels || extractSimulationModelsFromNote(payload.internalNote);
  const interestRateAnnual = payload.interestRateAnnual === undefined ? storedRate : payload.interestRateAnnual;
  const error = simulationRequiredFieldsError({ ...payload, simulationModels, interestRateAnnual });
  if (error) throw new Error(error);
}

export async function createSimulation(payload, userEmail = "", auth = null, options = {}) {
  assertRequiredSimulationFields(payload);
  const supabase = getSimulationClient();
  const payloadWithRegistration = await attachManualRegistration(payload, auth);
  const record = simulationToRecord({
    ...payloadWithRegistration,
    createdByUserId: resolveSimulationOwnerId(payloadWithRegistration, auth)
  }, userEmail);
  const { data, warning } = await writeSimulationRecord(
    (current) => supabase.from("simulations").insert(current).select("*").single(),
    record
  );
  await replaceSimulationProperties(data.id, payloadWithRegistration.properties || []);
  // "Comparar simulações": simulação nova do corretor com valores vira um cenário (sem duplicar o último igual).
  if (!options.skipScenario && payload?.autosave !== true && payloadWithRegistration.registrationId && simulationHasMeaningfulValues(payloadWithRegistration)) {
    const saved = rowToSimulation(data);
    if (!isAutomaticSimulationSource(saved.createdBy) && saved.createdBy !== SITE_REGISTRATION_SIMULATION_SOURCE) {
      await recordScenario({ registrationId: payloadWithRegistration.registrationId, simulationId: data.id, origin: "corretor", checked: true, data: scenarioDataFromSimulation(saved, { registration: payloadWithRegistration.registration || {} }), actor: { email: userEmail, userId: auth?.profile?.id || "" }, dedupe: true });
    }
  }
  return withSaveWarning(await getSimulation(data.id, auth), warning);
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
      simulationDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()),
      publicNote: "",
      internalNote: buildRegistrationInternalNote(registration),
      outputMode: "individual",
      properties: []
    },
    SITE_REGISTRATION_SIMULATION_SOURCE
  );
}

// SIM-AUTO (dono, 2026-10-19): cadastro do site elegível ao MCMV ganha a simulação automática GRAVADA como as do
// corretor (mesma tabela e formato: modelos "Imóvel novo" e "Imóvel usado", Price, prazo e taxa), marcada pelo
// `created_by` = AUTOMATIC_SIMULATION_SOURCE (não vale como simulação real — lib/simulation-status-lock-core.mjs).
// Idempotente: reenvio do formulário atualiza a MESMA linha enquanto ela for automática (ou a vazia "Cadastro do site");
// simulação que o corretor já salvou nunca é tocada. Fora do MCMV: a simulação vazia de sempre.
// Não marca "Simulação realizada" (não passa por markRegistrationSimulationCompleted).
export async function saveSiteSimulationFromRegistration(registration) {
  const referenceDate = todayInSaoPaulo();
  const estimate = estimateFinancing(registration || {}, referenceDate);
  if (!estimate.eligible) return { automatic: false, simulation: await createPendingSimulationFromRegistration(registration) };
  const supabase = getSimulationClient();
  const existing = await latestRegistrationSimulationRow(supabase, registration.id);
  const replaceable = !existing || isAutomaticSimulationSource(existing.created_by)
    || (existing.created_by === SITE_REGISTRATION_SIMULATION_SOURCE && !(Number(existing.financing_value) > 0) && !(Number(existing.subsidy_value) > 0));
  if (!replaceable) return { automatic: false, simulation: null };
  const simulation = await writeAutomaticSimulation(supabase, existing, registration, estimate);
  return { automatic: true, simulation, estimate, referenceDate };
}

async function latestRegistrationSimulationRow(supabase, registrationId) {
  const { data: rows, error } = await supabase
    .from("simulations")
    .select("id, created_by, financing_value, subsidy_value")
    .eq("registration_id", registrationId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return rows?.[0] || null;
}

async function writeAutomaticSimulation(supabase, existing, registration, estimate, extra = {}) {
  const record = simulationToRecord({ ...buildAutomaticSimulationPayload(registration, estimate, extra), createdByUserId: registration.responsibleUserId || "" }, AUTOMATIC_SIMULATION_SOURCE);
  const { data } = await writeSimulationRecord(
    (current) => (existing
      ? supabase.from("simulations").update(current).eq("id", existing.id).select("*").single()
      : supabase.from("simulations").insert(current).select("*").single()),
    record
  );
  return rowToSimulation(data);
}

export const REDO_REPLACE_CONFIRMATION = "Isso substitui a simulação atual. Continuar?";

export class AutomaticSimulationError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = "AutomaticSimulationError";
    this.status = status;
  }
}

const NOT_ELIGIBLE_MESSAGES = {
  has_property: "O cadastro diz que o cliente tem imóvel no nome: o Minha Casa Minha Vida não se aplica.",
  income: "Informe a renda no cadastro do cliente para refazer a simulação.",
  income_above_program: "A renda do cadastro passa de R$ 13.000: fora do Minha Casa Minha Vida.",
  birth_date: "Informe a data de nascimento do mais velho no cadastro para refazer a simulação.",
  age: "Pela idade do mais velho não sobra prazo mínimo de financiamento (60 meses)."
};

// "Refazer simulação automática" (REGRA OFICIAL — dono, 2026-10-19): recalcula com os dados ATUAIS do cadastro (novo +
// usado), com a renda DO CADASTRO (informal só com o teto de R$ 2.550 por pessoa; o melhor cenário vira sugestão na nota).
// Mesma gravação da simulação automática (volta a exigir a conferência; link/imagem bloqueados até OK/Corrigir).
// Simulação salva pelo corretor só é substituída com `confirmReplace` ("Isso substitui a simulação atual. Continuar?").
// Não muda etapa do cliente (só "Aguardando simulação" → "Simulação automática") e não envia nada.
export async function redoAutomaticSimulation(registrationId, { confirmReplace = false } = {}, auth) {
  const registration = await getSimulationRegistration(registrationId, auth);
  if (!registration) throw new AutomaticSimulationError("Cliente não encontrado.", 404);
  assertCanAccessResponsibleUser(auth, registration.responsibleUserId || "");
  const referenceDate = todayInSaoPaulo();
  const estimate = estimateFinancing(registration, referenceDate, { incomeMode: "registered" });
  if (!estimate.eligible) throw new AutomaticSimulationError(NOT_ELIGIBLE_MESSAGES[estimate.reason] || "Não foi possível refazer a simulação com os dados do cadastro.");
  const suggestion = suggestedInformalIncome(registration, referenceDate);
  const supabase = getSimulationClient();
  const existing = await latestRegistrationSimulationRow(supabase, registration.id);
  const manual = Boolean(existing) && !isAutomaticSimulationSource(existing.created_by)
    && (Number(existing.financing_value) > 0 || Number(existing.subsidy_value) > 0);
  if (manual && !confirmReplace) return { needsConfirmation: true, message: REDO_REPLACE_CONFIRMATION };
  const simulation = await writeAutomaticSimulation(supabase, existing, registration, estimate, { suggestion });
  return { needsConfirmation: false, simulation, estimate, referenceDate, suggestion, replacedManual: manual, registration };
}

function automaticMoney(value) {
  return `R$ ${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function incomeText(total, primary, secondary) {
  return `${automaticMoney(total)}${secondary > 0 ? ` (titular ${automaticMoney(primary)}; 2ª pessoa ${automaticMoney(secondary)})` : ""}`;
}

/** Linha "Renda para usar na Caixa — novo: R$ X / usado: R$ Y" (novo e usado têm rendas próprias desde 2026-10-19). */
// "Usar este cenário" (aba "Comparar simulações", REGRA OFICIAL — dono, 2026-10-19): copia os valores do cenário para a
// simulação atual (confirmação antes de substituir). Cenário conferido na Caixa → vira simulação do corretor (link
// liberado, mesma gravação do "Salvar" do Gerador). Não conferido → volta a ser simulação automática (conferência
// obrigatória, link bloqueado). Nunca apaga cenário; não grava cenário novo (é reuso) e não envia nada.
export async function applySimulationScenario(registrationId, scenarioId, { confirmReplace = false } = {}, auth) {
  const registration = await getSimulationRegistration(registrationId, auth);
  if (!registration) throw new AutomaticSimulationError("Cliente não encontrado.", 404);
  assertCanAccessResponsibleUser(auth, registration.responsibleUserId || "");
  const { schemaReady, scenario } = await getScenario(registration.id, scenarioId);
  if (!schemaReady) throw new AutomaticSimulationError(SCENARIOS_SCHEMA_MESSAGE, 503);
  if (!scenario) throw new AutomaticSimulationError("Cenário não encontrado.", 404);
  const supabase = getSimulationClient();
  const existing = await latestRegistrationSimulationRow(supabase, registration.id);
  if (existing && (Number(existing.financing_value) > 0 || Number(existing.subsidy_value) > 0) && !confirmReplace) {
    return { needsConfirmation: true, message: REDO_REPLACE_CONFIRMATION };
  }
  const current = existing ? await getSimulation(existing.id, auth) : null;
  const { registration: _registration, ...base } = current || {};
  const models = scenarioModelsForForm(scenario.data);
  const primary = scenario.data.novo?.power > 0 ? "novo" : "usado";
  const payload = {
    ...base,
    registrationId: registration.id,
    clientName: base.clientName || registration.fullName,
    simulationType: primary,
    simulationModels: models,
    financingValue: scenario.data[primary].price.financing,
    subsidyValue: scenario.data[primary].price.subsidy,
    firstInstallment: scenario.data[primary].price.firstInstallment,
    lastInstallment: scenario.data[primary].price.lastInstallment,
    interestRateAnnual: Number(scenario.data.annualRate) || undefined,
    autosave: false
  };
  if (scenario.checked) {
    const saved = current
      ? await updateSimulation(current.id, { ...payload, createdBy: isAutomaticSimulationSource(current.createdBy) ? "" : current.createdBy }, auth?.user?.email || "", auth, { skipScenario: true, fromScenario: true })
      : await createSimulation({ ...payload, createdBy: "" }, auth?.user?.email || "", auth, { skipScenario: true });
    return { needsConfirmation: false, checked: true, simulation: saved };
  }
  const record = simulationToRecord({ ...payload, createdBy: AUTOMATIC_SIMULATION_SOURCE, createdByUserId: registration.responsibleUserId || "" }, AUTOMATIC_SIMULATION_SOURCE);
  const { data } = await writeSimulationRecord(
    (row) => (existing
      ? supabase.from("simulations").update(row).eq("id", existing.id).select("*").single()
      : supabase.from("simulations").insert(row).select("*").single()),
    record
  );
  try {
    await markRegistrationAutoSimulation(registration.id);
    if (scenario.data.autoSnapshot) await saveAutoSnapshot({ registrationId: registration.id, simulationId: data.id, snapshot: scenario.data.autoSnapshot, newRound: true });
  } catch (followUpError) {
    console.warn("Usar cenário: status/conferência não atualizados:", followUpError?.message || followUpError);
  }
  return { needsConfirmation: false, checked: false, simulation: rowToSimulation(data) };
}

export function automaticIncomeLine(estimate) {
  const used = estimate.used || {};
  const novo = incomeText(estimate.income, estimate.primaryIncomeConsidered, estimate.secondaryIncomeConsidered);
  const usado = incomeText(used.income ?? estimate.income, used.primaryIncomeConsidered ?? estimate.primaryIncomeConsidered, used.secondaryIncomeConsidered ?? estimate.secondaryIncomeConsidered);
  return `${AUTOMATIC_INCOME_NOTE_PREFIX} novo: ${novo} / usado: ${usado}${estimate.incomeAdjusted || Math.abs((used.income ?? estimate.income) - estimate.declaredIncome) > 0.005
    ? ` (declarada ${automaticMoney(estimate.declaredIncome)})` : ""}`;
}

export function buildAutomaticSimulationPayload(registration, estimate, { suggestion = null } = {}) {
  const used = estimate.used || {};
  const novo = {
    financingValue: automaticMoney(estimate.financing),
    subsidyValue: automaticMoney(estimate.subsidy),
    firstInstallment: automaticMoney(estimate.priceFirstInstallment),
    lastInstallment: automaticMoney(estimate.priceLastInstallment),
    termMonths: String(estimate.termMonths)
  };
  const usado = {
    financingValue: automaticMoney(used.financing ?? estimate.financing),
    subsidyValue: automaticMoney(used.subsidy),
    firstInstallment: automaticMoney(used.priceFirstInstallment ?? estimate.priceFirstInstallment),
    lastInstallment: automaticMoney(used.priceLastInstallment ?? estimate.priceLastInstallment),
    termMonths: String(used.termMonths ?? estimate.termMonths)
  };
  const suggestionDiffers = suggestion && (Math.abs(suggestion.novo - estimate.income) > 0.005 || Math.abs(suggestion.usado - (used.income ?? estimate.income)) > 0.005);
  const phone = String(registration.phoneNormalized || registration.phone || "").replace(/\D/g, "");
  return {
    registrationId: registration.id,
    clientName: registration.fullName,
    simulationType: "novo",
    financingValue: estimate.financing,
    subsidyValue: estimate.subsidy,
    firstInstallment: estimate.priceFirstInstallment,
    lastInstallment: estimate.priceLastInstallment,
    downPaymentValue: "",
    fgtsValue: "",
    showExpandedPower: false,
    simulationDate: todayInSaoPaulo(),
    publicNote: ESTIMATE_DISCLAIMER,
    internalNote: [
      phone ? `${CLIENT_WHATSAPP_NOTE_PREFIX} ${phone}` : "",
      "Simulação automática do site (estimativa) — confirme no simulador da Caixa e salve no Gerador.",
      automaticIncomeLine(estimate),
      used.annualRate && used.annualRate !== estimate.annualRate ? `Taxa do usado com a renda dele: ${String(used.annualRate).replace(".", ",")}% a.a. (a taxa da simulação é a do novo).` : "",
      estimate.informalCapped ? "Renda informal acima de R$ 2.550 por pessoa: aplicado o teto da Caixa." : "",
      suggestionDiffers ? `Renda sugerida para informal: novo ${automaticMoney(suggestion.novo)} / usado ${automaticMoney(suggestion.usado)} (melhor cenário)` : ""
    ].filter(Boolean).join("\n"),
    outputMode: "individual",
    interestRateAnnual: estimate.annualRate,
    simulationModels: { novo, usado },
    createdBy: AUTOMATIC_SIMULATION_SOURCE
  };
}

export async function updateSimulation(id, payload, userEmail = "", auth = null, options = {}) {
  const supabase = getSimulationClient();
  const current = await getSimulation(id, auth);
  if (!current) throw new Error("Simulação não encontrada.");
  assertRequiredSimulationFields(payload, current.interestRateAnnual);
  const payloadWithRegistration = await attachManualRegistration(payload, auth);
  // SIM-AUTO: a simulação automática do site só vira simulação do corretor quando ele SALVA no Gerador (o formulário
  // devolve o `createdBy` carregado; sem esta troca ela ficaria automática para sempre). Autosave não troca nem marca
  // "Simulação realizada".
  const automaticDraft = isAutomaticSimulationSource(current.createdBy) && payload?.autosave === true;
  const takesOverAutomatic = isAutomaticSimulationSource(current.createdBy) && !automaticDraft;
  // A marca automática nunca volta pelo formulário (tela aberta antes do OK ainda guarda o `createdBy` antigo).
  const staleAutomaticMark = !isAutomaticSimulationSource(current.createdBy) && isAutomaticSimulationSource(payloadWithRegistration.createdBy);
  const record = simulationToRecord({
    ...payloadWithRegistration,
    ...(takesOverAutomatic ? { createdBy: "" } : {}),
    ...(staleAutomaticMark ? { createdBy: current.createdBy } : {}),
    createdByUserId: current.createdByUserId || resolveSimulationOwnerId(payloadWithRegistration, auth)
  }, userEmail);
  const { data, warning } = await writeSimulationRecord(
    (current) => supabase.from("simulations").update(current).eq("id", id).select("*").single(),
    record
  );
  await replaceSimulationProperties(data.id, payloadWithRegistration.properties || []);
  // Conferência (botões temporários): a simulação automática salva no Gerador guarda os valores da Caixa e, já
  // conferida, ganha o link da apresentação pronto (SIM-AUTO; antes disso nenhum link existe).
  if (takesOverAutomatic) {
    const takenOver = rowToSimulation(data);
    try {
      if (!options.fromScenario) await recordAutoSimulationCorrection({ simulation: takenOver, userEmail, userId: auth?.profile?.id || "" });
    } catch (reviewError) {
      console.warn("Falha ao registrar a correção da simulação automática:", reviewError?.message || reviewError);
    }
    try {
      const { ensurePresentation } = await import("./simulation-presentation");
      await ensurePresentation({ simulation: takenOver, userId: auth?.profile?.id || "" });
    } catch (presentationError) {
      console.warn("Falha ao gerar o link da simulação conferida:", presentationError?.message || presentationError);
    }
  }
  // "Comparar simulações" (dono, 2026-10-19): salvamento do corretor com valores novos vira cenário; o OK/correção da
  // simulação automática marca o cenário como "Conferida na Caixa" (ou grava o corrigido). Autosave nunca grava.
  if (!options.skipScenario && payload?.autosave !== true && payloadWithRegistration.registrationId && simulationHasMeaningfulValues(payloadWithRegistration)) {
    const saved = rowToSimulation(data);
    const scenarioData = scenarioDataFromSimulation(saved, { registration: payloadWithRegistration.registration || {} });
    const actor = { email: userEmail, userId: auth?.profile?.id || "" };
    if (takesOverAutomatic) await markScenarioChecked({ registrationId: payloadWithRegistration.registrationId, simulationId: data.id, data: scenarioData, actor });
    else if (!isAutomaticSimulationSource(saved.createdBy)) await recordScenario({ registrationId: payloadWithRegistration.registrationId, simulationId: data.id, origin: "corretor", checked: true, data: scenarioData, actor, dedupe: true });
  }
  if (!automaticDraft && payloadWithRegistration.registrationId && simulationHasMeaningfulValues(payloadWithRegistration)) {
    await markRegistrationSimulationCompleted(payloadWithRegistration.registrationId, auth);
  }
  return withSaveWarning(await getSimulation(data.id, auth), warning);
}

// Mesma regra de "só o administrador principal exclui" do cliente
// (deleteSimulationRegistration) — excluir a simulação é parte do mesmo
// fluxo "Excluir cliente" da Lista de clientes (components/clients/useClientList.js), nunca uma ação isolada.
export async function deleteSimulation(id, auth = null) {
  if (auth) assertOwnerAdmin(auth);
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

// Grava a simulação tolerando colunas ainda não migradas (a ordem de deploy nunca derruba o salvamento):
//  - registration_id ausente: tenta de novo sem ela (comportamento histórico);
//  - interest_rate_annual ausente (migration ainda não aplicada): salva TUDO sem a taxa e devolve um aviso
//    (só quando havia taxa a gravar), em vez de falhar o salvamento dos demais valores.
async function writeSimulationRecord(execute, record) {
  let current = record;
  let warning = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await execute(current);
    if (!error) return { data, warning };
    if ("interest_rate_annual" in current && isInterestColumnMissingError(error)) {
      const { interest_rate_annual: rate, ...rest } = current;
      if (rate !== null && rate !== undefined) warning = INTEREST_COLUMN_MISSING_WARNING;
      current = rest;
      continue;
    }
    if ("registration_id" in current && isMissingColumnError(error, "registration_id")) {
      current = withoutRegistrationColumn(current);
      continue;
    }
    throw error;
  }
  throw new Error("Não foi possível salvar a simulação.");
}

function withSaveWarning(simulation, warning) {
  return warning && simulation ? { ...simulation, saveWarning: warning } : simulation;
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
