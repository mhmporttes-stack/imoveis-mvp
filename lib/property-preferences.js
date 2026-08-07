import { z } from "zod";
import { sanitizeText } from "./simulation-registration-schema";

export const PROPERTY_PREFERENCE_STATUS = {
  NOT_STARTED: "nao_iniciado",
  STARTED: "iniciado",
  COMPLETED: "concluido",
  IGNORED: "ignorado"
};

export const NO_PREFERENCE_VALUE = "sem_preferencia";

export const PROPERTY_TYPE_OPTIONS = [
  { value: "casa", label: "Casa" },
  { value: "apartamento", label: "Apartamento" },
  { value: NO_PREFERENCE_VALUE, label: "Não tenho preferência" }
];

export const PROPERTY_REGION_OPTIONS = [
  { value: "centro", label: "Centro" },
  { value: "zona_norte", label: "Zona Norte" },
  { value: "zona_sul", label: "Zona Sul" },
  { value: "zona_leste", label: "Zona Leste" },
  { value: "zona_oeste", label: "Zona Oeste" },
  { value: NO_PREFERENCE_VALUE, label: "Não tenho preferência" }
];

export const PROPERTY_STAGE_OPTIONS = [
  { value: "pronto", label: "Pronto para morar" },
  { value: "em_construcao", label: "Em construção" },
  { value: "na_planta", label: "Na planta" },
  { value: NO_PREFERENCE_VALUE, label: "Não tenho preferência" }
];

export const PROPERTY_BEDROOM_OPTIONS = [
  { value: "um", label: "1 quarto" },
  { value: "dois", label: "2 quartos" },
  { value: "tres_ou_mais", label: "3 quartos ou mais" },
  { value: NO_PREFERENCE_VALUE, label: "Não tenho preferência" }
];

export const PROPERTY_RENT_OPTIONS = [
  { value: "ate_500", label: "Até R$ 500" },
  { value: "de_501_a_1000", label: "De R$ 501 a R$ 1.000" },
  { value: "de_1001_a_1500", label: "De R$ 1.001 a R$ 1.500" },
  { value: "de_1501_a_2000", label: "De R$ 1.501 a R$ 2.000" },
  { value: "acima_de_2000", label: "Acima de R$ 2.000" }
];

export const PROPERTY_TIMELINE_OPTIONS = [
  { value: "imediato", label: "O mais rápido possível", summaryLabel: "Compra imediata" },
  { value: "proximos_3_meses", label: "Nos próximos 3 meses", summaryLabel: "Compra nos próximos 3 meses" },
  { value: "entre_3_e_6_meses", label: "Entre 3 e 6 meses", summaryLabel: "Compra entre 3 e 6 meses" },
  { value: "mais_de_6_meses", label: "Daqui a mais de 6 meses", summaryLabel: "Compra daqui a mais de 6 meses" },
  { value: "ainda_nao_sei", label: "Ainda não sei" }
];

export const PROPERTY_PRIORITY_OPTIONS = [
  { value: "entrada_baixa", label: "Entrada baixa ou zerada" },
  { value: "menor_parcela", label: "Menor parcela possível" },
  { value: "localizacao", label: "Localização" },
  { value: "pronto_para_morar", label: "Imóvel pronto para morar" },
  { value: "terreno_ou_quintal", label: "Casa com terreno ou quintal" },
  { value: "lazer", label: "Condomínio com lazer" },
  { value: "maior_espaco", label: "Maior espaço interno" },
  { value: NO_PREFERENCE_VALUE, label: "Não tenho preferência" }
];

const PROPERTY_TYPE_VALUES = PROPERTY_TYPE_OPTIONS.map((option) => option.value);
const PROPERTY_REGION_VALUES = PROPERTY_REGION_OPTIONS.map((option) => option.value);
const PROPERTY_STAGE_VALUES = PROPERTY_STAGE_OPTIONS.map((option) => option.value);
const PROPERTY_BEDROOM_VALUES = PROPERTY_BEDROOM_OPTIONS.map((option) => option.value);
const PROPERTY_RENT_VALUES = PROPERTY_RENT_OPTIONS.map((option) => option.value);
const PROPERTY_TIMELINE_VALUES = PROPERTY_TIMELINE_OPTIONS.map((option) => option.value);
const PROPERTY_PRIORITY_VALUES = PROPERTY_PRIORITY_OPTIONS.map((option) => option.value);
const PROPERTY_PREFERENCE_STATUS_VALUES = Object.values(PROPERTY_PREFERENCE_STATUS);

const labelMaps = {
  type: toLabelMap(PROPERTY_TYPE_OPTIONS),
  region: toLabelMap(PROPERTY_REGION_OPTIONS),
  stage: toLabelMap(PROPERTY_STAGE_OPTIONS),
  bedroom: toLabelMap(PROPERTY_BEDROOM_OPTIONS),
  rent: toLabelMap(PROPERTY_RENT_OPTIONS),
  timeline: toLabelMap(PROPERTY_TIMELINE_OPTIONS),
  timelineSummary: toLabelMap(PROPERTY_TIMELINE_OPTIONS, "summaryLabel"),
  priority: toLabelMap(PROPERTY_PRIORITY_OPTIONS)
};

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

export function hasCompletedPropertyPreferences(preferences = {}) {
  return preferences.status === PROPERTY_PREFERENCE_STATUS.COMPLETED;
}

export function getPropertyPreferenceDetails(preferences = {}) {
  if (!hasCompletedPropertyPreferences(preferences)) return [];

  const items = [
    { label: "Tipo de imóvel", value: getOptionLabel(preferences.preferredPropertyType, labelMaps.type) },
    { label: "Regiões preferidas", value: formatOptionList(preferences.preferredRegions, labelMaps.region) },
    { label: "Estágio do imóvel", value: getOptionLabel(preferences.preferredPropertyStage, labelMaps.stage) },
    { label: "Quantidade de quartos", value: getOptionLabel(preferences.preferredBedrooms, labelMaps.bedroom) },
    { label: "Mora de aluguel", value: preferences.rentsCurrently === true ? "Sim" : "Não" },
    preferences.rentsCurrently === true
      ? { label: "Valor aproximado do aluguel", value: getOptionLabel(preferences.rentPriceRange, labelMaps.rent) }
      : null,
    { label: "Previsão de compra", value: getOptionLabel(preferences.purchaseTimeline, labelMaps.timeline) },
    { label: "Prioridades", value: formatOptionList(preferences.propertyPriorities, labelMaps.priority) },
    preferences.mustHaveFeatures
      ? { label: "Características indispensáveis", value: preferences.mustHaveFeatures }
      : null
  ].filter(Boolean);

  return items.filter((item) => item.value);
}

export function getPropertyPreferenceSummary(preferences = {}) {
  if (!hasCompletedPropertyPreferences(preferences)) return "";

  const pieces = [
    getOptionLabel(preferences.preferredPropertyType, labelMaps.type),
    formatOptionList(preferences.preferredRegions, labelMaps.region),
    getOptionLabel(preferences.preferredBedrooms, labelMaps.bedroom),
    getOptionLabel(preferences.preferredPropertyStage, labelMaps.stage),
    preferences.rentsCurrently === true && preferences.rentPriceRange
      ? `Aluguel ${lowerFirst(getOptionLabel(preferences.rentPriceRange, labelMaps.rent))}`
      : "",
    getOptionLabel(preferences.purchaseTimeline, labelMaps.timelineSummary) || getOptionLabel(preferences.purchaseTimeline, labelMaps.timeline)
  ].filter(Boolean);

  return pieces.join(" | ");
}

export function propertyPreferenceStatusLabel(status) {
  const normalized = normalizePropertyPreferenceStatus(status);
  if (normalized === PROPERTY_PREFERENCE_STATUS.STARTED) return "Iniciado";
  if (normalized === PROPERTY_PREFERENCE_STATUS.COMPLETED) return "Concluído";
  if (normalized === PROPERTY_PREFERENCE_STATUS.IGNORED) return "Ignorado";
  return "Não iniciado";
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

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(",").map((item) => item.trim());
  }
}

function getOptionLabel(value, labels) {
  return labels[value] || "";
}

function formatOptionList(values, labels) {
  const list = normalizeList(values).map((value) => getOptionLabel(value, labels)).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

function normalizeList(values) {
  if (Array.isArray(values)) return values;
  return parseArray(values);
}

function toLabelMap(options, key = "label") {
  return Object.fromEntries(options.map((option) => [option.value, option[key] || option.label]));
}

function lowerFirst(value = "") {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : "";
}
