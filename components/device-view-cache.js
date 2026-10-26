"use client";

// Gravação no APARELHO do cache das telas (dono, 2026-10-26: "Sim, quero que guarde"). Quando o iOS tira o app da memória,
// a próxima abertura mostra na hora o último conteúdo desta conta e atualiza por trás. Regras puras (chave por conta,
// validade de 24 h, filtro de campos sensíveis, limites) em components/device-view-cache-core.mjs.
// - IndexedDB, um registro só ("current"), de uma conta só. Sem IndexedDB (modo privado, erro) = sem cache, como antes.
// - Nada abre o banco do aparelho até a 1ª leitura/gravação (o módulo também é carregado no site público).
// - Apagado ao sair da conta, quando a sessão cai, na tela de login e em "Alterar conta" (wipeDeviceCache).
import { buildSnapshot, canPersistViewerKey, snapshotDecision, usableSnapshot } from "./device-view-cache-core.mjs";

const DB_NAME = "mm-painel-cache";
const STORE = "snapshot";
const RECORD = "current";
const PERSIST_DELAY_MS = 800;
// Depois de apagar (sair/trocar de conta), gravações atrasadas de telas que ainda estão abertas são ignoradas.
const WIPE_GUARD_MS = 3000;

let dbPromise = null;
let snapshotPromise = null; // leitura única por carregamento da página
let lastSnapshot = null; // último registro gravado/lido (base da próxima gravação)
let pending = null; // { key, getEntry }
let timer = null;
let wipedAt = 0;
let queue = Promise.resolve();
let flushHooked = false;

function hasIndexedDb() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function warn(action, error) {
  // Só o motivo técnico; nunca o conteúdo guardado.
  console.warn(`Cache do aparelho: falha ao ${action}:`, error?.name || error?.message || "erro");
}

function openDb() {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { warn("abrir", request.error); resolve(null); };
        request.onblocked = () => resolve(null);
      } catch (error) {
        warn("abrir", error);
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function run(mode, work) {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const request = work(store);
      tx.oncomplete = () => resolve(request?.result ?? null);
      tx.onerror = () => { warn(mode === "readonly" ? "ler" : "gravar", tx.error); resolve(null); };
      tx.onabort = () => resolve(null);
    } catch (error) {
      warn(mode === "readonly" ? "ler" : "gravar", error);
      resolve(null);
    }
  }));
}

function readRecord() {
  if (!snapshotPromise) {
    snapshotPromise = run("readonly", (store) => store.get(RECORD)).then((value) => {
      lastSnapshot = value || null;
      return lastSnapshot;
    });
  }
  return snapshotPromise;
}

function deleteRecord() {
  queue = queue.then(() => run("readwrite", (store) => store.delete(RECORD)));
  return queue;
}

// Registro desta conta para mostrar na hora (itens dentro da validade), ou null. Registro de outra pessoa, de
// "Alterar conta" ou de outra versão é apagado aqui ("quando o usuário da sessão mudar").
export async function loadDeviceSnapshot(key) {
  if (!key || !hasIndexedDb()) return null;
  const snapshot = await readRecord();
  const decision = snapshotDecision(snapshot, key);
  if (decision === "wipe") {
    lastSnapshot = null;
    await deleteRecord();
    return null;
  }
  return decision === "use" ? usableSnapshot(snapshot, key) : null;
}

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  const job = pending;
  pending = null;
  if (!job || Date.now() - wipedAt < WIPE_GUARD_MS) return queue;
  queue = queue
    .then(() => readRecord())
    .then((previous) => {
      if (Date.now() - wipedAt < WIPE_GUARD_MS) return null;
      const snapshot = buildSnapshot({ key: job.key, entry: job.getEntry(), previous: lastSnapshot || previous });
      if (!snapshot) return null;
      lastSnapshot = snapshot;
      return run("readwrite", (store) => store.put(snapshot, RECORD));
    })
    .catch((error) => warn("gravar", error));
  return queue;
}

function hookFlushOnHide() {
  if (flushHooked || typeof document === "undefined") return;
  flushHooked = true;
  // O iOS pode encerrar o app logo depois de ir para o fundo: grava o que estiver pendente na hora.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", () => flush());
}

// Agenda a gravação (agrupada) do que esta conta tem na memória. getEntry() devolve o formato de buildSnapshot.
export function scheduleDevicePersist(key, getEntry) {
  if (!hasIndexedDb() || !canPersistViewerKey(key)) return;
  if (Date.now() - wipedAt < WIPE_GUARD_MS) return;
  hookFlushOnHide();
  pending = { key, getEntry };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, PERSIST_DELAY_MS);
}

// Apaga TUDO o que está guardado no aparelho (sair, sessão caída, login, "Alterar conta").
export function wipeDeviceCache() {
  wipedAt = Date.now();
  pending = null;
  if (timer) clearTimeout(timer);
  timer = null;
  lastSnapshot = null;
  snapshotPromise = Promise.resolve(null);
  if (!hasIndexedDb()) return Promise.resolve();
  return deleteRecord().then(() => undefined);
}
