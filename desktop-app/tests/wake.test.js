// Escuta do nome (versão 1.2.1): gramática/palavra de chamada, sequência, parcial, pausa/retomada, limite do log e
// vocabulário do modelo. node --test tests/*.test.js (dentro de desktop-app/).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  WAKE_GRAMMAR,
  WAKE_MAX_PAUSE_MS,
  WAKE_PAUSE_INITIAL,
  WAKE_RESUME_AFTER_SOUND_MS,
  WAKE_SEQUENCE_GAP_MS,
  WAKE_TARGETS,
  WAKE_WORD_PRESETS,
  buildWakeConfig,
  formatLevelDetail,
  levelLogIntervalMs,
  logLimitStep,
  parseWakeChoice,
  sanitizeWakeReport,
  wakePartialStep,
  wakePauseStep,
  wakeSequenceStep
} = require("../src/core");
const { createTarScanner, loadVoskVocabulary, parseFstSymbols } = require("../src/vosk-vocab");

const MODEL = path.join(__dirname, "..", "models", "vosk-model-small-pt-0.3.tar.gz");
const w = (word, conf = 0.9) => ({ word, conf });

test("palavra de chamada: modelos prontos e palavra do dono", () => {
  assert.deepEqual(WAKE_WORD_PRESETS.map((item) => item.label), ["Henry", "Ei Henry", "Ok Henry"]);
  const henry = buildWakeConfig("henry");
  assert.deepEqual(henry.phrases, [...WAKE_TARGETS]);
  assert.deepEqual(henry.grammar, [...WAKE_GRAMMAR]);
  assert.equal(henry.grammar.at(-1), "[unk]");

  const ei = buildWakeConfig("ei-henry");
  assert.ok(ei.phrases.includes("ei henry") && ei.phrases.includes("ei rei ri") && ei.phrases.includes("hei henri"));
  assert.equal(ei.phrases.includes("henry"), false, "com 'Ei Henry' o nome sozinho não acorda");
  assert.ok(ei.grammar.includes("henry") && ei.grammar.includes("ei"), "palavras soltas seguram a fala comum");
  assert.equal(buildWakeConfig("ola-henry").id, "henry", "fora da lista do dono (Henry/Ei/Ok/livre) → Henry");
  assert.ok(buildWakeConfig("ok-henry").phrases.includes("ok rei ri"));

  const custom = buildWakeConfig("custom:  Ei, Rênri! ");
  assert.equal(custom.id, "custom");
  assert.equal(custom.label, "ei rênri");
  assert.ok(custom.phrases.includes("ei henry") && custom.phrases.includes("ei rei ri"), "grafia do nome vira as variantes");
  assert.deepEqual(buildWakeConfig("custom:jarvis").phrases, ["jarvis"]);

  // Palavra fora do vocabulário (vira [unk] no Vosk) → volta para Henry e diz qual faltou.
  const vocab = new Set(["henry", "henri", "henrik", "rei", "ri", "ei", "entrei", "rio"]);
  const missing = buildWakeConfig("custom:ei jarvis", (word) => vocab.has(word));
  assert.equal(missing.id, "henry");
  assert.equal(missing.fallback, true);
  assert.deepEqual(missing.missing, ["jarvis"]);
  assert.equal(missing.grammar.includes("renda"), false, "absorvedor fora do vocabulário também sai");
  assert.deepEqual(buildWakeConfig("ok-henry", (word) => vocab.has(word)).missing, ["ok"]);

  for (const bad of ["custom:", "custom:um dois tres quatro", `custom:${"a".repeat(41)}`, "qualquer", 42, null]) {
    const config = buildWakeConfig(bad);
    assert.equal(config.id, "henry", String(bad));
  }
  assert.equal(parseWakeChoice("").error, "");
  assert.equal(parseWakeChoice("xpto").error, "palavra_invalida");
});

test("vocabulário: todas as palavras da gramática existem no modelo (quando o modelo está baixado)", { skip: !fs.existsSync(MODEL) }, async () => {
  const vocab = await loadVoskVocabulary(MODEL);
  assert.ok(vocab.size > 90000);
  for (const preset of WAKE_WORD_PRESETS) {
    const config = buildWakeConfig(preset.id, (word) => vocab.has(word));
    assert.equal(config.fallback, false, preset.id);
    for (const phrase of config.grammar) if (phrase !== "[unk]") for (const word of phrase.split(" ")) assert.ok(vocab.has(word), word);
  }
  for (const word of ["enri", "renri", "rênri", "hen", "ren", "okay"]) assert.equal(vocab.has(word), false, word);
});

test("vocabulário: tabela de símbolos do OpenFst dentro de um tar.gz", async () => {
  const fst = fakeFst(["<eps>", "henry", "olá", "rei"]);
  assert.deepEqual(parseFstSymbols(fst), ["<eps>", "henry", "olá", "rei"]);
  assert.throws(() => parseFstSymbols(fst.subarray(0, fst.length - 40)), RangeError);
  assert.throws(() => parseFstSymbols(Buffer.alloc(64)), /fst_invalido/);

  const tar = Buffer.concat([tarEntry("modelo/final.mdl", Buffer.alloc(1500, 7)), tarEntry("modelo/Gr.fst", fst), Buffer.alloc(1024)]);
  let found = null;
  const scanner = createTarScanner("/Gr.fst", (buffer) => {
    try {
      found = parseFstSymbols(buffer);
      return true;
    } catch (error) {
      if (error instanceof RangeError) return false;
      throw error;
    }
  });
  for (let index = 0; index < tar.length; index += 100) scanner.push(tar.subarray(index, index + 100)); // pedaços pequenos
  assert.deepEqual(found, ["<eps>", "henry", "olá", "rei"]);

  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "mm-vocab-"));
  const file = path.join(dir, "modelo.tar.gz");
  fs.writeFileSync(file, zlib.gzipSync(tar));
  assert.deepEqual([...(await loadVoskVocabulary(file))], ["<eps>", "henry", "olá", "rei"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("sequência: nome inteiro, dividido entre dois trechos e confiança mínima", () => {
  let step = wakeSequenceStep({}, { now: 1000, words: [w("henry", 0.8)] });
  assert.deepEqual(step.hit, { phrase: "henry", confidence: 0.8 });

  step = wakeSequenceStep({}, { now: 1000, words: [w("[unk]"), w("rei", 0.7)] });
  assert.equal(step.hit, null);
  step = wakeSequenceStep(step.state, { now: 2000, words: [w("ri", 0.6), w("[unk]")] });
  assert.deepEqual(step.hit, { phrase: "rei ri", confidence: 0.6 }, "'rei' | 'ri' em trechos seguidos = 'rei ri'");

  step = wakeSequenceStep({}, { now: 1000, words: [w("rei")] });
  step = wakeSequenceStep(step.state, { now: 1000 + WAKE_SEQUENCE_GAP_MS + 1, words: [w("ri")] });
  assert.equal(step.hit, null, "longe demais não junta");

  // O mesmo nome não acorda duas vezes (o trecho velho não conta sozinho).
  step = wakeSequenceStep({}, { now: 1000, words: [w("henry", 0.2)] });
  assert.equal(step.hit, null);
  assert.deepEqual(step.near, { phrase: "henry", confidence: 0.2 }, "abaixo do mínimo vira 'quase' no log");
  step = wakeSequenceStep(step.state, { now: 1500, words: [w("[unk]")] });
  assert.equal(step.hit, null);
  assert.equal(step.near, null);

  const phrases = buildWakeConfig("ei-henry").phrases;
  step = wakeSequenceStep({}, { now: 1000, words: [w("ei")] , phrases });
  step = wakeSequenceStep(step.state, { now: 1800, words: [w("henry")], phrases });
  assert.equal(step.hit.phrase, "ei henry");
  assert.equal(wakeSequenceStep({}, { now: 0, words: [w("henry")], phrases }).hit, null, "'Ei Henry' escolhido: 'Henry' sozinho não acorda");
  assert.equal(wakeSequenceStep({}, { now: 0, words: [w("henrique"), w("renda")] }).hit, null);
  assert.equal(wakeSequenceStep({}, { now: 0, words: [w("rei"), w("[unk]"), w("ri")] }).hit, null);
  assert.equal(wakeSequenceStep(null, { now: 0, words: "henry" }).hit, null);
});

test("parcial: acorda quando o nome aparece em 2 parciais seguidos, uma vez por fala", () => {
  let step = wakePartialStep({}, { text: "henry" });
  assert.equal(step.hit, null);
  step = wakePartialStep(step.state, { text: "henry" });
  assert.deepEqual(step.hit, { phrase: "henry" });
  step = wakePartialStep(step.state, { text: "henry [unk]" });
  assert.equal(step.hit, null, "mesma fala não acorda de novo");
  step = wakePartialStep(step.state, { text: "" }); // fala nova
  step = wakePartialStep(step.state, { text: "rei" });
  step = wakePartialStep(step.state, { text: "rei ri" });
  assert.equal(step.hit, null);
  step = wakePartialStep(step.state, { text: "rei ri" });
  assert.equal(step.hit.phrase, "rei ri");
  step = wakePartialStep({}, { text: "henrique" });
  step = wakePartialStep(step.state, { text: "henrique" });
  assert.equal(step.hit, null);
});

test("pausa/retomada: volta depois do som e nunca fica pausada para sempre", () => {
  let state = { ...WAKE_PAUSE_INITIAL };
  let step = wakePauseStep(state, { now: 0, audible: true });
  assert.deepEqual(step.event, { type: "pausa", reason: "som_do_crm" });
  state = step.state;
  step = wakePauseStep(state, { now: 3000, audible: false });
  assert.equal(step.event, null);
  assert.equal(step.state.paused, true);
  step = wakePauseStep(step.state, { now: 3000 + WAKE_RESUME_AFTER_SOUND_MS, audible: false });
  assert.deepEqual(step.event, { type: "retomada", reason: "som_parou", ms: 3000 + WAKE_RESUME_AFTER_SOUND_MS });
  assert.equal(step.state.paused, false);

  // Som volta antes do tempo: continua pausada (não pisca).
  step = wakePauseStep({ ...WAKE_PAUSE_INITIAL }, { now: 0, audible: true });
  step = wakePauseStep(step.state, { now: 200, audible: false });
  step = wakePauseStep(step.state, { now: 400, audible: true });
  step = wakePauseStep(step.state, { now: 800, audible: false });
  step = wakePauseStep(step.state, { now: 1300, audible: false });
  assert.equal(step.state.paused, true);

  // Trava de segurança: som "eterno" (ex.: aba tocando algo) → volta à força e ignora esse som até ele parar.
  step = wakePauseStep({ ...WAKE_PAUSE_INITIAL }, { now: 0, audible: true });
  step = wakePauseStep(step.state, { now: WAKE_MAX_PAUSE_MS, audible: true });
  assert.equal(step.event.type, "retomada");
  assert.equal(step.event.reason, "tempo_maximo");
  assert.equal(step.state.paused, false);
  step = wakePauseStep(step.state, { now: WAKE_MAX_PAUSE_MS + 500, audible: true });
  assert.equal(step.event, null);
  assert.equal(step.state.paused, false);
  step = wakePauseStep(step.state, { now: WAKE_MAX_PAUSE_MS + 1000, audible: false });
  step = wakePauseStep(step.state, { now: WAKE_MAX_PAUSE_MS + 1500, audible: true });
  assert.equal(step.event.type, "pausa", "som novo depois do silêncio pausa de novo");
});

test("limite de frequência do log", () => {
  let state = {};
  const allowed = [];
  for (let now = 0; now < 30000; now += 1000) {
    const step = logLimitStep(state, "erro", now, { minIntervalMs: 10000 });
    state = step.state;
    if (step.allow) allowed.push([now, step.suppressed]);
  }
  assert.deepEqual(allowed, [[0, 0], [10000, 9], [20000, 9]]);

  state = {};
  let count = 0;
  for (let index = 0; index < 50; index += 1) {
    const step = logLimitStep(state, "pausa", index * 1000, { maxPerWindow: 20, windowMs: 600000 });
    state = step.state;
    if (step.allow) count += 1;
  }
  assert.equal(count, 20);
  const later = logLimitStep(state, "pausa", 600000, { maxPerWindow: 20, windowMs: 600000 });
  assert.equal(later.allow, true);
  assert.equal(later.suppressed, 30, "nova janela avisa quantas foram seguradas");
  assert.equal(logLimitStep(state, "outra", 0, { maxPerWindow: 1 }).allow, true, "chaves independentes");

  assert.equal(levelLogIntervalMs({ sinceStartMs: 0 }), 10000);
  assert.equal(levelLogIntervalMs({ sinceStartMs: 11 * 60000 }), 300000);
  assert.equal(levelLogIntervalMs({ sinceStartMs: 11 * 60000, diagnostic: true }), 10000);
});

test("relatórios da página da escuta: só números e textos curtos", () => {
  assert.equal(sanitizeWakeReport("qualquer", {}), null);
  const level = sanitizeWakeReport("nivel", { rms: 0.01, peak: 5, voiced: 0.12, segments: 3, frames: 78, noise: 0.003, extra: "x" });
  assert.deepEqual(level, { kind: "nivel", rms: 0.01, peak: 1, noise: 0.003, voiced: 0.12, segments: 3, frames: 78, paused: false });
  assert.equal(formatLevelDetail(level), "nivel media -40 dB pico 0 dB ruido -50 dB fala 12% trechos 3");
  assert.match(formatLevelDetail({ ...level, frames: 0 }), /SEM_AUDIO/);
  const device = sanitizeWakeReport("dispositivo", { label: "Microfone (Realtek)\n", usingDefault: 1, deviceRate: 48000, contextRate: 16000, inputs: 2 });
  assert.equal(device.label, "Microfone (Realtek)");
  assert.equal(device.usingDefault, true);
  const diag = sanitizeWakeReport("diag", { text: "rei ri liga a tela", words: [{ word: "rei", conf: 0.4 }, { word: 7 }, "x"] });
  assert.deepEqual(diag.words, [{ word: "rei", conf: 0.4 }]);
  assert.equal(sanitizeWakeReport("erro", { where: "vosk", message: "x".repeat(500) }).message.length, 160);
});

function fakeFst(words) {
  const parts = [];
  const int32 = (value) => {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(value);
    parts.push(buffer);
  };
  const int64 = (value) => {
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64LE(BigInt(value));
    parts.push(buffer);
  };
  const text = (value) => {
    const buffer = Buffer.from(value, "utf8");
    int32(buffer.length);
    parts.push(buffer);
  };
  int32(2125659606);
  text("ngram");
  text("standard");
  int32(4);
  int32(2); // só a tabela de saída
  int64(0);
  int64(0);
  int64(1);
  int64(0);
  int32(2125658996);
  text("words.txt");
  int64(words.length);
  int64(words.length);
  words.forEach((word, index) => {
    text(word);
    int64(index);
  });
  parts.push(Buffer.alloc(32, 1)); // resto do FST
  return Buffer.concat(parts);
}

function tarEntry(name, body) {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write(body.length.toString(8).padStart(11, "0"), 124, "ascii");
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}
