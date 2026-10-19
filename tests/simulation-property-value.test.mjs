import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_PROPERTY_VALUE, INCOME_BANDS, estimateFinancing, simulationFieldSuggestions } from "../lib/financiamento-estimativa-core.mjs";
import { buildAutoSnapshot } from "../lib/simulation-auto-review-core.mjs";
import { scenarioDataFromSimulation, scenarioModelsForForm } from "../lib/simulation-scenarios-core.mjs";

// Valor do imóvel na simulação do cliente (REGRA OFICIAL — dono, 2026-10-19): padrão R$ 235.000 em TODAS as faixas,
// editável até o teto da faixa da renda (Marília/SP: Faixas 1-2 R$ 235 mil; Faixa 3 R$ 400 mil; Classe Média R$ 600 mil —
// gov.br MCMV-FGTS). Acima do teto: fora do MCMV.
const REF = "2026-10-19";
const person = (income, extra = {}) => ({
  simulationType: "individual",
  primaryIncomeType: "registered_employment",
  primaryMonthlyIncome: income,
  oldestBirthDate: "1990-03-15",
  hasOverThreeYearsRegisteredWork: true,
  hasChildrenUnder18: true,
  hasResidentialProperty: false,
  ...extra
});

test("tetos por faixa usados pelo motor (gov.br: até R$ 5 mil 210–275 mil por município, Marília 235 mil; 9,6 mil 400 mil; 13 mil 600 mil)", () => {
  assert.deepEqual(INCOME_BANDS.map((band) => [band.upTo, band.propertyCap]), [
    [2160, 235000], [2850, 235000], [3200, 235000], [3500, 235000], [4000, 235000], [5000, 235000], [9600, 400000], [13000, 600000]
  ]);
});

for (const [income, cap, faixa] of [[2500, 235000, "Faixa 1"], [5000, 235000, "Faixa 2"], [6000, 400000, "Faixa 3"], [9000, 400000, "Faixa 3"], [12000, 600000, "Faixa 4 (Classe Média)"]]) {
  test(`renda ${income}: valor do imóvel padrão R$ 235 mil (${faixa}, teto ${cap}), editável até o teto`, () => {
    const estimate = estimateFinancing(person(income), REF);
    assert.equal(DEFAULT_PROPERTY_VALUE, 235000);
    assert.equal(estimate.eligible, true);
    assert.equal(estimate.propertyValue, 235000);
    assert.equal(estimate.propertyCap, cap);
    assert.equal(estimate.faixa, faixa);
    assert.equal(estimate.propertyValueTyped, false);
    assert.equal(estimate.used.propertyValue, 235000);
    assert.ok(estimate.financing <= 0.8 * 235000 + 0.01);
    const suggestion = simulationFieldSuggestions({ registration: person(income), referenceDate: REF }).propertyValue;
    assert.deepEqual(suggestion.novo, { value: 235000, faixa, cap });
    const atCap = estimateFinancing(person(income, { propertyValue: cap }), REF);
    assert.equal(atCap.eligible, true);
    assert.equal(estimateFinancing(person(income, { propertyValue: cap + 1000 }), REF).reason, "property_above_cap");
  });
}

test("novo e usado com rendas diferentes podem ter tetos diferentes (informal otimizado)", () => {
  const estimate = estimateFinancing(person(2000, { primaryIncomeType: "self_employed_unregistered" }), REF);
  assert.equal(estimate.used.propertyCap, INCOME_BANDS.find((band) => estimate.used.income <= band.upTo).propertyCap);
});

// Backtest com as simulações reais da Caixa (2026-10-19): comprador sozinho, sem dependentes, renda > R$ 3.200 →
// a Caixa deu subsídio ZERO nos 12 casos (rendas e cotista abaixo, sem dados pessoais). REGRA OFICIAL — dono, 2026-10-19.
const SINGLE_REAL_CASES = [[3243, true], [3249.97, true], [3400, true], [3500, true], [3800, true], [4000, false], [4000, true], [4000, true], [4000, true], [4000, true], [4000, false], [4000, true]];
test("sozinho, sem dependentes e renda acima de R$ 3.200: subsídio zero no novo e no usado (12 casos reais)", () => {
  assert.equal(SINGLE_REAL_CASES.length, 12);
  for (const [income, cotista] of SINGLE_REAL_CASES) {
    const estimate = estimateFinancing(person(income, { hasChildrenUnder18: false, hasOverThreeYearsRegisteredWork: cotista }), REF);
    assert.equal(estimate.subsidy, 0, `novo ${income}`);
    assert.equal(estimate.used.subsidy, 0, `usado ${income}`);
  }
  assert.ok(estimateFinancing(person(3000, { hasChildrenUnder18: false }), REF).subsidy > 0, "até R$ 3.200 continua (30%)");
  assert.ok(estimateFinancing(person(3500, { hasChildrenUnder18: true }), REF).subsidy > 0, "com dependente continua");
  assert.ok(estimateFinancing(person(1750, { hasChildrenUnder18: false, simulationType: "joint", secondaryMonthlyIncome: 1750 }), REF).subsidy > 0, "casal continua");
});

test("sem valor digitado o motor não muda (site): mesmos números de antes para o teto", () => {
  const auto = estimateFinancing(person(4800), REF);
  const typedCap = estimateFinancing(person(4800, { propertyValue: 235000 }), REF);
  assert.equal(auto.financing, typedCap.financing);
  assert.equal(auto.priceFirstInstallment, typedCap.priceFirstInstallment);
});

test("simulação automática grava o valor do imóvel por tipo; snapshot e cenários levam o valor", () => {
  const source = readFileSync(new URL("../lib/simulations.js", import.meta.url), "utf8");
  assert.match(source, /propertyValue: automaticMoney\(estimate\.propertyValue\)/);
  assert.match(source, /propertyValue: automaticMoney\(used\.propertyValue \?\? estimate\.propertyValue\)/);
  assert.match(source, /automaticPropertyValueLine\(estimate\)/);
  const estimate = estimateFinancing(person(6000), REF);
  const snapshot = buildAutoSnapshot(person(6000), estimate, REF);
  assert.equal(snapshot.outputs.propertyValue, 235000);
  assert.equal(snapshot.outputs.usado.propertyValue, 235000);
  const data = scenarioDataFromSimulation({ simulationModels: { novo: { financingValue: "R$ 300.000,00", propertyValue: "R$ 400.000,00", sac: {} }, usado: {} } });
  assert.equal(data.novo.propertyValue, 400000);
  assert.equal(scenarioModelsForForm(data).novo.propertyValue, "R$ 400.000,00");
});

test("modelos guardam o valor do imóvel; simulação antiga sem ele continua vazia", async () => {
  const { normalizeSimulationModels, mergeSimulationModelsIntoNote, extractSimulationModelsFromNote, simulationModelHasValues } = await import("../lib/simulation-models.js");
  const models = normalizeSimulationModels({ novo: { financingValue: "R$ 100.000,00", propertyValue: "R$ 235.000,00" } });
  assert.equal(models.novo.propertyValue, "R$ 235.000,00");
  assert.equal(models.usado.propertyValue, "");
  assert.equal(extractSimulationModelsFromNote(mergeSimulationModelsIntoNote("", models)).novo.propertyValue, "R$ 235.000,00");
  assert.equal(simulationModelHasValues({ propertyValue: "R$ 235.000,00" }), false, "valor do imóvel sozinho não ativa o tipo");
  assert.equal(normalizeSimulationModels({ novo: { financingValue: "1" } }).novo.propertyValue, "");
});

test("Gerador: campo Valor do imóvel por tipo, automático só em simulação sem valores", () => {
  const ui = readFileSync(new URL("../components/SimulationGenerator.jsx", import.meta.url), "utf8");
  assert.match(ui, /label="Valor do imóvel"/);
  assert.match(ui, /withDefaultPropertyValues\(normalizeInitialSimulation\(initialSimulation\), fieldSuggestions\?\.propertyValue\)/);
  assert.match(ui, /if \(SIMULATION_MODEL_TYPES\.some\(\(\{ key \}\) => simulationModelHasValues\(models\[key\]\)\)\) return form;/);
});

// Caso real #C6771 (dono, 2026-10-19): Caixa MCMV-FGTS, imóvel novo de R$ 400.000 (Faixa 3), 420 meses, 7,66% a.a.,
// nascido em 04/01/1997, cotista, com dependente: financiado R$ 291.128,51, 1ª parcela R$ 2.074,42, última R$ 2.021,27.
// Reproduz com 30% da renda − margem proporcional ao imóvel e renda de R$ 7.000 na Caixa (a ficha diz R$ 7.500; os 28%
// na Faixa 3 foram testados e revertidos pelo dono com base no backtest).
test("Faixa 3: 30% da renda − margem proporcional ao imóvel (#C6771 com renda R$ 7.000, no centavo)", () => {
  const estimate = estimateFinancing(person(7000, { oldestBirthDate: "1997-01-04", propertyValue: 400000 }), REF);
  assert.equal(estimate.faixa, "Faixa 3");
  assert.equal(estimate.annualRate, 7.66);
  assert.equal(estimate.termMonths, 420);
  assert.equal(estimate.priceFirstInstallment, 2074.42);
  assert.ok(Math.abs(estimate.priceLastInstallment - 2021.27) <= 0.02);
  assert.ok(Math.abs(estimate.financing - 291128.51) <= 1);
  const at235 = estimateFinancing(person(3000), REF);
  assert.equal(at235.priceFirstInstallment, Math.round((0.3 * 3000 - 15.03) * 100) / 100);
  const f4 = estimateFinancing(person(11000, { propertyValue: 600000 }), REF);
  assert.equal(f4.priceFirstInstallment, Math.round((0.3 * 11000 - 15.03 * 600000 / 235000) * 100) / 100);
});
