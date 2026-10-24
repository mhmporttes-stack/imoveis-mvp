// Palavra de chamada (1.3.0): o lado do CRM (lib/henry-desktop-core.mjs) e o lado do app (src/core.js) falam a mesma
// língua — o valor que a tela salva é aceito pelo app; qualquer outra coisa vira "Henry" nos dois.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { WAKE_WORD_PRESETS, parseWakeChoice } = require("../src/core");

const loadCrm = () => import(pathToFileURL(path.join(__dirname, "..", "..", "lib", "henry-desktop-core.mjs")).href);

const memory = (value) => ({ getItem: () => value });

test("CRM: opções e valor salvo", async () => {
  const crm = await loadCrm();
  assert.deepEqual(crm.DESKTOP_WAKE_WORD_OPTIONS.map((item) => item.label), ["Henry", "Ei Henry", "Ok Henry", "Outra palavra"]);
  assert.equal(crm.buildDesktopWakeWord("ei-henry"), "ei-henry");
  assert.equal(crm.buildDesktopWakeWord("custom", "  Ei, Jarvis! "), "custom:ei jarvis");
  assert.equal(crm.buildDesktopWakeWord("custom", ""), null);
  assert.equal(crm.buildDesktopWakeWord("custom", "um dois tres quatro"), null);
  assert.equal(crm.buildDesktopWakeWord("custom"), null);
  assert.equal(crm.buildDesktopWakeWord("qualquer"), null);
  assert.equal(crm.readDesktopWakeWord(memory(null)), "henry");
  assert.equal(crm.readDesktopWakeWord(memory("ok-henry")), "ok-henry");
  assert.equal(crm.readDesktopWakeWord(memory("custom:")), "henry");
  assert.equal(crm.readDesktopWakeWord(memory("lixo")), "henry");
  assert.equal(crm.readDesktopWakeWord({ getItem: () => { throw new Error("x"); } }), "henry");
  assert.deepEqual(crm.parseDesktopWakeWord("custom:jarvis"), { id: "custom", text: "jarvis" });
});

test("CRM e app aceitam os mesmos valores", async () => {
  const crm = await loadCrm();
  const presets = crm.DESKTOP_WAKE_WORD_OPTIONS.filter((item) => item.id !== "custom").map((item) => item.id);
  assert.deepEqual(presets, WAKE_WORD_PRESETS.map((item) => item.id));
  for (const id of presets) assert.equal(parseWakeChoice(crm.buildDesktopWakeWord(id)).id, id);
  const custom = parseWakeChoice(crm.buildDesktopWakeWord("custom", "Ei Rênri"));
  assert.deepEqual(custom, { id: "custom", text: "ei rênri", error: "" });
});
