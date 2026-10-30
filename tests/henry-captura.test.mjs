import assert from "node:assert/strict";
import test from "node:test";
import { isWarmStreamUsable, nextNoiseFloor, recordLevelThreshold } from "../lib/henry-voice-conversation.mjs";

test("ruído de fundo da gravação = menor nível lido (a voz do dono logo depois do nome não vira 'ruído')", () => {
  // Dono já falando nos primeiros 350 ms: leituras 0,05 (silêncio), 0,45, 0,5 (voz).
  let floor = 0;
  [0.05, 0.45, 0.5].forEach((level, reads) => {
    floor = nextNoiseFloor(floor, reads, level);
  });
  assert.equal(floor, 0.05);
  // Antes (média) o piso virava ~0,33 e o limiar subia para 0,6 (teto): a voz normal não passava.
  const average = (0.05 + 0.45 + 0.5) / 3;
  assert.ok(recordLevelThreshold({ floor: average }) > 0.5);
  assert.ok(recordLevelThreshold({ floor }) <= 0.12);
});

test("ruído de fundo estável (música baixa, ventilador) continua valendo como piso", () => {
  let floor = 0;
  [0.2, 0.21, 0.19].forEach((level, reads) => {
    floor = nextNoiseFloor(floor, reads, level);
  });
  assert.equal(floor, 0.19);
  assert.ok(recordLevelThreshold({ floor }) > 0.4); // 2,2× o piso: música não vira voz
  assert.equal(nextNoiseFloor(0, 0, 0.3), 0.3); // 1ª leitura define o piso
  assert.equal(nextNoiseFloor(0.3, 1, Number.NaN), 0);
});

test("microfone quente só serve com trilha de áudio ao vivo", () => {
  assert.equal(isWarmStreamUsable([{ kind: "audio", readyState: "live" }]), true);
  assert.equal(isWarmStreamUsable([{ kind: "audio", readyState: "ended" }]), false);
  assert.equal(isWarmStreamUsable([]), false);
  assert.equal(isWarmStreamUsable(null), false);
  assert.equal(isWarmStreamUsable([{ kind: "video", readyState: "live" }]), false);
});
