// Atualização automática (1.3.0): regras puras do item da bandeja, do log e do endereço público.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { UPDATE_FEED_URL, UPDATE_INTERVAL_MS, updateErrorDetail, updateTrayItem } = require("../src/core");

test("endereço das atualizações: https, leitura pública, sem token", () => {
  const url = new URL(UPDATE_FEED_URL);
  assert.equal(url.protocol, "https:");
  assert.equal(url.search, "");
  assert.equal(url.username + url.password, "");
  assert.equal(UPDATE_INTERVAL_MS, 4 * 60 * 60 * 1000);
});

test("item da bandeja conforme o estado", () => {
  assert.deepEqual(updateTrayItem(), { label: "Procurar atualização", enabled: true, install: false });
  assert.equal(updateTrayItem({ state: "procurando" }).enabled, false);
  assert.equal(updateTrayItem({ state: "baixando", version: "1.3.1", percent: 42.6 }).label, "Baixando versão 1.3.1 (43%)");
  assert.deepEqual(updateTrayItem({ state: "pronta", version: "1.3.1" }), { label: "Nova versão 1.3.1 pronta — Reiniciar agora", enabled: true, install: true });
  assert.equal(updateTrayItem({ state: "pronta", version: "" }).install, false, "sem versão não oferece reiniciar");
  assert.equal(updateTrayItem({ state: "erro" }).label, "Procurar atualização");
});

test("erro do atualizador no log: curto, sem endereço", () => {
  const error = Object.assign(new Error('Cannot find latest.yml in the latest release artifacts (https://example.com/x/latest.yml): HttpError: 404\nstack...'), { code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" });
  const detail = updateErrorDetail(error);
  assert.ok(detail.startsWith("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND "));
  assert.equal(detail.includes("https://"), false);
  assert.equal(detail.includes("stack"), false);
  assert.equal(updateErrorDetail(null), "erro");
});

test("pacote: sem publisherName (app sem assinatura) e com o atualizador nas dependências", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(pkg.dependencies["electron-updater"], "electron-updater precisa ir dentro do app");
  assert.equal(JSON.stringify(pkg.build).includes("publisherName"), false, "publisherName faria o atualizador exigir assinatura");
  assert.equal(pkg.build.nsis.oneClick, true);
  assert.equal(pkg.build.nsis.perMachine, false, "instala no usuário: atualiza sem pedir administrador");
});

// 1.3.1 (dono, 2026-10-23): nenhum aviso fixo no meio da tela com a tela cheia do Henry aberta.
test("caixa 'Nova versão pronta' espera a tela cheia do Henry fechar e não se perde", () => {
  const { UPDATE_PROMPT_INITIAL, updatePromptStep } = require("../src/core");
  // Sem Henry aberto: mostra na hora.
  assert.equal(updatePromptStep(UPDATE_PROMPT_INITIAL, { type: "ask", version: "1.3.2" }).show, "1.3.2");
  // Henry abriu → pronta chega → guardada.
  let step = updatePromptStep(UPDATE_PROMPT_INITIAL, { type: "hold", held: true });
  assert.equal(step.show, "");
  step = updatePromptStep(step.state, { type: "ask", version: "1.3.2" });
  assert.equal(step.show, "");
  assert.equal(step.state.pendingVersion, "1.3.2");
  // Abrir de novo não mostra; fechar mostra uma vez só.
  step = updatePromptStep(step.state, { type: "hold", held: true });
  assert.equal(step.show, "");
  step = updatePromptStep(step.state, { type: "hold", held: false });
  assert.equal(step.show, "1.3.2");
  step = updatePromptStep(step.state, { type: "hold", held: false });
  assert.equal(step.show, "");
  // Fechar sem nada guardado: nada aparece.
  assert.equal(updatePromptStep(UPDATE_PROMPT_INITIAL, { type: "hold", held: false }).show, "");
});

test("updater: a caixa só sai por askRestart/setHold (bandeja e notificação passam pela mesma trava)", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "updater.js"), "utf8");
  assert.equal((source.match(/dialog\.showMessageBox/g) || []).length, 1);
  assert.match(source, /function askRestart\(version\) \{\s*const step = updatePromptStep\(prompt, \{ type: "ask", version \}\);/);
});
