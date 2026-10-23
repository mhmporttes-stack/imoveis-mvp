// Henry no app de desktop do dono (desktop-app/, HENRY-1): detecção da ponte, comandos de tela e modo de captura.
import test from "node:test";
import assert from "node:assert/strict";
import { detectScreenCommand, readHenryDesktopBridge } from "../lib/henry-desktop-core.mjs";
import { henryCaptureMode } from "../lib/henry-voice-conversation.mjs";

const fn = () => {};
const fullBridge = { isDesktopApp: true, openSpotify: fn, openUrl: fn, notify: fn, screenOff: fn, screenOn: fn };

test("ponte do app: só com a flag e todas as ações", () => {
  assert.equal(readHenryDesktopBridge({ mmDesktop: fullBridge }), fullBridge);
  assert.equal(readHenryDesktopBridge({}), null);
  assert.equal(readHenryDesktopBridge(null), null);
  assert.equal(readHenryDesktopBridge({ mmDesktop: { ...fullBridge, isDesktopApp: "true" } }), null);
  assert.equal(readHenryDesktopBridge({ mmDesktop: { ...fullBridge, screenOff: "x" } }), null);
  const { notify, ...withoutNotify } = fullBridge;
  assert.equal(readHenryDesktopBridge({ mmDesktop: withoutNotify }), null);
});

test("comandos de tela", () => {
  for (const text of ["desliga a tela", "Henry, desliga a tela", "apaga o monitor", "pode desligar a tela do computador", "desligue a tela por favor"]) {
    assert.equal(detectScreenCommand(text), "off", text);
  }
  for (const text of ["liga a tela", "Henry liga a tela", "acende o monitor", "pode ligar a tela agora"]) {
    assert.equal(detectScreenCommand(text), "on", text);
  }
  for (const text of ["liga para o cliente", "desliga", "a tela", "liga a tela de vendas", "quantos clientes novos hoje", "liga e desliga a tela", "", null]) {
    assert.equal(detectScreenCommand(text), null, String(text));
  }
});

test("app de desktop sempre grava (sem reconhecimento do Chrome); fora do app nada muda", () => {
  assert.equal(henryCaptureMode({ desktop: true, desktopApp: true, hasRecognition: true, hasRecorder: true }), "record");
  assert.equal(henryCaptureMode({ desktop: true, desktopApp: true, hasRecognition: true, hasRecorder: false }), "none");
  assert.equal(henryCaptureMode({ desktop: true, hasRecognition: true, hasRecorder: true }), "recognition");
});

// --- Fase 1.1 (dono, 2026-10-23): onWake, speakLocal e piper-local ---------------------------------------------------
import { chunkForLocalVoice, desktopCanSpeakLocal, desktopCanWake, readDesktopWakeSetting, shouldHandleDesktopWake, LOCAL_VOICE_CHUNK, LOCAL_VOICE_MAX } from "../lib/henry-desktop-core.mjs";
import { henryReserveVoiceChain, HENRY_PROVIDER_LABELS } from "../lib/henry-voice-providers.mjs";

test("app 1.0.0 (sem onWake/speakLocal) continua aceito; as novas são opcionais", () => {
  assert.equal(readHenryDesktopBridge({ mmDesktop: fullBridge }), fullBridge);
  assert.equal(desktopCanWake(fullBridge), false);
  assert.equal(desktopCanSpeakLocal(fullBridge), false);
  const v11 = { ...fullBridge, onWake: fn, speakLocal: fn };
  assert.equal(desktopCanWake(v11), true);
  assert.equal(desktopCanSpeakLocal(v11), true);
  assert.equal(desktopCanWake(null), false);
  assert.equal(desktopCanSpeakLocal({ ...fullBridge, speakLocal: "x" }), false);
});

test("ordem de reserva: piper-local antes do navegador, só no app", () => {
  assert.deepEqual(henryReserveVoiceChain({ desktopLocalVoice: true }), ["piper-local", "browser"]);
  assert.deepEqual(henryReserveVoiceChain({ desktopLocalVoice: false }), ["browser"]);
  assert.deepEqual(henryReserveVoiceChain(), ["browser"]);
  assert.equal(HENRY_PROVIDER_LABELS["piper-local"], "voz do PC (Piper)");
});

test("nome ouvido pelo app só abre o Henry parado", () => {
  assert.equal(shouldHandleDesktopWake({ phase: "idle" }), true);
  assert.equal(shouldHandleDesktopWake({ phase: "armed" }), true);
  for (const phase of ["speaking", "thinking", "listening"]) assert.equal(shouldHandleDesktopWake({ phase }), false, phase);
  assert.equal(shouldHandleDesktopWake({ phase: "idle", recording: true }), false);
  assert.equal(shouldHandleDesktopWake({ phase: "idle", muted: true }), false);
});

test("liga/desliga do nome: nasce ligado", () => {
  assert.equal(readDesktopWakeSetting(null), true);
  assert.equal(readDesktopWakeSetting({ getItem: () => null }), true);
  assert.equal(readDesktopWakeSetting({ getItem: () => "1" }), true);
  assert.equal(readDesktopWakeSetting({ getItem: () => "0" }), false);
  assert.equal(readDesktopWakeSetting({ getItem: () => { throw new Error("x"); } }), true);
});

test("texto da voz local em pedaços de até 900 caracteres (o app aceita 1.000), sem perder nada", () => {
  assert.deepEqual(chunkForLocalVoice("Oi. Tudo bem?"), ["Oi. Tudo bem?"]);
  assert.deepEqual(chunkForLocalVoice(""), []);
  const long = Array.from({ length: 40 }, (_, index) => `Frase número ${index} com algum texto a mais.`).join(" ");
  const chunks = chunkForLocalVoice(long);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= LOCAL_VOICE_CHUNK && LOCAL_VOICE_CHUNK < LOCAL_VOICE_MAX));
  assert.equal(chunks.join(" "), long);
  const giant = "a".repeat(2500);
  assert.deepEqual(chunkForLocalVoice(giant).map((chunk) => chunk.length), [900, 900, 700]);
});
