// App de desktop do dono (Windows): abre o CRM de produção por dentro, com o Henry sempre ligado (pedido do dono em
// 2026-10-23 — docs/BUSINESS_RULES.md HENRY-1, "App de desktop"). Nenhuma chave/segredo aqui: o login é o do próprio CRM
// (cookies guardados na sessão persistente "persist:mm-crm"). Regras de segurança em ./core.js.
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const {
  app,
  BaseWindow,
  Menu,
  Notification,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  screen: electronScreen,
  session,
  shell,
  WebContentsView
} = require("electron");
const {
  ALLOWED_ORIGINS,
  CRM_HOME,
  TITLEBAR_HEIGHT,
  TITLEBAR_POLL_MS,
  TITLEBAR_SLIDE_MS,
  altTapStep,
  classifyNavigation,
  formatLogLine,
  isAllowedOrigin,
  isWindowHidden,
  parsePreferences,
  shouldGrantPermission,
  titlebarPointer,
  titlebarStep,
  validateAction,
  validateTitlebarMessage
} = require("./core");
const { setMonitorPower } = require("./screen");
const { synthesize } = require("./piper");
const { createWakeEngine, registerWakeScheme } = require("./wake-engine");
const { createUpdater } = require("./updater");

const APP_ID = "br.com.matheusmachadoimoveis.crm";
const PARTITION = "persist:mm-crm";
const SHORTCUT = "CommandOrControl+Shift+H";
const ICON = path.join(__dirname, "..", "assets", "icon-512-mm.png");
const TRAY_ICON = path.join(__dirname, "..", "assets", "favicon-32-mm.png");
const LOG_MAX_BYTES = 1024 * 1024;
const TITLE = "Matheus Machado Corretor de Imóveis";
// Barra de título própria (versão 1.2): página local, sessão própria sem disco, sem permissão nenhuma.
const TITLEBAR_HTML = path.join(__dirname, "titlebar", "titlebar.html");
const TITLEBAR_URL = pathToFileURL(TITLEBAR_HTML).href;
const TITLEBAR_PARTITION = "mm-titlebar";

// Janela sem a barra do Windows (frame: false) com duas views: o CRM (crmView) e, por cima, a barra do app (barView).
let mainWindow = null;
let crmView = null;
let barView = null;
let pendingMaximize = false;
let titlebar = { visible: false, hideAt: null };
let titlebarHideTimer = null;
let titlebarReveal = false;
let altArmed = false;
let preferences = parsePreferences("");
let tray = null;
let quitting = false;
let wakeEngine = null;
let updater = null;

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

function preferencesPath() {
  return path.join(app.getPath("userData"), "preferencias.json");
}

function loadPreferences() {
  try {
    preferences = parsePreferences(fs.readFileSync(preferencesPath(), "utf8"));
  } catch {
    preferences = parsePreferences(""); // primeira vez (ou arquivo ilegível): padrão
  }
}

function savePreferences() {
  try {
    const file = preferencesPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(preferences, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  } catch (error) {
    logAction("preferencias", false, error?.message || "erro_ao_salvar");
  }
}

function crmContents() {
  return crmView && !crmView.webContents.isDestroyed() ? crmView.webContents : null;
}

function webPreferences() {
  return {
    preload: path.join(__dirname, "preload.js"),
    partition: PARTITION,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    // Fica false de propósito (revisto em 1.3.1, app lento): minimizado, o Henry ouve o nome (Vosk), grava o pedido e decide o
    // fim da fala com timers de 100 ms; com throttling o Chromium os segura em 1 s (e em 1/min depois de 5 min oculto).
    // Efeito colateral: document.hidden nunca fica true aqui — por isso o app avisa a página (onWindowVisibility) e o CRM
    // pausa animações e consultas por components/page-visibility.js.
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

function titlebarPreferences() {
  return {
    preload: path.join(__dirname, "titlebar", "titlebar-preload.js"),
    partition: TITLEBAR_PARTITION,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: false
  };
}

function isPinned() {
  return preferences.titlebarAlwaysVisible && !mainWindow?.isFullScreen();
}

// Posição das views: barra fixa ("Mostrar barra de título sempre") empurra o CRM para baixo; oculta, ela desce POR CIMA.
function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { width, height } = mainWindow.getContentBounds();
  const top = isPinned() ? TITLEBAR_HEIGHT : 0;
  crmView.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
  barView.setBounds({ x: 0, y: 0, width, height: TITLEBAR_HEIGHT });
}

function sendTitlebarState() {
  if (!barView || barView.webContents.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) return;
  barView.webContents.send("mm:titlebar-state", { visible: titlebar.visible, pinned: isPinned(), maximized: mainWindow.isMaximized() || mainWindow.isFullScreen() });
}

// Lê o cursor e decide (core.js titlebarStep). A barra fica INVISÍVEL (setVisible(false)) quando fechada: nada fica por
// cima do CRM, e a faixa de 6 px do topo é só detectada pela posição do cursor — cliques ali vão para o CRM.
function updateTitlebar() {
  if (!mainWindow || mainWindow.isDestroyed() || !barView) return;
  const active = mainWindow.isVisible() && !mainWindow.isMinimized();
  let pointer = null;
  if (active) {
    const bounds = mainWindow.getBounds();
    pointer = titlebarPointer(electronScreen.getCursorScreenPoint(), bounds, electronScreen.getDisplayMatching(bounds).bounds);
  }
  const next = titlebarStep(titlebar, {
    now: Date.now(),
    pointer,
    active,
    reveal: titlebarReveal,
    alwaysVisible: preferences.titlebarAlwaysVisible,
    fullscreen: mainWindow.isFullScreen()
  });
  titlebarReveal = false;
  const changed = next.visible !== titlebar.visible;
  titlebar = next;
  if (!changed) return;
  clearTimeout(titlebarHideTimer);
  if (next.visible) {
    barView.setVisible(true);
    sendTitlebarState();
  } else {
    sendTitlebarState(); // sobe deslizando (CSS) e só então sai da janela
    titlebarHideTimer = setTimeout(() => !titlebar.visible && barView && barView.setVisible(false), TITLEBAR_SLIDE_MS + 30);
  }
}

function setTitlebarAlwaysVisible(enabled) {
  preferences = { ...preferences, titlebarAlwaysVisible: Boolean(enabled) };
  savePreferences();
  logAction("barra_titulo_sempre", true, enabled ? "ligado" : "desligado");
  layoutViews();
  updateTitlebar();
  sendTitlebarState();
  buildTrayMenu();
}

// Teclas da janela (no CRM e na barra): F11 = tela cheia; Alt sozinho = mostra a barra (não atrapalha Alt+Tab nem atalhos).
function attachWindowKeys(contents) {
  contents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11" && !input.isAutoRepeat) {
      event.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return;
    }
    const alt = altTapStep(altArmed, input);
    altArmed = alt.armed;
    if (alt.reveal) {
      titlebarReveal = true;
      updateTitlebar();
    }
  });
}

function createWindow({ hidden = false } = {}) {
  // Sem a barra do Windows (pedido do dono, 2026-10-23): frame: false mantém borda de redimensionar, encaixe e
  // animações do Windows 10 (thickFrame, padrão). Botões e arrastar ficam na barra própria (src/titlebar/).
  mainWindow = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    icon: ICON,
    title: TITLE,
    backgroundColor: "#0b1f3a"
  });
  crmView = new WebContentsView({ webPreferences: webPreferences() });
  crmView.setBackgroundColor("#0b1f3a");
  barView = new WebContentsView({ webPreferences: titlebarPreferences() });
  barView.setBackgroundColor("#00000000"); // translúcida por cima do CRM
  barView.setVisible(false);
  mainWindow.contentView.addChildView(crmView);
  mainWindow.contentView.addChildView(barView); // por último = por cima
  titlebar = { visible: false, hideAt: null };

  // A barra é página local: não navega para lugar nenhum e não abre janela.
  barView.webContents.on("will-navigate", (event) => event.preventDefault());
  barView.webContents.on("did-finish-load", sendTitlebarState);
  attachWindowKeys(crmView.webContents);
  attachWindowKeys(barView.webContents);

  // 1.3.1: minimizou/foi para a bandeja/voltou → a página pausa ou retoma animações e consultas (onWindowVisibility).
  for (const name of ["minimize", "restore", "hide", "show"]) mainWindow.on(name, sendWindowVisibility);
  crmView.webContents.on("did-finish-load", sendWindowVisibility);
  // Página recarregou/caiu: a tela cheia do Henry fechou junto (a página nova avisa de novo se abrir) — nada fica preso.
  crmView.webContents.on("did-navigate", () => updater?.setHold(false));
  crmView.webContents.on("render-process-gone", () => updater?.setHold(false));
  for (const name of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "restore"]) {
    mainWindow.on(name, () => {
      layoutViews();
      updateTitlebar();
      sendTitlebarState();
    });
  }
  mainWindow.on("focus", () => crmContents()?.focus());
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault(); // fechar = esconder na bandeja (Sair pelo menu da bandeja)
    mainWindow.hide();
  });
  mainWindow.on("closed", () => {
    for (const view of [crmView, barView]) if (view && !view.webContents.isDestroyed()) view.webContents.close();
    mainWindow = null;
    crmView = null;
    barView = null;
  });
  crmView.webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navegação cancelada (normal)
    logAction("falha_ao_carregar", false, `${code}`);
    setTimeout(() => crmContents()?.loadURL(isAllowedOrigin(url) ? url : CRM_HOME), 15000);
  });
  layoutViews();
  barView.webContents.loadFile(TITLEBAR_HTML);
  crmView.webContents.loadURL(CRM_HOME);
  // Abre maximizada. Escondida (--hidden, início com o Windows): maximiza na primeira vez que aparecer.
  pendingMaximize = hidden;
  if (!hidden) {
    mainWindow.maximize();
    mainWindow.show();
  }
}

function sendWindowVisibility() {
  const exists = Boolean(mainWindow && !mainWindow.isDestroyed());
  const hidden = isWindowHidden({ exists, visible: exists && mainWindow.isVisible(), minimized: exists && mainWindow.isMinimized() });
  crmContents()?.send("mm:window-visibility", { hidden });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (pendingMaximize) {
    pendingMaximize = false;
    mainWindow.maximize();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  crmContents()?.focus();
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
      { label: "Recarregar", click: () => crmContents()?.reload() },
      { type: "separator" },
      { label: "Abrir com o Windows", type: "checkbox", checked: openAtLogin(), click: (item) => setOpenAtLogin(item.checked) },
      {
        label: "Mostrar barra de título sempre",
        type: "checkbox",
        checked: preferences.titlebarAlwaysVisible,
        click: (item) => setTitlebarAlwaysVisible(item.checked)
      },
      {
        // 1.2.1: por 2 min o log guarda o TEXTO que o Vosk reconheceu (para ver como ele escreve o "Rênri"); nunca áudio.
        label: "Diagnóstico do nome (2 min)",
        type: "checkbox",
        checked: Boolean(wakeEngine?.isDiagnostic()),
        enabled: Boolean(wakeEngine?.isRunning()) || Boolean(wakeEngine?.isDiagnostic()),
        click: (item) => wakeEngine?.setDiagnostic(item.checked)
      },
      { label: "Ver registro de ações", click: () => shell.openPath(logPath()) },
      // 1.3.0: "Procurar atualização" (ou "Nova versão X pronta — Reiniciar agora" quando já baixou).
      ...(updater ? [updater.trayItem()] : []),
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

// 1.3.1: tela cheia do Henry aberta/fechada (evento henryFullscreen da ponte) → o atualizador guarda/mostra a caixa
// "Nova versão pronta". Só a página do CRM (frame principal da view do CRM); qualquer outra coisa é ignorada.
function setupHenryFullscreenChannel() {
  ipcMain.on("mm:henry-fullscreen", (event, open) => {
    const frame = event.senderFrame;
    if (!frame || frame.parent || !isAllowedOrigin(frame.url) || event.sender !== crmContents()) return;
    updater?.setHold(open === true);
  });
}

// Canal PRÓPRIO da barra (não é window.mmDesktop): só a página local da barra, frame principal, comando da lista fechada.
function setupTitlebarChannel() {
  ipcMain.on("mm:titlebar", (event, command) => {
    const frame = event.senderFrame;
    const checked = validateTitlebarMessage({
      senderId: event.sender?.id,
      barId: barView && !barView.webContents.isDestroyed() ? barView.webContents.id : undefined,
      isMainFrame: Boolean(frame) && !frame.parent,
      frameUrl: frame?.url,
      barUrl: TITLEBAR_URL,
      command
    });
    if (!checked.ok) {
      logAction("barra_titulo", false, checked.error);
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (checked.command === "minimize") mainWindow.minimize();
    else if (checked.command === "close") mainWindow.close(); // = esconder na bandeja (handler "close")
    else if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    else if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    if (checked.command === "toggleMaximize") crmContents()?.focus();
  });
}

// Aviso do próprio app (atualização): notificação do Windows; clicar abre a escolha (ou a janela).
function notifyApp(title, body, onClick) {
  try {
    const notice = new Notification({ title, body, icon: ICON, silent: false });
    notice.on("click", onClick || showWindow);
    notice.show();
  } catch {
    // sem notificação: o item da bandeja continua mostrando
  }
}

function start() {
  app.setAppUserModelId(APP_ID); // notificações do Windows com o nome do app
  Menu.setApplicationMenu(null);
  setupSession();
  setupBridge();
  setupTitlebarChannel();
  setupHenryFullscreenChannel();
  loadPreferences();
  session.fromPartition(TITLEBAR_PARTITION).setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.fromPartition(TITLEBAR_PARTITION).setPermissionCheckHandler(() => false);
  wakeEngine = createWakeEngine({ modelsDir: MODELS_DIR, log: logAction, onChange: () => buildTrayMenu() });
  updater = createUpdater({
    log: logAction,
    notify: notifyApp,
    onChange: () => buildTrayMenu(),
    beforeInstall: () => {
      quitting = true; // fechar a janela não pode virar "esconder na bandeja" durante a instalação
    }
  });
  app.on("web-contents-created", (_event, contents) => guardContents(contents));
  powerSaveBlocker.start("prevent-app-suspension"); // o app não é suspenso; o monitor ainda pode apagar
  createWindow({ hidden: process.argv.includes("--hidden") });
  setInterval(updateTitlebar, TITLEBAR_POLL_MS); // posição do cursor → barra (barato; com a janela escondida só confere e sai)

  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.setToolTip("Matheus Machado Corretor de Imóveis");
  tray.on("click", showWindow);
  buildTrayMenu();

  const registered = globalShortcut.register(SHORTCUT, () => {
    showWindow();
    crmContents()?.send("mm:activate-henry");
    logAction("atalho_henry", true);
  });
  if (!registered) logAction("atalho_henry", false, "Ctrl+Shift+H já usado por outro programa");
  logAction("app_aberto", true, app.getVersion());
  updater.start();
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
