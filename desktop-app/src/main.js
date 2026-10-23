// App de desktop do dono (Windows): abre o CRM de produção por dentro, com o Henry sempre ligado (pedido do dono em
// 2026-10-23 — docs/BUSINESS_RULES.md HENRY-1, "App de desktop"). Nenhuma chave/segredo aqui: o login é o do próprio CRM
// (cookies guardados na sessão persistente "persist:mm-crm"). Regras de segurança em ./core.js.
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  session,
  shell
} = require("electron");
const { ALLOWED_ORIGINS, CRM_HOME, classifyNavigation, formatLogLine, isAllowedOrigin, shouldGrantPermission, validateAction } = require("./core");
const { setMonitorPower } = require("./screen");
const { synthesize } = require("./piper");
const { createWakeEngine, registerWakeScheme } = require("./wake-engine");

const APP_ID = "br.com.matheusmachadoimoveis.crm";
const PARTITION = "persist:mm-crm";
const SHORTCUT = "CommandOrControl+Shift+H";
const ICON = path.join(__dirname, "..", "assets", "icon-512-mm.png");
const TRAY_ICON = path.join(__dirname, "..", "assets", "favicon-32-mm.png");
const LOG_MAX_BYTES = 1024 * 1024;

let mainWindow = null;
let tray = null;
let quitting = false;
let wakeEngine = null;

// Modelos de voz (Vosk + Piper, fase 1.1): no pacote ficam em resources/models (fora do asar: o Piper é um .exe);
// no desenvolvimento, em desktop-app/models (baixados por scripts/fetch-models.js).
const MODELS_DIR = app.isPackaged ? path.join(process.resourcesPath, "models") : path.join(__dirname, "..", "models");

registerWakeScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(start);
}

function logPath() {
  return path.join(app.getPath("userData"), "logs", "acoes.log");
}

// Registro local de cada ação da ponte (e de eventos do app). Passou de 1 MB → vira acoes.old.log.
function logAction(action, ok, detail = "") {
  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, file.replace(/\.log$/, ".old.log"));
    fs.appendFileSync(file, formatLogLine({ action, ok, detail }));
  } catch {
    // sem disco para o log: a ação segue
  }
}

function webPreferences() {
  return {
    preload: path.join(__dirname, "preload.js"),
    partition: PARTITION,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required",
    spellcheck: true,
    additionalArguments: [`--mm-allowed-origins=${ALLOWED_ORIGINS.join(",")}`, `--mm-app-version=${app.getVersion()}`]
  };
}

function openOutside(url) {
  shell.openExternal(url).catch(() => logAction("abrir_fora", false, url));
}

// Navegação: CRM fica no app; o resto vai para o sistema (navegador, Spotify, e-mail…); o que não for reconhecido é bloqueado.
function guardContents(contents) {
  contents.on("will-navigate", (event, url) => {
    const kind = classifyNavigation(url);
    if (kind === "app") return;
    event.preventDefault();
    if (kind === "external") openOutside(url);
  });
  // Redirecionamento para fora (ex.: autorização do Spotify em "Conectar") também vai para o navegador.
  contents.on("will-redirect", (event, url) => {
    const kind = classifyNavigation(url);
    if (kind === "app") return;
    event.preventDefault();
    if (kind === "external") openOutside(url);
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const kind = classifyNavigation(url);
    if (kind === "app") {
      return { action: "allow", overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, webPreferences: webPreferences() } };
    }
    if (kind === "external") openOutside(url);
    return { action: "deny" };
  });
  contents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F5") {
      event.preventDefault();
      contents.reload();
    }
  });
}

function setupSession() {
  const crm = session.fromPartition(PARTITION);
  crm.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = details?.requestingUrl || contents?.getURL() || "";
    callback(shouldGrantPermission({ permission, origin, mediaTypes: details?.mediaTypes }));
  });
  crm.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    const origin = requestingOrigin || details?.requestingUrl || contents?.getURL() || "";
    return shouldGrantPermission({ permission, origin, mediaTypes: details?.mediaType ? [details.mediaType] : undefined });
  });
  return crm;
}

function createWindow({ hidden = false } = {}) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: !hidden,
    icon: ICON,
    title: "Matheus Machado Corretor de Imóveis",
    autoHideMenuBar: true,
    backgroundColor: "#0b1f3a",
    webPreferences: webPreferences()
  });
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault(); // fechar = esconder na bandeja (Sair pelo menu da bandeja)
    mainWindow.hide();
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navegação cancelada (normal)
    logAction("falha_ao_carregar", false, `${code}`);
    setTimeout(() => mainWindow && !mainWindow.isDestroyed() && mainWindow.loadURL(isAllowedOrigin(url) ? url : CRM_HOME), 15000);
  });
  mainWindow.loadURL(CRM_HOME);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function openAtLogin() {
  return app.getLoginItemSettings({ path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: ["--hidden"] }).openAtLogin;
}

function setOpenAtLogin(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: ["--hidden"] });
  logAction("abrir_com_windows", true, enabled ? "ligado" : "desligado");
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir", click: showWindow },
      { label: "Recarregar", click: () => mainWindow?.webContents.reload() },
      { type: "separator" },
      { label: "Abrir com o Windows", type: "checkbox", checked: openAtLogin(), click: (item) => setOpenAtLogin(item.checked) },
      { label: "Ver registro de ações", click: () => shell.openPath(logPath()) },
      { type: "separator" },
      { label: "Sair", click: () => { quitting = true; app.quit(); } }
    ])
  );
}

async function runAction(action, args) {
  if (action === "speakLocal") {
    const wav = await synthesize(args.text, MODELS_DIR);
    return { audio: { contentType: "audio/wav", base64: wav.toString("base64") } };
  }
  if (action === "openSpotify" || action === "openUrl") {
    await shell.openExternal(action === "openSpotify" ? args.uri : args.url);
    return;
  }
  if (action === "notify") {
    const notice = new Notification({ title: args.title, body: args.body, icon: ICON, silent: false });
    notice.on("click", showWindow);
    notice.show();
    return;
  }
  await setMonitorPower(action === "screenOff" ? "off" : "on");
  return null;
}

function setupBridge() {
  ipcMain.handle("mm:action", async (event, action, payload) => {
    const frame = event.senderFrame;
    const name = typeof action === "string" ? action.slice(0, 40) : "?";
    // Só a página do CRM (frame principal), nunca outra origem nem iframe.
    if (!frame || frame.parent || !isAllowedOrigin(frame.url)) {
      logAction(name, false, "origem_recusada");
      return { ok: false, error: "origem_recusada" };
    }
    const checked = validateAction(action, payload);
    if (!checked.ok) {
      logAction(name, false, checked.error);
      return { ok: false, error: checked.error };
    }
    // Log: destino (Spotify/endereço) ou, na voz local, só o tamanho — nunca o texto falado.
    const detail = checked.args.uri || checked.args.url || (checked.action === "speakLocal" ? `${checked.args.text.length} caracteres` : "");
    try {
      const result = await runAction(checked.action, checked.args);
      logAction(checked.action, true, detail);
      return { ok: true, ...(result || {}) };
    } catch (error) {
      logAction(checked.action, false, `${detail} ${error?.message || "erro"}`.trim());
      return { ok: false, error: "falhou" };
    }
  });
}

function start() {
  app.setAppUserModelId(APP_ID); // notificações do Windows com o nome do app
  Menu.setApplicationMenu(null);
  setupSession();
  setupBridge();
  wakeEngine = createWakeEngine({ modelsDir: MODELS_DIR, log: logAction });
  app.on("web-contents-created", (_event, contents) => guardContents(contents));
  powerSaveBlocker.start("prevent-app-suspension"); // o app não é suspenso; o monitor ainda pode apagar
  createWindow({ hidden: process.argv.includes("--hidden") });

  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.setToolTip("Matheus Machado Corretor de Imóveis");
  tray.on("click", showWindow);
  buildTrayMenu();

  const registered = globalShortcut.register(SHORTCUT, () => {
    showWindow();
    mainWindow.webContents.send("mm:activate-henry");
    logAction("atalho_henry", true);
  });
  if (!registered) logAction("atalho_henry", false, "Ctrl+Shift+H já usado por outro programa");
  logAction("app_aberto", true, app.getVersion());
}

app.on("window-all-closed", () => {
  // Fica na bandeja: só "Sair" encerra.
});

app.on("before-quit", () => {
  quitting = true;
  session.fromPartition(PARTITION).cookies.flushStore().catch(() => {});
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  wakeEngine?.stop();
});
