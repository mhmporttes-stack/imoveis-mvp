// Service worker da extensão. Agenda (alarme de 15 min), manter acordado (alarme de 1 min), fila do CRM, abertura da aba do Facebook e retorno ao CRM.
// Regras de agenda/limite em lib/agenda.js (testadas). Seletores do Facebook em selectors.js.
import { CHECK_EVERY_MINUTES, REASON_LABELS, STALE_RUN_MS, buildResultBody, decideTick, finishJob, initialState, localWaitUntil, publishLimits, recomputeFromHistory, recordCheck, setManualPause, startJob, todayCount } from "./lib/agenda.js";
import { DEFAULT_CRM_URL, downloadAttachment, downloadPhotos, fetchNextListing, fetchNextOutbound, postChatSync, postDiagnostic, postOutboundResult, postResult } from "./lib/crm-api.js";
import { CHAT_EVERY_MINUTES, MAX_SENDS_PER_ROUND, ROUND_BUDGET_MS, outboxWaitMs, chatLockAlive, clearThreadFailure, diagnosticDue, splitIgnored, decideChatTick, describeChatLock, outboundResultBody, SEND_RETRY_WAIT_MS, verifyOutcome, recordThreadFailure, rememberPreviews, threadRetryBlocked, threadsToRead } from "./lib/chat-agenda.js";
import { CHECKPOINT_PAUSE_MS } from "./lib/agenda.js";
import { KEEP_AWAKE_ALARM, KEEP_AWAKE_EVERY_MINUTES, PULSE_PAGE, PULSE_TAB_CLOSE_MS, decidePulse, shouldHoldPower } from "./lib/keep-awake.js";
import { WORK_WINDOW_SIZE, describeWorkView, findWorkWindow } from "./lib/work-window.js";
import { createAwakeManager } from "./lib/page-awake.js";
import { SIGNALED_SKIPS, roundStatus } from "./lib/round-status.js";
import { criarLigacaoCrmChrome } from "./lib/crm-link.js";

const ALARM = "mp-tick";
const CHAT_ALARM = "mp-chat";
const PUBLISH_TIMEOUT_MS = 12 * 60 * 1000;
const PAGE_LOAD_TIMEOUT_MS = 45 * 1000;
const FORM_WAIT_MS = 15 * 1000;
const FB_ORIGIN = "https://www.facebook.com";

async function loadState() {
  const { state } = await chrome.storage.local.get("state");
  // `chatRunning` era a trava do chat até a 1.8.6 (ficava presa); hoje a trava é `chatLock` — descarta a antiga.
  const { chatRunning: _legacyChatLock, ...rest } = state || {};
  return { ...initialState(), ...rest };
}

async function saveState(state) {
  await chrome.storage.local.set({ state });
  return state;
}

async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  // version (1.9.3): vai no cabeçalho de toda chamada ao CRM — o CRM guarda junto do sinal e mostra no Chat qual versão
  // está rodando no PC (em 22/10 o PC ainda rodava a 1.9.0 com o zip da 1.9.2 publicado no repositório).
  return { baseUrl: config?.baseUrl || DEFAULT_CRM_URL, key: config?.key || "", version: chrome.runtime.getManifest().version };
}

// 1.10.0 (EXT-1, dono, 2026-10-29): tela "Extensões" do CRM — "Parar tudo" consultado antes de cada ação, limites da
// publicação editados lá, aviso de versão nova e sinal de saúde (erros, partes da tela não achadas, falhas internas).
const crmLink = criarLigacaoCrmChrome(loadConfig);
const swallow = (context) => crmLink.engolido(context);
const stoppedByCrm = async () => (await crmLink.estado()).stopped === true;

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icones/icon-192-mm.png", title, message, priority: 2 });
}

// Próxima rodada do chat 1 min depois de AGORA (1.9.9, dono 2026-10-26: "pode voltar e aguardar mais 1 minuto para a
// próxima rodada"). Recriar o alarme com o mesmo nome substitui o anterior; o período de 1 min fica como rede de
// segurança (worker encerrado no meio da rodada). Chamado no fim de cada rodada que rodou.
function scheduleNextChatRound() {
  chrome.alarms.create(CHAT_ALARM, { delayInMinutes: CHAT_EVERY_MINUTES, periodInMinutes: CHAT_EVERY_MINUTES });
}

function ensureAlarm() {
  chrome.alarms.get(ALARM, (alarm) => {
    if (!alarm) chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MINUTES });
  });
  // 1.9.9: alarme antigo de 2 min (instalação anterior) é trocado pelo de 1 min.
  chrome.alarms.get(CHAT_ALARM, (alarm) => {
    if (!alarm || alarm.periodInMinutes !== CHAT_EVERY_MINUTES) scheduleNextChatRound();
  });
  chrome.alarms.get(KEEP_AWAKE_ALARM, (alarm) => {
    if (!alarm) chrome.alarms.create(KEEP_AWAKE_ALARM, { delayInMinutes: KEEP_AWAKE_EVERY_MINUTES, periodInMinutes: KEEP_AWAKE_EVERY_MINUTES });
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  ensureAlarm();
  // Instalou/atualizou/recarregou (↻): nenhuma sincronização pode estar rodando — solta a trava e fecha a aba órfã.
  await releaseDeadChatLock("extensão recarregada/atualizada");
  await closeLeftoverPulseTabs();
  await applyPower();
  // 1.8.9: as versões 1.8.6–1.8.8 podiam guardar a prévia de conversa enviada SEM mensagens (o histórico nunca mais
  // seria lido). Uma vez, ao atualizar delas, esquece as prévias: tudo é relido com histórico completo (o CRM
  // ignora mensagem repetida pelo id).
  if (details.reason === "update" && /^1\.8\.[678]$/.test(details.previousVersion || "")) await chrome.storage.local.remove("chatPreviews");
  // Atualização: refaz a contagem do dia pelo histórico (versão 1.1.0 contava falha e travava 1 h).
  if (details.reason === "update") await saveState(recomputeFromHistory(await loadState(), new Date()));
});
chrome.runtime.onStartup.addListener(async () => {
  ensureAlarm();
  await releaseDeadChatLock("Chrome reiniciado");
  await closeLeftoverPulseTabs();
  await applyPower();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) tick("alarme").catch((error) => console.warn("[marketplace] tique falhou:", error));
  if (alarm.name === CHAT_ALARM) chatTick().catch((error) => console.warn("[marketplace] chat falhou:", error)).then(publishAfterChat);
  if (alarm.name === KEEP_AWAKE_ALARM) keepAwakeTick().catch((error) => console.warn("[marketplace] manter acordado falhou:", error));
});
// Opção "Manter acordado" mudou nas Opções: aplica na hora (sem esperar o próximo minuto).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.keepAwake) applyPower().catch(swallow("aplicar manter acordado"));
});

// --- Manter acordado (1.9.0) -------------------------------------------------------------------------------------
// Regras em lib/keep-awake.js. chrome.power "system" impede o computador de dormir (a tela ainda pode apagar) enquanto
// a opção estiver ligada e a extensão não estiver em Pausar; o alarme de 1 min também acorda o service worker.
async function applyPower() {
  const [{ keepAwake }, state] = await Promise.all([chrome.storage.local.get("keepAwake"), loadState()]);
  if (shouldHoldPower(keepAwake, state)) chrome.power.requestKeepAwake("system");
  else chrome.power.releaseKeepAwake();
  return { keepAwake, state };
}

// Aba própria da extensão não pode ser descartada pelo Chrome por inatividade (publicação, chat, diagnóstico).
async function protectTab(tabId) {
  await chrome.tabs.update(tabId, { autoDiscardable: false }).catch((error) => console.warn("[marketplace] autoDiscardable falhou:", error?.message || error));
}

// --- Janela de trabalho (1.9.4) ------------------------------------------------------------------------------------
// Pedido do dono (2026-10-22): "ela fica a todo momento abrindo novas guias; às vezes estou numa página e ela abre
// outra". Tudo o que a extensão faz no Facebook acontece numa janela PEQUENA só dela, com UMA aba reutilizada (guardada
// em chrome.storage.local.workWindow e recuperada depois de reiniciar o Chrome — regra em lib/work-window.js). Nunca
// cria aba na janela do dono e nunca dá foco: a janela nasce sem foco (focused:false) e só vem para a frente pelo botão
// "Abrir janela de trabalho" do popup. Minimizada o Facebook não abre conversa (a extensão espera, 1.9.3).
let workTabPending = null;

async function getWorkTab({ create = true } = {}) {
  if (workTabPending) return workTabPending;
  workTabPending = (async () => {
    const { workWindow } = await chrome.storage.local.get("workWindow");
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }).catch((error) => swallow("listar as janelas do Chrome")(error) || []);
    const found = findWorkWindow(windows, workWindow);
    if (found) {
      if (found.windowId !== workWindow?.windowId || found.tabId !== workWindow?.tabId) await chrome.storage.local.set({ workWindow: { windowId: found.windowId, tabId: found.tabId } });
      return chrome.tabs.get(found.tabId);
    }
    if (!create) return null;
    const win = await chrome.windows.create({ url: INBOX_URL, type: "normal", focused: false, ...WORK_WINDOW_SIZE });
    const tab = win.tabs?.[0] || (await chrome.tabs.query({ windowId: win.id }))[0];
    await chrome.storage.local.set({ workWindow: { windowId: win.id, tabId: tab.id } });
    await protectTab(tab.id);
    return tab;
  })().finally(() => {
    workTabPending = null;
  });
  return workTabPending;
}

async function isWorkTab(tabId) {
  const { workWindow } = await chrome.storage.local.get("workWindow");
  return Boolean(tabId && workWindow?.tabId === tabId);
}

// Botão do popup (pedido explícito do dono): única vez em que a extensão traz a janela de trabalho para a frente.
async function openWorkWindow() {
  const tab = await getWorkTab();
  await chrome.windows.update(tab.windowId, { focused: true, state: "normal" });
  await chrome.tabs.update(tab.id, { active: true });
  return { ok: true };
}

// Indicador do popup: a janela existe? está minimizada? a página do Facebook está visível para o Chrome?
async function workView() {
  const tab = await getWorkTab({ create: false }).catch(swallow("procurar a janela de trabalho (popup)"));
  if (!tab) return describeWorkView({ exists: false });
  const window = await chrome.windows.get(tab.windowId).catch(() => ({}));
  const view = String(tab.url || "").startsWith(FB_PREFIX) ? await pageVisibility(tab.id) : { visibility: "?" };
  return describeWorkView({ exists: true, windowState: window.state, visibility: view.visibility });
}

// Abas "manter acordado" que ficaram de uma versão anterior / worker morto (só as da extensão, pelo endereço).
async function closeLeftoverPulseTabs() {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL(PULSE_PAGE) }).catch((error) => swallow("listar abas de manter acordado")(error) || []);
  for (const tab of tabs) await chrome.tabs.remove(tab.id).catch(swallow("fechar aba de manter acordado antiga"));
}

// Pedido literal do dono (1.9.0): a cada 1 min abre uma aba em segundo plano e fecha em ~2 s. 1.9.4: dentro da janela
// de trabalho (nunca na janela do dono); sem janela de trabalho, não abre (a rodada do chat a recria em até 2 min).
async function keepAwakeTick() {
  const { keepAwake, state } = await applyPower();
  const { pulseTabId } = await chrome.storage.session.get("pulseTabId");
  const previousPulseOpen = pulseTabId ? Boolean(await chrome.tabs.get(pulseTabId).catch(() => null)) : false;
  const work = await getWorkTab({ create: false }).catch(swallow("procurar a janela de trabalho (manter acordado)"));
  const decision = decidePulse(keepAwake, state, { chatBusy: await chatBusy(), hasNormalWindow: Boolean(work), previousPulseOpen });
  if (!decision.pulse) {
    // Aba de um minuto anterior que ficou (worker morreu antes de fechar): fecha agora.
    if (previousPulseOpen && decision.reason === "aba_anterior_aberta") await chrome.tabs.remove(pulseTabId).catch(swallow("fechar aba de manter acordado"));
    return decision;
  }
  const tab = await chrome.tabs.create({ windowId: work.windowId, active: false, url: chrome.runtime.getURL(PULSE_PAGE) });
  await chrome.storage.session.set({ pulseTabId: tab.id });
  await sleep(PULSE_TAB_CLOSE_MS);
  await chrome.tabs.remove(tab.id).catch(swallow("fechar aba de manter acordado"));
  await chrome.storage.session.remove("pulseTabId");
  return decision;
}

// Espera a aba terminar de carregar DEPOIS de um comando de navegação (o listener é ligado antes do comando, então
// o "complete" da página anterior não engana).
const FB_PREFIX = "https://www.facebook.com/";

function navigateAndWait(tabId, url, timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
  // Só endereço absoluto do Facebook: URL vazia/relativa faria a aba abrir uma página da própria extensão
  // (chrome-extension://…), onde nada pode ser injetado (erro real do dono, 1.8.2).
  if (!String(url || "").startsWith(FB_PREFIX)) return Promise.reject(new Error(`Endereço inválido para a aba do Facebook: "${url || "(vazio)"}".`));
  return new Promise((resolve, reject) => {
    let sawLoading = false;
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`O Facebook não terminou de carregar em ${Math.round(timeoutMs / 1000)} s (${url}).`));
    }, timeoutMs);
    function listener(id, info, tab) {
      if (id !== tabId || String(tab?.url || "").startsWith("about:")) return;
      if (info.status === "loading") sawLoading = true;
      if (info.status === "complete" && sawLoading) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch((error) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(error);
    });
  });
}

// Injeta selectors.js + content.js (content.js ignora a 2ª injeção no mesmo documento).
async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["selectors.js", "content.js"] });
}

function sendWithTimeout(tabId, message, timeoutMs) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Tempo esgotado esperando a página do Facebook.")), timeoutMs))
  ]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Depois de um clique, a página pode trocar de documento (navegação completa) ou só de rota (SPA): espera um pouco,
// reinjeta e confere de novo.
async function probeAfterClick(tabId) {
  await sleep(3000);
  const tab = await chrome.tabs.get(tabId);
  if (tab.status !== "complete") await sleep(5000);
  await inject(tabId);
  return sendWithTimeout(tabId, { type: "mp-probe", waitForFormMs: FORM_WAIT_MS }, FORM_WAIT_MS + 10000);
}

// Leva a aba dedicada até "Novo classificado de imóvel". Devolve { ok, trail } — trail = URL atingida em cada tentativa.
async function openPropertyForm(tabId) {
  const trail = [];
  const note = (label, state) => trail.push(`${label}: ${state?.url || "?"}`);

  // 1) URL direta do formulário de imóvel.
  await navigateAndWait(tabId, `${FB_ORIGIN}/marketplace/create/rental`);
  await inject(tabId);
  let state = await sendWithTimeout(tabId, { type: "mp-probe", waitForFormMs: FORM_WAIT_MS }, FORM_WAIT_MS + 10000);
  note("1 (create/rental)", state);
  if (state.checkpoint) return { ok: false, checkpoint: true, trail };
  if (state.isForm) return { ok: true, trail };

  // 2) Escolha do tipo de classificado → cartão "Imóvel residencial para venda ou locação".
  await navigateAndWait(tabId, `${FB_ORIGIN}/marketplace/create`);
  await inject(tabId);
  state = await sendWithTimeout(tabId, { type: "mp-probe" }, 15000);
  if (state.hasCard) {
    await sendWithTimeout(tabId, { type: "mp-click", target: "card" }, 20000);
    state = await probeAfterClick(tabId);
  }
  note("2 (create + cartão)", state);
  if (state.checkpoint) return { ok: false, checkpoint: true, trail };
  if (state.isForm) return { ok: true, trail };

  // 3) "+ Criar novo classificado" no menu lateral → cartão.
  await navigateAndWait(tabId, `${FB_ORIGIN}/marketplace/`);
  await inject(tabId);
  await sendWithTimeout(tabId, { type: "mp-click", target: "create" }, 20000);
  state = await probeAfterClick(tabId);
  if (!state.isForm && state.hasCard) {
    await sendWithTimeout(tabId, { type: "mp-click", target: "card" }, 20000);
    state = await probeAfterClick(tabId);
  }
  note("3 (menu Criar novo classificado + cartão)", state);
  return { ok: Boolean(state.isForm), checkpoint: Boolean(state.checkpoint), trail };
}

// --- Entrada CONFIÁVEL (chrome.debugger / CDP) ----------------------------------------------------------------
// O autocomplete de localização do Facebook ignora eventos sintéticos (isTrusted=false). Durante a publicação a aba
// dedicada fica com o depurador ligado (o Chrome mostra a faixa "está depurando este navegador") e o content script
// pede cliques/teclas reais por mensagem. Desligado ao fim, sempre.
// 1.9.8 (dono, 25/10: "abro outra janela em tela cheia; as abas das extensões ficam atrás"): o depurador liga SÓ durante
// cada ação no Facebook (ler a caixa, abrir/ler uma conversa, enviar, publicar, diagnóstico) e, ligado, emula foco
// (lib/page-awake.js) — a página fica visível e com foco para o Chrome mesmo com a janela de trabalho atrás de outra,
// sem trazer nada para a frente. Solto ao fim de cada ação (a faixa some 5 s depois; ações seguidas a mantêm).
const awake = createAwakeManager({
  attach: (tabId) => withTimeout(chrome.debugger.attach({ tabId }, "1.3"), 8000, "ligar o depurador"),
  detach: (tabId) => chrome.debugger.detach({ tabId }),
  send: (tabId, method, params) => cdp(tabId, method, params),
  warn: (message) => console.warn("[marketplace]", message)
});
// Dono clicou em "Cancelar" na faixa, ou a aba fechou: o Chrome soltou o depurador.
chrome.debugger.onDetach.addListener((source) => {
  if (source?.tabId) awake.forget(source.tabId);
});

function withAwakePage(tabId, run) {
  return awake.run(tabId, run);
}
const KEYS = {
  ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  Enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Backspace: { code: "Backspace", windowsVirtualKeyCode: 8 },
  Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
  a: { code: "KeyA", windowsVirtualKeyCode: 65 }
};

// Com prazo (1.8.10): comando ao depurador numa aba oculta pode não voltar nunca.
function cdp(tabId, method, params) {
  return withTimeout(chrome.debugger.sendCommand({ tabId }, method, params), 8000, `depurador (${method})`);
}

async function trustedInput(tabId, message) {
  if (!awake.isAttached(tabId)) return { ok: false, reason: "sem_depurador" };
  if (message.action === "click") {
    const base = { x: Math.round(message.x), y: Math.round(message.y), button: "left", clickCount: 1 };
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: base.x, y: base.y });
    await sleep(60 + Math.floor(Math.random() * 120));
    await cdp(tabId, "Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
    await sleep(40 + Math.floor(Math.random() * 80));
    await cdp(tabId, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
    return { ok: true };
  }
  if (message.action === "key") {
    const key = KEYS[message.key];
    if (!key) return { ok: false, reason: "tecla_desconhecida" };
    const modifiers = message.ctrl ? 2 : 0;
    await cdp(tabId, "Input.dispatchKeyEvent", { type: key.text ? "keyDown" : "rawKeyDown", key: message.key, modifiers, ...key });
    await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: message.key, modifiers, code: key.code, windowsVirtualKeyCode: key.windowsVirtualKeyCode });
    return { ok: true };
  }
  if (message.action === "text") {
    await cdp(tabId, "Input.insertText", { text: String(message.text || "") });
    return { ok: true };
  }
  return { ok: false, reason: "acao_desconhecida" };
}

async function screenshot(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 45 });
  } catch {
    return ""; // sem permissão/aba não visível: fica só a descrição do passo
  }
}

// Clicou em Publicar? Pelo último passo informado pela página (para não repetir e duplicar o anúncio).
async function reachedPublishClick() {
  const step = (await loadState()).running?.step || "";
  return step === "clicou publicar" || step === "confirmação";
}

async function runPublication(listing) {
  let photos;
  try {
    photos = await downloadPhotos(listing.photoUrls);
  } catch (error) {
    return { ok: false, clickedPublish: false, step: "baixar fotos do CRM", error: error.message };
  }

  // Aba NOVA e dedicada, dentro da janela de trabalho (1.9.4 — nunca na janela do dono, que não recebe foco); fechada
  // no final, com print em caso de falha. Ativa só dentro da janela de trabalho (o print é da aba visível dela).
  const work = await getWorkTab();
  const tab = await chrome.tabs.create({ windowId: work.windowId, url: "about:blank", active: true });
  await protectTab(tab.id);
  await sleep(500);
  // Depurador + emulação de foco durante a publicação inteira (1.9.8: funciona com a janela de trabalho atrás de outra).
  const outcome = await withAwakePage(tab.id, () => publishOnTab(tab, listing, photos));
  await chrome.tabs.remove(tab.id).catch(swallow("fechar a aba da publicação"));
  return outcome;
}

async function publishOnTab(tab, listing, photos) {
  let outcome;
  try {
    const form = await openPropertyForm(tab.id);
    if (!form.ok) {
      outcome = {
        ok: false,
        clickedPublish: false,
        checkpoint: Boolean(form.checkpoint),
        step: "abrir formulário de imóvel",
        error: `${form.checkpoint ? "O Facebook mostrou verificação/limite. " : "O formulário \"Novo classificado de imóvel\" não abriu. "}Páginas atingidas — ${form.trail.join(" | ")}`
      };
    } else {
      outcome = await sendWithTimeout(tab.id, { type: "mp-publish", listing, photos }, PUBLISH_TIMEOUT_MS);
      if (outcome?.ok && !outcome.url) {
        await navigateAndWait(tab.id, `${FB_ORIGIN}/marketplace/you/selling`);
        await inject(tab.id);
        const found = await sendWithTimeout(tab.id, { type: "mp-find-url", price: listing.price }, 60000).catch((error) => swallow("achar o link do anúncio publicado")(error) || {});
        outcome = { ...outcome, url: found?.url || "" };
      }
      outcome = outcome || { ok: false, clickedPublish: false, step: "página do Facebook", error: "Sem resposta da página." };
    }
  } catch (error) {
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    const checkpoint = current?.url ? /\/(checkpoint|login|two_step_verification)/.test(new URL(current.url).pathname) : false;
    outcome = { ok: false, clickedPublish: await reachedPublishClick(), checkpoint, step: (await loadState()).running?.step || "página do Facebook", error: `${error.message} (aba em ${current?.url || "?"})` };
  }
  // Print ainda com o depurador ligado (página acordada).
  if (!outcome.ok) outcome = { ...outcome, screenshot: await screenshot(tab.windowId) };
  return outcome;
}

// onDecision: avisa o popup assim que se sabe o resultado da verificação (antes de publicar, que leva minutos).
// Publicação interrompida (Chrome fechado/extensão reiniciada no meio): avisa o CRM para o anúncio não ficar
// "Publicando" até vencer as 2 h. Só pede nova tentativa se não chegou a clicar em Publicar.
async function recoverInterruptedRun(state) {
  if (!state.running || Date.now() - new Date(state.running.startedAt).getTime() < STALE_RUN_MS) return state;
  const clicked = ["clicou publicar", "confirmação"].includes(state.running.step);
  const outcome = { ok: false, clickedPublish: clicked, step: state.running.step || "?", error: "A publicação foi interrompida (Chrome ou extensão reiniciou no meio)." };
  await postResult(await loadConfig(), state.running.listingId, buildResultBody(outcome)).catch((error) => console.warn("[marketplace] retorno da publicação interrompida falhou:", error?.message || error));
  return saveState(finishJob(state, outcome, new Date()));
}

// --- Tela "Extensões" do CRM (1.10.0, EXT-1) -------------------------------------------------------------------------
// Sinal de saúde: publicações do dia x limite, pausa, última rodada, erros e partes da tela não achadas (lib/crm-link.js).
async function reportHealth({ ok = true, stage = "", error = "", force = false } = {}) {
  const [state, runtime] = await Promise.all([loadState(), crmLink.estado()]);
  const limits = publishLimits(runtime.config || {});
  const paused = state.pausedUntil && new Date(state.pausedUntil).getTime() > Date.now();
  const result = await crmLink.enviarSaude({
    ok,
    stage,
    error,
    today: { publish: { done: todayCount(state), limit: limits.dailyLimit } },
    pausedUntil: paused ? state.pausedUntil : null,
    pauseReason: paused ? state.pauseReason : "",
    manualPause: state.manualPause === true,
    stoppedByCrm: runtime.stopped === true
  }, { forcar: force });
  await maybeWarnOutdated(runtime);
  return result;
}

// Versão do PC atrasada: avisa uma vez por versão nova (o popup mostra o link do zip o tempo todo).
async function maybeWarnOutdated(runtime) {
  if (!runtime?.outdated || !runtime.latestVersion) return;
  const { warnedVersion } = await chrome.storage.local.get("warnedVersion");
  if (warnedVersion === runtime.latestVersion) return;
  await chrome.storage.local.set({ warnedVersion: runtime.latestVersion });
  notify("Publicador do Marketplace: versão nova", `A versão ${runtime.latestVersion} está no CRM (este PC roda a ${chrome.runtime.getManifest().version}). Abra o popup da extensão para baixar.`);
}

async function tick(origin, onDecision = () => {}) {
  let state = await recoverInterruptedRun(await loadState());
  const runtime = await crmLink.estado();
  const decision = decideTick(state, new Date(), { chatBusy: await chatBusy(), stoppedByCrm: runtime.stopped === true, limits: runtime.config || {} });
  if (decision.action !== "check") {
    const waitUntil = localWaitUntil(state, decision.reason);
    await saveState(recordCheck(state, decision.reason, new Date(), waitUntil));
    onDecision({ reason: decision.reason, waitUntil });
    await reportHealth({ ok: true, stage: decision.reason }).catch(swallow("sinal de saúde (publicação)"));
    return { reason: decision.reason, waitUntil };
  }

  const config = await loadConfig();
  const next = await fetchNextListing(config);
  if (!next.listing) {
    await saveState(recordCheck(state, next.reason, new Date(), next.waitUntil));
    if (next.reason === "chave_invalida") notify("Publicador do Marketplace", REASON_LABELS.chave_invalida);
    onDecision({ reason: next.reason, waitUntil: next.waitUntil || null });
    return { reason: next.reason, waitUntil: next.waitUntil || null };
  }

  const listing = next.listing;
  onDecision({ reason: "publicando", title: listing.title });
  state = await saveState(startJob(recordCheck(state, `publicando (${origin})`), listing, new Date()));
  const outcome = await runPublication(listing);
  const body = buildResultBody(outcome);
  let reportError = "";
  try {
    await postResult(config, listing.id, body);
  } catch (error) {
    reportError = ` (não consegui avisar o CRM: ${error.message})`;
  }

  state = await saveState(finishJob(await loadState(), { ...outcome, error: `${outcome.error || ""}${reportError}` }, new Date()));
  if (!outcome.ok) {
    await crmLink.registrarErro("publicação", `Passo ${outcome.step || "?"}: ${outcome.error || "falha sem descrição"}`);
    if (/não encontrad|nao encontrad|not found/i.test(String(outcome.error || ""))) await crmLink.registrarSeletor(`publicação: ${outcome.step || "?"}`, outcome.error);
  }
  await reportHealth({ ok: Boolean(outcome.ok), stage: outcome.ok ? "publicado" : `publicação: ${outcome.step || "?"}`, error: outcome.ok ? "" : outcome.error, force: true }).catch(swallow("sinal de saúde (publicação)"));
  if (outcome.ok) {
    notify("Anúncio publicado", `${listing.title}${outcome.url ? "" : " — confira o link no Facebook"}${reportError}`);
  } else if (outcome.checkpoint) {
    notify("Marketplace pausado por 24 h", "O Facebook pediu verificação ou avisou de limite. Resolva no Facebook; nada mais será publicado até lá.");
  } else {
    notify("Falha ao publicar no Marketplace", `${listing.title}: ${outcome.step} — ${outcome.error}`);
  }
  return { reason: outcome.ok ? "publicado" : "falhou" };
}

// 1.9.10: com o chat rodando a cada 1 min (1.9.9), o tique de 15 min da publicação quase sempre caía no meio de uma
// rodada ("chat_em_andamento") e o anúncio aprovado ficava parado na fila. Agora, quando a publicação foi adiada pelo
// chat, ela roda assim que a rodada do chat termina (a próxima rodada do chat espera: decideChatTick pula com `running`).
async function publishAfterChat() {
  const state = await loadState().catch(swallow("ler o estado depois do chat"));
  if (state?.lastCheckResult !== "chat_em_andamento") return;
  await tick("após o chat").catch((error) => console.warn("[marketplace] tique após o chat falhou:", error));
}

// Mensagens do popup/opções e progresso da aba.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "mp-trusted") return sender.tab?.id ? trustedInput(sender.tab.id, message) : { ok: false, reason: "sem_aba" };
    // Relógio do leitor da página (1.9.3): com a aba oculta o Chrome segura os timers da página (até 1 min por espera)
    // e a leitura estourava o prazo ("passou de 210 s"); o relógio do service worker não é segurado.
    if (message?.type === "mp-sleep") {
      await sleep(Math.max(0, Math.min(Number(message.ms) || 0, 30000)));
      return { ok: true };
    }
    if (message?.type === "mp-progress") {
      const state = await loadState();
      if (state.running) await saveState({ ...state, running: { ...state.running, step: message.step } });
      return { ok: true };
    }
    if (message?.type === "mp-status") {
      const config = await loadConfig();
      const { chatLast, chatSkip, chatLock } = await chrome.storage.local.get(["chatLast", "chatSkip", "chatLock"]);
      const now = new Date();
      const alive = chatLockAlive(chatLock, { now, instance: WORKER_INSTANCE });
      const chatNow = chatLock?.token ? { alive, step: describeChatLock(chatLock, now), progress: chatLock.progress || null } : null;
      const { keepAwake } = await chrome.storage.local.get("keepAwake");
      const crm = await crmLink.estado();
      return { state: await loadState(), config: { baseUrl: config.baseUrl, hasKey: Boolean(config.key) }, keepAwake: keepAwake !== false, chatLast: chatLast || null, chatSkip: chatSkip || null, chatNow, crm: { stopped: crm.stopped === true, outdated: crm.outdated === true, latestVersion: crm.latestVersion || "", downloadUrl: crm.downloadUrl || "", limits: publishLimits(crm.config || {}), origin: crm.origem } };
    }
    if (message?.type === "mp-chat-unlock") return unlockChat();
    // 1.10.0: falha interna da aba/opções que antes sumia (content.js, options.js) → sinal de saúde.
    if (message?.type === "mp-swallowed") {
      swallow(String(message.context || "página").slice(0, 80))(new Error(String(message.error || "")));
      return { ok: true };
    }
    if (message?.type === "mp-work-open") return openWorkWindow();
    if (message?.type === "mp-work-view") return workView();
    if (message?.type === "mp-pause") {
      const state = await saveState(setManualPause(await loadState(), message.paused));
      await applyPower(); // Pausar solta o "manter acordado"; Retomar volta a segurar.
      return { state };
    }
    if (message?.type === "mp-diagnose") return diagnoseNow();
    if (message?.type === "mp-check-now") {
      // Responde ao popup assim que a decisão sai; a publicação (se houver) continua em segundo plano.
      return new Promise((resolve) => {
        tick("manual", resolve).then(resolve, (error) => resolve({ reason: "erro_crm", error: error.message }));
      });
    }
    return { ok: false };
  })().then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});

// --- Chat do Marketplace (MKT-2) ---------------------------------------------------------------------------------
// A cada ~1 min (1.9.9) (horário e liga/desliga vêm do CRM): abre uma aba própria na caixa de entrada do MARKETPLACE (nunca a
// lista geral do Messenger), lê só as conversas que mudaram, manda ao CRM e envia as respostas que os corretores
// escreveram (cliques/teclas reais, até MAX_SENDS_PER_ROUND por rodada dentro do orçamento e o limite por hora do CRM). Nunca responde sozinho.
// Depois de um clique: se a aba trocou de endereço/está carregando, espera terminar (até 45 s).
async function waitTabSettled(tabId, beforeUrl) {
  const end = Date.now() + PAGE_LOAD_TIMEOUT_MS;
  await sleep(1500);
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && (tab.url !== beforeUrl || Date.now() > end - PAGE_LOAD_TIMEOUT_MS + 3000)) return tab;
    await sleep(700);
  }
  throw new Error(`O Facebook não terminou de abrir a conversa em ${PAGE_LOAD_TIMEOUT_MS / 1000} s.`);
}

// Injeta o leitor SÓ se a aba dedicada estiver no Facebook; senão leva a aba de volta ao Facebook antes.
async function injectInbox(tabId, fallbackUrl = INBOX_URL) {
  let tab = await chrome.tabs.get(tabId);
  if (!String(tab.url || "").startsWith(FB_PREFIX)) {
    await navigateAndWait(tabId, fallbackUrl);
    tab = await chrome.tabs.get(tabId);
  }
  if (!String(tab.url || "").startsWith(FB_PREFIX)) throw new Error(`A aba dedicada não está no Facebook (${tab.url || "sem endereço"}).`);
  await chrome.scripting.executeScript({ target: { tabId }, files: ["selectors.js", "inbox.js"] });
}

const INBOX_URL = "https://www.facebook.com/marketplace/inbox/";

// 1.8.9: chamada ao leitor da página por chrome.scripting.executeScript (frame principal, mundo ISOLATED): reinjeta
// selectors.js + inbox.js a cada chamada (documento novo depois de qualquer troca de URL recebe o leitor de novo; o
// mesmo documento ignora) e recebe o valor DIRETO da função. Exceção na página vira { ok:false, error, stack };
// página que navegou no meio vira erro do Chrome (nunca mais "sem resposta" mudo como no sendMessage da 1.8.8).
async function callInboxInPage(message) {
  try {
    if (!globalThis.__mpInbox?.handle) return { ok: false, error: "Leitor da página não carregou (inbox.js).", stack: "" };
    return await globalThis.__mpInbox.handle(message);
  } catch (error) {
    return { ok: false, error: String(error?.message || error), stack: String(error?.stack || "").slice(0, 1500) };
  }
}

async function pageCall(tabId, message, timeoutMs) {
  await injectInbox(tabId);
  const run = chrome.scripting.executeScript({ target: { tabId, allFrames: false }, world: "ISOLATED", func: callInboxInPage, args: [message] })
    .then((results) => {
      const result = results?.[0]?.result;
      if (result === undefined || result === null) return { ok: false, error: `A página não devolveu resultado (${message.type}).`, noResult: true };
      return result;
    });
  return withTimeout(run, timeoutMs, `página do Facebook (${message.type})`);
}

// Retrato anonimizado da página tirado DIRETO por executeScript (não depende do leitor responder): caminho da URL,
// contagens e o esqueleto dos diálogos/painéis com role=log. Textos viram TXT(n); números longos de links viram :id.
function pageSnapshot() {
  const mask = (text) => {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return "";
    if (value === "·") return "·";
    return `TXT(${value.length})`;
  };
  const path = (href) => {
    try {
      return new URL(href, location.origin).pathname.replace(/\d{4,}/g, ":id").slice(0, 120);
    } catch {
      return "";
    }
  };
  const isVisible = (element) => {
    const rect = element.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  };
  const budget = { left: 1500 };
  const tree = (element, depth) => {
    if (!element || budget.left <= 0 || depth > 22) return null;
    budget.left -= 1;
    const node = { t: String(element.tagName || "").toLowerCase() };
    const role = element.getAttribute?.("role");
    if (role) node.r = role;
    const label = element.getAttribute?.("aria-label");
    if (label) node.a = mask(label);
    const href = element.getAttribute?.("href");
    if (href) node.h = path(href);
    const data = [...(element.attributes || [])].map((attr) => attr.name).filter((name) => name.startsWith("data-"));
    if (data.length) node.d = data.slice(0, 6);
    if (!isVisible(element)) node.hid = 1;
    const own = [...(element.childNodes || [])].filter((child) => child.nodeType === 3).map((child) => child.textContent).join(" ").trim();
    if (own) node.x = mask(own);
    const children = [...(element.children || [])].map((child) => tree(child, depth + 1)).filter(Boolean);
    if (children.length) node.c = children;
    return node;
  };
  const count = (selector) => document.querySelectorAll(selector).length;
  const logs = [...document.querySelectorAll('[role="log"]')];
  const roots = new Set([...document.querySelectorAll('[role="dialog"]')].slice(0, 4));
  for (const log of logs.slice(0, 3)) {
    let node = log;
    for (let level = 0; node.parentElement && level < 6; level += 1) node = node.parentElement;
    roots.add(node);
  }
  return {
    path: path(location.href),
    title: mask(document.title),
    counts: { logs: logs.length, visibleLogs: logs.filter(isVisible).length, articles: count('[role="article"]'), messageIds: count("[data-message-id]"), dialogs: count('[role="dialog"]'), textboxes: count('[role="textbox"]'), main: count('[role="main"]'), iframes: count("iframe") },
    readerLoaded: Boolean(globalThis.__mpInbox),
    trees: [...roots].slice(0, 6).map((root) => tree(root, 0)),
    truncated: budget.left <= 0
  };
}

async function takeSnapshot(tabId) {
  try {
    const results = await withTimeout(chrome.scripting.executeScript({ target: { tabId, allFrames: false }, world: "ISOLATED", func: pageSnapshot }), 20000, "retrato da página");
    return results?.[0]?.result || { error: "retrato vazio" };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

async function readInbox(tabId) {
  await navigateAndWait(tabId, INBOX_URL);
  await injectInbox(tabId);
  return pageCall(tabId, { type: "mp-inbox-list" }, 120000);
}

const THREAD_PATH_RE = /\/(?:marketplace\/t|messages\/t|t)\//;

// Conversa não abriu: manda o esqueleto anonimizado (URL, diálogos, o que foi clicado) para calibrar, no máximo 1 a
// cada 30 min por tipo de falha (1.9.3; regra em lib/chat-agenda.js diagnosticDue). Vai como kind "thread" (já aceito
// pelo CRM) com stage "open_conversation" — sem depender de deploy.
async function sendOpenDiagnostic(config, diagnostic) {
  if (!diagnostic || !config?.key) return "";
  const { openDiagnosticSentAt } = await chrome.storage.local.get("openDiagnosticSentAt");
  if (!diagnosticDue(openDiagnosticSentAt || {}, diagnostic.result)) return "";
  await chrome.storage.local.set({ openDiagnosticSentAt: { ...(openDiagnosticSentAt || {}), [diagnostic.result]: new Date().toISOString() } });
  return postDiagnostic(config, "thread", diagnostic).then(() => " (diagnóstico open_conversation enviado)", (error) => ` (diagnóstico falhou: ${error.message})`);
}

// Lê a conversa numa página que já está nela (link direto, rota /t/ ou último recurso).
// O leitor para sozinho READ_MARGIN_MS antes do prazo (devolve o que juntou e fecha a janela) — antes a margem era de
// 15 s e, com os timers da página segurados, a etapa era abandonada sem nada (erro real "passou de 210 s").
function readOpenThread(tabId, thread, readMs) {
  return pageCall(tabId, { type: "mp-inbox-read", threadKey: thread.threadKey, full: thread.full === true, contactName: thread.contactName || "", maxMs: readMs - (thread.full ? READ_MARGIN_MS.full : READ_MARGIN_MS.incremental) }, readMs)
    .catch(async (error) => ({ ok: false, error: `${error.message} (lendo a conversa em ${(await chrome.tabs.get(tabId).catch(() => ({}))).url || "?"}; esperava a janela com o campo "Aa" ou a área de mensagens)` }));
}

// --- Abrir conversa sem link (1.8.10) ------------------------------------------------------------------------------
// Diagnóstico real de 21/10: depois do clique, nada (sem diálogo, sem rota, 0 role=log) — o clique era sintético
// ou caía no botão de menu interno, e a aba oculta tem timers e pintura seguros pelo Chrome. Agora: a aba fica
// visível só enquanto abre e lê a conversa (depois o foco volta para a aba anterior), o clique é de verdade
// (chrome.debugger) na linha do NOME, e a espera roda aqui no background (a cada 0,5 s), não na página.
async function focusTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const window = await chrome.windows.get(tab.windowId).catch(() => ({}));
  const info = { wasActive: Boolean(tab.active), windowState: window.state || "?", windowFocused: Boolean(window.focused) };
  if (tab.active) return { info, restore: async () => {} };
  const [previous] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  await chrome.tabs.update(tabId, { active: true });
  await sleep(600);
  return { info, restore: async () => { if (previous?.id && previous.id !== tabId) await chrome.tabs.update(previous.id, { active: true }).catch(swallow("voltar para a aba anterior")); } };
}

// Visibilidade da página como o Chrome a vê (1.9.3; vai também nos diagnósticos). "hidden" com a aba ativa = tela
// desligada/bloqueada, janela minimizada ou coberta — o Chrome para de desenhar a página e segura os timers dela.
async function pageVisibility(tabId) {
  try {
    const results = await withTimeout(chrome.scripting.executeScript({ target: { tabId, allFrames: false }, func: () => ({ visibility: document.visibilityState, hasFocus: document.hasFocus() }) }), 10000, "visibilidade da página");
    return results?.[0]?.result || { visibility: "?" };
  } catch (error) {
    return { visibility: "?", error: String(error?.message || error) };
  }
}

// 1.9.8: com a emulação de foco a página fica visível mesmo atrás de outra janela; "hidden" agora = o depurador não ligou
// (DevTools aberto nesta aba, "Cancelar" na faixa) ou a janela está minimizada.
function hiddenTabMessage(focus = {}, awakeInfo = null) {
  const where = focus.windowState === "minimized" ? "janela de trabalho minimizada" : awakeInfo?.awake === false ? `a extensão não conseguiu acordar a página — ${awakeInfo.error || "depurador não ligou"}` : "página oculta mesmo com a emulação de foco";
  return `O Chrome não está mostrando a aba do Facebook (${where}); assim o Facebook não abre a conversa. Fica para a próxima rodada.`;
}

async function trustedClick(tabId, x, y) {
  if (!awake.isAttached(tabId)) return { ok: false, reason: "depurador não ligou (DevTools aberto nesta aba?)" };
  try {
    return await withTimeout(trustedInput(tabId, { action: "click", x, y }), 15000, "clique confiável");
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function waitOpened(tabId, contactName, beforeUrl, iframesBefore, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId).catch(() => ({}));
    if (tab.url && tab.url !== beforeUrl && THREAD_PATH_RE.test(MP_PATH(tab.url))) {
      if (tab.status === "complete") return { found: "rota", path: MP_PATH(tab.url) };
    }
    last = await pageCall(tabId, { type: "mp-inbox-open-state", contactName }, 5000).catch((error) => ({ error: error.message }));
    if (last?.found) return last;
    if (Number(last?.iframes || 0) > Number(iframesBefore || 0)) return { ...last, found: "iframe" };
    await sleep(500);
  }
  return { ...(last || {}), found: null };
}

async function openAndReadByClick(tabId, thread, readMs, awakeInfo = null) {
  const current = await chrome.tabs.get(tabId);
  if (!new URL(current.url || INBOX_URL).pathname.startsWith("/marketplace/inbox")) await navigateAndWait(tabId, INBOX_URL);
  const focus = await focusTab(tabId);
  try {
    // 1.9.3: aba ativa mas página OCULTA para o Chrome (tela desligada/bloqueada, janela minimizada ou coberta por outro
    // programa): o Facebook não abre a conversa nem carrega as mensagens assim (1.8.10) — não clica, não espera 25 s
    // nem 3,5 min; a conversa fica para a próxima rodada. Nunca tira a janela de minimizada nem rouba o foco do Windows.
    const view = await pageVisibility(tabId);
    if (view.visibility === "hidden") return { ok: false, hidden: true, error: hiddenTabMessage(focus.info, awakeInfo), opened: { ok: false, focus: focus.info, view, awake: awakeInfo } };
    const prep = await pageCall(tabId, { type: "mp-inbox-prepare-open", threadKey: thread.threadKey, contactName: thread.contactName || "" }, 60000)
      .catch((error) => ({ ok: false, error: error.message }));
    if (!prep?.ok) return { ok: false, error: prep?.error || "Não preparou o clique.", stack: prep?.stack || "", opened: { ok: false, focus: focus.info } };
    const startedAt = Date.now();
    const click = await trustedClick(tabId, prep.x, prep.y);
    let state = await waitOpened(tabId, thread.contactName || "", prep.before, prep.iframes);
    const waitedMs = Date.now() - startedAt;
    const how = `clique ${click.ok ? "confiável" : `sem depurador (${click.reason})`} na linha ${prep.by}${prep.hitOk === false ? ", ponto fora do item ou sobre o botão de menu" : ""}`;
    let read;
    if (state.found) {
      read = await readOpenThread(tabId, thread, readMs);
    } else if (prep.threadId) {
      // Último recurso: endereço da conversa revelado por um atributo do item; só lê se a janela tiver o nome.
      await navigateAndWait(tabId, `${FB_ORIGIN}/messages/t/${prep.threadId}/`);
      state = await waitOpened(tabId, thread.contactName || "", "", 0, 15000);
      read = state.found === "painel" ? await readOpenThread(tabId, thread, readMs) : { ok: false, error: `A conversa não abriu nem pelo endereço /messages/t/:id (${how}).` };
    } else {
      read = { ok: false, error: `A conversa não abriu em ${Math.round(waitedMs / 1000)} s depois do ${how} (aba em ${state.path || "?"}).` };
    }
    if (read.ok) return { ...read, opened: { ok: true, how, found: state.found } };
    const diagnostic = await pageCall(tabId, { type: "mp-inbox-open-diagnostic", before: prep.before, waitedMs, stage: state.found ? "abriu_sem_mensagens" : "sem_painel" }, 15000).catch((error) => ({ error: error.message }));
    return { ...read, opened: { ok: Boolean(state.found), focus: focus.info, view: await pageVisibility(tabId), click, point: { by: prep.by, hitOk: prep.hitOk, innerButtons: prep.innerButtons }, attrNames: prep.attrNames, hasThreadId: Boolean(prep.threadId), state, diagnostic } };
  } finally {
    await focus.restore();
  }
}

// awakeInfo (1.9.8): { attached, awake, error } da emulação de foco ligada para esta conversa (withAwakePage).
async function readThread(tabId, thread, config, awakeInfo = null) {
  // 1ª leitura (histórico inteiro) pode levar alguns minutos numa conversa longa.
  // maxMs: o leitor para de rolar antes do prazo e devolve o que juntou (1.8.7 — antes podia passar de 5 min).
  const readMs = thread.full ? THREAD_READ_MS.full : THREAD_READ_MS.incremental;
  let read;
  if (String(thread.threadUrl || "").startsWith(FB_PREFIX)) {
    await navigateAndWait(tabId, thread.threadUrl);
    await injectInbox(tabId);
    read = await readOpenThread(tabId, thread, readMs);
  } else {
    read = await openAndReadByClick(tabId, thread, readMs, awakeInfo);
  }
  // Falhou (não abriu, página sem resposta ou 0 mensagens): diagnóstico com o retrato tirado direto da página.
  if (!read?.ok && !read?.checkpoint) {
    const tab = await chrome.tabs.get(tabId).catch(() => ({}));
    const payload = {
      stage: "open_conversation",
      result: read?.hidden ? "aba_oculta" : read?.lost ? "sem_resposta_da_pagina" : read?.opened && !read.opened.ok ? "nao_abriu" : "sem_mensagens",
      version: chrome.runtime.getManifest().version,
      path: MP_PATH(tab.url),
      error: String(read?.error || "").replace(thread.contactName || "\u0000", "NOME").slice(0, 500),
      stack: String(read?.stack || "").slice(0, 1500),
      opened: read?.opened ? { ...read.opened, diagnostic: undefined } : null,
      openedPage: read?.opened?.diagnostic || null,
      view: await pageVisibility(tabId),
      awake: awakeInfo,
      snapshot: read?.hidden ? null : await takeSnapshot(tabId)
    };
    read = { ...read, error: `${read?.error || "Não abriu a conversa."}${await sendOpenDiagnostic(config, payload)}` };
  }
  // threadUrl lido na conversa (1.9.2): o CRM guarda e o envio abre a conversa direto por ele.
  return { read, conversation: { threadKey: thread.threadKey, threadUrl: thread.threadUrl || read?.threadUrl || "", contactName: thread.contactName, contactPhotoUrl: thread.contactPhotoUrl, listingTitle: thread.listingTitle, listingUrl: read?.listingUrl || "", lastActivityAt: thread.lastActivityAt || null, messages: read?.messages || [] } };
}

// Caminho anonimizado (mesma regra de MP.skeletonPath, que só existe na página).
function MP_PATH(href) {
  try {
    return new URL(href || "").pathname.replace(/\d{4,}/g, ":id").slice(0, 120);
  } catch {
    return "";
  }
}

async function pauseForCheckpoint(where) {
  const state = await loadState();
  await saveState({ ...state, pausedUntil: new Date(Date.now() + CHECKPOINT_PAUSE_MS).toISOString(), pauseReason: `O Facebook pediu verificação ou avisou de limite (${where}). Resolva no Facebook; a extensão volta sozinha em 24 h.` });
  notify("Marketplace pausado por 24 h", `O Facebook pediu verificação ou avisou de limite (${where}). Nada será lido nem enviado até lá.`);
}

// Envio pelo CRM (1.9.2 — os corretores não têm acesso ao Facebook; dependem 100% deste envio). Abre a conversa pelo
// endereço direto quando o CRM já o tem (lido na conversa); senão, pela lista com o clique confiável e espera de até
// 45 s. A aba fica visível só durante o envio. Falha antes de digitar → retry (o CRM tenta de novo a cada 30 s, até 24 h);
// depois do Enter sem confirmação → unconfirmed: na próxima tentativa (1.9.6) o CRM manda `verify` e a extensão CONFERE a
// conversa antes de digitar — nunca reenvia no escuro. Conversa que o Facebook não deixa responder → closed (para).
const SEND_OPEN_WAIT_MS = 45 * 1000;

async function sendOutbound(tabId, config, message) {
  // 1.9.8: depurador + emulação de foco só durante o envio (abrir a conversa, conferir, digitar).
  const outcome = await withAwakePage(tabId, (awakeInfo) => sendOnPage(tabId, message, awakeInfo));
  await postOutboundResult(config, message.id, outboundResultBody(outcome)).catch((error) => console.warn("[marketplace] retorno do envio falhou:", error?.message || error));
  return outcome;
}

async function sendOnPage(tabId, message, awakeInfo) {
  let outcome;
  let focus = null;
  try {
    // 1.9.5: resposta com arquivo (foto/PDF) — baixa do CRM ANTES de abrir a conversa (falha aqui = nada enviado).
    const file = message.attachment ? await downloadAttachment(message.attachment).catch((error) => { throw Object.assign(error, { beforeSend: true }); }) : null;
    focus = await focusTab(tabId);
    if (String(message.threadUrl || "").startsWith(FB_PREFIX)) {
      await navigateAndWait(tabId, message.threadUrl).catch((error) => { throw Object.assign(error, { beforeSend: true }); });
      const state = await waitOpened(tabId, "", "", 0, SEND_OPEN_WAIT_MS);
      if (!state.found) throw Object.assign(new Error("A conversa não abriu pelo endereço direto."), { beforeSend: true });
    } else {
      // Conversa sem endereço: reabre a caixa do Marketplace e clica no item (clique confiável, espera de até 45 s).
      const inbox = await readInbox(tabId).catch((error) => { throw Object.assign(error, { beforeSend: true }); });
      if (!(inbox?.threads || []).some((thread) => thread.threadKey === message.threadKey)) throw Object.assign(new Error("Conversa não encontrada na caixa do Marketplace."), { beforeSend: true });
      const opened = await pageCall(tabId, { type: "mp-inbox-open", threadKey: message.threadKey, openWaitMs: SEND_OPEN_WAIT_MS }, SEND_OPEN_WAIT_MS + 60000)
        .catch((error) => ({ ok: false, error: error.message }));
      if (!opened?.ok) throw Object.assign(new Error(opened?.error || "Não abriu a conversa."), { beforeSend: true });
    }
    // 1.9.6 (dono, 2026-10-24): reenvio de resposta cuja tentativa anterior pode ter saído → confere a conversa ANTES de
    // digitar. Já está lá = enviada (nada é digitado); não deu para conferir = não digita (o CRM tenta de novo em 30 s).
    const check = message.verify
      ? await pageCall(tabId, { type: "mp-inbox-verify", text: message.body, knownSame: message.knownSame, file: message.attachment ? { type: message.attachment.mime || message.attachment.type, name: message.attachment.name } : null }, 60000)
        .catch((error) => ({ ok: false, unknown: true, error: error.message }))
      : null;
    outcome = verifyOutcome(check) || (file
      ? await pageCall(tabId, { type: "mp-inbox-send-file", file }, 150000)
      : await pageCall(tabId, { type: "mp-inbox-send", text: message.body, automatic: message.automatic === true }, 120000));
  } catch (error) {
    // Falhou antes de digitar (conversa não aberta, aba fechada): pode tentar de novo; senão, sem saber se saiu, não reenvia.
    outcome = { ok: false, sentAttempted: !error?.beforeSend, error: error.message };
    // 1.9.3: falha ao abrir com a página oculta para o Chrome → diz o motivo real no erro (vai ao CRM e ao aviso do admin).
    if (error?.beforeSend && (await pageVisibility(tabId)).visibility === "hidden") outcome.error = `${error.message} ${hiddenTabMessage(focus?.info, awakeInfo)}`.slice(0, 480);
  } finally {
    if (focus) await focus.restore().catch(swallow("devolver o foco à aba anterior"));
  }
  return outcome;
}

// Aba da rodada fechada no meio (erro real "No tab with id"): pega/recria a aba da janela de trabalho antes do envio.
async function ensureRoundTab(tab, round) {
  const alive = tab?.id ? await chrome.tabs.get(tab.id).catch(() => null) : null;
  if (alive) return alive;
  const fresh = await getWorkTab();
  await round.set({ tabId: fresh.id }).catch(swallow("gravar a aba da rodada"));
  await sleep(500);
  return fresh;
}

// --- Trava da sincronização (1.8.7) -------------------------------------------------------------------------------
// Regras em lib/chat-agenda.js (chatLockAlive). Cada worker tem uma identidade; trava de outro worker = morta
// (o Chrome encerrou o worker no meio da rodada e o finally não rodou — causa do "sincronizando" eterno da 1.8.6).
const WORKER_INSTANCE = crypto.randomUUID();
const CHAT_HEARTBEAT_MS = 20 * 1000;
const STEP_TIMEOUT_MS = { inbox: 180 * 1000, threadFull: 300 * 1000, thread: 150 * 1000, post: 45 * 1000, outbox: 30 * 1000, send: 330 * 1000 };
const THREAD_READ_MS = { full: 180 * 1000, incremental: 60 * 1000 };
const READ_MARGIN_MS = { full: 30 * 1000, incremental: 15 * 1000 };

class ChatLockLost extends Error {}

async function loadChatLock() {
  const { chatLock } = await chrome.storage.local.get("chatLock");
  return chatLock || null;
}

async function chatBusy(now = new Date()) {
  return chatLockAlive(await loadChatLock(), { now, instance: WORKER_INSTANCE });
}

// Fecha a aba e o depurador que uma rodada morta deixou para trás (o worker morreu antes do finally).
async function closeOrphanTab(lock) {
  if (!lock?.tabId) return;
  await awake.release(lock.tabId);
  // A aba da janela de trabalho (1.9.4) fica: é reutilizada. Só fecha aba de rodada de versão anterior.
  if (!(await isWorkTab(lock.tabId))) await chrome.tabs.remove(lock.tabId).catch(swallow("fechar aba órfã do chat"));
}

async function releaseDeadChatLock(reason) {
  const lock = await loadChatLock();
  if (!lock) return;
  await closeOrphanTab(lock);
  await chrome.storage.local.remove("chatLock");
  console.warn(`[marketplace] trava do chat solta (${reason}); etapa: ${lock.step || "?"}`);
}

// Botão "Destravar sincronização" do popup. A rodada viva (se houver) percebe na próxima etapa e para.
async function unlockChat() {
  const lock = await loadChatLock();
  await closeOrphanTab(lock);
  await chrome.storage.local.remove("chatLock");
  await chrome.storage.local.set({ chatSkip: { at: new Date().toISOString(), result: "chat_destravado", detail: lock?.step ? `estava em: ${lock.step}` : "não havia trava" } });
  return { ok: true, released: Boolean(lock), step: lock?.step || "" };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Etapa "${label}" passou de ${Math.round(timeoutMs / 1000)} s e foi abandonada.`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

// Uma rodada dona da trava: batimento a cada 20 s (também mantém o worker vivo — toda chamada à API da extensão
// zera o relógio de inatividade do MV3), etapa atual + progresso visíveis no popup, timeout por etapa.
function createChatRound(token, startedAt) {
  let current = { token, instance: WORKER_INSTANCE, startedAt, stepAt: startedAt, heartbeatAt: startedAt, step: "iniciando", tabId: null, progress: null };
  let lost = false;
  const write = async (patch) => {
    if (lost) throw new ChatLockLost("A trava foi solta (Destravar ou rodada nova); esta rodada parou.");
    const stored = await loadChatLock();
    if (stored?.token !== token) {
      lost = true;
      throw new ChatLockLost("A trava foi solta (Destravar ou rodada nova); esta rodada parou.");
    }
    current = { ...current, ...patch, heartbeatAt: new Date().toISOString() };
    await chrome.storage.local.set({ chatLock: current });
  };
  const timer = setInterval(() => write({}).catch(swallow("pulso da trava do chat")), CHAT_HEARTBEAT_MS);
  return {
    get lost() {
      return lost;
    },
    elapsed: () => Date.now() - new Date(startedAt).getTime(),
    set: (patch) => write(patch),
    async step(label, run, timeoutMs, progress) {
      await write({ step: label, stepAt: new Date().toISOString(), ...(progress ? { progress: { ...progress } } : {}) });
      return withTimeout(Promise.resolve().then(run), timeoutMs, label);
    },
    stop() {
      clearInterval(timer);
    }
  };
}

// Rodada pulada por pausa (1.9.8): sinal ao CRM com o motivo, sem abrir o Facebook.
async function signalSkip(reason, state) {
  const config = await loadConfig();
  if (!config.key) return;
  const detail = reason === "pausado" ? "Extensão pausada no popup (botão Pausar)." : reason === "parado_crm" ? "Parada pelo CRM (Extensões › Parar tudo)." : state?.pauseReason || "Pausa de 24 h: o Facebook pediu verificação ou avisou de limite.";
  try {
    const synced = await withTimeout(postChatSync(config, [], undefined, roundStatus({ skipReason: reason, skipDetail: detail })), 45000, "sinal ao CRM");
    if (synced?.settings) await chrome.storage.local.set({ chatSettings: synced.settings });
  } catch (error) {
    console.warn("[marketplace] sinal da pausa ao CRM falhou:", error?.message || error);
  }
}

async function chatTick() {
  const { chatSettings, chatPreviews, chatBackoff } = await chrome.storage.local.get(["chatSettings", "chatPreviews", "chatBackoff"]);
  const state = await loadState();
  const previousLock = await loadChatLock();
  const runtime = await crmLink.estado();
  const decision = decideChatTick({ state, settings: chatSettings || {}, now: new Date(), lock: previousLock, instance: WORKER_INSTANCE, stoppedByCrm: runtime.stopped === true });
  if (decision.action !== "sync") {
    // Rodada pulada vai para `chatSkip` — não apaga as contagens/caminho/erro da última rodada (`chatLast`).
    await chrome.storage.local.set({ chatSkip: { at: new Date().toISOString(), result: decision.reason } });
    // 1.9.8: pausa (botão Pausar ou 24 h de verificação) também avisa o CRM, com o motivo — nunca silêncio. Não toca no Facebook.
    if (SIGNALED_SKIPS.has(decision.reason)) await signalSkip(decision.reason, state);
    if (decision.reason !== "chat_em_andamento") await reportHealth({ ok: true, stage: decision.reason }).catch(swallow("sinal de saúde (chat pulado)"));
    return decision;
  }
  const config = await loadConfig();
  if (!config.key) {
    await chrome.storage.local.set({ chatSkip: { at: new Date().toISOString(), result: "sem_configuracao" } });
    return { reason: "sem_configuracao" };
  }
  // Trava morta de uma rodada anterior: fecha a aba que ficou aberta e registra onde ela parou.
  if (previousLock) await closeOrphanTab(previousLock);

  const startedAt = new Date().toISOString();
  const token = crypto.randomUUID();
  await chrome.storage.local.set({ chatLock: { token, instance: WORKER_INSTANCE, startedAt, stepAt: startedAt, heartbeatAt: startedAt, step: "abrindo aba", tabId: null, progress: null } });
  const round = createChatRound(token, startedAt);
  // Diagnóstico do popup: o que foi listado, lido, enviado e o erro (se houver).
  const summary = { listed: 0, read: 0, sent: 0, failed: 0, created: 0, newMessages: 0, pending: 0, error: "", inboxUrl: "", steps: "" };
  if (previousLock?.step) summary.steps = `rodada anterior morreu em "${previousLock.step}" → `;
  let result = "chat_erro";
  let tab = null;
  let previews = { ...(chatPreviews || {}) };
  let settings = chatSettings || {};
  // 1.9.8 — nunca silêncio: toda rodada chama a sincronização do CRM (sinal MKT-2g) com o estado dela (lib/round-status.js).
  // Antes, uma falha na leitura da caixa encerrava a rodada sem chamar o CRM e sem enviar as respostas dos corretores.
  let signaled = false;
  let inboxError = "";
  let hiddenError = "";
  let fatal = null;
  const sync = async (conversations, status) => {
    const response = await postChatSync(config, conversations, undefined, status);
    signaled = true;
    return response;
  };
  try {
    // 1.9.4: a aba da janela de trabalho (reutilizada), nunca aba nova na janela do dono.
    tab = await getWorkTab();
    await round.set({ tabId: tab.id });
    await protectTab(tab.id);
    // 1.9.8: o depurador (cliques reais + emulação de foco) liga só durante cada ação no Facebook (withAwakePage).

    let inbox = null;
    try {
      inbox = await round.step("lendo a caixa do Marketplace", () => withAwakePage(tab.id, () => readInbox(tab.id)), STEP_TIMEOUT_MS.inbox, summary);
    } catch (error) {
      if (error instanceof ChatLockLost) throw error;
      // Caixa não lida (prazo, página sem resposta, aba fechada): registra o motivo e segue para o CRM e para os envios.
      inboxError = `Caixa do Marketplace não lida: ${error?.message || error}`;
      summary.error = inboxError;
      await awake.release(tab.id);
    }
    summary.inboxUrl = inbox?.url || "";
    summary.steps += (inbox?.steps || []).join(" → ");
    if (inbox?.checkpoint) {
      summary.error = "O Facebook pediu verificação/limite na caixa do Marketplace.";
      await pauseForCheckpoint("caixa do Marketplace");
      return { reason: (result = "chat_erro") };
    }
    const threads = inbox?.threads || [];
    summary.listed = threads.length;
    if (inbox && !threads.length) {
      summary.error = "Nenhuma conversa encontrada na caixa do Marketplace (seletores a calibrar ou caixa vazia).";
      await crmLink.registrarSeletor("inbox: lista de conversas", "nenhuma conversa achada na caixa do Marketplace");
      // Envia sozinho o diagnóstico de estrutura (no máximo 1 por hora) para calibrar os seletores.
      const { lastDiagnosticAt } = await chrome.storage.local.get("lastDiagnosticAt");
      if (!lastDiagnosticAt || Date.now() - new Date(lastDiagnosticAt).getTime() > 60 * 60 * 1000) {
        summary.error += ` Diagnóstico: ${await round.step("enviando diagnóstico", () => withAwakePage(tab.id, () => sendDiagnostics(tab.id, config, { navigate: true })), STEP_TIMEOUT_MS.inbox, summary)}`;
      }
    }

    // Envio incremental: cada conversa lida vai ao CRM logo em seguida e a prévia é guardada na hora (se o worker
    // morrer depois, a conversa já está no CRM e não é relida do zero).
    // 1ª carga: conversas anteriores ao dia configurado no CRM nem são abertas (prévia guardada = não relê).
    const { keep, ignored } = splitIgnored(threads, settings.firstLoadIgnoreBefore);
    if (ignored.length) {
      summary.ignored = ignored.length;
      summary.steps += ` → ${ignored.length} conversa(s) anteriores a ${settings.firstLoadIgnoreBefore} ignorada(s)`;
      previews = rememberPreviews(previews, ignored);
      await chrome.storage.local.set({ chatPreviews: previews });
    }
    // Conversa que falhou há pouco espera a vez dela (4 → 8 → 15 → 30 min; lib/chat-agenda.js).
    let backoff = chatBackoff || {};
    const waiting = keep.filter((thread) => threadRetryBlocked(backoff, thread.threadKey));
    if (waiting.length) summary.steps += ` → ${waiting.length} conversa(s) com falha recente aguardando nova tentativa`;
    const toRead = threadsToRead(keep.filter((thread) => !threadRetryBlocked(backoff, thread.threadKey)), previews);
    summary.pending = toRead.length;
    let posted = 0;
    for (const [index, thread] of toRead.entries()) {
      // 1.10.0: "Parar tudo" no CRM vale na hora — confere antes de abrir cada conversa.
      if (await stoppedByCrm()) {
        summary.steps += " → parada pelo CRM (Extensões › Parar tudo)";
        result = "chat_parcial";
        break;
      }
      if (round.elapsed() > ROUND_BUDGET_MS) {
        summary.steps += ` → tempo da rodada esgotado; ${toRead.length - index} conversa(s) ficam para a próxima`;
        result = "chat_parcial";
        break;
      }
      const label = `lendo conversa ${index + 1}/${toRead.length} (${thread.contactName || "sem nome"}${thread.full ? ", histórico completo" : ""})`;
      let outcome;
      try {
        outcome = await round.step(label, () => withAwakePage(tab.id, (awakeInfo) => readThread(tab.id, thread, config, awakeInfo)), thread.full ? STEP_TIMEOUT_MS.threadFull : STEP_TIMEOUT_MS.thread, summary);
      } catch (error) {
        if (error instanceof ChatLockLost) throw error;
        await awake.release(tab.id);
        outcome = { read: { ok: false, error: error.message }, conversation: null };
      }
      const { read, conversation } = outcome;
      if (read?.checkpoint) {
        await pauseForCheckpoint("conversa do Marketplace");
        return { reason: (result = "chat_erro") };
      }
      summary.steps += ` → ${thread.contactName}: ${read?.ok ? `${(read.messages || []).length} msg` : read?.hidden ? "aba oculta" : "falhou"}`;
      // Aba oculta (1.9.3): nenhuma outra conversa abre nesta rodada — para aqui, sem contar falha para a conversa.
      // 1.10.0: parte da tela não achada (ex.: área de mensagens só pelo seletor genérico) vai ao sinal de saúde.
      if (read?.selectorFailed) await crmLink.registrarSeletor(read.selectorFailed, read.error);
      if (read?.hidden) {
        summary.error = read.error;
        hiddenError = read.error;
        result = "chat_parcial";
        break;
      }
      // Sem mensagem nenhuma não vai ao CRM nem guarda a prévia (1.8.9): tenta de novo depois do intervalo (1.9.3).
      if (!read?.ok || !conversation || !conversation.messages.length) {
        if (read?.error) summary.error = `${thread.contactName}: ${read.error}`;
        backoff = recordThreadFailure(backoff, thread.threadKey);
        await chrome.storage.local.set({ chatBackoff: backoff });
        continue;
      }
      try {
        const synced = await round.step(`enviando ao CRM: ${thread.contactName || "conversa"}`, () => sync([conversation], roundStatus({ result: "lendo" })), STEP_TIMEOUT_MS.post, summary);
        posted += 1;
        summary.read += 1;
        summary.created += synced.created || 0;
        summary.newMessages += synced.newMessages || 0;
        settings = synced.settings || settings;
        previews = rememberPreviews(previews, [thread]);
        backoff = clearThreadFailure(backoff, thread.threadKey);
        await chrome.storage.local.set({ chatSettings: settings, chatPreviews: previews, chatBackoff: backoff });
        if (synced.settings?.syncEnabled === false) return { reason: (result = "chat_desligado") };
      } catch (error) {
        if (error instanceof ChatLockLost || error?.status === 401) throw error;
        summary.error = `${thread.contactName}: não chegou ao CRM (${error.message})`;
      }
    }
    // Nenhuma conversa enviada: uma chamada vazia busca a configuração e roda a fila/prazo da roleta no CRM.
    // 1.9.8: leitura com falha (caixa não lida, página oculta) também chama, levando o motivo ao CRM.
    const status = roundStatus({ inboxError, hidden: hiddenError, result: "leitura", note: summary.error });
    if (!posted || !status.ok) {
      const synced = await round.step("consultando o CRM", () => sync([], status), STEP_TIMEOUT_MS.post, summary);
      settings = synced.settings || settings;
      await chrome.storage.local.set({ chatSettings: settings });
      if (synced.settings?.syncEnabled === false) return { reason: (result = "chat_desligado") };
    }

    // 1.9.9: `i` conta só envios (as esperas não contam); fila sem resposta pronta mas com automática marcada
    // para daqui a até 60 s (`nextAt` do CRM) → espera por ela dentro do orçamento — automáticas saem uma a cada 30 s.
    for (let i = 0; i < MAX_SENDS_PER_ROUND; ) {
      // 1.10.0: "Parar tudo" — confere antes de cada envio.
      if (await stoppedByCrm()) {
        summary.steps += " → envios parados pelo CRM (Extensões › Parar tudo)";
        break;
      }
      if (round.elapsed() > ROUND_BUDGET_MS) {
        result = "chat_parcial";
        break;
      }
      const next = await round.step("buscando respostas a enviar", () => fetchNextOutbound(config), STEP_TIMEOUT_MS.outbox, summary);
      if (!next?.message) {
        const wait = outboxWaitMs(next, { now: Date.now(), elapsedMs: round.elapsed() });
        if (!wait) break;
        await round.step(`aguardando a próxima resposta automática (${Math.round(wait / 1000)} s)`, () => sleep(wait), wait + 15000, summary);
        continue;
      }
      i += 1;
      tab = await ensureRoundTab(tab, round);
      const outcome = await round.step(`enviando resposta ${i}`, () => sendOutbound(tab.id, config, next.message), STEP_TIMEOUT_MS.send, summary);
      if (outcome.ok) summary.sent += 1;
      else summary.failed += 1;
      if (outcome.checkpoint) {
        await pauseForCheckpoint("envio de mensagem");
        return { reason: (result = "chat_erro") };
      }
      // 1.9.6 (dono, 2026-10-24): "se a mensagem não foi enviada, você espera 30 segundos e tenta enviar de novo". Espera
      // 30 s e pede a próxima ao CRM (que só devolve a mesma 30 s depois da falha); continua dentro do orçamento da rodada
      // e do máximo de envios por rodada — o resto fica para a próxima rodada (1 min depois, 1.9.9). Conversa bloqueada: o CRM parou.
      if (!outcome.ok) {
        if (round.elapsed() + SEND_RETRY_WAIT_MS > ROUND_BUDGET_MS) break;
        await round.step("aguardando 30 s para reenviar", () => sleep(SEND_RETRY_WAIT_MS), SEND_RETRY_WAIT_MS + 15000, summary);
        continue;
      }
      await sleep(4000 + Math.floor(Math.random() * 6000));
    }
    if (result !== "chat_parcial") result = threadsToRead(keep, previews).length ? "chat_parcial" : "chat_sincronizado";
    return { reason: result, ...summary };
  } catch (error) {
    console.warn("[marketplace] sincronização do chat falhou:", error?.message || error);
    fatal = error;
    summary.error = error?.status === 401 ? "Chave recusada pelo CRM (gere outra no CRM)." : error?.message || String(error);
    result = "chat_erro";
    return { reason: result, error: summary.error };
  } finally {
    round.stop();
    // A aba de trabalho fica aberta para a próxima rodada (1.9.4); só o depurador é desligado (se ficou ligado por uma
    // etapa abandonada pelo prazo).
    if (tab) await awake.release(tab.id);
    // 1.9.8: a rodada parou antes de chamar o CRM → manda o sinal com o motivo (exceto chave recusada ou trava perdida
    // para outra rodada, que já sinaliza).
    if (!signaled && !(fatal instanceof ChatLockLost) && fatal?.status !== 401) {
      await withTimeout(postChatSync(config, [], undefined, roundStatus({ fatalError: summary.error || result })), STEP_TIMEOUT_MS.post, "sinal ao CRM")
        .catch((error) => console.warn("[marketplace] sinal ao CRM falhou:", error?.message || error));
    }
    // Só solta a trava se ainda for desta rodada (Destravar/rodada nova já podem ter trocado).
    const stored = await loadChatLock().catch(swallow("ler a trava do chat no fim da rodada"));
    if (stored?.token === token) await chrome.storage.local.remove("chatLock");
    // 1.9.9: a próxima rodada começa 1 min depois desta terminar (não no meio de um minuto já corrido).
    scheduleNextChatRound();
    summary.pending = Math.max(0, summary.pending - summary.read);
    await chrome.storage.local.set({ chatLast: { at: new Date().toISOString(), startedAt, result, ...summary } });
    // 1.10.0: sinal de saúde ao CRM (tela Extensões) — rodada com erro sempre manda; as demais no máximo a cada 2 min.
    const failed = result === "chat_erro" || Boolean(summary.error);
    if (failed) await crmLink.registrarErro("chat", summary.error || result);
    await reportHealth({ ok: !failed, stage: result, error: summary.error, force: failed }).catch(swallow("sinal de saúde (chat)"));
  }
}

// --- Diagnóstico de estrutura (1.8.5; lista em 1.8.6) ---------------------------------------------------------------
// Na aba dedicada: esqueleto da lista (role=main), da página /marketplace/inbox e do painel Messenger → "Marketplace", enviados ao CRM.
async function sendDiagnostics(tabId, config, { navigate = true } = {}) {
  const sent = [];
  try {
    if (navigate) await navigateAndWait(tabId, INBOX_URL);
    await injectInbox(tabId);
    // 1.8.6: lista ancorada em role=main e nos clicáveis com miniatura (fecha janelas de chat antes).
    const list = await pageCall(tabId, { type: "mp-inbox-diagnose", stage: "inbox_list" }, 60000);
    await postDiagnostic(config, "inbox_list", list);
    sent.push(`lista (${list?.counts?.withThumb ?? "?"} clicáveis com miniatura, ${list?.counts?.items ?? "?"} itens)`);
    const page = await pageCall(tabId, { type: "mp-inbox-diagnose", stage: "inbox_page" }, 60000);
    await postDiagnostic(config, "inbox_page", page);
    sent.push(`página (${page?.counts?.dots ?? "?"} textos " · ")`);
    await navigateAndWait(tabId, INBOX_URL);
    await injectInbox(tabId);
    const panel = await pageCall(tabId, { type: "mp-inbox-diagnose", stage: "messenger_panel" }, 90000);
    await postDiagnostic(config, "messenger_panel", panel);
    sent.push(`painel (${panel?.counts?.dots ?? "?"} textos " · ")`);
    await chrome.storage.local.set({ lastDiagnosticAt: new Date().toISOString() });
    return `enviado: ${sent.join(", ")}`;
  } catch (error) {
    return `falhou${sent.length ? ` depois de ${sent.join(", ")}` : ""}: ${error.message}`;
  }
}

async function diagnoseNow() {
  const config = await loadConfig();
  if (!config.key) return { error: "Configure a chave nas opções." };
  if (await chatBusy()) return { error: "Sincronização em andamento; tente de novo em 1 min." };
  const tab = await getWorkTab();
  const result = await withAwakePage(tab.id, () => sendDiagnostics(tab.id, config));
  await chrome.storage.local.set({ lastDiagnostic: { at: new Date().toISOString(), result } });
  return { result };
}
