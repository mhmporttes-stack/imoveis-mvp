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
