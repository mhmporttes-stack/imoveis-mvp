// Atalho de fala do Henry e anel segurado no celular (REGRA OFICIAL — dono, 2026-10-25; HENRY-1 "Atalho de fala").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PTT_RECORDER_INITIAL,
  buildPttShortcut,
  isPttShortcutKey,
  matchesPttShortcut,
  parsePttShortcut,
  pttRecorderStep,
  pttShortcutLabel,
  pttShortcutToken,
  resolvePttShortcut,
  validatePttShortcut
} from "../lib/henry-ptt-shortcut-core.mjs";
import { HENRY_PTT_TAP_MS, henryRingHoldReady, henryRingPressAction, isPushToTalkRelease, pushToTalkKeyAction } from "../lib/henry-voice-conversation.mjs";
import { mergeHenryStyle, parseHenryStylePatch, resolveHenryStyle } from "../lib/henry-voice-style.mjs";

const press = (codes) => {
  let state = PTT_RECORDER_INITIAL;
  for (const code of codes) state = pttRecorderStep(state, { type: "down", code });
  for (const code of codes) state = pttRecorderStep(state, { type: "up", code });
  return state.result;
};

test("peças: esquerda/direita iguais, code desconhecido ignorado, ordem fixa", () => {
  assert.equal(pttShortcutToken("ControlRight"), "Control");
  assert.equal(pttShortcutToken("AltLeft"), "Alt");
  assert.equal(pttShortcutToken("KeyM"), "KeyM");
  assert.equal(pttShortcutToken(""), "");
  assert.equal(pttShortcutToken("<script>"), "");
  assert.equal(buildPttShortcut(["Space", "Control"]), "Control+Space");
  assert.equal(buildPttShortcut(["F9", "F8"]), "F8+F9");
  assert.deepEqual(parsePttShortcut("Control+Space"), ["Control", "Space"]);
  assert.deepEqual(parsePttShortcut("Space+Control"), []); // fora da ordem fixa = inválido guardado
  assert.deepEqual(parsePttShortcut("Control+Alt+KeyM"), []);
  assert.equal(pttShortcutLabel("Control+Space"), "Ctrl + Espaço");
  assert.equal(pttShortcutLabel("Alt+KeyM"), "Alt + M");
});

test("gravação: 2 teclas juntas viram o atalho; 1 ou 3 teclas, aviso", () => {
  assert.deepEqual(press(["ControlLeft", "Space"]), { ok: true, shortcut: "Control+Space" });
  assert.deepEqual(press(["AltRight", "KeyM"]), { ok: true, shortcut: "Alt+KeyM" });
  assert.deepEqual(press(["F8", "F9"]), { ok: true, shortcut: "F8+F9" });
  assert.equal(press(["KeyM"]).ok, false);
  assert.equal(press(["ControlLeft", "AltLeft", "KeyM"]).ok, false);
  // Soltar uma e apertar outra antes de soltar tudo: vale o maior conjunto segurado junto.
  let state = PTT_RECORDER_INITIAL;
  state = pttRecorderStep(state, { type: "down", code: "ControlLeft" });
  state = pttRecorderStep(state, { type: "down", code: "KeyK" });
  assert.equal(state.result, null);
  state = pttRecorderStep(state, { type: "up", code: "KeyK" });
  assert.equal(state.result, null);
  state = pttRecorderStep(state, { type: "up", code: "ControlLeft" });
  assert.deepEqual(state.result, { ok: true, shortcut: "Control+KeyK" });
});

test("conflitos recusados: digitação, Ctrl+C/V/X/A/Z, navegador, Alt+B do Henry", () => {
  for (const shortcut of ["KeyA+KeyS", "Digit1+KeyQ", "KeyM+Space", "Enter+Space", "ArrowDown+ArrowUp"]) {
    assert.equal(validatePttShortcut(shortcut).ok, false, shortcut);
  }
  for (const key of ["KeyC", "KeyV", "KeyX", "KeyA", "KeyZ"]) {
    assert.equal(validatePttShortcut(`Control+${key}`).ok, false, key);
    assert.equal(validatePttShortcut(`Meta+${key}`).ok, false, key);
  }
  assert.match(validatePttShortcut("Control+KeyC").error, /copiar/);
  assert.equal(validatePttShortcut("Shift+KeyM").ok, false); // escreve "M"
  assert.equal(validatePttShortcut("Control+Shift").ok, false); // duas de controle
  assert.equal(validatePttShortcut("Alt+KeyB").ok, false);
  assert.equal(validatePttShortcut("Control+KeyW").ok, false);
  assert.equal(validatePttShortcut("F5+F8").ok, false);
  assert.equal(validatePttShortcut("Control+F5").ok, false);
  assert.equal(validatePttShortcut("Control+Enter").ok, false);
  assert.equal(validatePttShortcut("Control+Space+KeyM").ok, false);
  assert.equal(validatePttShortcut(42).ok, false);
  for (const shortcut of ["Control+Space", "Alt+KeyM", "F8+F9", "Shift+F9", "Control+Digit1", "Meta+KeyJ", "Alt+Digit0"]) {
    assert.equal(validatePttShortcut(shortcut).ok, true, shortcut);
  }
  assert.deepEqual(validatePttShortcut("Space+Control"), { ok: true, shortcut: "Control+Space" }); // normaliza a ordem
  assert.deepEqual(validatePttShortcut(""), { ok: true, shortcut: "" });
  assert.equal(resolvePttShortcut("Control+KeyV"), "");
});

test("keydown/keyup → ação: atalho exato em qualquer lugar, soltar qualquer tecla dele", () => {
  const input = { tagName: "INPUT", type: "text", parentElement: null, getAttribute: () => null };
  const base = { henryActive: true, shortcut: "Control+Space", target: input };
  assert.equal(pushToTalkKeyAction({ ...base, key: " ", code: "Space", ctrlKey: true, held: new Set(["Control", "Space"]) }), "custom");
  assert.equal(pushToTalkKeyAction({ ...base, key: " ", code: "Space", ctrlKey: true, shiftKey: true, held: new Set(["Control", "Shift", "Space"]) }), null); // exato
  assert.equal(pushToTalkKeyAction({ ...base, key: " ", code: "Space", held: new Set(["Space"]) }), null);
  assert.equal(pushToTalkKeyAction({ ...base, locked: true, key: " ", code: "Space", ctrlKey: true, held: ["Control", "Space"] }), null);
  assert.equal(pushToTalkKeyAction({ ...base, henryActive: false, key: " ", code: "Space", ctrlKey: true, held: ["Control", "Space"] }), null);
  assert.equal(pushToTalkKeyAction({ ...base, shortcut: "", key: " ", code: "Space", ctrlKey: true, held: ["Control", "Space"] }), null);
  // Enter e Ctrl+Shift+H seguem como antes, com ou sem atalho salvo.
  assert.equal(pushToTalkKeyAction({ henryActive: true, shortcut: "Control+Space", held: ["Control", "Shift", "KeyH"], key: "H", code: "KeyH", ctrlKey: true, shiftKey: true }), "shortcut");
  assert.equal(pushToTalkKeyAction({ henryActive: true, shortcut: "Control+Space", held: ["Enter"], key: "Enter", code: "Enter", target: null }), "enter");
  assert.equal(isPushToTalkRelease("custom", { key: "Control", code: "ControlRight" }, "Control+Space"), true);
  assert.equal(isPushToTalkRelease("custom", { key: " ", code: "Space" }, "Control+Space"), true);
  assert.equal(isPushToTalkRelease("custom", { key: "Shift", code: "ShiftLeft" }, "Control+Space"), false);
  assert.equal(isPttShortcutKey("Alt+KeyM", "KeyM"), true);
  assert.equal(matchesPttShortcut("Alt+KeyM", ["KeyM", "Alt"]), true);
});

test("anel do celular: toque curto abre, segurar ouve e soltar envia", () => {
  assert.equal(henryRingHoldReady({ pressed: true, heldMs: HENRY_PTT_TAP_MS }), true);
  assert.equal(henryRingHoldReady({ pressed: true, heldMs: HENRY_PTT_TAP_MS - 1 }), true); // atraso do relógio no disparo
  assert.equal(henryRingHoldReady({ pressed: true, heldMs: 100 }), false);
  assert.equal(henryRingHoldReady({ pressed: false, heldMs: 900 }), false); // já soltou
  assert.equal(henryRingPressAction({ started: false, heldMs: 120 }), "open");
  assert.equal(henryRingPressAction({ started: false, heldMs: 900 }), "open"); // não chegou a ouvir (mic desligado): toque de sempre
  assert.equal(henryRingPressAction({ started: true, heldMs: 900 }), "send");
});

test("servidor: style.pttShortcut validado, guardado e preservado", () => {
  assert.deepEqual(parseHenryStylePatch({ pttShortcut: "Space+Control" }), { ok: true, patch: { pttShortcut: "Control+Space" } });
  assert.equal(parseHenryStylePatch({ pttShortcut: "Control+KeyC" }).ok, false);
  assert.deepEqual(parseHenryStylePatch({ pttShortcut: "" }), { ok: true, patch: { pttShortcut: "" } });
  assert.equal(resolveHenryStyle({ pttShortcut: "Alt+KeyM" }).pttShortcut, "Alt+KeyM");
  assert.equal(resolveHenryStyle({ pttShortcut: "KeyA+KeyB" }).pttShortcut, "");
  assert.deepEqual(mergeHenryStyle({ tone: "executivo" }, { pttShortcut: "Alt+KeyM" }), { tone: "executivo", pttShortcut: "Alt+KeyM" });
  assert.equal(mergeHenryStyle({ pttShortcut: "Alt+KeyM" }, { tone: "executivo" }).pttShortcut, "Alt+KeyM"); // salvar outro campo não perde
  assert.equal("pttShortcut" in mergeHenryStyle({ pttShortcut: "Alt+KeyM" }, { pttShortcut: "" }), false); // Limpar
});

test("tela: anel segurado sem menu do toque longo e retorno visual; atalho sem teclado = dica", () => {
  const view = readFileSync(new URL("../components/henry/HenryVoiceView.jsx", import.meta.url), "utf8");
  assert.match(view, /ringHold\?\.onClick \|\| onExpand/);
  assert.match(view, /touchAction: "none"/);
  const assistant = readFileSync(new URL("../components/henry/HenryVoiceAssistant.jsx", import.meta.url), "utf8");
  assert.match(assistant, /beginPushToTalk\("pointer"\)[\s\S]{0,200}vibrate/);
  assert.match(assistant, /onContextMenu: \(event\) => event\.preventDefault\(\), \/\/ toque longo não abre menu/);
  const setting = readFileSync(new URL("../components/henry/HenryPttShortcutSetting.jsx", import.meta.url), "utf8");
  assert.match(setting, /any-pointer: fine/);
  assert.match(setting, /segure o ícone do Henry minimizado/);
});
