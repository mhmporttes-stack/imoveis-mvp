// Prazo e taxa de juros obrigatórios ao salvar a simulação (regra do dono, 2026-10-18; PRES-24 / SIM-REQ).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RATE_REQUIRED_ERROR, simulationRequiredFieldsError } from "../lib/simulation-required-fields.mjs";

const model = (overrides = {}) => ({ financingValue: "R$ 190.000,00", subsidyValue: "", firstInstallment: "R$ 1.085,40", lastInstallment: "R$ 812,15", termMonths: "420", ...overrides });
const sim = (novo, extra = {}) => ({ interestRateAnnual: 5.4, simulationModels: { novo, usado: model({ financingValue: "", firstInstallment: "", lastInstallment: "", termMonths: "" }) }, ...extra });

test("com prazo e taxa: salva", () => {
  assert.equal(simulationRequiredFieldsError(sim(model())), "");
  assert.equal(simulationRequiredFieldsError(sim(model(), { interestRateAnnual: "5,4" })), "");
});

test("sem prazo, prazo inválido ou sem taxa: mensagem clara", () => {
  assert.match(simulationRequiredFieldsError(sim(model({ termMonths: "" }))), /prazo em meses do imóvel novo/);
  assert.match(simulationRequiredFieldsError(sim(model({ termMonths: "816" }))), /prazo/);
  assert.equal(simulationRequiredFieldsError(sim(model(), { interestRateAnnual: null })), RATE_REQUIRED_ERROR);
  assert.equal(simulationRequiredFieldsError(sim(model(), { interestRateAnnual: 0 })), RATE_REQUIRED_ERROR);
});

test("rascunho sem valores (lista de clientes / cadastro do site) passa", () => {
  const empty = model({ financingValue: "", firstInstallment: "", lastInstallment: "", termMonths: "" });
  assert.equal(simulationRequiredFieldsError({ interestRateAnnual: null, simulationModels: { novo: empty, usado: empty } }), "");
  assert.equal(simulationRequiredFieldsError({ financingValue: "", firstInstallment: "", lastInstallment: "" }), "");
});

test("prazo exigido só no modelo destacado (o tipo copiado pelo Gerador não precisa)", () => {
  const copied = model({ termMonths: "" });
  assert.equal(simulationRequiredFieldsError({ interestRateAnnual: 5.4, simulationModels: { novo: model(), usado: copied } }), "");
  // só SAC preenchido: o SAC é o destacado
  const sacOnly = { ...model({ financingValue: "", firstInstallment: "", lastInstallment: "", termMonths: "" }), sac: model({ termMonths: "" }) };
  assert.match(simulationRequiredFieldsError({ interestRateAnnual: 5.4, simulationModels: { novo: sacOnly } }), /\(SAC\)/);
});

test("tela e servidor usam a mesma regra; autosave não é barrado", () => {
  const generator = readFileSync(new URL("../components/SimulationGenerator.jsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../lib/simulations.js", import.meta.url), "utf8");
  assert.match(generator, /simulationRequiredFieldsError\(/);
  assert.match(generator, /silent \? "" : simulationRequiredFieldsError/);
  assert.match(generator, /autosave: true/);
  assert.match(server, /if \(payload\?\.autosave === true\) return;/);
  assert.match(server, /export async function createSimulation[^]*?assertRequiredSimulationFields\(payload\);/);
  assert.match(server, /assertRequiredSimulationFields\(payload, current\.interestRateAnnual\);/);
});
