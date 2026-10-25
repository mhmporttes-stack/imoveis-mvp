import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeWorkView, findWorkWindow, isFacebookUrl } from "../lib/work-window.js";

const fb = "https://www.facebook.com/marketplace/inbox/";

test("1.9.4: reusa a janela guardada; depois de reiniciar recupera a janela estreita com 1 aba do Facebook", () => {
  const windows = [
    { id: 1, type: "normal", width: 1920, tabs: [{ id: 10, url: "https://www.matheusmachadoimoveis.com.br/admin" }, { id: 11, url: fb }] },
    { id: 2, type: "normal", width: 520, tabs: [{ id: 20, url: fb }] }
  ];
  assert.deepEqual(findWorkWindow(windows, { windowId: 2, tabId: 20 }), { windowId: 2, tabId: 20, how: "guardada" });
  assert.deepEqual(findWorkWindow(windows, { windowId: 99, tabId: 999 }), { windowId: 2, tabId: 20, how: "recuperada" });
  // Nunca adota a janela do dono (larga ou com várias abas), mesmo com Facebook aberto.
  assert.equal(findWorkWindow([windows[0]], null), null);
  assert.equal(findWorkWindow([{ id: 3, type: "normal", width: 1280, tabs: [{ id: 30, url: fb }] }], null), null);
  assert.equal(isFacebookUrl("https://www.facebook.com.evil.com/"), false);
});

test("1.9.4/1.9.8: indicador do popup — visível ou atrás de outra janela trabalha; minimizada ou fechada não", () => {
  assert.equal(describeWorkView({ exists: true, windowState: "normal", visibility: "visible" }).ok, true);
  assert.match(describeWorkView({ exists: true, windowState: "minimized", visibility: "hidden" }).text, /MINIMIZADA/);
  // 1.9.8: atrás de outra janela (tela cheia do dono) a extensão acorda a página na hora da ação.
  assert.equal(describeWorkView({ exists: true, windowState: "normal", visibility: "hidden" }).ok, true);
  assert.equal(describeWorkView({ exists: false }).ok, false);
});

test("1.9.4: nunca aba nova na janela do dono nem foco sem pedido", () => {
  const bg = readFileSync(new URL("../background.js", import.meta.url), "utf8");
  for (const call of bg.match(/chrome\.tabs\.create\(\{[^}]*\}/g) || []) assert.match(call, /windowId: work\.windowId/, call);
  assert.match(bg, /chrome\.windows\.create\(\{ url: INBOX_URL, type: "normal", focused: false/);
  // focused: true só no botão "Abrir janela de trabalho".
  assert.equal((bg.match(/focused: true/g) || []).length, 1);
  assert.match(bg, /async function openWorkWindow\(\) \{[\s\S]{0,120}focused: true/);
  // A rodada do chat não fecha mais a aba de trabalho.
  assert.doesNotMatch(bg, /if \(tab\) \{\s*await detachDebugger\(tab\.id\);\s*await chrome\.tabs\.remove/);
});
