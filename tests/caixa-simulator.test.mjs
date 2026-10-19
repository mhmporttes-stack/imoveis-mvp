import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { caixaValuesFromInput, moneyFromInput, parseVote, simulate, simulatorInput } from "../lib/caixa-simulator-core.mjs";
import { estimateFinancing } from "../lib/financiamento-estimativa-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const REF = "2026-10-19";
const base = {
  joint: "false",
  primaryIncomeType: "registered_employment",
  primaryMonthlyIncome: "R$ 3.000",
  oldestBirthDate: "1995-05-10",
  fgtsThreeYears: "true",
  dependents: "true",
  firstProperty: "true",
  downPayment: "R$ 5.000",
  fgtsAvailable: "R$ 2.000"
};

test("respostas viram a mesma entrada do motor; Primeiro imóvel = não tem imóvel", () => {
  const input = simulatorInput(base);
  assert.equal(input.simulationType, "individual");
  assert.equal(input.primaryMonthlyIncome, 3000);
  assert.equal(input.secondaryMonthlyIncome, null);
  assert.equal(input.hasResidentialProperty, false);
  assert.equal(input.hasOverThreeYearsRegisteredWork, true);
  assert.equal(input.availablePurchaseResource, 7000);
  assert.equal(simulatorInput({ ...base, firstProperty: "false" }).hasResidentialProperty, true);
  assert.equal(simulatorInput({ ...base, primaryIncomeType: "x" }).primaryIncomeType, "self_employed_unregistered");
});

test("resultado = MESMO motor da simulação automática (novo e usado)", () => {
  const result = simulate(base, REF);
  assert.deepEqual(result, estimateFinancing(simulatorInput(base), REF));
  assert.equal(result.eligible, true);
  assert.ok(result.used.financing > 0);
});

test("casal autônomo: renda otimizada pelo motor (sugerida ≠ informada)", () => {
  const answers = { ...base, joint: "true", primaryIncomeType: "self_employed_unregistered", primaryMonthlyIncome: "R$ 2.000", secondaryIncomeType: "self_employed_unregistered", secondaryMonthlyIncome: "R$ 2.000" };
  const result = simulate(answers, REF);
  assert.equal(result.eligible, true);
  assert.equal(result.incomeRule, "optimize");
  assert.equal(result.declaredIncome, 4000);
});

test("inelegível devolve mensagem em português", () => {
  const owner = simulate({ ...base, firstProperty: "false" }, REF);
  assert.equal(owner.eligible, false);
  assert.match(owner.message, /imóvel/);
  assert.equal(simulate({ ...base, oldestBirthDate: "" }, REF).reason, "birth_date");
});

test("valores da Caixa e voto", () => {
  assert.equal(moneyFromInput("R$ 2.550"), 2550);
  assert.equal(moneyFromInput(""), 0);
  assert.deepEqual(caixaValuesFromInput({ income: "R$ 2.400", firstInstallment: "632,97" }), { income: 2400, financing: null, subsidy: null, firstInstallment: 632.97 });
  assert.equal(caixaValuesFromInput({ firstInstallment: "1.234,56" }).firstInstallment, 1234.56);
  assert.equal(caixaValuesFromInput({}), null);
  assert.equal(parseVote("up"), "up");
  assert.equal(parseVote("down"), "down");
  assert.equal(parseVote("x"), null);
});

test("menu: Simulador Caixa para todos os perfis, com ícone no celular", async () => {
  const menu = read("components/AdminMenu.jsx");
  assert.match(menu, /href: "\/admin\/simulador-caixa", label: "Simulador Caixa", key: "caixa-simulator"/);
  assert.match(menu, /CAIXA_SIMULATOR_GROUPS = new Set\(\["crm", "clientes"\]\)/);
  assert.match(read("components/AdminBottomNav.jsx"), /"caixa-simulator": Calculator/);
});

test("página e API com guard; API recalcula no servidor; não cria cliente nem envia", () => {
  const page = read("app/admin/simulador-caixa/page.jsx");
  assert.match(page, /await requireAdminPage\(\)/);
  const route = read("app/api/admin/simulador-caixa/feedback/route.js");
  assert.equal((route.match(/const auth = await requireAdminApi\(request\);\n  if \(!auth\.ok\)/g) || []).length, 2);
  assert.match(route, /const outputs = simulate\(/);
  assert.doesNotMatch(route + read("lib/caixa-simulator-feedback.js") + read("components/CaixaSimulator.jsx"), /simulation_registrations|sendWhatsapp|sendEmail|push/i);
  const migration = read("supabase/migrations/20261019230000_caixa_simulator_feedback.sql");
  assert.match(migration, /create table if not exists public\.caixa_simulator_feedback/);
  assert.match(migration, /enable row level security/);
});
