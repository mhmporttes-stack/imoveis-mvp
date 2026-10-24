import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { detectWakeWord, joinSplitHenry } from "../lib/henry-voice-core.mjs";
import { classifyTapUtterance, detectMusicBargeIn, isMusicPauseCommand, musicListenGate, triggeredTranscriptIntent } from "../lib/henry-voice-conversation.mjs";

// Chamada do Henry mais fácil (dono, 2026-10-24): "Ei/Fala/Oi/Olá, Henry" chamam em todos os caminhos e o prefixo nunca
// entra no pedido; variações de transcrição do nome; "Henrique" só no começo seguido de pedido.

// [frase, kind esperado, pedido esperado]
const POSITIVE = [
  ["Ei, Henry", "wake", ""],
  ["Ei Henry", "wake", ""],
  ["Fala, Henry", "wake", ""],
  ["Fala Henry", "wake", ""],
  ["Hey Henry", "wake", ""],
  ["Oi Henry", "report", ""], // saudação (HENRY-1: "olá, Henry" → relatório do dia)
  ["Olá Henry", "report", ""],
  ["fala Henry quantos clientes", "question", "quantos clientes"],
  ["Ei, Henry, quantos leads hoje?", "question", "quantos leads hoje?"],
  ["Oi Henry, abre a agenda", "question", "abre a agenda"],
  ["Olá, Henry, toca um rock", "question", "toca um rock"],
  ["Henri, quantos clientes aguardam?", "question", "quantos clientes aguardam?"],
  ["Enri toca rock", "question", "toca rock"],
  ["Enry, qual a meta de hoje", "question", "qual a meta de hoje"],
  ["Henrri abre o Chat", "question", "abre o Chat"],
  ["Rênri, quem chegou?", "question", "quem chegou?"],
  ["Hen-ri, quantos clientes", "question", "quantos clientes"],
  ["Hen ri quantos clientes", "question", "quantos clientes"],
  ["ei hen-ri, qual o ranking", "question", "qual o ranking"],
  ["Henrique, quantos clientes aguardam resposta?", "question", "quantos clientes aguardam resposta?"],
  ["Henrique mostra a agenda", "question", "mostra a agenda"],
  ["quantos clientes faltam, Henry", "question", "quantos clientes faltam"]
];

const NEGATIVE = [
  "então vamos ver isso",
  "entre aqui, por favor",
  "o enredo da novela",
  "Henrique mandou os documentos",
  "o Henrique ligou agora",
  "a cliente falou com o Henrique",
  "fala com o cliente",
  "ei, tudo bem?",
  "oi, beleza",
  "a renda dela é baixa",
  "entendi, obrigado",
  "eu entrei agora",
  "hen", // pedaço solto
  "a henna da cliente"
];

test("chamadas aceitas: prefixo fora do pedido e variações do nome", () => {
  for (const [spoken, kind, question] of POSITIVE) {
    const result = detectWakeWord(spoken);
    assert.equal(result.called, true, spoken);
    assert.equal(result.kind, kind, spoken);
    assert.equal(result.question, question, spoken);
  }
});

test("frases comuns não chamam (então, entre, enredo, Henrique no meio ou contando de cliente)", () => {
  for (const spoken of NEGATIVE) assert.equal(detectWakeWord(spoken).called, false, spoken);
});

test("nome falado em duas partes vira uma palavra só; o resto do texto não muda", () => {
  assert.equal(joinSplitHenry("Hen-ri, quantos"), "Henri, quantos");
  assert.equal(joinSplitHenry("ei hen ri"), "ei Henri");
  assert.equal(joinSplitHenry("en ry toca"), "Henri toca");
  assert.equal(joinSplitHenry("o enredo"), "o enredo");
  assert.equal(joinSplitHenry("então"), "então");
  assert.equal(joinSplitHenry("a henna"), "a henna");
});

test("todos os caminhos do navegador/PWA usam a mesma regra (toque, gravação/Scribe e música tocando)", () => {
  assert.deepEqual(classifyTapUtterance("fala Henry quantos clientes"), { kind: "question", question: "quantos clientes" });
  assert.deepEqual(classifyTapUtterance("Ei, Henry"), { kind: "wake", question: "" });
  const intent = triggeredTranscriptIntent("Ei Henry, quantos leads hoje?");
  assert.equal(intent.kind, "question");
  assert.equal(intent.question, "quantos leads hoje?");
  // Música tocando: só acorda com o nome no começo — com o prefixo também; letra comum continua barrada.
  for (const spoken of ["Ei Henry toca outra", "Fala, Henry, pausa", "Oi Henry", "Enri, próxima"]) assert.equal(musicListenGate(spoken).accept, true, spoken);
  assert.equal(musicListenGate("hoje eu vou te esquecer, então me deixa").accept, false);
  assert.equal(musicListenGate("Ei Henry toca outra").wake.question, "toca outra");
  assert.equal(detectMusicBargeIn("Fala Henry, pausa").interrupt, true);
  assert.equal(isMusicPauseCommand("fala Henry pausa"), true);
  assert.equal(isMusicPauseCommand("Henrri pausa"), true);
});

test("app de desktop 1.3.2: prefixos na gramática do Vosk, só os que existem no modelo; nome sozinho segue acordando", () => {
  const require = createRequire(import.meta.url);
  const core = require("../desktop-app/src/core.js");
  const pkg = require("../desktop-app/package.json");
  assert.equal(pkg.version, "1.3.2");
  assert.deepEqual([...core.WAKE_CALL_PREFIXES], ["ei", "hei", "oi", "olá", "ola", "fala"]);
  const config = core.buildWakeConfig("henry");
  for (const word of core.WAKE_CALL_PREFIXES) assert.ok(config.grammar.includes(word), word);
  assert.deepEqual(config.phrases, [...core.WAKE_TARGETS], "o que acorda é o nome; o prefixo não é exigido");
  const withoutFala = core.buildWakeConfig("henry", (word) => word !== "fala");
  assert.equal(withoutFala.grammar.includes("fala"), false, "palavra fora do modelo não entra");
  const words = (list) => list.map((word) => ({ word, conf: 0.9 }));
  assert.ok(core.wakeSequenceStep({}, { now: 0, words: words(["fala", "henry"]), phrases: config.phrases }).hit);
  assert.ok(core.wakeSequenceStep({}, { now: 0, words: words(["ei", "henri"]), phrases: config.phrases }).hit);
  assert.equal(core.wakeSequenceStep({}, { now: 0, words: words(["fala", "oi"]), phrases: config.phrases }).hit, null);
});
