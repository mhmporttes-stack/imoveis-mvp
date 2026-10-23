// Ponte da janela escondida de escuta do nome (só a página local mm-wake://app). Lista fechada: ler a configuração,
// mandar as palavras reconhecidas, mandar o estado e receber pausa. Nada de áudio passa por aqui.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

if (window.location.origin === "mm-wake://app") {
  contextBridge.exposeInMainWorld("mmWake", {
    config: () => ipcRenderer.invoke("mm:wake-config"),
    result: (words) => ipcRenderer.send("mm:wake-result", words),
    status: (state, detail = "") => ipcRenderer.send("mm:wake-status", String(state), String(detail)),
    onPause: (callback) => ipcRenderer.on("mm:wake-pause", (_event, value) => callback(Boolean(value)))
  });
}
