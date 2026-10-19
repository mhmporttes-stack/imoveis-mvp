import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { resolveSimulationResources, resourcesToStore } from "../lib/simulation-resources-core.mjs";

// Entrada e FGTS só no cadastro do cliente (pedido do dono, 2026-10-19).
test("simulação lê entrada/FGTS do cadastro; valores próprios antigos continuam valendo", () => {
  const registration = { availablePurchaseResource: 15000, availableFgtsBalance: 8000 };
  assert.deepEqual(resolveSimulationResources({ downPaymentValue: 0, fgtsValue: 0 }, registration), { downPaymentValue: 15000, fgtsValue: 8000, source: "cadastro" });
  assert.deepEqual(resolveSimulationResources({ downPaymentValue: 5000, fgtsValue: 0 }, registration), { downPaymentValue: 5000, fgtsValue: 0, source: "simulacao" });
  assert.deepEqual(resolveSimulationResources({}, null), { downPaymentValue: 0, fgtsValue: 0, source: "nenhum" });
  assert.equal(resolveSimulationResources({ downPaymentValue: "R$ 1.234,50" }, registration).downPaymentValue, 1234.5);
});

test("ao salvar: sem os campos mantém o gravado; igual ao cadastro grava zero; digitado diferente vira próprio", () => {
  const fromRegistration = { downPaymentValue: 15000, fgtsValue: 8000, storedDownPaymentValue: 0, storedFgtsValue: 0, resourcesSource: "cadastro" };
  assert.deepEqual(resourcesToStore({}, fromRegistration), { downPaymentValue: 0, fgtsValue: 0 });
  assert.deepEqual(resourcesToStore({ downPaymentValue: 15000, fgtsValue: 8000 }, fromRegistration), { downPaymentValue: 0, fgtsValue: 0 });
  assert.deepEqual(resourcesToStore({ downPaymentValue: "R$ 20.000,00", fgtsValue: 8000 }, fromRegistration), { downPaymentValue: 20000, fgtsValue: 8000 });
  const legacy = { downPaymentValue: 5000, fgtsValue: 0, storedDownPaymentValue: 5000, storedFgtsValue: 0, resourcesSource: "simulacao" };
  assert.deepEqual(resourcesToStore({}, legacy), { downPaymentValue: 5000, fgtsValue: 0 });
  assert.deepEqual(resourcesToStore({ downPaymentValue: 5000, fgtsValue: 0 }, legacy), { downPaymentValue: 5000, fgtsValue: 0 });
});

test("getSimulation e a lista usam a mesma regra; cadastro aceita o FGTS disponível (tolerante à coluna ausente)", () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.match(read("lib/simulations.js"), /const resources = resolveSimulationResources\(simulation, registration\)/);
  assert.match(read("lib/simulations.js"), /const storedResources = resourcesToStore\(payload, current\)/);
  assert.match(read("lib/simulation-list-query.js"), /resolveSimulationResources\(storedSimulation, registration\)/);
  const registrations = read("lib/simulation-registrations.js");
  assert.match(registrations, /record\.available_fgts_balance = normalizeMoney\(updates\.availableFgtsBalance\)/);
  assert.match(registrations, /isMissingColumnError\(error, "available_fgts_balance"\)/);
  assert.match(registrations, /availableFgtsBalance: Number\(row\.available_fgts_balance \|\| 0\)/);
});

test("aba da simulação: sem os campos de entrada/FGTS; FGTS no cadastro; corpo do salvamento sem esses valores", () => {
  const generator = readFileSync(new URL("../components/SimulationGenerator.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(generator, /label="Entrada disponível"/);
  assert.doesNotMatch(generator, /<MoneyField label="FGTS disponível" value=\{form\.fgtsValue\}/);
  assert.match(generator, /<MoneyField compact label="FGTS" value=\{form\.registration\?\.availableFgtsBalance/);
  assert.match(generator, /downPaymentValue: _downPaymentValue,\s*fgtsValue: _fgtsValue,/);
  assert.doesNotMatch(generator, /downPaymentValue: primaryModel\.totals\.downPayment/);
});
