import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AMBIENT_PHRASES,
  AMBIENT_SCENE_EVERY,
  AMBIENT_SECOND_LINES,
  AMBIENT_TIMING,
  AMBIENT_TYPES,
  ambientActive,
  ambientPulseEvent,
  ambientShouldWait,
  createAmbientState,
  nextAmbientDelay,
  nextAmbientItem,
  seededRandom
} from "../lib/henry-pulse-ambient-core.mjs";
import { HENRY_PULSE_TYPES, pickPulseSpot } from "../lib/henry-pulse-core.mjs";
import { HENRY_LOCKED_PHRASES, HENRY_PIN_LENGTH, HENRY_UNLOCK_DONE_GLYPH, HENRY_UNLOCK_GLYPHS, henryUnlockDuration, henryUnlockFrame } from "../lib/henry-lock-core.mjs";

// Modo ambiente da tela de bloqueio (dono, 2026-10-24: "deixei bloqueado de madrugada e nada aconteceu") e cena do
// desbloqueio. Tudo só no navegador; nenhum dado real.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("frases genéricas: 2 a 3 por tipo, tipos do Pulso, sem nome, número nem dado", () => {
  for (const type of AMBIENT_TYPES) {
    assert.ok(HENRY_PULSE_TYPES[type], type);
    assert.ok(AMBIENT_PHRASES[type].length >= 2 && AMBIENT_PHRASES[type].length <= 3, type);
    for (const phrase of AMBIENT_PHRASES[type]) {
      assert.ok(!/\d/.test(phrase), phrase);
      assert.ok(!/\b(Ana|Bruno|Carol|Matheus|Henry)\b/.test(phrase), phrase);
    }
  }
  for (const line of AMBIENT_SECOND_LINES) assert.ok(!/\d/.test(line));
  const event = ambientPulseEvent({ kind: "card", type: "lead", phrase: "Novo cliente cadastrado", line2: "agora há pouco", side: "left" }, 3);
  assert.equal(event.ambient, true);
  assert.equal(event.link, undefined, "inventado não abre nada");
  assert.equal(event.broker, undefined, "sem corretor (avatar = cadeado/ícone do canal)");
  assert.equal(event.client, undefined);
  assert.equal(event.ambientText.who, "Novo cliente cadastrado");
});

test("sorteio com seed: nunca a mesma frase seguida nem o mesmo tipo 3 vezes; cena a cada 6 a 8; lados variam", () => {
  for (const seed of [1, 2, 3, 42, 2026]) {
    const random = seededRandom(seed);
    const state = createAmbientState(random);
    let lastPhrase = "";
    const types = [];
    let sinceScene = 0;
    const sides = new Set();
    const used = new Set();
    for (let i = 0; i < 400; i += 1) {
      const item = nextAmbientItem(state, random);
      if (item.kind === "scene") {
        assert.ok(sinceScene + 1 >= AMBIENT_SCENE_EVERY[0] && sinceScene + 1 <= AMBIENT_SCENE_EVERY[1], `cena depois de ${sinceScene} cards`);
        sinceScene = 0;
        continue;
      }
      sinceScene += 1;
      assert.notEqual(item.phrase, lastPhrase, `frase repetida (seed ${seed})`);
      lastPhrase = item.phrase;
      types.push(item.type);
      const last3 = types.slice(-3);
      assert.ok(!(last3.length === 3 && last3.every((type) => type === last3[0])), `tipo 3x (seed ${seed})`);
      sides.add(item.side);
      used.add(item.type);
    }
    assert.deepEqual([...sides].sort(), ["left", "right"]);
    assert.ok(used.size >= 5, "varia os tipos");
  }
});

test("ritmo: 35 s a 2 min, às vezes 2 seguidos (3–8 s), às vezes pausa maior (3–5 min) — não é ciclo fixo", () => {
  const random = seededRandom(9);
  const state = createAmbientState(random);
  const delays = Array.from({ length: 500 }, () => nextAmbientDelay(state, random));
  const t = AMBIENT_TIMING;
  for (const ms of delays) {
    const normal = ms >= t.minMs && ms <= t.maxMs;
    const burst = ms >= t.burstMinMs && ms <= t.burstMaxMs;
    const long = ms >= t.longMinMs && ms <= t.longMaxMs;
    assert.ok(normal || burst || long, String(ms));
  }
  assert.ok(delays.some((ms) => ms <= t.burstMaxMs), "tem 2 seguidos");
  assert.ok(delays.some((ms) => ms >= t.longMinMs), "tem pausa maior");
  assert.ok(new Set(delays).size > 400, "sem ciclo fixo");
  // Depois de um "2 seguidos", o próximo volta ao ritmo normal (nunca 3 em rajada).
  for (let i = 2; i < delays.length; i += 1) assert.ok(!(delays[i] <= t.burstMaxMs && delays[i - 1] <= t.burstMaxMs));
});

test("prioridade do real e só com a tela cheia bloqueada e o Henry parado", () => {
  assert.equal(ambientShouldWait({ realQueued: 1 }), true);
  assert.equal(ambientShouldWait({ realLive: 1 }), true);
  assert.equal(ambientShouldWait({ realQueued: 0, realLive: 0 }), false);
  assert.equal(ambientActive({ locked: true, expanded: true, idle: true }), true);
  assert.equal(ambientActive({ locked: false, expanded: true, idle: true }), false, "desbloqueou: para na hora");
  assert.equal(ambientActive({ locked: true, expanded: false, idle: true }), false);
  assert.equal(ambientActive({ locked: true, expanded: true, idle: false }), false, "Henry falando/pensando");
});

test("HenryPulse: inventados voltam ao anel ao desbloquear, real tem prioridade, sem consulta/gravação", () => {
  const pulse = read("../components/henry/HenryPulse.jsx");
  assert.match(pulse, /\(card\.event\.ambient && !ambientRef\.current\)\) && k < HENRY_PULSE_PHASES\.pull/);
  assert.match(pulse, /ambientShouldWait\(\{ realQueued: queue\.length, realLive: live\.filter\(\(card\) => !card\.event\.ambient\)\.length \}\)/);
  assert.match(pulse, /if \(!isPageHidden\(\) && realRef\.current\) \{/, "sem o Pulso ligado, nenhuma consulta ao servidor");
  const core = read("../lib/henry-pulse-ambient-core.mjs");
  assert.ok(!/fetch\(|localStorage|navigator\.|Audio|Notification/.test(core), "nada gravado nem enviado");
  const view = read("../components/henry/HenryVoiceView.jsx");
  assert.match(view, /ambient=\{locked\} realEvents=\{Boolean\(pulse\)\}/);
  // lado sorteado respeitado no computador
  const spot = pickPulseSpot({ W: 1440, H: 900, cx: 720, cy: 450, R: 160, wide: true, side: "left", random: seededRandom(4) });
  assert.ok(spot.x < 720 - 160);
  const right = pickPulseSpot({ W: 1440, H: 900, cx: 720, cy: 450, R: 160, wide: true, side: "right", random: seededRandom(4) });
  assert.ok(right.x > 720 + 160);
});

test("cena do desbloqueio: caracteres aleatórios SEM dígito e fim neutro (nunca a senha)", () => {
  assert.ok(HENRY_UNLOCK_GLYPHS.every((char) => !/\d/.test(char)));
  const random = seededRandom(5);
  for (let ms = 0; ms <= henryUnlockDuration(); ms += 45) {
    const frame = henryUnlockFrame(ms, { random });
    assert.equal(frame.length, HENRY_PIN_LENGTH);
    for (const slot of frame) assert.ok(!/\d/.test(slot.char), slot.char);
    // trava da esquerda para a direita
    const firstOpen = frame.findIndex((slot) => !slot.locked);
    if (firstOpen >= 0) assert.ok(frame.slice(firstOpen).every((slot) => !slot.locked));
  }
  const end = henryUnlockFrame(henryUnlockDuration(), { random });
  assert.ok(end.every((slot) => slot.locked && slot.char === HENRY_UNLOCK_DONE_GLYPH));
  assert.ok(henryUnlockDuration() >= 1000 && henryUnlockDuration() <= 1300, "≈1,1 s + varredura do anel ≈ 1,7 s");
  assert.equal(henryUnlockDuration({ reduced: true }), 300);
  assert.ok(henryUnlockFrame(0, { reduced: true, random }).every((slot) => slot.locked));
  // a tela nunca recebe os dígitos para a cena
  const screen = read("../components/henry/HenryLockScreen.jsx");
  assert.match(screen, /henryUnlockFrame\(elapsed, \{ reduced \}\)/);
  assert.ok(!/henryUnlockFrame\([^)]*digits/.test(screen));
  assert.ok(HENRY_LOCKED_PHRASES.length > 0);
});
