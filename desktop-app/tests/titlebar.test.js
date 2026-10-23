// Barra de título própria (versão 1.2): revelação por hover, Alt, preferência e canal IPC da barra.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  TITLEBAR_ALT_SHOW_MS,
  TITLEBAR_HEIGHT,
  TITLEBAR_HIDE_DELAY_MS,
  TITLEBAR_REVEAL_PX,
  BRIDGE_ACTIONS,
  altTapStep,
  parsePreferences,
  titlebarPointer,
  titlebarStep,
  validateTitlebarMessage
} = require("../src/core");

const closed = { visible: false, hideAt: null };
const at = (y) => ({ x: 500, y });

test("cursor relativo ao topo visível da janela (maximizada passa da borda da tela)", () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  // Maximizada no Windows: a janela começa em -8, mas o topo que vale é o do monitor.
  assert.deepEqual(titlebarPointer({ x: 100, y: 0 }, { x: -8, y: -8, width: 1936, height: 1048 }, display), { x: 100, y: 0 });
  // Janela solta no meio da tela.
  assert.deepEqual(titlebarPointer({ x: 300, y: 205 }, { x: 200, y: 200, width: 800, height: 600 }, display), { x: 100, y: 5 });
  assert.equal(titlebarPointer({ x: 100, y: 199 }, { x: 200, y: 200, width: 800, height: 600 }, display), null);
  assert.equal(titlebarPointer({ x: 1000, y: 300 }, { x: 200, y: 200, width: 800, height: 600 }, display), null);
  assert.equal(titlebarPointer(null, { x: 0, y: 0, width: 10, height: 10 }, display), null);
});

test("mouse a até 6 px do topo abre; 7 px não abre", () => {
  assert.equal(titlebarStep(closed, { now: 0, pointer: at(0) }).visible, true);
  assert.equal(titlebarStep(closed, { now: 0, pointer: at(TITLEBAR_REVEAL_PX - 1) }).visible, true);
  assert.equal(titlebarStep(closed, { now: 0, pointer: at(TITLEBAR_REVEAL_PX) }).visible, false);
  // Fechada, passar pela área da barra (sem tocar a faixa) não abre: cliques no topo do CRM seguem normais.
  assert.equal(titlebarStep(closed, { now: 0, pointer: at(20) }).visible, false);
  assert.equal(titlebarStep(closed, { now: 0, pointer: null }).visible, false);
});

test("aberta: fica enquanto o mouse está nela e some 1 s depois que ele sai", () => {
  let state = titlebarStep(closed, { now: 0, pointer: at(2) });
  state = titlebarStep(state, { now: 500, pointer: at(TITLEBAR_HEIGHT - 1) });
  assert.deepEqual(state, { visible: true, hideAt: null });
  state = titlebarStep(state, { now: 1000, pointer: at(200) });
  assert.deepEqual(state, { visible: true, hideAt: 1000 + TITLEBAR_HIDE_DELAY_MS });
  state = titlebarStep(state, { now: 1900, pointer: at(200) });
  assert.equal(state.visible, true);
  // Voltou para a barra antes de sumir: cancela o sumiço.
  const back = titlebarStep(state, { now: 1950, pointer: at(10) });
  assert.deepEqual(back, { visible: true, hideAt: null });
  state = titlebarStep(state, { now: 2000, pointer: null });
  assert.deepEqual(state, closed);
});

test("Alt sozinho mostra por um tempo; janela escondida fecha; 'sempre' e tela cheia", () => {
  let state = titlebarStep(closed, { now: 0, pointer: at(400), reveal: true });
  assert.deepEqual(state, { visible: true, hideAt: TITLEBAR_ALT_SHOW_MS });
  assert.equal(titlebarStep(state, { now: TITLEBAR_ALT_SHOW_MS - 1, pointer: at(400) }).visible, true);
  assert.equal(titlebarStep(state, { now: TITLEBAR_ALT_SHOW_MS, pointer: at(400) }).visible, false);
  assert.deepEqual(titlebarStep({ visible: true, hideAt: null }, { now: 0, pointer: at(0), active: false }), closed);
  assert.deepEqual(titlebarStep(closed, { now: 0, pointer: at(500), alwaysVisible: true }), { visible: true, hideAt: null });
  // Em tela cheia (F11) a barra volta a ser só por hover, mesmo com "sempre" ligado.
  assert.equal(titlebarStep(closed, { now: 0, pointer: at(500), alwaysVisible: true, fullscreen: true }).visible, false);
});

test("Alt: só aperta-e-solta sozinho revela (Alt+Tab e atalhos com Alt não)", () => {
  let s = altTapStep(false, { type: "keyDown", key: "Alt" });
  s = altTapStep(s.armed, { type: "keyDown", key: "Alt", isAutoRepeat: true });
  assert.deepEqual(altTapStep(s.armed, { type: "keyUp", key: "Alt" }), { armed: false, reveal: true });
  s = altTapStep(false, { type: "keyDown", key: "Alt" });
  s = altTapStep(s.armed, { type: "keyDown", key: "Tab" });
  assert.deepEqual(altTapStep(s.armed, { type: "keyUp", key: "Alt" }), { armed: false, reveal: false });
});

test("canal da barra: só a página local da barra, frame principal, comandos da lista fechada", () => {
  const barUrl = "file:///C:/Users/x/AppData/Local/Programs/crm/resources/app.asar/src/titlebar/titlebar.html";
  const ok = { senderId: 7, barId: 7, isMainFrame: true, frameUrl: barUrl, barUrl };
  for (const command of ["minimize", "toggleMaximize", "close"]) assert.deepEqual(validateTitlebarMessage({ ...ok, command }), { ok: true, command });
  // A página do CRM (outra webContents, mesmo que tente o canal) é recusada.
  assert.equal(validateTitlebarMessage({ ...ok, senderId: 3, frameUrl: "https://www.matheusmachadoimoveis.com.br/admin", command: "close" }).error, "remetente_recusado");
  assert.equal(validateTitlebarMessage({ ...ok, frameUrl: "https://www.matheusmachadoimoveis.com.br/admin", command: "close" }).error, "remetente_recusado");
  assert.equal(validateTitlebarMessage({ ...ok, isMainFrame: false, command: "close" }).error, "remetente_recusado");
  assert.equal(validateTitlebarMessage({ ...ok, frameUrl: "file:///C:/outro.html", command: "close" }).error, "remetente_recusado");
  assert.equal(validateTitlebarMessage({ ...ok, barId: undefined, senderId: undefined, command: "close" }).error, "remetente_recusado");
  for (const command of ["quit", "openUrl", "eval", "", null, { command: "close" }]) {
    assert.equal(validateTitlebarMessage({ ...ok, command }).error, "comando_desconhecido", String(command));
  }
});

test("a ponte do CRM (window.mmDesktop) não ganhou nada com a barra", () => {
  assert.deepEqual([...BRIDGE_ACTIONS], ["openSpotify", "openUrl", "notify", "screenOff", "screenOn", "speakLocal"]);
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  assert.doesNotMatch(preload, /titlebar|minimize|maximize/i);
});

test("preferências: padrão barra oculta; só booleano conhecido entra", () => {
  assert.deepEqual(parsePreferences(""), { titlebarAlwaysVisible: false });
  assert.deepEqual(parsePreferences("{quebrado"), { titlebarAlwaysVisible: false });
  assert.deepEqual(parsePreferences('{"titlebarAlwaysVisible":true}'), { titlebarAlwaysVisible: true });
  assert.deepEqual(parsePreferences('{"titlebarAlwaysVisible":"sim","outra":1}'), { titlebarAlwaysVisible: false });
});
