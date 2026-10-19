import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_CLIENT_STATUS_VALUES,
  AWAITING_SIMULATION_STATUS_VALUES,
  CLIENT_FUNNEL_STAGES,
  CLIENT_STATUS,
  CLIENT_STATUS_FILTER_GROUPS,
  clientStatusLabel,
  getClientFunnelStage,
  normalizeClientStatus
} from "../lib/client-status.js";
import { AUTOMATIC_SIMULATION_SOURCE, hasRealSimulationValues, isAutomaticSimulationSource } from "../lib/simulation-status-lock-core.mjs";
import { PRE_SIMULATION_STATUSES, rouletteRuleConditions } from "../lib/simulation-deadline-core.mjs";
import { SIMULATION_FIRST_STATUSES } from "../lib/simulation-first-core.mjs";
import { CHAT_CLIENT_EVENT, nextClientStatusOnChatEvent } from "../lib/whatsapp-client-status-core.mjs";
import { readFileSync } from "node:fs";

// SIM-AUTO (dono, 2026-10-19): "Simulação automática" = antes da simulação real em todas as regras.
test("status novo existe, logo após Aguardando simulação, sem pontuação e fora das etapas do funil", () => {
  assert.equal(normalizeClientStatus("auto_simulation"), CLIENT_STATUS.AUTO_SIMULATION);
  assert.equal(clientStatusLabel("auto_simulation"), "Simulação automática");
  // lib/scoring-rules.js é server-only: confere que o status não tem chave de pontuação no mapa.
  assert.ok(!/AUTO_SIMULATION|auto_simulation/.test(readFileSync(new URL("../lib/scoring-rules.js", import.meta.url), "utf8")));
  assert.equal(getClientFunnelStage("auto_simulation"), "");
  assert.ok(!CLIENT_FUNNEL_STAGES.some((stage) => stage.statuses.includes("auto_simulation")));
  assert.ok(ACTIVE_CLIENT_STATUS_VALUES.has("auto_simulation"));
  assert.deepEqual(AWAITING_SIMULATION_STATUS_VALUES, ["pending", "auto_simulation"]);
  assert.ok(CLIENT_STATUS_FILTER_GROUPS.find((group) => group.key === "simulation").statuses.includes("auto_simulation"));
});

test("roleta: o prazo da simulação e a regra 'simulação primeiro' continuam valendo", () => {
  assert.ok(PRE_SIMULATION_STATUSES.includes("auto_simulation"));
  assert.ok(SIMULATION_FIRST_STATUSES.includes("auto_simulation"));
  const client = { status: "auto_simulation", primary_monthly_income: 2500, created_at: "2026-10-19T12:00:00Z" };
  assert.deepEqual(rouletteRuleConditions([{ type: "status_equals", value: "pending" }], client), []);
});

test("mensagem humana no Chat: Simulação automática → Tentando contato (igual a Aguardando simulação)", () => {
  assert.equal(nextClientStatusOnChatEvent("auto_simulation", CHAT_CLIENT_EVENT.HUMAN_MESSAGE_SENT), CLIENT_STATUS.AWAITING_RETURN);
});

test("simulação automática não conta como simulação real (trava, pontuação, card, prazo da roleta)", () => {
  assert.ok(isAutomaticSimulationSource(AUTOMATIC_SIMULATION_SOURCE));
  assert.equal(hasRealSimulationValues([{ financing_value: 150000, subsidy_value: 0, created_by: AUTOMATIC_SIMULATION_SOURCE }]), false);
  assert.equal(hasRealSimulationValues([{ financing_value: 150000, subsidy_value: 0, created_by: "corretor@exemplo.com" }]), true);
  // lib/simulation-list-utils.js (imports sem extensão) não roda no node --test: confere no código que o card trata a
  // simulação automática como não realizada e expõe os números em `automatic`.
  const listUtils = readFileSync(new URL("../lib/simulation-list-utils.js", import.meta.url), "utf8");
  assert.match(listUtils, /if \(isAutomaticSimulationSource\(source\.createdBy\)\) \{\s*return \{\s*completed: false,/);
  assert.match(listUtils, /automatic: \{/);
});

import { AUTO_SIMULATION_REVIEW_ENABLED, buildAutoSnapshot, buildCorrectedSnapshot, parseCaixaIncome } from "../lib/simulation-auto-review-core.mjs";
import { AUTO_PRESENTATION_LOCKED_MESSAGE } from "../lib/simulation-status-lock-core.mjs";
import { estimateFinancing } from "../lib/financiamento-estimativa-core.mjs";

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("conferência: retrato do site com entradas e saídas (novo e usado) e valores corrigidos da Caixa", () => {
  assert.equal(AUTO_SIMULATION_REVIEW_ENABLED, true);
  const registration = { primaryMonthlyIncome: 5000, primaryIncomeType: "self_employed_unregistered", hasChildrenUnder18: true, hasOverThreeYearsRegisteredWork: true, oldestBirthDate: "1998-01-01", hasResidentialProperty: false, availablePurchaseResource: 0 };
  const estimate = estimateFinancing(registration, "2026-10-19");
  const snapshot = buildAutoSnapshot(registration, estimate, "2026-10-19");
  assert.equal(snapshot.inputs.primaryIncomeDeclared, 5000);
  assert.equal(snapshot.inputs.incomeConsidered, estimate.income);
  assert.equal(snapshot.inputs.incomeRule, "optimize");
  assert.equal(snapshot.outputs.financing, estimate.financing);
  assert.equal(snapshot.outputs.usado.subsidy, estimate.used.subsidy);
  const corrected = buildCorrectedSnapshot({ interestRateAnnual: 4.5, simulationModels: { novo: { financingValue: "R$ 150.000,00", subsidyValue: "R$ 20.000,00", firstInstallment: "R$ 749,97", termMonths: "420" } } }, { caixaIncome: 2550 });
  assert.deepEqual(corrected.novo.price, { financing: 150000, subsidy: 20000, firstInstallment: 749.97, lastInstallment: 0, termMonths: 420 });
  assert.equal(corrected.caixaIncome, 2550);
  assert.equal(parseCaixaIncome("2.550,00"), 2550);
  assert.equal(parseCaixaIncome("abc"), null);
});

test("link da apresentação travado até a conferência (servidor e tela)", () => {
  assert.equal(AUTO_PRESENTATION_LOCKED_MESSAGE, "Confira na Caixa e marque OK ou Corrija para liberar o link.");
  const presentation = source("lib/simulation-presentation.js");
  assert.match(presentation, /export async function ensurePresentation\(\{ simulation, userId \}\) \{\s*assertPresentationAllowed\(simulation\);/);
  assert.match(presentation, /export async function regeneratePresentation\(\{ simulation, userId \}\) \{\s*assertPresentationAllowed\(simulation\);/);
  assert.match(presentation, /simulacao_automatica_nao_conferida/);
  assert.doesNotMatch(source("app/api/simulation-registrations/route.js"), /ensurePresentation/);
  assert.match(source("app/api/simulations/[id]/conferencia/route.js"), /assertCanAccessResponsibleUser/);
});

test("usado: subsídio zero acima de R$ 2.850 (Caixa zera); Gerador sem a opção do PDF; imagem só pelo token", () => {
  assert.equal(estimateFinancing({ primaryMonthlyIncome: 3000, primaryIncomeType: "registered_employment", hasChildrenUnder18: true, hasOverThreeYearsRegisteredWork: true, oldestBirthDate: "1998-01-01", hasResidentialProperty: false }, "2026-10-19").used.subsidy, 0);
  assert.ok(estimateFinancing({ primaryMonthlyIncome: 2300, primaryIncomeType: "registered_employment", hasChildrenUnder18: true, hasOverThreeYearsRegisteredWork: true, oldestBirthDate: "1998-01-01", hasResidentialProperty: false }, "2026-10-19").used.subsidy > 0);
  assert.doesNotMatch(source("components/SimulationGenerator.jsx"), /Modo de páginas dos imóveis\s*<select/);
  assert.match(source("app/apresentacao/[token]/imagem/route.js"), /getPublicPresentation\(token/);
});
