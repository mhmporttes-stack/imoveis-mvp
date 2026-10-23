// Ponte do app de desktop (sandbox, contextIsolation). Expõe window.mmDesktop SÓ quando a página é a origem do CRM
// (lista vinda do main.js por argumento). O main.js confere a origem de novo em cada chamada — esta checagem é só a
// primeira barreira. Lista FECHADA de ações; nada de comando arbitrário.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function readArg(name) {
  const prefix = `--${name}=`;
  const found = (process.argv || []).find((item) => typeof item === "string" && item.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

const allowedOrigins = readArg("mm-allowed-origins").split(",").filter(Boolean);
const appVersion = readArg("mm-app-version");

if (allowedOrigins.includes(window.location.origin)) {
  let wakeListeners = 0;
  const run = (action, payload = {}) => ipcRenderer.invoke("mm:action", action, payload);
  contextBridge.exposeInMainWorld("mmDesktop", {
    isDesktopApp: true,
    version: appVersion,
    openSpotify: (uri) => run("openSpotify", { uri }),
    openUrl: (url) => run("openUrl", { url }),
    notify: (title, body) => run("notify", { title, body }),
    screenOff: () => run("screenOff"),
    screenOn: () => run("screenOn"),
    // Fase 1.1: voz de reserva no PC (Piper). Devolve { ok, audio: { contentType: "audio/wav", base64 } } ou { ok: false }.
    speakLocal: (text) => run("speakLocal", { text }),
    // Atalho global (Ctrl+Shift+H): o app avisa a página para acionar o Henry. Devolve a função que cancela.
    onActivate: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = () => callback();
      ipcRenderer.on("mm:activate-henry", listener);
      return () => ipcRenderer.removeListener("mm:activate-henry", listener);
    },
    // Fase 1.1: o app ouviu "Henry" (Vosk, offline). Assinar LIGA a escuta no app; cancelar a última assinatura DESLIGA
    // (o microfone do app fecha). O callback recebe só { phrase } — nunca áudio.
    // 1.2.1: options.wakeWord = palavra de chamada ("henry", "ei-henry", "ola-henry", "ok-henry" ou "custom:<palavra>";
    // o app confere no vocabulário do modelo) e options.onStatus({ label, ok, missing }) = qual palavra o app está usando.
    onWake: (callback, options) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, info) => callback({ phrase: typeof info?.phrase === "string" ? info.phrase : "" });
      const onStatus = typeof options?.onStatus === "function" ? options.onStatus : null;
      const statusListener = onStatus
        ? (_event, info) =>
            onStatus({
              label: typeof info?.label === "string" ? info.label : "",
              ok: info?.ok === true,
              missing: Array.isArray(info?.missing) ? info.missing.filter((item) => typeof item === "string").slice(0, 5) : []
            })
        : null;
      const wakeWord = typeof options?.wakeWord === "string" ? options.wakeWord.slice(0, 80) : "henry";
      ipcRenderer.on("mm:wake", listener);
      if (statusListener) ipcRenderer.on("mm:wake-word", statusListener);
      wakeListeners += 1;
      if (wakeListeners === 1) ipcRenderer.send("mm:wake-listen", true, { wakeWord });
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        ipcRenderer.removeListener("mm:wake", listener);
        if (statusListener) ipcRenderer.removeListener("mm:wake-word", statusListener);
        wakeListeners -= 1;
        if (wakeListeners === 0) ipcRenderer.send("mm:wake-listen", false);
      };
    }
  });
}
