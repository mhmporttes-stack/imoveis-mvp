// Ponte da janela escondida de escuta do nome (só a página local mm-wake://app). Lista fechada: ler a configuração,
// mandar as palavras reconhecidas (final e parcial), mandar o estado e os números de diagnóstico (nível, microfone,
// erros, texto do modo diagnóstico) e receber pausa/diagnóstico. Nada de áudio passa por aqui.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

if (window.location.origin === "mm-wake://app") {
  contextBridge.exposeInMainWorld("mmWake", {
    config: () => ipcRenderer.invoke("mm:wake-config"),
    result: (words) => ipcRenderer.send("mm:wake-result", words),
    partial: (text) => ipcRenderer.send("mm:wake-partial", String(text).slice(0, 200)),
    status: (state, detail = "") => ipcRenderer.send("mm:wake-status", String(state), String(detail)),
    report: (kind, data) => ipcRenderer.send("mm:wake-report", String(kind), data && typeof data === "object" ? data : {}),
    onPause: (callback) => ipcRenderer.on("mm:wake-pause", (_event, value) => callback(Boolean(value))),
    onDiagnostic: (callback) => ipcRenderer.on("mm:wake-diagnostic", (_event, value) => callback(Boolean(value)))
  });
}
