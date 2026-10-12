import { z } from "zod";
import { sanitizeText } from "./simulation-registration-schema";
import {
  PROPERTY_PREFERENCE_STATUS,
  NO_PREFERENCE_VALUE,
  PROPERTY_TYPE_OPTIONS,
  PROPERTY_REGION_OPTIONS,
  PROPERTY_STAGE_OPTIONS,
  PROPERTY_BEDROOM_OPTIONS,
  PROPERTY_RENT_OPTIONS,
  PROPERTY_TIMELINE_OPTIONS,
  PROPERTY_PRIORITY_OPTIONS,
  hasCompletedPropertyPreferences,
  getPropertyPreferenceDetails,
  getPropertyPreferenceSummary,
  PROPERTY_TYPE_VALUES,
  PROPERTY_REGION_VALUES,
  PROPERTY_STAGE_VALUES,
  PROPERTY_BEDROOM_VALUES,
  PROPERTY_RENT_VALUES,
  PROPERTY_TIMELINE_VALUES,
  PROPERTY_PRIORITY_VALUES,
  PROPERTY_PREFERENCE_STATUS_VALUES,
  parseArray
} from "./property-preference-display.js";

export {
  PROPERTY_PREFERENCE_STATUS,
  NO_PREFERENCE_VALUE,
  PROPERTY_TYPE_OPTIONS,
  PROPERTY_REGION_OPTIONS,
  PROPERTY_STAGE_OPTIONS,
  PROPERTY_BEDROOM_OPTIONS,
  PROPERTY_RENT_OPTIONS,
  PROPERTY_TIMELINE_OPTIONS,
  PROPERTY_PRIORITY_OPTIONS,
  hasCompletedPropertyPreferences,
  getPropertyPreferenceDetails,
  getPropertyPreferenceSummary
} from "./property-preference-display.js";

const optionalEnum = (values) =>
  z.preprocess((value) => {
    const text = sanitizeText(value);
    return text || null;
  }, z.enum(values).nullable());

const booleanSchema = z.preprocess((value) => {
  if (value === true || value === "true" || value === "Sim") return true;
  if (value === false || value === "false" || value === "Não" || value === "Nao") return false;
  return undefined;
}, z.boolean({ error: "Escolha uma opção." }));

export class PropertyPreferencesValidationError extends Error {
  constructor(validation) {
    super(validation.formError || "Revise as preferências antes de continuar.");
    this.name = "PropertyPreferencesValidationError";
    this.fieldErrors = validation.fieldErrors || {};
  }
}

export function getDefaultPropertyPreferences(initial = {}) {
  return {
    preferredPropertyType: normalizeEnumValue(initial.preferredPropertyType, PROPERTY_TYPE_VALUES),
    preferredRegions: normalizePreferenceArray(initial.preferredRegions, PROPERTY_REGION_VALUES),
    preferredPropertyStage: normalizeEnumValue(initial.preferredPropertyStage, PROPERTY_STAGE_VALUES),
    preferredBedrooms: normalizeEnumValue(initial.preferredBedrooms, PROPERTY_BEDROOM_VALUES),
    rentsCurrently: typeof initial.rentsCurrently === "boolean" ? initial.rentsCurrently : null,
    rentPriceRange: normalizeEnumValue(initial.rentPriceRange, PROPERTY_RENT_VALUES),
    purchaseTimeline: normalizeEnumValue(initial.purchaseTimeline, PROPERTY_TIMELINE_VALUES),
    propertyPriorities: normalizePreferenceArray(initial.propertyPriorities, PROPERTY_PRIORITY_VALUES),
    mustHaveFeatures: sanitizeText(initial.mustHaveFeatures).slice(0, 500)
  };
}

export function buildPropertyPreferenceSteps(values = {}) {
  const rentsCurrently = values.rentsCurrently === true;
  const steps = [
    {
      id: "preferredPropertyType",
      kind: "choice",
      title: "Em qual tipo de imóvel você prefere morar?",
      options: PROPERTY_TYPE_OPTIONS
    },
    {
      id: "preferredRegions",
      kind: "multi",
      title: "Qual região de Marília você prefere?",
      options: PROPERTY_REGION_OPTIONS
    },
    {
      id: "preferredPropertyStage",
      kind: "choice",
      title: "Você prefere um imóvel:",
      options: PROPERTY_STAGE_OPTIONS
    },
    {
      id: "preferredBedrooms",
      kind: "choice",
      title: "Quantos quartos você procura?",
      options: PROPERTY_BEDROOM_OPTIONS
    },
    {
      id: "rentsCurrently",
      kind: "boolean",
      title: "Atualmente, você mora de aluguel?"
    }
  ];

  if (rentsCurrently) {
    steps.push({
      id: "rentPriceRange",
      kind: "choice",
      title: "Qual é o valor aproximado do seu aluguel mensal?",
      options: PROPERTY_RENT_OPTIONS
    });
  }

  steps.push(
    {
      id: "purchaseTimeline",
      kind: "choice",
      title: "Quando você pretende comprar seu imóvel?",
      options: PROPERTY_TIMELINE_OPTIONS
    },
    {
      id: "propertyPriorities",
      kind: "multi",
      maxSelections: 2,
      title: "O que é mais importante para você na escolha do imóvel?",
      options: PROPERTY_PRIORITY_OPTIONS
    },
    {
      id: "mustHaveFeatures",
      kind: "textarea",
      maxLength: 500,
      optional: true,
      placeholder: "Ex.: garagem, quintal, área de lazer, proximidade do trabalho ou espaço para animais.",
      title: "Existe alguma característica que não pode faltar?"
    }
  );

  return steps;
}

const propertyPreferencesSchema = z
  .object({
    preferredPropertyType: z.enum(PROPERTY_TYPE_VALUES, { error: "Escolha o tipo de imóvel." }),
    preferredRegions: z.array(z.enum(PROPERTY_REGION_VALUES)).min(1, "Escolha pelo menos uma região."),
    preferredPropertyStage: z.enum(PROPERTY_STAGE_VALUES, { error: "Escolha o estágio do imóvel." }),
    preferredBedrooms: z.enum(PROPERTY_BEDROOM_VALUES, { error: "Escolha a quantidade de quartos." }),
    rentsCurrently: booleanSchema,
    rentPriceRange: optionalEnum(PROPERTY_RENT_VALUES),
    purchaseTimeline: z.enum(PROPERTY_TIMELINE_VALUES, { error: "Escolha uma previsão de compra." }),
    propertyPriorities: z
      .array(z.enum(PROPERTY_PRIORITY_VALUES))
      .min(1, "Escolha pelo menos uma prioridade.")
      .max(2, "Você pode selecionar até duas opções."),
    mustHaveFeatures: z.string().max(500, "Use no máximo 500 caracteres.").optional().default("")
  })
  .superRefine((data, context) => {
    if (data.rentsCurrently && !data.rentPriceRange) {
      context.addIssue({
        code: "custom",
        path: ["rentPriceRange"],
        message: "Escolha o valor aproximado do aluguel."
      });
    }
  })
  .transform((data) => ({
    ...data,
    rentPriceRange: data.rentsCurrently ? data.rentPriceRange : null,
    mustHaveFeatures: sanitizeText(data.mustHaveFeatures).slice(0, 500)
  }));

export function validatePropertyPreferences(payload) {
  const normalized = normalizePropertyPreferences(payload);
  const result = propertyPreferencesSchema.safeParse(normalized);

  if (result.success) {
    return { ok: true, data: result.data, fieldErrors: {}, formError: "" };
  }

  const flattened = result.error.flatten();
  return {
    ok: false,
    data: null,
    fieldErrors: flattened.fieldErrors || {},
    formError: flattened.formErrors?.[0] || "Revise suas preferências antes de continuar."
  };
}

export function validatePropertyPreferenceStep(step, values = {}) {
  const value = values[step.id];

  if (step.kind === "choice") {
    return step.options?.some((option) => option.value === value) ? "" : "Escolha uma opção para continuar.";
  }

  if (step.kind === "boolean") {
    return typeof value === "boolean" ? "" : "Escolha uma opção para continuar.";
  }

  if (step.kind === "multi") {
    const values = normalizePreferenceArray(value, step.options?.map((option) => option.value) || []);
    if (!values.length) return "Escolha pelo menos uma opção.";
    if (step.maxSelections && values.length > step.maxSelections) return "Você pode selecionar até duas opções.";
    return "";
  }

  if (step.kind === "textarea") {
    const text = sanitizeText(value);
    if (!step.optional && !text) return "Campo obrigatório.";
    if (step.maxLength && text.length > step.maxLength) return `Use no máximo ${step.maxLength} caracteres.`;
    return "";
  }

  return "";
}

export function normalizePropertyPreferences(payload = {}) {
  const rentsCurrently = normalizeNullableBoolean(payload.rentsCurrently);

  return {
    preferredPropertyType: normalizeEnumValue(payload.preferredPropertyType, PROPERTY_TYPE_VALUES),
    preferredRegions: normalizePreferenceArray(payload.preferredRegions, PROPERTY_REGION_VALUES),
    preferredPropertyStage: normalizeEnumValue(payload.preferredPropertyStage, PROPERTY_STAGE_VALUES),
    preferredBedrooms: normalizeEnumValue(payload.preferredBedrooms, PROPERTY_BEDROOM_VALUES),
    rentsCurrently,
    rentPriceRange: rentsCurrently === true ? normalizeEnumValue(payload.rentPriceRange, PROPERTY_RENT_VALUES) : null,
    purchaseTimeline: normalizeEnumValue(payload.purchaseTimeline, PROPERTY_TIMELINE_VALUES),
    propertyPriorities: normalizePreferenceArray(payload.propertyPriorities, PROPERTY_PRIORITY_VALUES),
    mustHaveFeatures: sanitizeText(payload.mustHaveFeatures).slice(0, 500)
  };
}

export function rowToPropertyPreferences(row = {}) {
  return {
    status: normalizePropertyPreferenceStatus(row.property_preferences_status),
    accessToken: row.preferences_access_token || "",
    startedAt: row.property_preferences_started_at || "",
    completedAt: row.property_preferences_completed_at || "",
    updatedAt: row.property_preferences_updated_at || "",
    preferredPropertyType: normalizeEnumValue(row.preferred_property_type, PROPERTY_TYPE_VALUES),
    preferredRegions: normalizePreferenceArray(row.preferred_regions, PROPERTY_REGION_VALUES),
    preferredPropertyStage: normalizeEnumValue(row.preferred_property_stage, PROPERTY_STAGE_VALUES),
    preferredBedrooms: normalizeEnumValue(row.preferred_bedrooms, PROPERTY_BEDROOM_VALUES),
    rentsCurrently: typeof row.rents_currently === "boolean" ? row.rents_currently : null,
    rentPriceRange: normalizeEnumValue(row.rent_price_range, PROPERTY_RENT_VALUES),
    purchaseTimeline: normalizeEnumValue(row.purchase_timeline, PROPERTY_TIMELINE_VALUES),
    propertyPriorities: normalizePreferenceArray(row.property_priorities, PROPERTY_PRIORITY_VALUES),
    mustHaveFeatures: sanitizeText(row.must_have_features).slice(0, 500)
  };
}

export function propertyPreferencesToRecord(preferences, status = PROPERTY_PREFERENCE_STATUS.COMPLETED) {
  const validation = validatePropertyPreferences(preferences);
  if (!validation.ok) {
    throw new PropertyPreferencesValidationError(validation);
  }

  const now = new Date().toISOString();
  const data = validation.data;

  return {
    property_preferences_status: normalizePropertyPreferenceStatus(status, PROPERTY_PREFERENCE_STATUS.COMPLETED),
    property_preferences_started_at: now,
    property_preferences_completed_at: status === PROPERTY_PREFERENCE_STATUS.COMPLETED ? now : null,
    property_preferences_updated_at: now,
    preferred_property_type: data.preferredPropertyType,
    preferred_regions: data.preferredRegions,
    preferred_property_stage: data.preferredPropertyStage,
    preferred_bedrooms: data.preferredBedrooms,
    rents_currently: data.rentsCurrently,
    rent_price_range: data.rentPriceRange,
    purchase_timeline: data.purchaseTimeline,
    property_priorities: data.propertyPriorities,
    must_have_features: data.mustHaveFeatures || null
  };
}

export function startedPropertyPreferencesRecord() {
  const now = new Date().toISOString();
  return {
    property_preferences_status: PROPERTY_PREFERENCE_STATUS.STARTED,
    property_preferences_started_at: now,
    property_preferences_updated_at: now
  };
}

export function ignoredPropertyPreferencesRecord() {
  return {
    property_preferences_status: PROPERTY_PREFERENCE_STATUS.IGNORED,
    property_preferences_updated_at: new Date().toISOString()
  };
}

export function normalizePropertyPreferenceStatus(value, fallback = PROPERTY_PREFERENCE_STATUS.NOT_STARTED) {
  return PROPERTY_PREFERENCE_STATUS_VALUES.includes(value) ? value : fallback;
}

function normalizeNullableBoolean(value) {
  if (value === true || value === "true" || value === "Sim") return true;
  if (value === false || value === "false" || value === "Não" || value === "Nao") return false;
  return null;
}

function normalizeEnumValue(value, allowedValues) {
  const text = sanitizeText(value);
  return allowedValues.includes(text) ? text : "";
}

function normalizePreferenceArray(value, allowedValues) {
  const values = parseArray(value)
    .map((item) => sanitizeText(item))
    .filter((item) => allowedValues.includes(item));
  const unique = Array.from(new Set(values));

  if (unique.includes(NO_PREFERENCE_VALUE)) return [NO_PREFERENCE_VALUE];
  return unique;
}
