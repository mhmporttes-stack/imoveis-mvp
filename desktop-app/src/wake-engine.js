// Escuta do nome "Henry" no app (fase 1.1, dono 2026-10-23 — docs/BUSINESS_RULES.md HENRY-1 "App de desktop").
// Uma janela ESCONDIDA (página local mm-wake://app, sessão própria, sem acesso ao CRM) roda o Vosk offline; este módulo:
//   - liga a escuta só enquanto a página do CRM assina mmDesktop.onWake (o liga/desliga da tela "Voz e personalidade");
//   - pausa enquanto o CRM está tocando som (o Henry falando — a interrupção durante a fala é do próprio CRM);
//   - decide pelo core.js (detectWakeInResult) e avisa o CRM com o evento "mm:wake" (nunca áudio).
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, ipcMain, protocol, session } = require("electron");
const { WAKE_COOLDOWN_MS, WAKE_GRAMMAR, WAKE_ORIGIN, detectWakeInResult, isAllowedOrigin, shouldGrantWakePermission } = require("./core");

const SCHEME = "mm-wake";
const PARTITION = "mm-wake"; // sem "persist:": nada da escuta fica no disco
const VOSK_MODEL = "vosk-model-small-pt-0.3.tar.gz";
const RESUME_AFTER_SOUND_MS = 700;
const RESTART_AFTER_CRASH_MS = 10000;
const TYPES = Object.freeze({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".gz": "application/gzip" });

// Antes do app ficar pronto (exigência do Electron).
function registerWakeScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

function createWakeEngine({ modelsDir, log }) {
  const subscribers = new Set();
  let win = null;
  let paused = false;
  let resumeTimer = null;
  let lastWakeAt = 0;
  let lastStatus = "";
  const files = {
    "/wake.html": path.join(__dirname, "wake", "wake.html"),
    "/wake.js": path.join(__dirname, "wake", "wake.js"),
    "/vosk.js": require.resolve("vosk-browser/dist/vosk.js"),
    "/model.tar.gz": path.join(modelsDir, VOSK_MODEL)
  };
  const available = () => fs.existsSync(files["/model.tar.gz"]);

  const wakeSession = session.fromPartition(PARTITION);
  // Só os 4 arquivos fixos acima; qualquer outro endereço = 404.
  // Leitura pelo fs (enxerga dentro do app.asar, onde ficam wake.* e o vosk.js no pacote).
  wakeSession.protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const file = url.host === "app" ? files[url.pathname] : null;
    if (!file || !fs.existsSync(file)) return new Response("", { status: 404 });
    const body = await fs.promises.readFile(file);
    return new Response(body, { headers: { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Content-Length": String(body.length) } });
  });
  wakeSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(shouldGrantWakePermission({ permission, origin: details?.requestingUrl || contents?.getURL() || "", mediaTypes: details?.mediaTypes }));
  });
  wakeSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    shouldGrantWakePermission({ permission, origin: requestingOrigin || contents?.getURL() || "", mediaTypes: details?.mediaType ? [details.mediaType] : undefined })
  );

  function setPaused(value) {
    if (paused === value) return;
    paused = value;
    if (win && !win.isDestroyed()) win.webContents.send("mm:wake-pause", paused);
  }

  // CRM tocando som (voz do Henry, aviso) → pausa já; parou → volta depois de um instante.
  function refreshPause() {
    const audible = [...subscribers].some((contents) => !contents.isDestroyed() && contents.isCurrentlyAudible());
    clearTimeout(resumeTimer);
    if (audible) setPaused(true);
    else resumeTimer = setTimeout(() => setPaused(false), RESUME_AFTER_SOUND_MS);
  }

  function start() {
    if (win || !subscribers.size) return;
    if (!available()) {
      log("escuta_nome", false, "modelo_ausente");
      return;
    }
    win = new BrowserWindow({
      show: false,
      width: 320,
      height: 120,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "wake", "wake-preload.js"),
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    const current = win;
    current.webContents.on("will-navigate", (event) => event.preventDefault());
    current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    current.webContents.on("render-process-gone", () => {
      log("escuta_nome", false, "travou");
      stop();
      setTimeout(start, RESTART_AFTER_CRASH_MS);
    });
    current.on("closed", () => {
      if (win === current) win = null;
    });
    paused = false;
    refreshPause();
    current.loadURL(`${WAKE_ORIGIN}/wake.html`);
    log("escuta_nome", true, "ligada");
  }

  function stop() {
    if (!win) return;
    const current = win;
    win = null;
    if (!current.isDestroyed()) current.destroy(); // fecha o microfone do app
    lastStatus = "";
    log("escuta_nome", true, "desligada");
  }

  function unsubscribe(contents) {
    if (!subscribers.delete(contents)) return;
    if (!subscribers.size) stop();
  }

  const wired = new WeakSet();
  function subscribe(contents) {
    if (subscribers.has(contents)) return;
    subscribers.add(contents);
    if (!wired.has(contents)) {
      wired.add(contents);
      contents.on("audio-state-changed", refreshPause);
      contents.once("destroyed", () => unsubscribe(contents));
      // Página recarregada/trocada: a assinatura antiga morreu com ela (a página nova assina de novo).
      contents.on("did-start-navigation", (details) => {
        if (details?.isMainFrame && !details?.isSameDocument) unsubscribe(contents);
      });
    }
    start();
  }

  const fromWakePage = (event) => win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame?.url?.startsWith(`${WAKE_ORIGIN}/`);

  ipcMain.on("mm:wake-listen", (event, on) => {
    const frame = event.senderFrame;
    if (!frame || frame.parent || !isAllowedOrigin(frame.url)) {
      log("onWake", false, "origem_recusada");
      return;
    }
    if (on === true) subscribe(event.sender);
    else unsubscribe(event.sender);
  });

  ipcMain.handle("mm:wake-config", (event) => (fromWakePage(event) ? { modelUrl: `${WAKE_ORIGIN}/model.tar.gz`, grammar: [...WAKE_GRAMMAR] } : null));

  ipcMain.on("mm:wake-status", (event, state, detail) => {
    if (!fromWakePage(event)) return;
    const value = `${String(state).slice(0, 20)} ${String(detail || "").slice(0, 120)}`.trim();
    if (value === lastStatus) return;
    lastStatus = value;
    log("escuta_nome", state !== "erro", value);
  });

  ipcMain.on("mm:wake-result", (event, words) => {
    if (!fromWakePage(event) || paused) return;
    const hit = detectWakeInResult({ result: Array.isArray(words) ? words : [] });
    if (!hit) return;
    const now = Date.now();
    if (now - lastWakeAt < WAKE_COOLDOWN_MS) return;
    lastWakeAt = now;
    for (const contents of subscribers) if (!contents.isDestroyed()) contents.send("mm:wake", { phrase: hit.phrase });
    log("onWake", true, `${hit.phrase} ${hit.confidence.toFixed(2)}`); // só a palavra e a confiança; nunca áudio
  });

  return { stop, subscribe, unsubscribe, isRunning: () => Boolean(win) };
}

module.exports = { registerWakeScheme, createWakeEngine, VOSK_MODEL };
