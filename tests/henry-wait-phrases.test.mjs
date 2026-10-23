// Frases de espera sem repetir no dia (dono, 2026-10-23: "o Henry repete muito 'Tô passando os olhos nos números'").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_ACK_ITEMS,
  HENRY_WAIT_PHRASES,
  NARRATION_AFTER_ACK_MS,
  RECENT_PHRASES_TO_AVOID,
  narrationWarmBatches,
  pickWaitPhrase,
  rememberPhrase,
  shouldNarrate,
  waitPhrasesToSynthesize
} from "../lib/henry-voice-narration.mjs";

const ui = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
const lib = readFileSync(new URL("../lib/henry-voice.js", import.meta.url), "utf8");
const seeded = (seed = 7) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const scopeOf = (topic) => HENRY_WAIT_PHRASES.filter((phrase) => !phrase.topics.includes("music") && (phrase.topics.includes(topic) || phrase.topics.includes("geral")));

test("no mesmo dia nenhuma frase repete enquanto houver outra do assunto ou geral com áudio", () => {
  for (const topic of ["relatorio", "geral", "clientes", "internet", "music"]) {
    const scope = topic === "music" ? HENRY_WAIT_PHRASES.filter((phrase) => phrase.topics.includes("music")) : scopeOf(topic);
    let used = [];
    const random = seeded(topic.length);
    for (let index = 0; index < scope.length; index += 1) {
      const choice = pickWaitPhrase({ topic, recentIds: used, usedToday: used, random });
      assert.ok(choice, `${topic}: acabou antes do banco (${index}/${scope.length})`);
      assert.ok(!used.includes(choice.id), `${topic}: ${choice.id} repetiu no dia`);
      assert.ok(scope.includes(choice), `${topic}: ${choice.id} fora do assunto`);
      used = rememberPhrase(used, choice.id, 200);
    }
  }
});

test("o assunto vem antes das gerais; nunca uma do Spotify num pedido do CRM", () => {
  const first = pickWaitPhrase({ topic: "relatorio", random: () => 0.99 });
  assert.ok(first.topics.includes("relatorio"));
  for (let index = 0; index < 50; index += 1) assert.ok(!pickWaitPhrase({ topic: "geral", random: () => index / 50 }).topics.includes("music"));
});

test("frases com áudio já usadas hoje e ainda há frase nova sem áudio → silêncio + pede a síntese dela", () => {
  const ready = ["w18", "w12", "w13"];
  const used = ["w12", "w13", "w18"];
  assert.equal(pickWaitPhrase({ topic: "relatorio", recentIds: used, usedToday: used, available: ready }), null);
  const ids = waitPhrasesToSynthesize({ topic: "relatorio", usedToday: used, available: ready });
  assert.equal(ids.length, 2);
  for (const id of ids) {
    const phrase = HENRY_WAIT_PHRASES.find((item) => item.id === id);
    assert.ok(phrase.topics.includes("relatorio"), id); // do assunto primeiro
    assert.ok(!used.includes(id) && !ready.includes(id));
  }
  // Com o áudio da nova pronto, sai a nova (nunca a w18 de novo).
  const choice = pickWaitPhrase({ topic: "relatorio", recentIds: used, usedToday: used, available: [...ready, ids[0]] });
  assert.equal(choice.id, ids[0]);
  // Sem nenhum áudio (sem voz do servidor) → silêncio.
  assert.equal(pickWaitPhrase({ topic: "relatorio", available: [] }), null);
});

test("banco do dia acabou: pode repetir, mas nunca uma das últimas 10", () => {
  assert.equal(RECENT_PHRASES_TO_AVOID, 10);
  const scope = scopeOf("relatorio");
  const used = scope.map((phrase) => phrase.id);
  const last10 = used.slice(-10);
  for (let index = 0; index < 60; index += 1) {
    const choice = pickWaitPhrase({ topic: "relatorio", recentIds: used, usedToday: used, random: () => index / 60 });
    assert.ok(choice);
    assert.ok(!last10.includes(choice.id), `${choice.id} está nas últimas 10`);
  }
  // Só as 10 últimas com áudio → silêncio, nunca repete uma delas.
  assert.equal(pickWaitPhrase({ topic: "relatorio", recentIds: used, usedToday: used, available: last10 }), null);
});

test("pré-aquecimento: só o que falta, em lotes pequenos", () => {
  const all = [...HENRY_ACK_ITEMS, ...HENRY_WAIT_PHRASES].map((phrase) => phrase.id);
  assert.deepEqual(narrationWarmBatches({ readyIds: all }), []);
  const batches = narrationWarmBatches({ readyIds: all.slice(0, 20) });
  assert.ok(batches.every((batch) => batch.length <= 4));
  assert.deepEqual(batches.flat(), all.slice(20));
  // Servidor: cache por frase e teto de tempo no pacote; a tela pede por ids e para se um lote volta vazio.
  assert.match(lib, /narrationPhraseCache/);
  assert.match(lib, /NARRATION_BUDGET_MS/);
  assert.match(ui, /fetchNarrationIds\(batch\)/);
  assert.match(ui, /waitPhrasesToSynthesize\(/);
});

test("com confirmação de escuta, a 1ª frase de espera só ~2,5 s depois da confirmação E do começo do pedido", () => {
  const base = { playing: false, replied: false, hasAudio: true, acked: true };
  // Gravação: a confirmação acabou em 1000, a transcrição levou 2 s e o pedido saiu em 3000.
  assert.equal(shouldNarrate({ ...base, ackEndedAt: 1000, startedAt: 3000, now: 3000 + NARRATION_AFTER_ACK_MS - 1 }), false);
  assert.equal(shouldNarrate({ ...base, ackEndedAt: 1000, startedAt: 3000, now: 3000 + NARRATION_AFTER_ACK_MS }), true);
  // Escuta do navegador: pedido em 1000, confirmação termina em 1600.
  assert.equal(shouldNarrate({ ...base, startedAt: 1000, ackEndedAt: 1600, now: 1600 + NARRATION_AFTER_ACK_MS - 1 }), false);
  assert.equal(shouldNarrate({ ...base, startedAt: 1000, ackEndedAt: 1600, now: 1600 + NARRATION_AFTER_ACK_MS }), true);
  // A tela marca o pedido como confirmado nos dois caminhos.
  assert.match(ui, /acked: ackedBeforeAsk/);
  assert.match(ui, /acked: wait\.acked/);
});
