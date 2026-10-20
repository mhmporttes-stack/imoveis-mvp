// Service worker da extensão. Agenda (alarme de 15 min), fila do CRM, abertura da aba do Facebook e retorno ao CRM.
// Regras de agenda/limite em lib/agenda.js (testadas). Seletores do Facebook em selectors.js.
import { CHECK_EVERY_MINUTES, REASON_LABELS, buildResultBody, decideTick, finishJob, initialState, recordCheck, setManualPause, startJob } from "./lib/agenda.js";
import { DEFAULT_CRM_URL, downloadPhotos, fetchNextListing, postResult } from "./lib/crm-api.js";

const ALARM = "mp-tick";
const PUBLISH_TIMEOUT_MS = 12 * 60 * 1000;
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

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) tick("alarme").catch((error) => console.warn("[marketplace] tique falhou:", error));
});

function waitTabComplete(tabId, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("A página do Facebook não terminou de carregar."));
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") listener(tabId, { status: "complete" });
    }).catch(() => {});
  });
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["selectors.js", "content.js"] });
}

function sendWithTimeout(tabId, message, timeoutMs) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, message),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Tempo esgotado esperando a página do Facebook.")), timeoutMs))
  ]);
}

async function screenshot(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 45 });
  } catch {
    return ""; // sem permissão/aba não visível: fica só a descrição do passo
  }
}

async function runPublication(listing) {
  let photos;
  try {
    photos = await downloadPhotos(listing.photoUrls);
  } catch (error) {
    return { ok: false, clickedPublish: false, step: "baixar fotos do CRM", error: error.message };
  }

  // Formulário de imóvel direto; se não abrir, content.js volta para "Escolha o tipo de classificado" e clica no cartão.
  const tab = await chrome.tabs.create({ url: `${FB_ORIGIN}/marketplace/create/rental`, active: true });
  try {
    await waitTabComplete(tab.id);
    await inject(tab.id);
    let outcome = await sendWithTimeout(tab.id, { type: "mp-publish", listing, photos }, PUBLISH_TIMEOUT_MS);
    if (outcome?.navigated) {
      // O formulário direto não abriu e a aba foi para a escolha do tipo de classificado: uma única continuação.
      await waitTabComplete(tab.id);
      await inject(tab.id);
      outcome = await sendWithTimeout(tab.id, { type: "mp-publish", listing, photos }, PUBLISH_TIMEOUT_MS);
    }
    if (outcome?.ok && !outcome.url) {
      await chrome.tabs.update(tab.id, { url: `${FB_ORIGIN}/marketplace/you/selling` });
      await waitTabComplete(tab.id);
      await inject(tab.id);
      const found = await sendWithTimeout(tab.id, { type: "mp-find-url", price: listing.price }, 60000).catch(() => ({}));
      outcome = { ...outcome, url: found?.url || "" };
    }
    if (!outcome?.ok) outcome = { ...outcome, screenshot: await screenshot(tab.windowId) };
    return outcome || { ok: false, clickedPublish: false, step: "página do Facebook", error: "Sem resposta da página." };
  } catch (error) {
    const current = await chrome.tabs.get(tab.id).catch(() => null);
    const checkpoint = current?.url ? /\/(checkpoint|login|two_step_verification)/.test(new URL(current.url).pathname) : false;
    // Sem saber se clicou em Publicar: trata como clicado (não tenta de novo, evita anúncio duplicado).
    return { ok: false, clickedPublish: true, checkpoint, step: "página do Facebook", error: error.message, screenshot: await screenshot(tab.windowId) };
  }
  // Em caso de falha a aba fica aberta para você ver o que aconteceu; quando dá certo, tick() fecha.
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
    const tabs = await chrome.tabs.query({ url: `${FB_ORIGIN}/marketplace/*` });
    for (const tab of tabs) if (tab.url?.includes("/marketplace/you/selling") || tab.url?.includes("/marketplace/item/")) chrome.tabs.remove(tab.id).catch(() => {});
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
