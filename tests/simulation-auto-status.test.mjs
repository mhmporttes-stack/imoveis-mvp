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
  assert.equal(AUTO_PRESENTATION_LOCKED_MESSAGE, "Confira 👍/👎 em cada imóvel para liberar o link.");
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

test("conferência por tipo na aba da simulação (Gerador) e na ficha, com a linha curta; marca automática nunca volta pelo formulário", () => {
  const page = source("app/admin/simulacoes/[id]/page.jsx");
  assert.match(page, /isAutomaticSimulationSource\(simulation\.createdBy\) \? \([\s\S]{0,200}\{AUTO_PRESENTATION_LOCKED_MESSAGE\}/);
  assert.match(source("components/SimulationGenerator.jsx"), /<AutoReviewTypeVote[\s\S]{0,80}type=\{key\}/);
  assert.match(source("components/clients/ClientSheet.jsx"), /<AutoReviewTypeVote[\s\S]{0,120}type=\{item\.type\}/);
  const review = source("components/AutoReviewTypeVote.jsx");
  assert.match(review, /ThumbsUp/);
  assert.match(review, /ThumbsDown/);
  assert.match(review, /Não lance a entrada mostrada pela Caixa/);
  assert.match(source("lib/simulations.js"), /staleAutomaticMark \? \{ createdBy: current\.createdBy \}/);
});

test("refazer simulação automática: guard do cliente, confirmação antes de substituir a do corretor, histórico da conferência", () => {
  const lib = source("lib/simulations.js");
  assert.match(lib, /export async function redoAutomaticSimulation[\s\S]*assertCanAccessResponsibleUser\(auth/);
  assert.match(lib, /incomeMode: "registered"/);
  assert.match(lib, /REDO_REPLACE_CONFIRMATION = "Isso substitui a simulação atual\. Continuar\?"/);
  assert.match(lib, /if \(manual && !confirmReplace\) return \{ needsConfirmation: true/);
  const route = source("app/api/admin/clients/[id]/simulacao-automatica/route.js");
  assert.match(route, /requireAdminApi/);
  assert.match(route, /newRound: true/);
  assert.match(source("lib/simulation-auto-reviews.js"), /AUTO_REVIEW_STATUS\.SUPERSEDED/);
  assert.doesNotMatch(route, /sendWhatsapp|sendMessage|ensurePresentation/);
});

import { scenarioDataFromSimulation, scenarioDiff, scenarioHighlights, scenarioModelsForForm, scenarioValuesKey } from "../lib/simulation-scenarios-core.mjs";

test("comparar simulações: dados do cenário, destaques, diferença e volta ao formato do Gerador", () => {
  const simulation = (financing, subsidy, first) => ({ interestRateAnnual: 4.5, simulationModels: {
    novo: { financingValue: `R$ ${financing}`, subsidyValue: `R$ ${subsidy}`, firstInstallment: `R$ ${first}`, termMonths: "420" },
    usado: { financingValue: `R$ ${financing}`, subsidyValue: "R$ 1000", firstInstallment: `R$ ${first}`, termMonths: "420" } } });
  const a = { id: "a", data: scenarioDataFromSimulation(simulation(150000, 20000, 750), { estimate: { income: 2550, used: { income: 2400 } } }) };
  const b = { id: "b", data: scenarioDataFromSimulation(simulation(115000, 48000, 555)) };
  assert.equal(a.data.novo.power, 170000);
  assert.equal(a.data.inputs.incomeNovo, 2550);
  assert.equal(a.data.inputs.incomeUsado, 2400);
  const highlights = scenarioHighlights([a, b]);
  assert.equal(highlights.novo.bestPowerId, "a");
  assert.equal(highlights.novo.lowestInstallmentId, "b");
  assert.deepEqual(scenarioDiff(b.data, a.data).novo, { power: -7000, firstInstallment: -195 });
  assert.equal(scenarioModelsForForm(b.data).novo.financingValue, "R$ 115.000,00");
  assert.notEqual(scenarioValuesKey(a.data), scenarioValuesKey(b.data));
  assert.equal(scenarioValuesKey(a.data), scenarioValuesKey(scenarioDataFromSimulation(simulation(150000, 20000, 750))));
});

test("cenários: gravados no site, no refazer e no Salvar do corretor; usar cenário com confirmação e guard", () => {
  assert.match(source("app/api/simulation-registrations/route.js"), /recordScenario\(\{ registrationId: registration\.id, simulationId: saved\.simulation\.id, origin: "site"/);
  assert.match(source("app/api/admin/clients/[id]/simulacao-automatica/route.js"), /origin: "refazer"/);
  const lib = source("lib/simulations.js");
  assert.match(lib, /origin: "corretor", checked: true, data: scenarioData, actor, dedupe: true/);
  assert.match(lib, /export async function applySimulationScenario[\s\S]*assertCanAccessResponsibleUser\(auth/);
  assert.match(lib, /if \(existing && \(Number\(existing\.financing_value\) > 0 \|\| Number\(existing\.subsidy_value\) > 0\) && !confirmReplace\)/);
  const route = source("app/api/admin/clients/[id]/cenarios/route.js");
  assert.match(route, /requireAdminApi/);
  assert.match(route, /assertCanAccessResponsibleUser/);
});

test("aba da simulação: Enviar bloqueado na automática, Salvar só para nova/automática, sugestões de prazo e taxa", async () => {
  const generator = source("components/SimulationGenerator.jsx");
  assert.match(generator, /async function sendPresentationToWhatsApp\(\) \{[\s\S]{0,400}isAutomaticSimulationSource\(formRef\.current\?\.createdBy\)[\s\S]{0,80}AUTO_PRESENTATION_LOCKED_MESSAGE/);
  assert.match(generator, /\{!form\.id \|\| isAutomaticSimulationSource\(form\.createdBy\) \? \(/);
  assert.match(source("lib/simulations.js"), /mergeWindowMinutes: 30/);
  const { simulationFieldSuggestions } = await import("../lib/financiamento-estimativa-core.mjs");
  const older = simulationFieldSuggestions({ registration: { oldestBirthDate: "1960-05-01", primaryMonthlyIncome: 2400, primaryIncomeType: "registered_employment", hasOverThreeYearsRegisteredWork: true }, simulation: {}, referenceDate: "2026-10-19" });
  assert.deepEqual(older.termMonths, { value: 169, source: "idade", label: "Prazo máximo pela idade do mais velho" });
  assert.equal(older.annualRate.source, "faixa_renda");
  assert.equal(older.annualRate.value, 4.5);
  const auto = simulationFieldSuggestions({ registration: { oldestBirthDate: "1998-01-01" }, simulation: { interestRateAnnual: 4.25 }, automatic: true, referenceDate: "2026-10-19" });
  assert.equal(auto.termMonths.value, 420);
  assert.deepEqual(auto.annualRate, { value: 4.25, source: "simulacao_automatica", label: "Taxa da simulação automática" });
  assert.equal(simulationFieldSuggestions({ registration: {}, simulation: { interestRateAnnual: 5 }, referenceDate: "2026-10-19" }).annualRate.source, "ultima_usada");
});

import { snapshotWithPreviousRound } from "../lib/simulation-auto-review-core.mjs";

test("refazer sem a migration 20261019200000: conferência fechada é reaberta como pendente, rodada anterior guardada (incidente 2026-10-19)", () => {
  const lib = source("lib/simulation-auto-reviews.js");
  assert.match(lib, /if \(newRound\) return reopenClosedReview\(\{ simulationId, snapshot \}\)/);
  const reopen = /async function reopenClosedReview[\s\S]*?\n}\n/.exec(lib)?.[0] || "";
  assert.match(reopen, /review_status: AUTO_REVIEW_STATUS\.PENDING/);
  assert.match(reopen, /snapshotWithPreviousRound\(snapshot, previous\)/);
  const previous = { id: "r1", review_status: "ok", reviewed_by_email: "a@b", auto_snapshot: { version: "v1", origin: "site", previousRounds: [{ review_status: "corrected" }] } };
  const next = snapshotWithPreviousRound({ version: "v2", origin: "refazer" }, previous);
  assert.equal(next.version, "v2");
  assert.deepEqual(next.previousRounds.map((round) => round.review_status), ["ok", "corrected"]);
  assert.deepEqual(next.previousRounds[0].auto_snapshot, { version: "v1", origin: "site" });
  assert.equal(next.previousRounds[0].id, undefined);
  assert.deepEqual(snapshotWithPreviousRound({ version: "v2" }, null), { version: "v2" });
});

test("/s/<token> de simulação automática aguardando conferência: aviso amigável, demais motivos seguem 404", () => {
  const page = source("app/apresentacao/[token]/page.jsx");
  assert.match(page, /reason === PRESENTATION_UPDATING_REASON\) return <PresentationUpdating \/>/);
  assert.match(page, /if \(!dto\) notFound\(\)/);
  assert.doesNotMatch(page.split("function PresentationUpdating")[1], /dto|token|recordPresentationEvent/);
  const lib = source("lib/simulation-presentation.js");
  assert.match(lib, /PRESENTATION_UPDATING_REASON = "simulacao_automatica_nao_conferida"/);
  assert.match(lib, /export async function getPublicPresentation\(token, options = \{\}\) \{\n  return \(await resolvePublicPresentation\(token, options\)\)\.dto;/);
});

// Incidente 2026-10-22: rascunho vazio criado ao abrir "Simulação"/"Valores" na lista (created_by = e-mail de quem abriu)
// 0,3 s antes do formulário do site bloqueava a simulação automática em silêncio. Mesma régua do "Refazer".
import { automaticSimulationCanReplace } from "../lib/simulation-status-lock-core.mjs";

test("SIM-AUTO: site substitui rascunho vazio (inclusive de pessoa), nunca simulação com valor salva por pessoa", () => {
  assert.equal(automaticSimulationCanReplace(null), true);
  assert.equal(automaticSimulationCanReplace({ created_by: "dono@exemplo.com", financing_value: null, subsidy_value: "0.00" }), true);
  assert.equal(automaticSimulationCanReplace({ created_by: "Cadastro do site", financing_value: 0, subsidy_value: 0 }), true);
  assert.equal(automaticSimulationCanReplace({ created_by: AUTOMATIC_SIMULATION_SOURCE, financing_value: "167779.22", subsidy_value: "12086.00" }), true);
  assert.equal(automaticSimulationCanReplace({ created_by: "corretor@exemplo.com", financing_value: "150000.00", subsidy_value: 0 }), false);
  assert.equal(automaticSimulationCanReplace({ created_by: "corretor@exemplo.com", financing_value: 0, subsidy_value: "5000" }), false);
  const sims = readFileSync(new URL("../lib/simulations.js", import.meta.url), "utf8");
  const site = sims.slice(sims.indexOf("export async function saveSiteSimulationFromRegistration"), sims.indexOf("async function latestRegistrationSimulationRow"));
  assert.match(site, /automaticSimulationCanReplace\(existing\)/);
  const redo = sims.slice(sims.indexOf("export async function redoAutomaticSimulation"));
  assert.match(redo, /const manual = !automaticSimulationCanReplace\(existing\);/);
  // Pulo nunca é silencioso: a rota registra o motivo (sem dado pessoal).
  const route = readFileSync(new URL("../app/api/simulation-registrations/route.js", import.meta.url), "utf8");
  assert.match(route, /if \(saved\.skipped\) console\.warn\("Site automatic simulation skipped:"/);
});
