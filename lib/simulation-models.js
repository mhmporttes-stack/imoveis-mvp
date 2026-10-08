export const SIMULATION_MODEL_TYPES = [
  { key: "novo", label: "Imóvel novo" },
  { key: "usado", label: "Imóvel usado" }
];

const SIMULATION_MODELS_NOTE_PREFIX = "__SIMULATION_MODELS__:";
const MODEL_MONEY_FIELDS = ["financingValue", "subsidyValue", "firstInstallment", "lastInstallment"];

// Sistemas de amortização (pedido do dono, 2026-10-08): cada tipo de imóvel pode ter a simulação em SAC e/ou em Price,
// com os MESMOS 4 campos. O SAC é o que sempre existiu (campos no próprio modelo; simulações antigas = SAC); o Price fica
// em `model.price`. Nenhum cálculo: os valores são digitados do simulador da Caixa.
export const SIMULATION_SYSTEMS = [
  { key: "sac", label: "SAC" },
  { key: "price", label: "Price" }
];

function emptySystemValues() {
  return { financingValue: "", subsidyValue: "", firstInstallment: "", lastInstallment: "" };
}

function pickSystemValues(source = {}) {
  return {
    financingValue: source?.financingValue ?? "",
    subsidyValue: source?.subsidyValue ?? "",
    firstInstallment: source?.firstInstallment ?? "",
    lastInstallment: source?.lastInstallment ?? ""
  };
}

export function emptySimulationModel() {
  return { ...emptySystemValues(), price: emptySystemValues() };
}

export function simulationModelLabel(type) {
  return SIMULATION_MODEL_TYPES.find((item) => item.key === type)?.label || "Imóvel novo";
}

export function normalizeSimulationModels(input = {}, legacy = {}) {
  const models = Object.fromEntries(SIMULATION_MODEL_TYPES.map(({ key }) => [key, emptySimulationModel()]));

  for (const { key } of SIMULATION_MODEL_TYPES) {
    const source = input?.[key] || {};
    models[key] = { ...pickSystemValues(source), price: pickSystemValues(source.price) };
  }

  const hasStructuredValues = SIMULATION_MODEL_TYPES.some(({ key }) => simulationModelHasValues(models[key]));
  if (!hasStructuredValues && legacy) {
    const legacyType = legacy.simulationType === "novo" ? "novo" : "usado";
    models[legacyType] = { ...pickSystemValues(legacy), price: emptySystemValues() };
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

// Os 4 campos de UM sistema (SAC ou Price) têm algum valor?
export function simulationSystemHasValues(values = {}) {
  return MODEL_MONEY_FIELDS.some((field) => moneyNumber(values?.[field]) > 0);
}

// O tipo de imóvel tem valor em QUALQUER sistema (SAC ou Price)? "Ativo = tem valor".
export function simulationModelHasValues(model = {}) {
  return simulationSystemHasValues(model) || simulationSystemHasValues(model?.price);
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

// Uma entrada por (tipo de imóvel × sistema) com valor: SAC primeiro, depois Price, na ordem novo → usado. `values` são
// sempre os 4 campos do sistema da entrada. `systemLabel` ("SAC"/"Price") só vem preenchido quando a simulação tem Price
// em algum tipo — sem Price tudo continua exatamente como era (PDF, imagem e apresentação).
export function getRenderableSimulationModels(form = {}) {
  const models = normalizeSimulationModels(form.simulationModels, form);
  const filled = [];
  for (const { key, label } of SIMULATION_MODEL_TYPES) {
    const sacValues = pickSystemValues(models[key]);
    const priceValues = pickSystemValues(models[key]?.price);
    if (simulationSystemHasValues(sacValues)) filled.push({ type: key, system: "sac", systemLabel: "", label, values: sacValues, totals: simulationModelTotals(sacValues, form) });
    if (simulationSystemHasValues(priceValues)) filled.push({ type: key, system: "price", systemLabel: "", label, values: priceValues, totals: simulationModelTotals(priceValues, form) });
  }
  if (filled.some((item) => item.system === "price")) {
    for (const item of filled) item.systemLabel = item.system === "price" ? "Price" : "SAC";
  }

  if (filled.length) return filled;

  const fallbackType = form.simulationType === "novo" ? "novo" : "usado";
  const fallbackValues = pickSystemValues(models[fallbackType]);
  return [{
    type: fallbackType,
    system: "sac",
    systemLabel: "",
    label: simulationModelLabel(fallbackType),
    values: fallbackValues,
    totals: simulationModelTotals(fallbackValues, form)
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
