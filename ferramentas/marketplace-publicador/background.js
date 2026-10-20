// Service worker da extensão. Agenda (alarme de 15 min), fila do CRM, abertura da aba do Facebook e retorno ao CRM.
// Regras de agenda/limite em lib/agenda.js (testadas). Seletores do Facebook em selectors.js.
import { CHECK_EVERY_MINUTES, REASON_LABELS, buildResultBody, decideTick, finishJob, initialState, recomputeFromHistory, recordCheck, setManualPause, startJob } from "./lib/agenda.js";
import { DEFAULT_CRM_URL, downloadPhotos, fetchNextListing, postResult } from "./lib/crm-api.js";

const ALARM = "mp-tick";
const PUBLISH_TIMEOUT_MS = 12 * 60 * 1000;
const PAGE_LOAD_TIMEOUT_MS = 45 * 1000;
const FORM_WAIT_MS = 15 * 1000;
const FB_ORIGIN = "https://www.facebook.com";

async function loadState() {
  const { state } = await chrome.storage.local.get("state");
  return { ...initialState(), ...(state || {}) };
}

async function saveState(state) {
  await chrome.storage.local.set({ state });
  return state;
}

async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  return { baseUrl: config?.baseUrl || DEFAULT_CRM_URL, key: config?.key || "" };
}

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icones/icon-192-mm.png", title, message, priority: 2 });
}

function ensureAlarm() {
  chrome.alarms.get(ALARM, (alarm) => {
    if (!alarm) chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MINUTES });
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  ensureAlarm();
  // Atualização: refaz a contagem do dia pelo histórico (versão 1.1.0 contava falha e travava 1 h).
  if (details.reason === "update") await saveState(recomputeFromHistory(await loadState(), new Date()));
});
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) tick("alarme").catch((error) => console.warn("[marketplace] tique falhou:", error));
});

// Espera a aba terminar de carregar DEPOIS de um comando de navegação (o listener é ligado antes do comando, então
// o "complete" da página anterior não engana).
function navigateAndWait(tabId, url, timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
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

  // Aba NOVA e dedicada (nunca a aba em que você está navegando); fechada no final, com print em caso de falha.
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  await sleep(500);
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
        const found = await sendWithTimeout(tab.id, { type: "mp-find-url", price: listing.price }, 60000).catch(() => ({}));
        outcome = { ...outcome, url: found?.url || "" };
      }
      outcome = outcome || { ok: false, clickedPublish: false, step: "página do Facebook", error: "Sem resposta da página." };
    }
  } catch (error) {
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    const checkpoint = current?.url ? /\/(checkpoint|login|two_step_verification)/.test(new URL(current.url).pathname) : false;
    outcome = { ok: false, clickedPublish: await reachedPublishClick(), checkpoint, step: (await loadState()).running?.step || "página do Facebook", error: `${error.message} (aba em ${current?.url || "?"})` };
  }
  if (!outcome.ok) outcome = { ...outcome, screenshot: await screenshot(tab.windowId) };
  await chrome.tabs.remove(tab.id).catch(() => {});
  return outcome;
}

async function tick(origin) {
  let state = await loadState();
  const decision = decideTick(state, new Date());
  if (decision.action !== "check") {
    await saveState(recordCheck(state, decision.reason));
    return { reason: decision.reason };
  }

  const config = await loadConfig();
  const next = await fetchNextListing(config);
  if (!next.listing) {
    await saveState(recordCheck(state, next.reason));
    if (next.reason === "chave_invalida") notify("Publicador do Marketplace", REASON_LABELS.chave_invalida);
    return { reason: next.reason };
  }

  const listing = next.listing;
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
  if (outcome.ok) {
    notify("Anúncio publicado", `${listing.title}${outcome.url ? "" : " — confira o link no Facebook"}${reportError}`);
  } else if (outcome.checkpoint) {
    notify("Marketplace pausado por 24 h", "O Facebook pediu verificação ou avisou de limite. Resolva no Facebook; nada mais será publicado até lá.");
  } else {
    notify("Falha ao publicar no Marketplace", `${listing.title}: ${outcome.step} — ${outcome.error}`);
  }
  return { reason: outcome.ok ? "publicado" : "falhou" };
}

// Mensagens do popup/opções e progresso da aba.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "mp-progress") {
      const state = await loadState();
      if (state.running) await saveState({ ...state, running: { ...state.running, step: message.step } });
      return { ok: true };
    }
    if (message?.type === "mp-status") {
      const config = await loadConfig();
      return { state: await loadState(), config: { baseUrl: config.baseUrl, hasKey: Boolean(config.key) } };
    }
    if (message?.type === "mp-pause") return { state: await saveState(setManualPause(await loadState(), message.paused)) };
    if (message?.type === "mp-check-now") return tick("manual");
    return { ok: false };
  })().then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});
