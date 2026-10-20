// Service worker da extensão. Agenda (alarme de 15 min), fila do CRM, abertura da aba do Facebook e retorno ao CRM.
// Regras de agenda/limite em lib/agenda.js (testadas). Seletores do Facebook em selectors.js.
import { CHECK_EVERY_MINUTES, REASON_LABELS, STALE_RUN_MS, buildResultBody, decideTick, finishJob, initialState, localWaitUntil, recomputeFromHistory, recordCheck, setManualPause, startJob } from "./lib/agenda.js";
import { DEFAULT_CRM_URL, downloadPhotos, fetchNextListing, fetchNextOutbound, postChatSync, postOutboundResult, postResult } from "./lib/crm-api.js";
import { CHAT_EVERY_MINUTES, MAX_SENDS_PER_ROUND, decideChatTick, outboundResultBody, rememberPreviews, threadsToRead } from "./lib/chat-agenda.js";
import { CHECKPOINT_PAUSE_MS } from "./lib/agenda.js";

const ALARM = "mp-tick";
const CHAT_ALARM = "mp-chat";
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
  chrome.alarms.get(CHAT_ALARM, (alarm) => {
    if (!alarm) chrome.alarms.create(CHAT_ALARM, { delayInMinutes: 1, periodInMinutes: CHAT_EVERY_MINUTES });
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
  if (alarm.name === CHAT_ALARM) chatTick().catch((error) => console.warn("[marketplace] chat falhou:", error));
});

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
const attachedTabs = new Set();
const KEYS = {
  ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  Enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Backspace: { code: "Backspace", windowsVirtualKeyCode: 8 },
  Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
  a: { code: "KeyA", windowsVirtualKeyCode: 65 }
};

async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedTabs.add(tabId);
  } catch (error) {
    console.warn("[marketplace] depurador não ligou (segue com eventos comuns):", error?.message || error);
  }
}

async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;
  attachedTabs.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => {});
}

function cdp(tabId, method, params) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function trustedInput(tabId, message) {
  if (!attachedTabs.has(tabId)) return { ok: false, reason: "sem_depurador" };
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

  // Aba NOVA e dedicada (nunca a aba em que você está navegando); fechada no final, com print em caso de falha.
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  await sleep(500);
  await attachDebugger(tab.id);
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
  await detachDebugger(tab.id);
  await chrome.tabs.remove(tab.id).catch(() => {});
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

async function tick(origin, onDecision = () => {}) {
  let state = await recoverInterruptedRun(await loadState());
  const decision = decideTick(state, new Date());
  if (decision.action !== "check") {
    const waitUntil = localWaitUntil(state, decision.reason);
    await saveState(recordCheck(state, decision.reason, new Date(), waitUntil));
    onDecision({ reason: decision.reason, waitUntil });
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "mp-trusted") return sender.tab?.id ? trustedInput(sender.tab.id, message) : { ok: false, reason: "sem_aba" };
    if (message?.type === "mp-progress") {
      const state = await loadState();
      if (state.running) await saveState({ ...state, running: { ...state.running, step: message.step } });
      return { ok: true };
    }
    if (message?.type === "mp-status") {
      const config = await loadConfig();
      const { chatLast } = await chrome.storage.local.get("chatLast");
      return { state: await loadState(), config: { baseUrl: config.baseUrl, hasKey: Boolean(config.key) }, chatLast: chatLast || null };
    }
    if (message?.type === "mp-pause") return { state: await saveState(setManualPause(await loadState(), message.paused)) };
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
// A cada ~2 min (horário e liga/desliga vêm do CRM): abre uma aba própria na caixa de entrada do MARKETPLACE (nunca a
// lista geral do Messenger), lê só as conversas que mudaram, manda ao CRM e envia as respostas que os corretores
// escreveram (cliques/teclas reais, no máximo 3 por rodada e o limite por hora do CRM). Nunca responde sozinho.
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

async function readInbox(tabId) {
  await navigateAndWait(tabId, INBOX_URL);
  await injectInbox(tabId);
  return sendWithTimeout(tabId, { type: "mp-inbox-list" }, 120000);
}

async function readThread(tabId, thread) {
  if (String(thread.threadUrl || "").startsWith(FB_PREFIX)) {
    await navigateAndWait(tabId, thread.threadUrl);
    await injectInbox(tabId);
  } else {
    // Item sem link (painel do Messenger): abre a janela de chat clicando no item, na mesma página.
    const opened = await sendWithTimeout(tabId, { type: "mp-inbox-open", threadKey: thread.threadKey }, 30000);
    if (!opened?.ok) return { read: { ok: false, error: opened?.error || "Não abriu a conversa." }, conversation: null };
  }
  // 1ª leitura (histórico inteiro) pode levar alguns minutos numa conversa longa.
  const read = await sendWithTimeout(tabId, { type: "mp-inbox-read", threadKey: thread.threadKey, full: thread.full === true, contactName: thread.contactName || "" }, thread.full ? 300000 : 30000);
  return { read, conversation: { threadKey: thread.threadKey, threadUrl: thread.threadUrl, contactName: thread.contactName, contactPhotoUrl: thread.contactPhotoUrl, listingTitle: thread.listingTitle, listingUrl: read?.listingUrl || "", lastActivityAt: thread.lastActivityAt || null, messages: read?.messages || [] } };
}

async function pauseForCheckpoint(where) {
  const state = await loadState();
  await saveState({ ...state, pausedUntil: new Date(Date.now() + CHECKPOINT_PAUSE_MS).toISOString(), pauseReason: `O Facebook pediu verificação ou avisou de limite (${where}). Resolva no Facebook; a extensão volta sozinha em 24 h.` });
  notify("Marketplace pausado por 24 h", `O Facebook pediu verificação ou avisou de limite (${where}). Nada será lido nem enviado até lá.`);
}

async function sendOutbound(tabId, config, message) {
  let outcome;
  try {
    await attachDebugger(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (String(message.threadUrl || "").startsWith(FB_PREFIX)) {
      await navigateAndWait(tabId, message.threadUrl);
      await injectInbox(tabId);
    } else {
      // Conversa sem link (painel do Messenger): reabre a caixa do Marketplace e clica no item.
      const inbox = await readInbox(tabId);
      if (!(inbox?.threads || []).some((thread) => thread.threadKey === message.threadKey)) throw Object.assign(new Error("Conversa não encontrada na caixa do Marketplace."), { beforeSend: true });
      const opened = await sendWithTimeout(tabId, { type: "mp-inbox-open", threadKey: message.threadKey }, 30000);
      if (!opened?.ok) throw Object.assign(new Error(opened?.error || "Não abriu a conversa."), { beforeSend: true });
    }
    outcome = await sendWithTimeout(tabId, { type: "mp-inbox-send", text: message.body }, 120000);
  } catch (error) {
    // Falhou antes de digitar (conversa não aberta): pode tentar de novo; senão, sem saber se saiu, não reenvia.
    outcome = { ok: false, sentAttempted: !error?.beforeSend, error: error.message };
  }
  // O depurador fica ligado até o fim da rodada (desligado no finally do chatTick).
  await postOutboundResult(config, message.id, outboundResultBody(outcome)).catch((error) => console.warn("[marketplace] retorno do envio falhou:", error?.message || error));
  return outcome;
}

async function chatTick() {
  const { chatSettings, chatPreviews } = await chrome.storage.local.get(["chatSettings", "chatPreviews"]);
  const state = await loadState();
  const decision = decideChatTick({ state, settings: chatSettings || {}, now: new Date() });
  if (decision.action !== "sync") {
    await chrome.storage.local.set({ chatLast: { at: new Date().toISOString(), result: decision.reason } });
    return decision;
  }
  const config = await loadConfig();
  if (!config.key) {
    await chrome.storage.local.set({ chatLast: { at: new Date().toISOString(), result: "sem_configuracao" } });
    return { reason: "sem_configuracao" };
  }
  await saveState({ ...state, chatRunning: new Date().toISOString() });
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  await sleep(500);
  // Cliques reais (ícone do Messenger, item Marketplace, conversa) precisam do depurador ligado nesta aba.
  await attachDebugger(tab.id);
  // Diagnóstico do popup: o que foi listado, lido, enviado e o erro (se houver).
  const summary = { listed: 0, read: 0, sent: 0, failed: 0, created: 0, newMessages: 0, error: "", inboxUrl: "", steps: "" };
  try {
    const inbox = await readInbox(tab.id);
    summary.inboxUrl = inbox?.url || "";
    summary.steps = (inbox?.steps || []).join(" → ");
    if (inbox?.checkpoint) {
      summary.error = "O Facebook pediu verificação/limite na caixa do Marketplace.";
      return await pauseForCheckpoint("caixa do Marketplace");
    }
    const threads = inbox?.threads || [];
    summary.listed = threads.length;
    if (!threads.length) summary.error = "Nenhuma conversa encontrada na caixa do Marketplace (seletores a calibrar ou caixa vazia).";
    const conversations = [];
    for (const thread of threadsToRead(threads, chatPreviews || {})) {
      const { read, conversation } = await readThread(tab.id, thread);
      if (read?.checkpoint) return await pauseForCheckpoint("conversa do Marketplace");
      if (read?.ok && conversation) conversations.push(conversation);
      else if (read?.error) summary.error = `${thread.contactName}: ${read.error}`;
      summary.steps += ` → ${thread.contactName}: ${read?.ok ? `${(read.messages || []).length} msg` : "falhou"}`;
    }
    const synced = await postChatSync(config, conversations);
    summary.read = conversations.length;
    summary.created = synced.created || 0;
    summary.newMessages = synced.newMessages || 0;
    await chrome.storage.local.set({ chatSettings: synced.settings || chatSettings || {}, chatPreviews: rememberPreviews(chatPreviews || {}, threads.filter((thread) => conversations.some((item) => item.threadKey === thread.threadKey))) });
    if (synced.settings?.syncEnabled === false) return { reason: "chat_desligado" };

    for (let i = 0; i < MAX_SENDS_PER_ROUND; i += 1) {
      const next = await fetchNextOutbound(config);
      if (!next?.message) break;
      const outcome = await sendOutbound(tab.id, config, next.message);
      if (outcome.ok) summary.sent += 1;
      else summary.failed += 1;
      if (outcome.checkpoint) return await pauseForCheckpoint("envio de mensagem");
      if (!outcome.ok) break; // não insiste na mesma rodada
      await sleep(4000 + Math.floor(Math.random() * 6000));
    }
    return { reason: "chat_sincronizado", ...summary };
  } catch (error) {
    console.warn("[marketplace] sincronização do chat falhou:", error?.message || error);
    summary.error = error?.status === 401 ? "Chave recusada pelo CRM (gere outra no CRM)." : error?.message || String(error);
    return { reason: "chat_erro", error: summary.error };
  } finally {
    await detachDebugger(tab.id);
    await chrome.tabs.remove(tab.id).catch(() => {});
    const latest = await loadState();
    await saveState({ ...latest, chatRunning: null });
    await chrome.storage.local.set({ chatLast: { at: new Date().toISOString(), result: "chat_sincronizado", ...summary } });
  }
}
