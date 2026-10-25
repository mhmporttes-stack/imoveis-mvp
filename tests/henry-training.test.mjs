import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_TRAINING_FEATURE,
  HENRY_TRAINING_MAX_EXCHANGES,
  HENRY_TRAINING_SCENARIOS,
  analyzeHenryTraining,
  buildTrainingOwnerPrompt,
  cleanTrainingOwnerLine,
  estimateHenryTrainingCostUsd,
  henryTrainingFits,
  henryTrainingTotalSteps,
  parseTrainingSandbox,
  HENRY_TRAINING_HISTORY_LIMIT,
  HENRY_TRAINING_REPORTS_SETTING_ID,
  HENRY_TRAINING_STORED_REPLY_MAX,
  appendTrainingScenario,
  countTrainingIssues,
  parseTrainingRounds,
  summarizeTrainingRound
} from "../lib/henry-training-core.mjs";
import { HENRY_FALLBACK_REPLY, HENRY_SCREEN_REPLY } from "../lib/henry-voice-core.mjs";
import { HENRY_WAIT_PHRASES } from "../lib/henry-voice-narration.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("../lib/henry-training.js", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/admin/henry/treino/route.js", import.meta.url), "utf8");
const card = readFileSync(new URL("../components/henry/HenryTrainingCard.jsx", import.meta.url), "utf8");
const kinds = (report) => report.issues.map((issue) => issue.kind);

// --- Roteiro e teto -----------------------------------------------------------------------------------------------------
test("roteiro: os cenários pedidos pelo dono, todos cabendo no teto de trocas", () => {
  const ids = HENRY_TRAINING_SCENARIOS.map((scenario) => scenario.id);
  for (const id of ["cumprimentos", "papo", "crm", "comparacao", "musica", "ambiguos", "frustracao", "interrupcoes", "dia"]) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(henryTrainingTotalSteps() <= HENRY_TRAINING_MAX_EXCHANGES);
  for (const scenario of HENRY_TRAINING_SCENARIOS) for (const step of scenario.steps) assert.ok(step.say && step.say.length <= 200, scenario.id);
  // "Dia inteiro" começa pelo bom dia no modo relatório (o mesmo pedido da tela).
  assert.equal(HENRY_TRAINING_SCENARIOS.find((scenario) => scenario.id === "dia").steps[0].mode, "report");
});

test("teto: um cenário só roda se couber nas trocas restantes da rodada", () => {
  assert.equal(henryTrainingFits(0, "crm"), true);
  assert.equal(henryTrainingFits(HENRY_TRAINING_MAX_EXCHANGES - 4, "crm"), false);
  assert.equal(henryTrainingFits(0, "nao-existe"), false);
});

test("custo estimado: cresce com as trocas, sem dono simulado é mais barato, rodada cheia fica abaixo de 10 centavos de dólar", () => {
  assert.equal(estimateHenryTrainingCostUsd(0), 0);
  const full = estimateHenryTrainingCostUsd(HENRY_TRAINING_MAX_EXCHANGES);
  assert.ok(full > estimateHenryTrainingCostUsd(10));
  assert.ok(estimateHenryTrainingCostUsd(HENRY_TRAINING_MAX_EXCHANGES, { simulateOwner: false }) < full);
  assert.ok(full > 0 && full < 0.1, String(full));
  assert.equal(estimateHenryTrainingCostUsd(500), full, "o teto vale também na estimativa");
});

// --- Dono simulado ------------------------------------------------------------------------------------------------------
test("dono simulado: prompt próprio (não é o do Henry), variação ou continuação; linha limpa e com reserva", () => {
  const vary = buildTrainingOwnerPrompt({ scenarioLabel: "Papo", step: { say: "Tô cansado hoje", vary: true } });
  assert.match(vary.user, /OUTRAS palavras/);
  const reply = buildTrainingOwnerPrompt({ scenarioLabel: "Frustração", step: { say: "Não foi isso", reply: "reclama" }, lastReply: "Hoje entraram 3." });
  assert.match(reply.user, /Última fala do Henry: "Hoje entraram 3\."/);
  assert.match(vary.system, /Nunca invente telefone, CPF/);
  assert.equal(cleanTrainingOwnerLine('Matheus: "E aí, beleza?"\nexplicação extra'), "E aí, beleza?");
  assert.equal(cleanTrainingOwnerLine("", "Boa noite"), "Boa noite");
  assert.ok(cleanTrainingOwnerLine("a".repeat(500)).length <= 200);
});

// --- Memória isolada ----------------------------------------------------------------------------------------------------
test("sandbox: só as chaves de memória do Henry voltam do navegador; resto e objeto gigante são descartados", () => {
  const parsed = parseTrainingSandbox({ henry_day_memory: { date: "2026-10-24", turns: [] }, henry_voice_assistant: { enabled: false }, henry_notes: "texto" });
  assert.deepEqual(Object.keys(parsed), ["henry_day_memory"]);
  assert.deepEqual(parseTrainingSandbox({ henry_day_memory: { big: "x".repeat(70000) } }), {});
  assert.deepEqual(parseTrainingSandbox(null), {});
});

// --- Relatório ----------------------------------------------------------------------------------------------------------
test("relatório: mesma resposta, mesma abertura, mesmo fechamento e trecho repetido no dia", () => {
  const report = analyzeHenryTraining([
    { owner: "quantos clientes novos?", reply: "Opa, bora ver. Hoje entraram três clientes novos na roleta. Qualquer coisa é só chamar." },
    { owner: "e o ranking?", reply: "Opa, bora ver. A Carol lidera a semana com folga. Qualquer coisa é só chamar." },
    { owner: "e o whatsapp?", reply: "Opa, bora ver. Tem duas conversas esperando na fila. Qualquer coisa é só chamar." },
    { owner: "valeu", reply: "Tamo junto!" },
    { owner: "obrigado", reply: "Tamo junto!" }
  ]);
  const found = kinds(report);
  for (const kind of ["repeticao_resposta", "repeticao_abertura", "repeticao_fechamento", "repeticao_trecho"]) assert.ok(found.includes(kind), kind);
  assert.ok(report.repeats.ngrams.some((entry) => entry.text === "qualquer coisa e so" && entry.count === 3));
});

test("relatório: resposta longa para voz (pergunta comum) e limite maior no relatório do dia", () => {
  const long = "Frase curta aqui. ".repeat(5).trim();
  assert.ok(kinds(analyzeHenryTraining([{ owner: "como tá?", reply: long }])).includes("longa"));
  assert.ok(!kinds(analyzeHenryTraining([{ owner: "Bom dia, Henry", reply: long, mode: "report" }])).includes("longa"));
  assert.ok(kinds(analyzeHenryTraining([{ owner: "oi", reply: "a".repeat(320) }])).includes("longa"));
});

test("relatório: fala barrada pela mesma barreira do Henry e resposta só na tela", () => {
  assert.ok(kinds(analyzeHenryTraining([{ owner: "x", reply: HENRY_FALLBACK_REPLY }])).includes("barrada"));
  assert.ok(kinds(analyzeHenryTraining([{ owner: "x", reply: "O CPF dele é 123.456.789-00." }])).includes("barrada"));
  assert.ok(kinds(analyzeHenryTraining([{ owner: "x", reply: HENRY_SCREEN_REPLY }])).includes("so_tela"));
  assert.deepEqual(kinds(analyzeHenryTraining([{ owner: "quantos novos?", reply: "Entraram três hoje, tudo certo." }])), []);
});

test("relatório: \"não tenho acesso\", erro, resposta vazia e \"não consegui responder\"", () => {
  assert.ok(kinds(analyzeHenryTraining([{ owner: "status da Ana", reply: "Não tenho acesso a essa informação." }])).includes("sem_acesso"));
  assert.ok(kinds(analyzeHenryTraining([{ owner: "x", reply: "", error: "falha na IA" }])).includes("erro"));
  assert.ok(kinds(analyzeHenryTraining([{ owner: "x", reply: "  " }])).includes("vazia"));
  assert.ok(kinds(analyzeHenryTraining([{ owner: "x", reply: "Não consegui responder agora." }])).includes("sem_resposta"));
});

test("relatório: cumprimento puro respondido com espera ou números", () => {
  const wait = HENRY_WAIT_PHRASES[0].text;
  assert.ok(kinds(analyzeHenryTraining([{ owner: "Boa noite, Henry", reply: wait }])).includes("espera_cumprimento"));
  assert.ok(kinds(analyzeHenryTraining([{ owner: "boa tarde", reply: "Boa tarde! Deixa eu ver os números." }])).includes("espera_cumprimento"));
  assert.ok(kinds(analyzeHenryTraining([{ owner: "Boa noite", reply: "Boa noite! Hoje foram 4 atendimentos." }])).includes("numero_cumprimento"));
  assert.deepEqual(kinds(analyzeHenryTraining([{ owner: "Boa noite", reply: "Boa noite! Tudo certo por aqui." }])), []);
  // Pedido de dado com cumprimento não é cumprimento puro.
  assert.ok(!kinds(analyzeHenryTraining([{ owner: "boa noite, quantos clientes novos?", reply: "Deixa eu ver: entraram 4." }])).includes("espera_cumprimento"));
});

test("relatório: tom errado (markdown, emoji, kkk, fala de robô)", () => {
  const found = kinds(analyzeHenryTraining([
    { owner: "a", reply: "**Resumo:** tudo certo." },
    { owner: "b", reply: "Tudo certo 😀" },
    { owner: "c", reply: "kkk essa foi boa" },
    { owner: "d", reply: "Como assistente virtual, não tenho opinião." }
  ]));
  for (const kind of ["tom_markdown", "tom_emoji", "tom_risada", "tom_robo"]) assert.ok(found.includes(kind), kind);
});

// --- Travas do servidor (leitura do código) -----------------------------------------------------------------------------
test("servidor: mesmo answerHenry, memória isolada, música simulada, custo em henry_training, rota só do dono", () => {
  assert.equal(HENRY_TRAINING_FEATURE, "henry_training");
  assert.match(runner, /answerHenry\(auth/);
  assert.doesNotMatch(runner, /synthesizeHenry|elevenlabs|openai/i, "treino nunca chama voz do servidor");
  assert.match(lib, /new AsyncLocalStorage\(\)/);
  // Gravação em crm_settings dentro do treino nunca chega ao banco.
  assert.match(lib, /async function writeSettingRow\(auth, id, value\) \{\n  const training = trainingStore\.getStore\(\);\n  if \(training\) \{/);
  assert.match(lib, /trainingStore\.getStore\(\) \? trainingSpotifyTool\(input\)/);
  assert.match(lib, /trainingStore\.getStore\(\) \? \{ ok: true, reason: "", playing: \{ name: query \}, uri: "" \} : await startHenryMorningMusic/);
  assert.match(lib, /feature: HENRY_TRAINING_FEATURE/);
  assert.match(route, /requireHenryOwner\(request\)/g);
  assert.equal((route.match(/requireHenryOwner\(request\)/g) || []).length, 2, "GET e POST com o guard do dono");
  assert.match(card, /speechSynthesis/);
  assert.doesNotMatch(card, /synthesizeHenry|mode: "speak"/);
});

// --- Treinos anteriores (dono, 2026-10-25) ------------------------------------------------------------------------------
const roundIdOf = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sampleExchanges = [
  { scenarioId: "papo", step: 0, owner: "E aí, Henry?", reply: "Opa, tudo certo por aqui. E com você?", mode: "question", ms: 900 },
  { scenarioId: "papo", step: 1, owner: "Tudo bem", reply: "", mode: "question", ms: 400, error: "falha na IA" }
];

test("histórico: grava a rodada com trocas, cenários, custo e achados por tipo", () => {
  const { rounds, round } = appendTrainingScenario([], { roundId: roundIdOf(1), scenarioLabel: "Papo casual", exchanges: sampleExchanges, costUsd: 0.0021, now: "2026-10-24T13:59:00.000Z" });
  assert.equal(HENRY_TRAINING_REPORTS_SETTING_ID, "henry_training_reports");
  assert.equal(rounds.length, 1);
  assert.equal(round.startedAt, "2026-10-24T13:59:00.000Z");
  assert.deepEqual(round.scenarios, ["Papo casual"]);
  assert.equal(round.exchanges.length, 2);
  assert.equal(round.exchanges[0].label, "Papo casual");
  assert.equal(round.exchanges[0].owner, "E aí, Henry?");
  assert.equal(round.costUsd, 0.0021);
  assert.deepEqual(round.issueCounts.map((entry) => [entry.kind, entry.count]), [["erro", 1]]);
  const summary = summarizeTrainingRound(round);
  assert.equal(summary.issues, 1);
  assert.equal(summary.exchanges, 2);
  assert.equal("exchanges" in summary && Array.isArray(summary.exchanges), false, "lista sem as trocas");
});

test("histórico: o 2º cenário da MESMA rodada soma trocas e custo; mantém a data de início", () => {
  const first = appendTrainingScenario([], { roundId: roundIdOf(1), scenarioLabel: "Papo casual", exchanges: sampleExchanges, costUsd: 0.001, now: "2026-10-24T13:59:00.000Z" });
  const second = appendTrainingScenario(first.rounds, { roundId: roundIdOf(1), scenarioLabel: "Música", exchanges: [sampleExchanges[0]], costUsd: 0.002, now: "2026-10-24T14:01:00.000Z" });
  assert.equal(second.rounds.length, 1);
  assert.equal(second.round.exchanges.length, 3);
  assert.deepEqual(second.round.scenarios, ["Papo casual", "Música"]);
  assert.equal(second.round.costUsd, 0.003);
  assert.equal(second.round.startedAt, "2026-10-24T13:59:00.000Z");
  assert.equal(second.round.updatedAt, "2026-10-24T14:01:00.000Z");
});

test("histórico: guarda só as últimas 20 rodadas, a mais nova primeiro", () => {
  let rounds = [];
  for (let n = 1; n <= HENRY_TRAINING_HISTORY_LIMIT + 3; n += 1) rounds = appendTrainingScenario(rounds, { roundId: roundIdOf(n), scenarioLabel: "Papo casual", exchanges: [sampleExchanges[0]] }).rounds;
  assert.equal(HENRY_TRAINING_HISTORY_LIMIT, 20);
  assert.equal(rounds.length, 20);
  assert.equal(rounds[0].id, roundIdOf(23));
  assert.equal(rounds.at(-1).id, roundIdOf(4));
  assert.equal(parseTrainingRounds({ rounds: [...rounds, ...rounds] }).length, 20);
});

test("histórico: leitura descarta lixo e corta textos; id de rodada inválido é recusado", () => {
  const long = "a".repeat(HENRY_TRAINING_STORED_REPLY_MAX + 50);
  const { rounds } = appendTrainingScenario([], { roundId: roundIdOf(9), scenarioLabel: "Papo", exchanges: [{ owner: "oi", reply: long, audio: "xxx" }] });
  const parsed = parseTrainingRounds(JSON.parse(JSON.stringify({ rounds: [...rounds, { id: "../x" }, null, "x"] })));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].exchanges[0].reply.length, HENRY_TRAINING_STORED_REPLY_MAX);
  assert.equal("audio" in parsed[0].exchanges[0], false, "só texto conhecido é guardado");
  assert.deepEqual(parseTrainingRounds(null), []);
  assert.deepEqual(parseTrainingRounds({ rounds: "x" }), []);
  assert.throws(() => appendTrainingScenario([], { roundId: "não vale" }));
  assert.deepEqual(countTrainingIssues([{ kind: "longa", label: "longa" }, { kind: "longa", label: "longa 2" }, {}]), [{ kind: "longa", label: "longa", count: 2 }]);
});

test("histórico: servidor grava em crm_settings fora da memória isolada; rota só do dono; card mostra Treinos anteriores", () => {
  assert.match(runner, /HENRY_TRAINING_REPORTS_SETTING_ID/);
  assert.ok(runner.indexOf("saveHenryTrainingScenario(auth") > runner.indexOf("return out;"), "grava depois do withHenryTraining");
  assert.match(route, /getHenryTrainingRound\(roundId\)/);
  assert.ok(route.indexOf("requireHenryOwner(request)") < route.indexOf("getHenryTrainingRound("), "guard antes de ler o histórico");
  assert.match(card, /Treinos anteriores/);
  assert.match(card, /roundId/);
});
