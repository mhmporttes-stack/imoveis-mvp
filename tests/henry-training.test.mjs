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
  parseTrainingSandbox
} from "../lib/henry-training-core.mjs";
import { HENRY_FALLBACK_REPLY, HENRY_SCREEN_REPLY } from "../lib/henry-voice-core.mjs";
import { HENRY_WAIT_PHRASES } from "../lib/henry-voice-narration.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("../lib/henry-training.js", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/admin/henry/treino/route.js", import.meta.url), "utf8");
const card = readFileSync(new URL("../components/henry/HenryTrainingCard.jsx", import.meta.url), "utf8");
const kinds = (report) => report.issues.map((issue) => issue.kind);

// --- Roteiro e teto -----------------------------------------------------------------------------------------------------
test("roteiro: os cenários pedidos pelo dono, todos cabendo no teto de 40 trocas", () => {
  const ids = HENRY_TRAINING_SCENARIOS.map((scenario) => scenario.id);
  for (const id of ["cumprimentos", "papo", "crm", "musica", "ambiguos", "frustracao", "interrupcoes", "dia"]) assert.ok(ids.includes(id), id);
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
  const full = estimateHenryTrainingCostUsd(40);
  assert.ok(full > estimateHenryTrainingCostUsd(10));
  assert.ok(estimateHenryTrainingCostUsd(40, { simulateOwner: false }) < full);
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
