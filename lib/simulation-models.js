export const SIMULATION_MODEL_TYPES = [
  { key: "novo", label: "Imóvel novo" },
  { key: "usado", label: "Imóvel usado" }
];

const SIMULATION_MODELS_NOTE_PREFIX = "__SIMULATION_MODELS__:";
const MODEL_MONEY_FIELDS = ["financingValue", "subsidyValue", "firstInstallment", "lastInstallment"];

export function emptySimulationModel() {
  return {
    financingValue: "",
    subsidyValue: "",
    firstInstallment: "",
    lastInstallment: ""
  };
}

export function simulationModelLabel(type) {
  return SIMULATION_MODEL_TYPES.find((item) => item.key === type)?.label || "Imóvel novo";
}

export function normalizeSimulationModels(input = {}, legacy = {}) {
  const models = Object.fromEntries(SIMULATION_MODEL_TYPES.map(({ key }) => [key, emptySimulationModel()]));

  for (const { key } of SIMULATION_MODEL_TYPES) {
    const source = input?.[key] || {};
    models[key] = {
      financingValue: source.financingValue ?? "",
      subsidyValue: source.subsidyValue ?? "",
      firstInstallment: source.firstInstallment ?? "",
      lastInstallment: source.lastInstallment ?? ""
    };
  }

  const hasStructuredValues = SIMULATION_MODEL_TYPES.some(({ key }) => simulationModelHasValues(models[key]));
  if (!hasStructuredValues && legacy) {
    const legacyType = legacy.simulationType === "novo" ? "novo" : "usado";
    models[legacyType] = {
      financingValue: legacy.financingValue ?? "",
      subsidyValue: legacy.subsidyValue ?? "",
      firstInstallment: legacy.firstInstallment ?? "",
      lastInstallment: legacy.lastInstallment ?? ""
    };
  }

  return models;
}

export function extractSimulationModelsFromNote(note = "") {
  const line = String(note || "")
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith(SIMULATION_MODELS_NOTE_PREFIX));

  if (!line) return null;

  const encoded = line.trim().slice(SIMULATION_MODELS_NOTE_PREFIX.length).trim();
  if (!encoded) return null;

  try {
    return normalizeSimulationModels(JSON.parse(decodeURIComponent(encoded)));
  } catch {
    return null;
  }
}

export function removeSimulationModelsFromNote(note = "") {
  return String(note || "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith(SIMULATION_MODELS_NOTE_PREFIX))
    .join("\n")
    .trim();
}

export function mergeSimulationModelsIntoNote(note = "", models = {}) {
  const cleanNote = removeSimulationModelsFromNote(note);
  const normalized = normalizeSimulationModels(models);
  const hasValues = SIMULATION_MODEL_TYPES.some(({ key }) => simulationModelHasValues(normalized[key]));

  if (!hasValues) return cleanNote;

  const encoded = encodeURIComponent(JSON.stringify(normalized));
  return [cleanNote, `${SIMULATION_MODELS_NOTE_PREFIX} ${encoded}`].filter(Boolean).join("\n");
}

/**
 * Tipos de imóvel ATIVOS no Gerador (caixas "Imóvel novo" / "Imóvel usado", pedido do dono 2026-10-06). Não é gravado à
 * parte: ativo = tem valor. Nenhum dos dois com valor (simulação nova) → os dois ativos, como sempre foi.
 */
export function enabledModelsFromModels(models = {}) {
  const normalized = normalizeSimulationModels(models);
  const enabled = Object.fromEntries(SIMULATION_MODEL_TYPES.map(({ key }) => [key, simulationModelHasValues(normalized[key])]));
  return Object.values(enabled).some(Boolean) ? enabled : Object.fromEntries(SIMULATION_MODEL_TYPES.map(({ key }) => [key, true]));
}

const SHARED_MODEL_FIELDS = ["financingValue", "firstInstallment", "lastInstallment"];

/**
 * Liga/desliga um tipo. Desligar APAGA os valores dele (assim PDF, imagem e apresentação mostram só o outro, sem comparação).
 * Religar copia financiamento e parcelas do outro tipo (a mesma cópia automática do Gerador); o subsídio fica em branco.
 * Nunca deixa os dois desligados: devolve null quando o pedido desligaria o último.
 */
export function toggleSimulationModel(models = {}, enabled = {}, type, on) {
  if (!SIMULATION_MODEL_TYPES.some(({ key }) => key === type)) return null;
  const nextEnabled = { ...enabled, [type]: Boolean(on) };
  if (!Object.values(nextEnabled).some(Boolean)) return null;
  const normalized = normalizeSimulationModels(models);
  const peer = SIMULATION_MODEL_TYPES.find(({ key }) => key !== type)?.key;
  const nextModels = { ...normalized };
  if (!on) nextModels[type] = emptySimulationModel();
  else if (peer && nextEnabled[peer]) {
    nextModels[type] = { ...emptySimulationModel(), ...Object.fromEntries(SHARED_MODEL_FIELDS.map((field) => [field, normalized[peer]?.[field] || ""])) };
  }
  return { models: nextModels, enabled: nextEnabled };
}

export function simulationModelHasValues(model = {}) {
  return MODEL_MONEY_FIELDS.some((field) => moneyNumber(model[field]) > 0);
}

export function simulationModelTotals(model = {}, shared = {}) {
  const financing = moneyNumber(model.financingValue);
  const subsidy = moneyNumber(model.subsidyValue);
  const downPayment = moneyNumber(shared.downPaymentValue);
  const fgts = moneyNumber(shared.fgtsValue);

  return {
    financing,
    subsidy,
    downPayment,
    fgts,
    total: financing + subsidy,
    expanded: financing + subsidy + downPayment + fgts
  };
}

export function getRenderableSimulationModels(form = {}) {
  const models = normalizeSimulationModels(form.simulationModels, form);
  const filled = SIMULATION_MODEL_TYPES
    .map(({ key, label }) => ({
      type: key,
      label,
      values: models[key],
      totals: simulationModelTotals(models[key], form)
    }))
    .filter((item) => simulationModelHasValues(item.values));

  if (filled.length) return filled;

  const fallbackType = form.simulationType === "novo" ? "novo" : "usado";
  return [{
    type: fallbackType,
    label: simulationModelLabel(fallbackType),
    values: models[fallbackType],
    totals: simulationModelTotals(models[fallbackType], form)
  }];
}

export function getPrimarySimulationModel(form = {}) {
  return getRenderableSimulationModels(form)[0];
}

function moneyNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100) / 100;
  const normalized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

// Leitura de valor em reais com a MESMA regra do restante do arquivo (usada pela apresentação interativa,
// lib/simulation-presentation-core.mjs, para que os números sejam idênticos aos do PDF).
export function parseSimulationMoney(value) {
  return moneyNumber(value);
}
