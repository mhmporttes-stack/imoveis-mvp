// Repetição por SEMELHANÇA nas falas do Henry (dono, 2026-10-25: "o início dele é muito repetitivo: 'Ok, vou dar uma
// olhada nos números'. [...] ele pode não falar exatamente a mesma coisa, mas muda uma palavra e fala a mesma frase").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  distinctBySimilarity,
  groupSimilar,
  isPreambleOpening,
  isSimilarPhrase,
  openingSentencesFrom,
  phraseSimilarity,
  trimRepeatedOpening
} from "../lib/henry-repetition-core.mjs";
import { HENRY_ACK_ITEMS, pickListenAck } from "../lib/henry-voice-narration.mjs";
import { drawHenryRepertoire, lexiconKey } from "../lib/henry-voice-lexicon.mjs";
import { HENRY_REPORT_INTROS, HENRY_VARIATION_HINTS, buildHenryStaticPrompt, buildReportRewritePrompt } from "../lib/henry-voice-persona.mjs";
import { analyzeHenryTraining } from "../lib/henry-training-core.mjs";

const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");

test("semelhança: trocar uma palavra (ou a muleta do começo) é a mesma frase", () => {
  for (const [a, b] of [
    ["Ok, vou dar uma olhada nos números.", "Beleza, vou dar uma olhada nos números."],
    ["Ok, vou dar uma olhada nos números.", "Certo, deixa eu ver os dados."],
    ["Tô olhando aqui.", "Vou olhar aqui."],
    ["Tô passando os olhos nos números.", "Deixa eu dar uma conferida nesses números."],
    ["Deixa eu ver.", "Deixa eu ver isso direitinho."],
    ["Opa!", "Opa."]
  ]) {
    assert.ok(isSimilarPhrase(a, b), `${a} ~ ${b} (${phraseSimilarity(a, b)})`);
  }
  for (const [a, b] of [
    ["Opa!", "Beleza."],
    ["Fechou.", "Fechando a conta aqui rapidinho."],
    ["Tô vendo quem tá na frente.", "O relatório tá quase saindo do forno."],
    ["Bom dia, Matheus!", "Boa tarde, Matheus!"]
  ]) {
    assert.ok(!isSimilarPhrase(a, b), `${a} ≁ ${b} (${phraseSimilarity(a, b)})`);
  }
  const groups = groupSimilar(["Ok, vou olhar os números.", "Beleza, vou olhar os números.", "Entraram 12 clientes novos."]);
  assert.deepEqual(groups.map((group) => group.count), [2, 1]);
});

test("abertura do modelo: 'vou olhar' e abertura parecida com uma de hoje saem; o fato nunca sai", () => {
  assert.equal(trimRepeatedOpening("Ok, vou dar uma olhada nos números. Entraram 12 clientes novos hoje."), "Entraram 12 clientes novos hoje.");
  assert.equal(trimRepeatedOpening("Ok, vou dar uma olhada nos números, entraram 12 clientes novos."), "Entraram 12 clientes novos.");
  assert.equal(trimRepeatedOpening("Deixa eu ver… 5 atendimentos pro Gabriel hoje."), "5 atendimentos pro Gabriel hoje.");
  // Parecida com uma de hoje ("Opa!" de novo): sai; a 1ª vez fica.
  assert.equal(trimRepeatedOpening("Opa! Entraram 12 clientes novos.", ["Opa"]), "Entraram 12 clientes novos.");
  assert.equal(trimRepeatedOpening("Opa! Entraram 12 clientes novos.", []), "Opa! Entraram 12 clientes novos.");
  // Nunca some: resposta que é só a abertura, frase com número, frase com nome próprio, ação ("Abrindo a agenda.").
  assert.equal(trimRepeatedOpening("Deixa eu ver."), "Deixa eu ver.");
  assert.equal(trimRepeatedOpening("Entraram 12 clientes novos. Tá rendendo.", ["Entraram 12 clientes novos"]), "Entraram 12 clientes novos. Tá rendendo.");
  assert.equal(trimRepeatedOpening("A Carol tá na frente. Ela fez 30 pontos.", ["A Carol tá na frente"]), "A Carol tá na frente. Ela fez 30 pontos.");
  assert.equal(trimRepeatedOpening("Abrindo a agenda."), "Abrindo a agenda.");
  // Pedaço parcial do stream (voz antecipada): a frase toda de abertura vira "" (espera a próxima).
  assert.equal(trimRepeatedOpening("Ok, vou dar uma olhada nos números.", [], { allowEmpty: true }), "");
  assert.ok(isPreambleOpening("Só um instante"));
  assert.ok(!isPreambleOpening("Vou abrir a agenda pra você"));
  assert.deepEqual(openingSentencesFrom([{ role: "user", text: "oi" }, { role: "assistant", text: "Opa, entraram 12 clientes novos. Boa!" }]), ["Opa", "Opa, entraram 12 clientes novos"]);
});

test("servidor: a mesma regra na 1ª frase antecipada e na resposta final; repertório sem o que é parecido", () => {
  assert.match(lib, /const usedOpeningSentences = greeting \? null : openingSentencesFrom\(memoryTurns\)/);
  assert.match(lib, /const first = trimOpening\(match\[1\]\.trim\(\), \{ allowEmpty: true \}\)/);
  assert.match(lib, /replyText = stripSpeechLabel\(trimOpening\(replyText\)\);\n(?: {2}\/\/.*\n)* {2}replyText = trimRepeatedClosing\(replyText, promptExtras\.usedClosings\);\n {2}const musicOnly/);
  assert.match(lib, /saidOpenings: openingSentencesFrom\(turns\)/);
});

test("repertório: nada parecido com o usado hoje nem 'vou olhar' (a resposta já vem com os dados)", () => {
  const used = [lexiconKey("Deixa eu dar uma espiada.")];
  for (let seed = 1; seed < 30; seed += 1) {
    let value = seed;
    const random = () => ((value = (value * 16807) % 2147483647) - 1) / 2147483646;
    const { items } = drawHenryRepertoire({ context: "pergunta", used, random, saidOpenings: ["Opa, boa pergunta"] });
    for (const { text } of items) {
      assert.ok(!isPreambleOpening(text), text);
      assert.ok(!isSimilarPhrase(text, "Deixa eu dar uma espiada."), text);
      assert.ok(!isSimilarPhrase(text, "Opa, boa pergunta"), text);
    }
  }
});

test("confirmação de escuta: nada parecido com o que já foi falado hoje", () => {
  const phrases = HENRY_ACK_ITEMS.map((item) => ({ ...item, audio: { base64: "x" } }));
  const said = HENRY_ACK_ITEMS.find((item) => item.text === "Tô olhando aqui.");
  for (let index = 0; index < 80; index += 1) {
    const choice = pickListenAck({ context: "data", usedToday: [said.id], phrases, random: () => index / 80 });
    if (choice.kind === "phrase") assert.ok(!isSimilarPhrase(choice.text, said.text), choice.text);
  }
});

test("prompt: começar direto pela informação, nunca anunciar que vai olhar; lead = cliente novo", () => {
  const fixed = buildHenryStaticPrompt();
  assert.match(fixed, /Comece DIRETO pela informação na maioria das respostas/);
  assert.match(fixed, /Nunca diga que vai olhar, verificar, conferir ou puxar algo/);
  assert.match(fixed, /Lead e cliente novo são a MESMA coisa/);
  assert.doesNotMatch(fixed, /Deixa eu ver… 5 atendimentos/);
  assert.match(buildReportRewritePrompt({}), /vá direto aos números/);
  assert.ok(HENRY_VARIATION_HINTS.filter((hint) => /direto|sem abertura|primeira palavra|pelo fato|sujeito da resposta/.test(hint)).length >= 5);
  assert.ok(distinctBySimilarity(HENRY_REPORT_INTROS).length >= 35, `${distinctBySimilarity(HENRY_REPORT_INTROS).length} aberturas do relatório`);
});

test("Treino: repetição contada por semelhança (muda uma palavra = mesma abertura)", () => {
  const report = analyzeHenryTraining([
    { owner: "quantos clientes novos?", reply: "Ok, vou dar uma olhada nos números. Entraram 12." },
    { owner: "e simulações?", reply: "Beleza, vou dar uma olhada nos números. Foram 4." }
  ]);
  assert.ok(report.repeats.openings.some((entry) => entry.count === 2), JSON.stringify(report.repeats.openings));
});
