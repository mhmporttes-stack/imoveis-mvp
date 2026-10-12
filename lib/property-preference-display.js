// Opções, rótulos e resumo das preferências de imóvel — SEM zod, para poder ser usado nas telas (Ficha do cliente)
// sem levar a biblioteca de validação (~60 KB compactados) para o navegador (desempenho, 2026-10-12).
// A validação continua em lib/property-preferences.js, que reexporta tudo daqui (uma fonte só).

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

export const PROPERTY_TYPE_VALUES = PROPERTY_TYPE_OPTIONS.map((option) => option.value);
export const PROPERTY_REGION_VALUES = PROPERTY_REGION_OPTIONS.map((option) => option.value);
export const PROPERTY_STAGE_VALUES = PROPERTY_STAGE_OPTIONS.map((option) => option.value);
export const PROPERTY_BEDROOM_VALUES = PROPERTY_BEDROOM_OPTIONS.map((option) => option.value);
export const PROPERTY_RENT_VALUES = PROPERTY_RENT_OPTIONS.map((option) => option.value);
export const PROPERTY_TIMELINE_VALUES = PROPERTY_TIMELINE_OPTIONS.map((option) => option.value);
export const PROPERTY_PRIORITY_VALUES = PROPERTY_PRIORITY_OPTIONS.map((option) => option.value);
export const PROPERTY_PREFERENCE_STATUS_VALUES = Object.values(PROPERTY_PREFERENCE_STATUS);

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

export function parseArray(value) {
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
