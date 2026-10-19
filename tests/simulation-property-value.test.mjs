import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INCOME_BANDS, estimateFinancing, simulationFieldSuggestions } from "../lib/financiamento-estimativa-core.mjs";
import { buildAutoSnapshot } from "../lib/simulation-auto-review-core.mjs";
import { scenarioDataFromSimulation, scenarioModelsForForm } from "../lib/simulation-scenarios-core.mjs";

// Valor do imóvel na simulação do cliente (REGRA OFICIAL — dono, 2026-10-19): padrão = teto da faixa MCMV da renda
// considerada (Marília/SP: Faixas 1-2 R$ 235 mil; Faixa 3 R$ 400 mil; Classe Média R$ 600 mil — gov.br MCMV-FGTS).
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
  test(`renda ${income}: valor do imóvel automático = teto ${cap} (${faixa}), novo e usado`, () => {
    const estimate = estimateFinancing(person(income), REF);
    assert.equal(estimate.eligible, true);
    assert.equal(estimate.propertyValue, cap);
    assert.equal(estimate.faixa, faixa);
    assert.equal(estimate.propertyValueTyped, false);
    assert.equal(estimate.used.propertyValue, cap);
    assert.ok(estimate.financing <= 0.8 * cap + 0.01);
    const suggestion = simulationFieldSuggestions({ registration: person(income), referenceDate: REF }).propertyValue;
    assert.deepEqual(suggestion.novo, { value: cap, faixa });
  });
}

test("novo e usado com rendas diferentes podem ter tetos diferentes (informal otimizado)", () => {
  const estimate = estimateFinancing(person(2000, { primaryIncomeType: "self_employed_unregistered" }), REF);
  assert.equal(estimate.used.propertyValue, INCOME_BANDS.find((band) => estimate.used.income <= band.upTo).propertyCap);
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
  assert.equal(snapshot.outputs.propertyValue, 400000);
  assert.equal(snapshot.outputs.usado.propertyValue, 400000);
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
