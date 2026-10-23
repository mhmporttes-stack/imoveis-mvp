// Ponte da barra de título (sandbox, contextIsolation). Só existe na página local da barra — o CRM usa outro preload
// (preload.js, window.mmDesktop, lista fechada que NÃO ganhou nada com a barra). O main.js confere o remetente e o
// comando de novo em cada mensagem (core.js validateTitlebarMessage).
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const COMMANDS = ["minimize", "toggleMaximize", "close"];

if (window.location.protocol === "file:") {
  contextBridge.exposeInMainWorld("mmTitlebar", {
    send: (command) => {
      if (COMMANDS.includes(command)) ipcRenderer.send("mm:titlebar", command);
    },
    onState: (callback) => {
      if (typeof callback !== "function") return;
      ipcRenderer.on("mm:titlebar-state", (_event, state) =>
        callback({ visible: Boolean(state?.visible), pinned: Boolean(state?.pinned), maximized: Boolean(state?.maximized) })
      );
    }
  });
}
