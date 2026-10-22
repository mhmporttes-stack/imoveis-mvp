import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { KEEP_AWAKE_EVERY_MINUTES, PULSE_PAGE, PULSE_TAB_CLOSE_MS, decidePulse, keepAwakeEnabled, shouldHoldPower } from "../lib/keep-awake.js";

const active = { manualPause: false, running: null };

test("manter acordado vem ligado por padrão e só desliga com false explícito", () => {
  assert.equal(keepAwakeEnabled(undefined), true);
  assert.equal(keepAwakeEnabled(true), true);
  assert.equal(keepAwakeEnabled(false), false);
});

test("Pausar do popup solta o computador; opção desligada também", () => {
  assert.equal(shouldHoldPower(undefined, active), true);
  assert.equal(shouldHoldPower(undefined, { ...active, manualPause: true }), false);
  assert.equal(shouldHoldPower(false, active), false);
  // Pausa de 24 h por verificação do Facebook não solta: o chat/agenda precisam continuar vivos para retomar.
  assert.equal(shouldHoldPower(undefined, { ...active, pausedUntil: "2099-01-01T00:00:00Z" }), true);
});

test("aba de acordar: nunca durante publicação, sincronização, sem janela ou com a anterior aberta", () => {
  assert.deepEqual(decidePulse(undefined, active), { pulse: true, reason: "ok" });
  assert.equal(decidePulse(false, active).reason, "desligado");
  assert.equal(decidePulse(undefined, { ...active, manualPause: true }).reason, "pausado");
  assert.equal(decidePulse(undefined, { ...active, running: { listingId: "a1" } }).reason, "publicando");
  assert.equal(decidePulse(undefined, active, { chatBusy: true }).reason, "sincronizando");
  assert.equal(decidePulse(undefined, active, { hasNormalWindow: false }).reason, "sem_janela");
  assert.equal(decidePulse(undefined, active, { previousPulseOpen: true }).reason, "aba_anterior_aberta");
});

test("ritmo: a cada 1 min, fecha em ~2 s, página interna existe", () => {
  assert.equal(KEEP_AWAKE_EVERY_MINUTES, 1);
  assert.ok(PULSE_TAB_CLOSE_MS >= 1000 && PULSE_TAB_CLOSE_MS <= 3000);
  assert.ok(existsSync(new URL(`../${PULSE_PAGE}`, import.meta.url)));
});

test("manifest pede a permissão power e o background usa os pontos certos", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.permissions.includes("power"));
  assert.ok(manifest.permissions.includes("alarms"));
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  assert.match(bg, /chrome\.power\.requestKeepAwake\("system"\)/);
  assert.match(bg, /chrome\.power\.releaseKeepAwake\(\)/);
  assert.match(bg, /active: false, url: chrome\.runtime\.getURL\(PULSE_PAGE\)/);
  // Abas próprias (publicação, chat, diagnóstico) não são descartadas pelo Chrome.
  assert.equal((bg.match(/protectTab\(tab\.id\)/g) || []).length, 3);
});
