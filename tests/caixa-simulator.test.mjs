import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BROKER_INCOME_SOURCE, caixaValuesFromInput, feedbackInputs, moneyFromInput, parseVote, simulate, simulatorInput } from "../lib/caixa-simulator-core.mjs";
import { estimateFinancing } from "../lib/financiamento-estimativa-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const REF = "2026-10-19";
const base = {
  joint: "false",
  primaryMonthlyIncome: "R$ 3.000",
  oldestBirthDate: "1995-05-10",
  fgtsThreeYears: "true",
  dependents: "true",
  firstProperty: "true",
  downPayment: "R$ 5.000",
  fgtsAvailable: "R$ 2.000"
};

test("respostas viram a mesma entrada do motor; sem regime: renda do corretor como renda fixa; Primeiro imóvel = não tem imóvel", () => {
  const input = simulatorInput(base);
  assert.equal(input.simulationType, "individual");
  assert.equal(input.primaryMonthlyIncome, 3000);
  assert.equal(input.secondaryMonthlyIncome, null);
  assert.equal(input.hasResidentialProperty, false);
  assert.equal(input.hasOverThreeYearsRegisteredWork, true);
  assert.equal(input.availablePurchaseResource, 7000);
  assert.equal(input.propertyValue, null, "vazio = automático (teto da faixa)");
  assert.equal(input.primaryIncomeType, "registered_employment");
  assert.equal(simulatorInput({ ...base, firstProperty: "false" }).hasResidentialProperty, true);
  const stored = feedbackInputs(base);
  assert.equal(stored.incomeSource, BROKER_INCOME_SOURCE);
  assert.ok(!("primaryIncomeType" in stored) && !("secondaryIncomeType" in stored), "voto sem regime");
});

test("resultado = MESMO motor da simulação automática (novo e usado)", () => {
  const result = simulate(base, REF);
  assert.deepEqual(result, estimateFinancing(simulatorInput(base), REF));
  assert.equal(result.eligible, true);
  assert.ok(result.used.financing > 0);
  assert.equal(result.propertyValue, 235000);
});

test("renda digitada usada EXATAMENTE (sem teto de informal nem renda sugerida), mesmo com filhos e FGTS", () => {
  const answers = { ...base, joint: "true", primaryMonthlyIncome: "R$ 2.000", secondaryMonthlyIncome: "R$ 2.000" };
  const result = simulate(answers, REF);
  assert.equal(result.eligible, true);
  assert.equal(result.incomeRule, "declared");
  assert.equal(result.income, 4000);
  assert.equal(result.used.income, 4000);
  assert.equal(simulate({ ...base, primaryMonthlyIncome: "R$ 3.100" }, REF).income, 3100);
});

test("valor do imóvel abaixo de 235 mil: cota de 80% limita o financiamento; subsídio cabe no valor; acima do teto avisa", () => {
  const rich = { ...base, primaryMonthlyIncome: "R$ 4.800" };
  const full = simulate(rich, REF);
  const small = simulate({ ...rich, propertyValue: "R$ 150.000" }, REF);
  assert.equal(small.eligible, true);
  assert.equal(small.propertyValue, 150000);
  assert.equal(small.financing, 120000, "80% de 150 mil");
  assert.ok(full.financing > small.financing);
  assert.ok(small.financing + small.subsidy <= 150000);
  assert.ok(small.purchasePower <= 150000);
  const tiny = simulate({ ...base, primaryMonthlyIncome: "R$ 2.000", propertyValue: "R$ 100.000" }, REF);
  assert.equal(tiny.financing, 80000);
  assert.ok(tiny.subsidy <= 20000 && tiny.used.subsidy <= 20000, "subsídio limitado ao que sobra do imóvel");
  const above = simulate({ ...base, propertyValue: "R$ 300.000" }, REF);
  assert.equal(above.eligible, false);
  assert.equal(above.reason, "property_above_cap");
  assert.match(above.message, /teto da Faixa 1 \(R\$\s235\.000\)/);
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
  assert.match(route, /const inputs = feedbackInputs\(/);
  const ui = read("components/CaixaSimulator.jsx").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(ui, /Regime|Entrada necessária|Falta de entrada|Renda sugerida/);
  assert.match(ui, /label="Valor do imóvel"/);
  assert.doesNotMatch(route + read("lib/caixa-simulator-feedback.js") + read("components/CaixaSimulator.jsx"), /simulation_registrations|sendWhatsapp|sendEmail|push/i);
  const migration = read("supabase/migrations/20261019230000_caixa_simulator_feedback.sql");
  assert.match(migration, /create table if not exists public\.caixa_simulator_feedback/);
  assert.match(migration, /enable row level security/);
});

test("barra do corretor/associado: Simulador no lugar da Meta; pré-carregamento do Online no admin (dono, 2026-10-19)", () => {
  const nav = read("components/AdminBottomNav.jsx");
  assert.match(nav, /return \[DESTINATIONS\.caixaSimulator, DESTINATIONS\.clients, DESTINATIONS\.chat, DESTINATIONS\.agenda\]/);
  assert.match(nav, /if \(isManager\) return \[DESTINATIONS\.dailyGoal,/);
  const layout = read("app/admin/layout.jsx");
  assert.match(layout, /isAdmin \? \["\/admin\/desempenho\/online", "\/admin\/desempenho"\]/);
  assert.match(layout, /!isAdmin && !hidden\.has\("daily-goal"\) \? \["\/admin\/meta-diaria"\]/);
  assert.match(read("app/admin/desempenho/online/page.jsx"), /unstable_dynamicStaleTime = 300/);
  assert.match(read("components/OnlinePresenceBoard.jsx"), /useRevalidateOnReuse\(renderId/);
});
