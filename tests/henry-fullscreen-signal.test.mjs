// Avisos fixos esperam a tela cheia do Henry fechar (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-23).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_FULLSCREEN_EVENT,
  heldWhileHenryOpen,
  henryJustClosed,
  isHenryFullscreenOpen,
  setHenryFullscreenOpen,
  subscribeHenryFullscreen
} from "../lib/henry-fullscreen-signal.mjs";

test("sinal: começa fechado, abre, fecha e só avisa quando muda", () => {
  const target = new EventTarget();
  let events = 0;
  const off = subscribeHenryFullscreen(() => { events += 1; }, target);
  assert.equal(isHenryFullscreenOpen(target), false);
  assert.equal(setHenryFullscreenOpen(true, target), true);
  assert.equal(isHenryFullscreenOpen(target), true);
  assert.equal(setHenryFullscreenOpen(true, target), false, "abrir de novo não dispara outro evento");
  assert.equal(setHenryFullscreenOpen(false, target), true);
  assert.equal(isHenryFullscreenOpen(target), false);
  assert.equal(events, 2);
  off();
  setHenryFullscreenOpen(true, target);
  assert.equal(events, 2, "depois de cancelar a inscrição não recebe mais");
});

test("sinal: só true explícito abre; sem window nada quebra", () => {
  const target = new EventTarget();
  setHenryFullscreenOpen("sim", target);
  assert.equal(isHenryFullscreenOpen(target), false);
  assert.equal(isHenryFullscreenOpen(null), false);
  assert.equal(setHenryFullscreenOpen(true, null), false);
  assert.equal(typeof subscribeHenryFullscreen(() => {}, null), "function");
  assert.equal(HENRY_FULLSCREEN_EVENT, "mm-henry-fullscreen");
});

test("fila: aviso guardado com o Henry aberto volta igual quando fecha", () => {
  const queue = [{ id: "a" }, { id: "b" }];
  assert.equal(heldWhileHenryOpen(queue[0], true), null);
  assert.equal(queue.length, 2, "nada sai da fila enquanto está guardado");
  assert.equal(heldWhileHenryOpen(queue[0], false), queue[0]);
  assert.equal(heldWhileHenryOpen(undefined, false), null);
});

test("fechou agora: só a transição aberto → fechado", () => {
  assert.equal(henryJustClosed(true, false), true);
  assert.equal(henryJustClosed(false, false), false);
  assert.equal(henryJustClosed(false, true), false);
  assert.equal(henryJustClosed(true, true), false);
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("o Henry emite o sinal pelo estado da tela cheia", () => {
  const source = read("components/henry/HenryVoiceAssistant.jsx");
  assert.match(source, /setHenryFullscreenOpen\(expanded\)/);
  assert.match(source, /return \(\) => setHenryFullscreenOpen\(false\)/);
});

test("todo aviso fixo coberto consulta o sinal único", () => {
  for (const path of [
    "components/alerts/AlertCenterGate.jsx",
    "components/supervision/SupervisionMessageGate.jsx",
    "components/DailyMessageGate.jsx",
    "components/celebrations/BrokerCelebrationGate.jsx",
    "components/PwaLifecycle.jsx",
    "components/AdminPwaInstallHint.jsx",
    "components/AdminPushSubscription.jsx"
  ]) {
    assert.match(read(path), /useHenryFullscreen\(/, path);
  }
});
