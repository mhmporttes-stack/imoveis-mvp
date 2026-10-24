// Atualização automática do app (versão 1.3.0, pedido do dono em 2026-10-23: "esta é a última instalação manual").
// electron-updater com provider "generic" em UPDATE_FEED_URL (leitura pública, sem token/segredo no app). Procura ao abrir
// e a cada 4 h, baixa em segundo plano, confere o SHA-512 do latest.yml e avisa: "Nova versão X pronta — Reiniciar agora /
// Depois". "Depois" = instala sozinho ao Sair (autoInstallOnAppQuit). App sem assinatura digital: sem publisherName no
// app-update.yml, o electron-updater não exige assinatura (NsisUpdater.verifySignature devolve null). Tudo no acoes.log.
// Só funciona no app INSTALADO (NSIS); no "npm start" e na versão portátil fica desligado (registrado no log).
"use strict";

const { app, dialog } = require("electron");
const { UPDATE_FEED_URL, UPDATE_FIRST_CHECK_MS, UPDATE_INTERVAL_MS, UPDATE_PROMPT_INITIAL, updateErrorDetail, updatePromptStep, updateTrayItem } = require("./core");

function createUpdater({ log, notify, onChange = () => {}, beforeInstall = () => {} }) {
  let autoUpdater = null;
  let state = { state: "parado", version: "", percent: 0 };
  let manual = false; // "Procurar atualização" pela bandeja: avisa também quando não há versão nova
  let lastPercentLogged = -1;
  let timer = null;
  let prompt = { ...UPDATE_PROMPT_INITIAL }; // 1.3.1: caixa guardada com a tela cheia do Henry aberta (updatePromptStep)

  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  const active = app.isPackaged && !portable && process.platform === "win32";

  const set = (next) => {
    state = { ...state, ...next };
    onChange();
  };

  function askRestart(version) {
    const step = updatePromptStep(prompt, { type: "ask", version });
    prompt = step.state;
    if (step.show) showRestartBox(step.show);
    else if (prompt.held) log("atualizacao", true, `aviso ${version} guardado (Henry em tela cheia)`);
  }

  // A página avisou que a tela cheia do Henry abriu/fechou (ou recarregou: fechada). Fechou com aviso guardado → mostra.
  function setHold(held) {
    const step = updatePromptStep(prompt, { type: "hold", held });
    prompt = step.state;
    if (step.show && state.state === "pronta") showRestartBox(step.show);
  }

  function showRestartBox(version) {
    const options = {
      type: "info",
      buttons: ["Reiniciar agora", "Depois"],
      defaultId: 0,
      cancelId: 1,
      title: "CRM Matheus Machado",
      message: `Nova versão ${version} pronta`,
      detail: "Reiniciar agora instala e abre de novo (uns segundos). Depois: ela entra quando você Sair do app."
    };
    dialog.showMessageBox(options).then(({ response }) => {
      if (response === 0) install("reiniciar_agora");
      else log("atualizacao", true, `depois ${version} (instala ao Sair)`);
    });
  }

  function install(reason) {
    if (!autoUpdater || state.state !== "pronta") return;
    log("atualizacao", true, `instalando ${state.version} ${reason}`);
    beforeInstall();
    autoUpdater.quitAndInstall(true, true); // silencioso e reabre o app depois
  }

  function wire() {
    ({ autoUpdater } = require("electron-updater"));
    autoUpdater.logger = null; // o log do app é o acoes.log (abaixo, só o essencial)
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.setFeedURL({ provider: "generic", url: UPDATE_FEED_URL, channel: "latest" });

    autoUpdater.on("checking-for-update", () => set({ state: "procurando" }));
    autoUpdater.on("update-not-available", (info) => {
      log("atualizacao", true, `sem_novidade (atual ${app.getVersion()}, publicada ${info?.version || "?"})`);
      set({ state: "parado" });
      if (manual) notify("CRM Matheus Machado", `Você já está na versão mais nova (${app.getVersion()}).`);
      manual = false;
    });
    autoUpdater.on("update-available", (info) => {
      lastPercentLogged = -1;
      log("atualizacao", true, `encontrada ${info?.version || "?"} baixando`);
      set({ state: "baixando", version: String(info?.version || ""), percent: 0 });
    });
    autoUpdater.on("download-progress", (progress) => {
      const percent = Math.floor(Number(progress?.percent) || 0);
      const step = Math.floor(percent / 25) * 25; // log a cada 25%
      if (step > lastPercentLogged && step < 100) {
        lastPercentLogged = step;
        log("atualizacao", true, `baixando ${state.version} ${step}%`);
      }
      if (percent !== state.percent) set({ percent });
    });
    autoUpdater.on("update-downloaded", (info) => {
      const version = String(info?.version || state.version || "");
      manual = false;
      log("atualizacao", true, `pronta ${version} (SHA-512 conferido)`);
      set({ state: "pronta", version, percent: 100 });
      notify("CRM Matheus Machado", `Nova versão ${version} pronta — clique para Reiniciar agora ou Depois.`, () => askRestart(version));
    });
    autoUpdater.on("error", (error) => {
      log("atualizacao", false, `erro ${updateErrorDetail(error)}`);
      if (manual) notify("CRM Matheus Machado", "Não consegui procurar atualização agora. Tento de novo mais tarde.");
      manual = false;
      // Se já tinha baixado, continua pronta (instala ao Sair); senão volta a "Procurar atualização".
      if (state.state !== "pronta") set({ state: "parado" });
    });
  }

  function check(reason) {
    if (!active) {
      if (reason === "bandeja") notify("CRM Matheus Machado", "Atualização automática só no app instalado (instalador .exe).");
      return;
    }
    if (state.state === "procurando" || state.state === "baixando") return;
    if (state.state === "pronta") {
      askRestart(state.version);
      return;
    }
    manual = reason === "bandeja";
    log("atualizacao", true, `procurando (${reason}) versao ${app.getVersion()}`);
    autoUpdater.checkForUpdates().catch(() => {}); // o erro chega pelo evento "error" (registrado acima)
  }

  function start() {
    if (!active) {
      log("atualizacao", true, `desligada (${portable ? "versao_portatil" : app.isPackaged ? process.platform : "desenvolvimento"})`);
      return;
    }
    try {
      wire();
    } catch (error) {
      log("atualizacao", false, `sem_atualizador ${updateErrorDetail(error)}`);
      return;
    }
    setTimeout(() => check("ao_abrir"), UPDATE_FIRST_CHECK_MS);
    timer = setInterval(() => check("a_cada_4h"), UPDATE_INTERVAL_MS);
  }

  function trayItem() {
    const item = updateTrayItem(state);
    return { label: item.label, enabled: item.enabled, click: () => (item.install ? install("bandeja") : check("bandeja")) };
  }

  return { start, check, trayItem, setHold, stop: () => clearInterval(timer), isReady: () => state.state === "pronta" };
}

module.exports = { createUpdater };
