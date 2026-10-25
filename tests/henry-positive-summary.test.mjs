// Resumo positivo do Henry (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24, docs/BUSINESS_RULES.md HENRY-1): resumo de
// desempenho fala só o que foi bom; dia fraco = frase curta de ânimo; pergunta direta de uma métrica = número, inclusive 0.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  composePositiveDailyFacts,
  greetingOf,
  hasPositiveContent,
  henryQuestionKind,
  pickSlowDayPhrase,
  positiveSpeech,
  prunePositiveFacts,
  wantsPositiveSummary,
  zeroCount
} from "../lib/henry-reports-positive-core.mjs";
import { buildHenryBrokerReport, buildHenryPeriodReport, previousHenryPeriod, resolveHenryPeriod } from "../lib/henry-reports-core.mjs";
import { HENRY_SLOW_DAY_PHRASES, HENRY_SLOW_PERIOD_PHRASES, buildHenryStaticPrompt, buildReportRewritePrompt, reportNumbersMatch } from "../lib/henry-voice-persona.mjs";
import { isSafeToSpeak } from "../lib/alexa-v2/sanitize.mjs";

const TODAY = "2026-10-24";
const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");

test("classificação: pergunta direta de métrica x resumo de desempenho (regra pura)", () => {
  const table = [
    ["qual foi o desempenho da equipe hoje?", "resumo"],
    ["como foi o dia?", "resumo"],
    ["Bom dia, Henry", "resumo"],
    ["relatório semanal", "resumo"],
    ["me dá um resumo do mês", "resumo"],
    ["como foi a Carol no mês?", "resumo"],
    ["me passa os números da semana", "resumo"],
    ["quantas simulações hoje?", "direta"],
    ["quantos leads entraram?", "direta"],
    ["quantos pontos o Eduardo fez nos últimos 30 dias?", "direta"],
    ["teve alguma venda hoje?", "direta"],
    ["bateu a meta?", "direta"],
    ["em que posição está o Bruno no ranking?", "direta"],
    ["como estão as vendas?", "direta"],
    ["e as simulações?", "direta"],
    ["toca Legião Urbana", "outra"],
    ["", "outra"]
  ];
  for (const [question, kind] of table) assert.equal(henryQuestionKind(question), kind, question);
  assert.equal(wantsPositiveSummary("qual foi o desempenho da equipe hoje?"), true);
  assert.equal(wantsPositiveSummary("quantas simulações hoje?"), false);
  assert.equal(wantsPositiveSummary(""), true); // "bom dia" do botão chega sem pergunta = resumo
});

// --- Relatório do dia ("bom dia") ---------------------------------------------------------------------------------------
// Dígitos com palavra feminina ("2 simulações") são lidos "duas" pela voz (concordarNumeros via pronounceForSpeech).
test("bom dia, dia normal: só o que foi bom, com concordância; zero e falha ficam de fora", () => {
  const rows = [{ presence: "online", metaPercent: 100 }, { presence: "online", metaPercent: 40 }, { presence: "offline", metaPercent: 0 }];
  const good = composePositiveDailyFacts({ leadsToday: 7, rows, extras: { newClients: 5, autoSimulations: 2, autoSimulationSends: 0 } });
  assert.equal(good.positive, true);
  // Lead = cliente novo (REGRA OFICIAL, dono 2026-10-25): UM item, pela contagem do Início; o "desde ontem" não se repete.
  assert.equal(good.text, "Hoje já entraram 7 clientes novos. Já saíram 2 simulações automáticas pelo site. 2 pessoas da equipe já estão on-line. Um corretor já bateu a Meta Diária.");
  assert.doesNotMatch(good.text, /nenhum|não|aguard|atras|parad/i);
  assert.ok(isSafeToSpeak(good.text));
  const one = composePositiveDailyFacts({ leadsToday: 1, rows: null, extras: { newClients: 1, autoSimulations: 0, autoSimulationSends: 1 } });
  assert.equal(one.text, "Hoje já entrou um cliente novo. Já enviei a simulação para um cliente.");
  assert.doesNotMatch(good.text + one.text, /\blead/i);
  // Sem a contagem de hoje (falhou ou zero): vale o "desde ontem", nunca os dois.
  const fallback = composePositiveDailyFacts({ leadsToday: null, rows: null, extras: { newClients: 5, autoSimulations: 0, autoSimulationSends: 0 } });
  assert.equal(fallback.text, "Desde ontem entraram 5 clientes novos no CRM.");
});

test("bom dia, dia fraco: tudo zero → nada de bom (positive false) e frase curta de ânimo, sem número, sem repetir no dia", () => {
  const weak = composePositiveDailyFacts({ leadsToday: 0, rows: [{ presence: "offline", metaPercent: 0 }], extras: { newClients: 0, autoSimulations: 0, autoSimulationSends: 0 } });
  assert.deepEqual(weak, { text: "", positive: false });
  assert.deepEqual(composePositiveDailyFacts({ leadsToday: null, rows: null, extras: null }), { text: "", positive: false }); // falhou ≠ zero, mas também não é "bom"
  for (const phrase of [...HENRY_SLOW_DAY_PHRASES, ...HENRY_SLOW_PERIOD_PHRASES]) {
    assert.doesNotMatch(phrase, /\d|nenhum|nenhuma|não foi/i, phrase);
    assert.ok(isSafeToSpeak(phrase), phrase);
    assert.ok(phrase.split(/\s+/).length <= 14, phrase);
  }
  assert.equal(HENRY_SLOW_DAY_PHRASES[0], "Dia mais tranquilo hoje, amanhã a gente acelera."); // exemplo do dono
  // Já saiu hoje → não repete; todas usadas → qualquer uma menos a última.
  const turns = [{ role: "assistant", text: "Bom dia, Matheus. Dia mais tranquilo hoje, amanhã a gente acelera." }];
  for (let index = 0; index < 20; index += 1) assert.notEqual(pickSlowDayPhrase({ turns, random: () => index / 20 }), HENRY_SLOW_DAY_PHRASES[0]);
  const all = HENRY_SLOW_DAY_PHRASES.map((text) => ({ role: "assistant", text }));
  assert.notEqual(pickSlowDayPhrase({ turns: all, random: () => 0.9999 }), HENRY_SLOW_DAY_PHRASES.at(-1));
  assert.ok(HENRY_SLOW_PERIOD_PHRASES.includes(pickSlowDayPhrase({ today: false, random: () => 0 })));
});

test("trava de números do relatório reescrito continua; 'um/uma/duas' do texto valem como 1 e 2", () => {
  const source = "Bom dia, Matheus. Hoje já entrou um lead. Já saíram duas simulações automáticas pelo site.";
  assert.equal(reportNumbersMatch(source, "Bom dia, Matheus! Entrou 1 lead e saíram 2 simulações."), true);
  assert.equal(reportNumbersMatch(source, "Bom dia! Entraram 3 leads."), false);
  assert.equal(reportNumbersMatch("Bom dia, Matheus. Hoje já entraram 7 leads.", "Bom dia! 1 lead."), false);
  assert.match(buildReportRewritePrompt({}), /não acrescente zero, pendência, atraso nem cliente aguardando/);
  // Servidor: fala positiva no relatório, tela com o relatório completo; dia fraco sem modelo.
  assert.match(lib, /const good = composePositiveDailyFacts\(\{ leadsToday: inicio\?\.kpis\?\.leadsToday\?\.total \?\? null, rows: ownerRows, extras \}\)/);
  assert.match(lib, /const rewritten = good\.positive \? await rewriteDailyReport\(auth, factual/);
  assert.match(lib, /const sentences = screenText\.split/);
});

// --- Período e corretor ----------------------------------------------------------------------------------------------------
const overview = {
  metrics: { newClients: 4, prospecting: 0, service: 12, simulation: 2, approvalPending: 0, approval: 0, sale: 0 },
  funnel: { documentation: 0 },
  team: [
    { id: "b1", name: "Ana Souza", service: 8, simulation: 2, documentation: 0, approvalPending: 0, approval: 0, sale: 0, points: 30, newClients: 3, prospecting: 0, overdueActivities: 4, staleContact: 6 },
    { id: "b2", name: "Bruno Lima", service: 0, simulation: 0, documentation: 0, approvalPending: 0, approval: 0, sale: 0, points: 0, newClients: 0, prospecting: 0, overdueActivities: 2, staleContact: 3 }
  ],
  ranking: [{ id: "b1", name: "Ana Souza", points: 30 }, { id: "b2", name: "Bruno Lima", points: 0 }],
  attention: { staleContact: 9, awaitingAction: 5 }
};
const zeroOverview = { ...overview, metrics: { newClients: 0, prospecting: 0, service: 0, simulation: 0, approvalPending: 0, approval: 0, sale: 0 }, ranking: [] };
const teamGoal = { summary: { metaPercent: 0, atividadesDone: 0, atividadesTotal: 40 }, brokers: [] };

test("desempenho da equipe hoje (dia normal): fala só o que passou de zero; tela completa", () => {
  const range = resolveHenryPeriod({ periodo: "hoje" }, TODAY);
  const report = buildHenryPeriodReport({ range, overview, teamGoal, leads: { total: 6, ad: 6, marketplace: 0, other: 0 }, awaitingReply: 8, cooledPending: 3 });
  // Lead = cliente novo (dono, 2026-10-25): um número só ("6 clientes novos", do Início); o do funil não se repete.
  assert.equal(report.spoken, "Hoje entraram 6 clientes novos, 6 de anúncio. Foram 12 atendimentos e 2 simulações. Ana lidera o ranking com 30 pontos.");
  assert.equal(report.facts.funil.novosClientes, undefined);
  assert.equal(report.facts.clientes_novos.total, 6);
  assert.doesNotMatch(report.spoken, /nenhum|\b0 |aguard|frio|Meta Diária/);
  assert.equal(report.weak, false);
  assert.equal(report.facts.funil.vendas, undefined); // zero não vai ao modelo
  assert.equal(report.facts.funil.atendimento, 12);
  const funnel = report.detail.sections.find((section) => section.title === "Funil").rows;
  assert.equal(funnel.find((row) => row.label === "Vendas").value, "0"); // a tela continua com tudo
  assert.equal(report.detail.sections.find((section) => section.title === "Atenção agora").rows[0].value, "8");
});

test("desempenho de período fraco: frase de ânimo no lugar dos zeros; sem 'não entrou nenhum lead'", () => {
  const range = resolveHenryPeriod({ periodo: "hoje" }, TODAY);
  const report = buildHenryPeriodReport({ range, overview: zeroOverview, teamGoal, leads: { total: 0, ad: 0, marketplace: 0, other: 0 }, awaitingReply: 4, cooledPending: 0, slowDayPhrase: "Dia mais tranquilo hoje, amanhã a gente acelera." });
  assert.equal(report.spoken, "Dia mais tranquilo hoje, amanhã a gente acelera.");
  assert.equal(report.weak, true);
  const week = resolveHenryPeriod({ periodo: "ultimos_7_dias" }, TODAY);
  const lower = buildHenryPeriodReport({ range: week, previousRange: previousHenryPeriod(week), overview, previousOverview: { ...overview, metrics: { ...overview.metrics, sale: 3 } }, leads: { total: 6, ad: 0, marketplace: 0, other: 6 }, previousLeads: { total: 10, ad: 0, marketplace: 0, other: 10 } });
  assert.doesNotMatch(lower.spoken, /caíram|ficaram iguais|Comparado/); // queda não se fala no resumo
});

test("pergunta direta com zero: responde o número (positive false / métrica do corretor)", () => {
  const range = resolveHenryPeriod({ periodo: "hoje" }, TODAY);
  const direct = buildHenryPeriodReport({ range, overview: zeroOverview, teamGoal, leads: { total: 0, ad: 0, marketplace: 0, other: 0 }, positive: false });
  assert.match(direct.spoken, /não entrou nenhum cliente novo/);
  assert.match(direct.spoken, /0 simulações/);
  const broker = buildHenryBrokerReport({ broker: { id: "b2", name: "Bruno Lima" }, range, overview, teamGoal, metric: "simulacoes" });
  assert.equal(broker.spoken, "Bruno não teve nenhuma simulação hoje.");
  assert.equal(broker.facts.simulacoes, 0);
  assert.equal(buildHenryBrokerReport({ broker: { id: "b2", name: "Bruno Lima" }, range, overview, teamGoal, metric: "atendimentos" }).spoken, "Bruno não teve nenhum atendimento hoje.");
  assert.equal(zeroCount("venda"), "nenhuma venda");
  assert.match(lib, /if \(!positive\) return \{ instrucao: "Pergunta direta: responda o número pedido, inclusive zero/);
});

test("corretor (resumo): só o positivo; corretor zerado → frase de ânimo; tela com atrasadas e sem contato", () => {
  const range = resolveHenryPeriod({ periodo: "hoje" }, TODAY);
  const ana = buildHenryBrokerReport({ broker: { id: "b1", name: "Ana Souza" }, range, overview, teamGoal });
  assert.equal(ana.spoken, "Ana hoje: 8 atendimentos e 2 simulações. Fez 30 pontos e está em 1º no ranking.");
  assert.equal(ana.facts.vendas, undefined);
  assert.equal(ana.detail.sections[0].rows.find((row) => row.label === "Atividades atrasadas (agora)").value, "4");
  const bruno = buildHenryBrokerReport({ broker: { id: "b2", name: "Bruno Lima" }, range, overview, teamGoal, slowDayPhrase: "Dia mais devagar hoje, bora com tudo amanhã." });
  assert.equal(bruno.spoken, "Dia mais devagar hoje, bora com tudo amanhã.");
  assert.equal(bruno.weak, true);
  const full = buildHenryBrokerReport({ broker: { id: "b2", name: "Bruno Lima" }, range, overview, teamGoal, positive: false });
  assert.match(full.spoken, /0 atendimentos/);
  // Servidor: positivo só sem métrica e com pergunta geral.
  assert.match(lib, /const positive = !metric && wantsPositiveSummary\(context\.question\)/);
  assert.match(lib, /const positive = wantsPositiveSummary\(context\.question\);\n  const report = buildHenryPeriodReport\(\{/);
});

test("consultar_crm no Henry: frase do catálogo (compartilhada com a Alexa) filtrada só no resumo", () => {
  assert.equal(positiveSpeech("Hoje: 0 clientes novos, 12 prospecções e 1 aprovação."), "Hoje: 12 prospecções e 1 aprovação.");
  assert.equal(
    positiveSpeech("A equipe está com 0% da meta de hoje. Ninguém bateu a meta ainda. Hoje foram 3 simulações. Nenhum corretor online agora. 2 corretores ainda não prospectaram."),
    "Hoje foram 3 simulações."
  );
  assert.equal(positiveSpeech("Bom dia, Matheus. Hoje entraram 3 leads. 4 clientes aguardam resposta; o mais antigo é Ana. 2 atenções para você: x."), "Bom dia, Matheus. Hoje entraram 3 leads.");
  assert.equal(hasPositiveContent("Bom dia, Matheus."), false);
  assert.equal(hasPositiveContent("Bom dia, Matheus. Hoje entraram 3 leads."), true);
  assert.equal(greetingOf("Bom dia, Matheus. Nenhum lead novo hoje ainda."), "Bom dia, Matheus.");
  assert.deepEqual(prunePositiveFacts({ a: 0, b: 3, agora: { aguardando_resposta: 9 }, c: "indisponível", d: "sem meta no período", e: { x: 0 } }), { b: 3, c: "indisponível" });
  assert.match(lib, /return positiveCatalogAnswer\(text, query, context\)/);
  assert.match(lib, /const POSITIVE_CATALOG_TOPICS = new Set\(\["resumo", "desempenho", "equipe_resumo", "corretor_resumo", "funil"\]\)/);
  // A Alexa não muda: o filtro mora só no Henry.
  const alexa = readFileSync(new URL("../lib/alexa-v2/catalog-corretor.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(alexa, /henry-reports-positive-core/);
});

test("prompt fixo: regra curta do resumo positivo e da pergunta direta", () => {
  const prompt = buildHenryStaticPrompt();
  assert.match(prompt, /Resumo de desempenho .*fale SÓ o que foi bom/);
  assert.match(prompt, /Zero não se fala/);
  assert.match(prompt, /Pergunta DIRETA de uma métrica .*inclusive zero \("Nenhuma simulação foi realizada hoje\."\)/);
  assert.match(prompt, /Desempenho geral da equipe de hoje ou ontem .*relatorio_periodo/);
});
