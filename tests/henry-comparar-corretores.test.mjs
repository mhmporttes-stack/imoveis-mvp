// Comparação entre corretores no Henry (bug relatado pelo dono em 2026-10-25): "quantas simulações o Eduardo realizou nos
// últimos 30 dias?" foi respondida; "qual corretor mais realizou simulações?" e "olha as simulações dos corretores um por
// um e me diz quem mais realizou" não. Ver docs/INCIDENTES.md e docs/CHANGELOG_AI.md (2026-10-25).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { henryDirectRoute, isBrokerComparisonQuestion } from "../lib/henry-voice-turn.mjs";
import { HENRY_COMPARE_METRIC_IDS, buildHenryBrokerComparison, buildHenryBrokerReport, resolveHenryPeriod } from "../lib/henry-reports-core.mjs";
import { HENRY_TOOL_ACCESS } from "../lib/henry-voice-core.mjs";
import { henryProgressFor } from "../lib/henry-voice-narration.mjs";
import { buildHenryStaticPrompt } from "../lib/henry-voice-persona.mjs";
import { HENRY_TRAINING_SCENARIOS, analyzeHenryTraining } from "../lib/henry-training-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const TODAY = "2026-10-25";
const route = (text, turns = []) => henryDirectRoute(text, { turns, today: TODAY });
const FIRST = "Henry, quantas simulações o Eduardo realizou nos últimos 30 dias?";
const turnsAfterFirst = [
  { role: "user", text: FIRST },
  { role: "assistant", text: "O Eduardo teve 12 simulações nos últimos 30 dias." }
];

// slimOverview fictício: as MESMAS linhas do Desempenho por corretor (team) e o ranking.
const overview = {
  team: [
    { id: "e", name: "Eduardo", fullName: "Eduardo Lima", gender: "male", role: "broker", simulation: 12, sale: 1, service: 30, points: 80 },
    { id: "c", name: "Carol", fullName: "Carol Souza", gender: "female", role: "broker", simulation: 15, sale: 2, service: 25, points: 95 },
    { id: "g", name: "Gabriel", fullName: "Gabriel Reis", gender: "male", role: "broker", simulation: 9, sale: 0, service: 40, points: 60 },
    { id: "b", name: "Bruna", fullName: "Bruna Alves", gender: "female", role: "broker", simulation: 4, sale: 0, service: 10, points: 20 },
    { id: "m", name: "Lucas", fullName: "Lucas Gestor", gender: "male", role: "manager", simulation: 0, sale: 0, service: 0, points: 0 }
  ],
  ranking: [
    { id: "c", name: "Carol", gender: "female", points: 95 },
    { id: "e", name: "Eduardo", gender: "male", points: 80 },
    { id: "g", name: "Gabriel", gender: "male", points: 60 },
    { id: "b", name: "Bruna", gender: "female", points: 20 }
  ]
};
const range30 = resolveHenryPeriod({ periodo: "ultimos_30_dias" }, TODAY);

test("falas do dono: comparação vai direto para comparar_corretores, herdando métrica e período", () => {
  assert.equal(route(FIRST), null); // um corretor (nome próprio) continua no consultar_corretor, pelo modelo
  assert.deepEqual(route("Qual corretor mais realizou simulações?", turnsAfterFirst), {
    name: "comparar_corretores",
    input: { metrica: "simulacoes", ordem: "mais", periodo: "ultimos_30_dias" },
    topic: "comparacao",
    speak: true
  });
  assert.deepEqual(route("Olha as simulações dos corretores um por um e me diz quem mais realizou", turnsAfterFirst).input, { metrica: "simulacoes", ordem: "mais", periodo: "ultimos_30_dias" });
  // "e quem mais fez?" sem métrica nem período: os dois vêm da conversa.
  assert.deepEqual(route("E quem mais fez?", turnsAfterFirst).input, { metrica: "simulacoes", ordem: "mais", periodo: "ultimos_30_dias" });
  assert.deepEqual(route("e quem menos fez?", turnsAfterFirst).input, { metrica: "simulacoes", ordem: "menos", periodo: "ultimos_30_dias" });
  // Período dito na fala vale sobre o da conversa; sem nenhum, o mês (padrão do consultar_corretor).
  assert.deepEqual(route("quem mais vendeu na semana passada?").input, { metrica: "vendas", ordem: "mais", periodo: "semana_passada" });
  assert.deepEqual(route("qual corretor teve mais atendimentos hoje?").input, { metrica: "atendimentos", ordem: "mais", periodo: "hoje" });
  assert.deepEqual(route("quem recebeu mais clientes novos?").input, { metrica: "novos_clientes", ordem: "mais", periodo: "este_mes" });
  assert.deepEqual(route("quem fez mais pontos nos últimos 15 dias?").input, { metrica: "pontos", ordem: "mais", periodo: "ultimos_15_dias" });
});

test("não é comparação: 'quem mais' sem métrica, conversa, presença, meta e quem está parado", () => {
  for (const text of ["quem mais está na imobiliária?", "quem mais chegou hoje?", "quem mais tem conversa esperando?", "quem mais bateu a meta?", "e quem mais?"]) {
    assert.equal(isBrokerComparisonQuestion(text), false, text);
  }
  // "e quem mais fez?" sem nenhuma métrica na conversa → o modelo decide (nada de chute).
  assert.equal(route("E quem mais fez?", []), null);
  // Rotas antigas intactas.
  assert.equal(route("quais clientes novos entraram hoje?").name, "consultar_crm");
  assert.equal(route("e o ranking do mês?").name, "ranking_periodo");
});

test("montagem: mesma fonte do consultar_corretor, ordenada, 1º e os 2 seguintes com números, tabela completa na tela", () => {
  const report = buildHenryBrokerComparison({ range: range30, overview, metric: "simulacoes" });
  assert.equal(report.spoken, "Nos últimos 30 dias, quem teve mais simulações foi a Carol, com 15; depois vêm o Eduardo, com 12, e o Gabriel, com 9.");
  assert.deepEqual(report.detail.sections[0].rows.map((row) => row.value), ["15", "12", "9", "4"]);
  assert.equal(report.detail.sections[0].rows[0].label, "1º Carol Souza");
  // Os números batem com a pergunta individual (consultar_corretor, mesma linha do Desempenho).
  const eduardo = buildHenryBrokerReport({ broker: { id: "e", name: "Eduardo" }, range: range30, overview, metric: "simulacoes" });
  assert.equal(eduardo.facts.simulacoes, report.facts.corretores.find((row) => row.nome === "Eduardo").simulacoes);
  // Menos: do menor para o maior, zero dito como "nenhuma".
  const fewest = buildHenryBrokerComparison({ range: range30, overview, metric: "simulacoes", order: "menos" });
  assert.match(fewest.spoken, /^Nos últimos 30 dias, quem teve menos simulações foi a Bruna, com 4; depois vêm o Gabriel, com 9, e o Eduardo, com 12\.$/);
  // Empate na frente; seguidores com zero ficam fora da fala em "mais".
  const tie = buildHenryBrokerComparison({ range: range30, overview, metric: "vendas" });
  assert.equal(tie.spoken, "Nos últimos 30 dias, quem teve mais vendas foi a Carol, com 2; depois vem o Eduardo, com 1.");
  // Pontos = o ranking do período (o mesmo do ranking_periodo).
  assert.match(buildHenryBrokerComparison({ range: range30, overview, metric: "pontos" }).spoken, /quem fez mais pontos foi a Carol, com 95/);
  // Ninguém fez.
  assert.equal(buildHenryBrokerComparison({ range: range30, overview, metric: "documentacao" }).spoken, "Nos últimos 30 dias, ninguém teve cliente em documentação.");
  assert.equal(buildHenryBrokerComparison({ range: range30, overview: null, metric: "simulacoes" }), null);
  assert.equal(buildHenryBrokerComparison({ range: range30, overview, metric: "ranking" }), null);
});

test("ferramenta só de leitura, no prompt, na narração e com o roteiro do Treino", () => {
  assert.equal(HENRY_TOOL_ACCESS.comparar_corretores, "leitura");
  assert.match(lib, /name: "comparar_corretores"/);
  assert.match(lib, /if \(name === "comparar_corretores"\) return await runBrokerComparison/);
  assert.ok(!HENRY_COMPARE_METRIC_IDS.includes("ranking") && !HENRY_COMPARE_METRIC_IDS.includes("meta"));
  assert.ok(HENRY_COMPARE_METRIC_IDS.includes("simulacoes") && HENRY_COMPARE_METRIC_IDS.includes("novos_clientes"));
  assert.equal(henryProgressFor("comparar_corretores", {}).topic, "ranking");
  assert.match(buildHenryStaticPrompt(), /comparar_corretores/);
  const scenario = HENRY_TRAINING_SCENARIOS.find((item) => item.id === "comparacao");
  assert.equal(scenario.steps.length, 2);
  assert.equal(isBrokerComparisonQuestion(scenario.steps[1].say), true);
});

test("Treino: achado comparacao_sem_resposta", () => {
  const kinds = (exchanges) => analyzeHenryTraining(exchanges).issues.map((issue) => issue.kind);
  assert.ok(kinds([{ owner: "Qual corretor mais realizou simulações?", reply: "Não consigo comparar os corretores por aqui." }]).includes("comparacao_sem_resposta"));
  assert.ok(kinds([{ owner: "E quem mais fez?", reply: "Boa pergunta, vou dar uma olhada." }]).includes("comparacao_sem_resposta"));
  assert.ok(!kinds([{ owner: "E quem mais fez?", reply: "Nos últimos 30 dias, quem teve mais simulações foi a Carol, com 15." }]).includes("comparacao_sem_resposta"));
});

test("só corretores (dono, 2026-10-25): gestor fica fora, inclusive em 'quem menos' e em pontos", () => {
  const fewest = buildHenryBrokerComparison({ range: range30, overview, metric: "simulacoes", order: "menos" });
  assert.ok(!fewest.spoken.includes("Lucas"));
  const withManagerInRanking = { ...overview, ranking: [{ id: "m", name: "Lucas", gender: "male", points: 999 }, ...overview.ranking] };
  const points = buildHenryBrokerComparison({ range: range30, overview: withManagerInRanking, metric: "pontos" });
  assert.ok(!points.spoken.includes("Lucas"));
});
