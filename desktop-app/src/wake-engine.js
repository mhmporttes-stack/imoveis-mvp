// Escuta do nome "Henry" no app (fase 1.1, dono 2026-10-23 — docs/BUSINESS_RULES.md HENRY-1 "App de desktop").
// Uma janela ESCONDIDA (página local mm-wake://app, sessão própria, sem acesso ao CRM) roda o Vosk offline; este módulo:
//   - liga a escuta só enquanto a página do CRM assina mmDesktop.onWake (o liga/desliga da tela "Voz e personalidade");
//   - pausa enquanto o CRM está tocando som (o Henry falando — a interrupção durante a fala é do próprio CRM), com trava
//     de segurança: nunca fica pausada para sempre (core.js wakePauseStep);
//   - decide pelo core.js (wakeSequenceStep/wakePartialStep) e avisa o CRM com o evento "mm:wake" (nunca áudio).
// Versão 1.2.1: palavra de chamada escolhida no CRM (buildWakeConfig, conferida no vocabulário do modelo), log de
// diagnóstico com limite de frequência (nível do microfone, dispositivo, erros, pausas) e modo "Diagnóstico do nome"
// (2 min, texto reconhecido com gramática livre — nunca áudio).
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { BrowserWindow, ipcMain, protocol, session } = require("electron");
const {
  WAKE_COOLDOWN_MS,
  WAKE_MIN_CONFIDENCE,
  WAKE_ORIGIN,
  WAKE_PAUSE_INITIAL,
  buildWakeConfig,
  formatLevelDetail,
  formatWakeWords,
  isAllowedOrigin,
  levelLogIntervalMs,
  logLimitStep,
  sanitizeWakeReport,
  shouldGrantWakePermission,
  wakePartialStep,
  wakePauseStep,
  wakeSequenceStep
} = require("./core");
const { loadVoskVocabulary } = require("./vosk-vocab");

const SCHEME = "mm-wake";
const PARTITION = "mm-wake"; // sem "persist:": nada da escuta fica no disco
const VOSK_MODEL = "vosk-model-small-pt-0.3.tar.gz";
const PAUSE_POLL_MS = 500; // confere o som do CRM mesmo sem evento (o evento sozinho já deixou dúvida)
const RESTART_AFTER_CRASH_MS = 10000;
const RESTART_AFTER_ERROR_MS = 30000;
const RESTART_AFTER_DEVICE_CHANGE_MS = 3000;
const DIAGNOSTIC_MS = 120000;
// Limites do log (por chave): pausas/retomadas no máx. 20 a cada 10 min; erro igual 1 por minuto; "quase" 1 a cada 5 s;
// texto do diagnóstico no máx. 60 por sessão de 2 min; reinício automático no máx. 6 por hora.
const LIMITS = Object.freeze({
  pause: { maxPerWindow: 20, windowMs: 600000 },
  error: { minIntervalMs: 60000 },
  near: { minIntervalMs: 5000 },
  diag: { maxPerWindow: 60, windowMs: DIAGNOSTIC_MS },
  device: { minIntervalMs: 60000 },
  restart: { maxPerWindow: 6, windowMs: 3600000 }
});
const FATAL_ERRORS = new Set(["microfone", "modelo", "contexto", "inicio"]);
const TYPES = Object.freeze({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".gz": "application/gzip" });

// Antes do app ficar pronto (exigência do Electron).
function registerWakeScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

function createWakeEngine({ modelsDir, log, onChange = () => {} }) {
  const subscribers = new Set();
  let win = null;
  let pause = { ...WAKE_PAUSE_INITIAL };
  let pollTimer = null;
  let restartTimer = null;
  let lastWakeAt = 0;
  let lastStatus = "";
  let startedAt = 0;
  let sequence = {};
  let partial = {};
  let limits = {};
  let lastLevelAt = -Infinity;
  let wakeChoice = "henry";
  let config = buildWakeConfig("henry");
  let configReady = Promise.resolve(config);
  let vocabulary = null; // Promise<Set|null>, carregado uma vez
  let diagnosticUntil = 0;
  let diagnosticTimer = null;
  const files = {
    "/wake.html": path.join(__dirname, "wake", "wake.html"),
    "/wake.js": path.join(__dirname, "wake", "wake.js"),
    "/vosk.js": require.resolve("vosk-browser/dist/vosk.js"),
    "/model.tar.gz": path.join(modelsDir, VOSK_MODEL)
  };
  const available = () => fs.existsSync(files["/model.tar.gz"]);

  // Log com limite de frequência por chave ("(+N omitidas)" quando segurou alguma).
  function limitedLog(key, policy, action, ok, detail) {
    const step = logLimitStep(limits, key, Date.now(), policy);
    limits = step.state;
    if (step.allow) log(action, ok, step.suppressed ? `${detail} (+${step.suppressed} omitidas)` : detail);
    return step.allow;
  }

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

  function sendToPage(channel, value) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, value);
  }

  function sendToSubscribers(channel, value) {
    for (const contents of subscribers) if (!contents.isDestroyed()) contents.send(channel, value);
  }

  function loadVocabulary() {
    if (!vocabulary) {
      vocabulary = loadVoskVocabulary(files["/model.tar.gz"]).catch((error) => {
        log("escuta_nome", false, `vocabulario_ilegivel ${error?.message || ""}`.trim());
        return null;
      });
    }
    return vocabulary;
  }

  // Palavra de chamada → gramática. Palavra fora do vocabulário do modelo: volta para "Henry" e avisa (log + CRM).
  async function resolveConfig(choice) {
    const words = await loadVocabulary();
    const next = buildWakeConfig(choice, words ? (word) => words.has(word) : null);
    config = next;
    const detail = `palavra "${next.label}" (${next.phrases.slice(0, 8).join(", ")}${next.phrases.length > 8 ? ", ..." : ""})`;
    if (next.fallback) log("escuta_nome", false, `palavra_recusada ${next.missing.length ? `fora_do_vocabulario: ${next.missing.join(" ")}` : next.error} usando Henry`);
    log("escuta_nome", true, detail);
    sendToSubscribers("mm:wake-word", { label: next.label, ok: !next.fallback, missing: [...next.missing] });
    return next;
  }

  // CRM tocando som (voz do Henry, aviso) → pausa já; parou → volta depois de um instante; trava de 2 min.
  function audibleNow() {
    return [...subscribers].some((contents) => !contents.isDestroyed() && contents.isCurrentlyAudible());
  }

  function tickPause() {
    if (!win) return;
    const step = wakePauseStep(pause, { now: Date.now(), audible: audibleNow() });
    pause = step.state;
    if (!step.event) return;
    sendToPage("mm:wake-pause", pause.paused);
    if (step.event.type === "pausa") limitedLog("pausa", LIMITS.pause, "escuta_nome", true, `pausa ${step.event.reason}`);
    else limitedLog("pausa", LIMITS.pause, "escuta_nome", step.event.reason !== "tempo_maximo", `retomada ${step.event.reason} ${(step.event.ms / 1000).toFixed(1)}s`);
  }

  function start() {
    if (win || !subscribers.size) return;
    clearTimeout(restartTimer);
    restartTimer = null;
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
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required"
      }
    });
    const current = win;
    current.webContents.on("will-navigate", (event) => event.preventDefault());
    current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    current.webContents.on("render-process-gone", (_event, details) => {
      log("escuta_nome", false, `travou ${details?.reason || ""}`.trim());
      scheduleRestart("travou", RESTART_AFTER_CRASH_MS);
    });
    current.on("closed", () => {
      if (win === current) win = null;
    });
    pause = { ...WAKE_PAUSE_INITIAL };
    sequence = {};
    partial = {};
    startedAt = Date.now();
    lastLevelAt = -Infinity;
    configReady = resolveConfig(wakeChoice);
    clearInterval(pollTimer);
    pollTimer = setInterval(tickPause, PAUSE_POLL_MS);
    tickPause();
    current.loadURL(`${WAKE_ORIGIN}/wake.html`);
    log("escuta_nome", true, "ligada");
    onChange();
  }

  function stop() {
    clearInterval(pollTimer);
    pollTimer = null;
    if (!win) return;
    const current = win;
    win = null;
    if (!current.isDestroyed()) current.destroy(); // fecha o microfone do app
    lastStatus = "";
    if (diagnosticUntil) setDiagnostic(false);
    log("escuta_nome", true, "desligada");
    onChange();
  }

  // Erro do microfone/Vosk, troca de microfone ou travamento: desliga e religa sozinha (no máx. 6 vezes por hora).
  function scheduleRestart(reason, delay) {
    if (restartTimer) return;
    const step = logLimitStep(limits, "reinicio", Date.now(), LIMITS.restart);
    limits = step.state;
    stop();
    if (!step.allow) {
      limitedLog("reinicio_limite", LIMITS.error, "escuta_nome", false, `sem_reinicio_automatico ${reason} (6 por hora; desligue e ligue em Voz e personalidade)`);
      return;
    }
    log("escuta_nome", true, `reinicio ${reason} em ${Math.round(delay / 1000)}s`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      start();
    }, delay);
  }

  function unsubscribe(contents) {
    if (!subscribers.delete(contents)) return;
    if (!subscribers.size) {
      clearTimeout(restartTimer);
      restartTimer = null;
      stop();
    }
  }

  const wired = new WeakSet();
  function subscribe(contents, choice) {
    const nextChoice = typeof choice === "string" && choice ? choice.slice(0, 80) : "henry";
    const changed = nextChoice !== wakeChoice;
    wakeChoice = nextChoice;
    if (!subscribers.has(contents)) {
      subscribers.add(contents);
      if (!wired.has(contents)) {
        wired.add(contents);
        contents.on("audio-state-changed", tickPause);
        contents.once("destroyed", () => unsubscribe(contents));
        // Página recarregada/trocada: a assinatura antiga morreu com ela (a página nova assina de novo).
        contents.on("did-start-navigation", (details) => {
          if (details?.isMainFrame && !details?.isSameDocument) unsubscribe(contents);
        });
      }
    }
    if (changed && win) {
      stop(); // palavra nova = gramática nova: religa a escuta
      start();
      return;
    }
    if (win) configReady.then((current) => !contents.isDestroyed() && contents.send("mm:wake-word", { label: current.label, ok: !current.fallback, missing: [...current.missing] }));
    start();
  }

  // Modo "Diagnóstico do nome" (menu da bandeja): por 2 min registra o TEXTO que o Vosk reconheceu (gramática livre) e o
  // que a gramática do nome ouviu, com a confiança. Nunca áudio. Desliga sozinho.
  function setDiagnostic(on) {
    clearTimeout(diagnosticTimer);
    diagnosticTimer = null;
    if (on && !win) {
      log("nome_diagnostico", false, "escuta_desligada (ligue \"Ouvir Henry sem atalho\" e deixe o CRM aberto)");
      onChange();
      return false;
    }
    const was = Boolean(diagnosticUntil);
    diagnosticUntil = on ? Date.now() + DIAGNOSTIC_MS : 0;
    sendToPage("mm:wake-diagnostic", Boolean(on));
    if (on) {
      limits = { ...limits, diag: undefined };
      log("nome_diagnostico", true, `ligado 2 min, palavra "${config.label}", confianca minima ${WAKE_MIN_CONFIDENCE}`);
      diagnosticTimer = setTimeout(() => setDiagnostic(false), DIAGNOSTIC_MS);
    } else if (was) {
      log("nome_diagnostico", true, "desligado");
    }
    onChange();
    return Boolean(on);
  }

  const isDiagnostic = () => diagnosticUntil > Date.now();

  function fire(hit, source) {
    const now = Date.now();
    if (now - lastWakeAt < WAKE_COOLDOWN_MS) return;
    lastWakeAt = now;
    sendToSubscribers("mm:wake", { phrase: hit.phrase });
    const confidence = Number.isFinite(hit.confidence) ? hit.confidence.toFixed(2) : "-";
    log("onWake", true, `${hit.phrase} ${confidence} ${source}`); // só a palavra e a confiança; nunca áudio
  }

  const fromWakePage = (event) => win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame?.url?.startsWith(`${WAKE_ORIGIN}/`);

  ipcMain.on("mm:wake-listen", (event, on, options) => {
    const frame = event.senderFrame;
    if (!frame || frame.parent || !isAllowedOrigin(frame.url)) {
      log("onWake", false, "origem_recusada");
      return;
    }
    if (on === true) subscribe(event.sender, options && typeof options === "object" ? options.wakeWord : undefined);
    else unsubscribe(event.sender);
  });

  ipcMain.handle("mm:wake-config", async (event) => {
    if (!fromWakePage(event)) return null;
    const current = await configReady;
    return { modelUrl: `${WAKE_ORIGIN}/model.tar.gz`, grammar: [...current.grammar], diagnostic: isDiagnostic() };
  });

  ipcMain.on("mm:wake-status", (event, state, detail) => {
    if (!fromWakePage(event)) return;
    const value = `${String(state).slice(0, 20)} ${String(detail || "").slice(0, 120)}`.trim();
    if (value === lastStatus) return;
    lastStatus = value;
    log("escuta_nome", state !== "erro", value);
  });

  ipcMain.on("mm:wake-report", (event, kind, data) => {
    if (!fromWakePage(event)) return;
    const report = sanitizeWakeReport(kind, data);
    if (!report) return;
    if (report.kind === "nivel") {
      const now = Date.now();
      const interval = levelLogIntervalMs({ sinceStartMs: now - startedAt, diagnostic: isDiagnostic() });
      if (now - lastLevelAt < interval - 500) return;
      lastLevelAt = now;
      log("escuta_nome", report.frames > 0, formatLevelDetail({ ...report, paused: report.paused || pause.paused }));
      return;
    }
    if (report.kind === "dispositivo") {
      const rate = report.deviceRate ? `${report.deviceRate} Hz -> ${report.contextRate} Hz` : `${report.contextRate} Hz`;
      const which = report.usingDefault ? "padrao" : `NAO_e_o_padrao (padrao: ${report.defaultLabel || "?"})`;
      limitedLog("dispositivo", LIMITS.device, "escuta_nome", true, `microfone "${report.label}" ${which} ${rate} ${report.channels || "?"} canal entradas ${report.inputs}`);
      return;
    }
    if (report.kind === "diag") {
      if (!isDiagnostic()) return;
      limitedLog("diag", LIMITS.diag, "nome_diag", true, `"${report.text}" | ${formatWakeWords(report.words) || "-"}`);
      return;
    }
    if (report.kind === "aviso") {
      limitedLog(`aviso:${report.message}`, LIMITS.error, "escuta_nome", true, `aviso ${report.where} ${report.message}`);
      if (report.message === "dispositivos_mudaram") scheduleRestart("microfone_trocado", RESTART_AFTER_DEVICE_CHANGE_MS);
      return;
    }
    limitedLog(`erro:${report.where}:${report.message}`, LIMITS.error, "escuta_nome", false, `erro ${report.where} ${report.message}`);
    if (FATAL_ERRORS.has(report.where)) scheduleRestart(`erro_${report.where}`, RESTART_AFTER_ERROR_MS);
  });

  ipcMain.on("mm:wake-result", (event, words) => {
    if (!fromWakePage(event)) return;
    const list = Array.isArray(words) ? words : [];
    if (isDiagnostic()) limitedLog("diag", LIMITS.diag, "nome_gramatica", true, formatWakeWords(list) || "-");
    if (pause.paused) return;
    const step = wakeSequenceStep(sequence, { now: Date.now(), words: list, phrases: config.phrases });
    sequence = step.state;
    if (step.hit) fire(step.hit, "final");
    else if (step.near) limitedLog("quase", LIMITS.near, "escuta_nome", true, `quase ${step.near.phrase} ${step.near.confidence.toFixed(2)} (minimo ${WAKE_MIN_CONFIDENCE})`);
  });

  // Resultado parcial do Vosk (texto, sem confiança): acorda mais rápido, sem esperar o fim da fala.
  ipcMain.on("mm:wake-partial", (event, text) => {
    if (!fromWakePage(event) || pause.paused || typeof text !== "string") return;
    const step = wakePartialStep(partial, { text: text.slice(0, 200), phrases: config.phrases });
    partial = step.state;
    if (step.hit) fire(step.hit, "parcial");
  });

  return { stop, subscribe, unsubscribe, setDiagnostic, isDiagnostic, isRunning: () => Boolean(win) };
}

module.exports = { registerWakeScheme, createWakeEngine, VOSK_MODEL };
