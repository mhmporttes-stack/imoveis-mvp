"use client";

import { canPersistViewerKey, DEVICE_CACHE_TTL_MS, isFreshStamp } from "./device-view-cache-core.mjs";
import { loadDeviceSnapshot, scheduleDevicePersist, wipeDeviceCache } from "./device-view-cache";

// Chat "já carregado" ao voltar para a tela (pedido do dono, 2026-10-12): guarda o que o Chat já mostrou (lista, aba,
// filtros e as últimas conversas abertas). Ao voltar, a tela aparece na hora e atualiza em seguida pelas APIs de sempre
// (o servidor continua decidindo o escopo de cada perfil).
// - Chave = conta REAL + conta EFETIVA ("Alterar conta"): trocar de conta descarta tudo, nunca mostra dado de outra.
// - Guardado também NO APARELHO (dono, 2026-10-26: "Sim, quero que guarde" — substitui o "nada vai para o disco" de
//   2026-10-12): components/device-view-cache.js (IndexedDB), por conta, 24 h, sem CPF/documentos/arquivos/mídia.
//   Em "Alterar conta" continua SÓ na memória da aba (30 min sem uso), nunca no disco.
// - Limpo (memória e aparelho) ao sair da conta, ao trocar de conta, quando a sessão cai e na tela de login.
// - O que vem do aparelho só aparece depois que a tela montou (restoreChatView/restoreViewerData, assíncronos): a 1ª
//   pintura é igual à do servidor. Nunca é fonte para gravar nada — a tela sempre busca de novo no servidor.
const MAX_DETAILS = 8;
const MEMORY_ONLY_TTL_MS = 30 * 60 * 1000;

// Mesma memória (mesma chave, validade e limpeza) guarda também dados de outras telas do painel (readViewerData), ex.: os
// números do Desempenho pré-carregados pelo AdminWarmup.
let entry = null; // { key, at, view, viewAt, details: Map<id,{value,at}>, data: Map<name,{value,at}> }
const clearHandlers = new Set();

function ttlFor(key) {
  return canPersistViewerKey(key) ? DEVICE_CACHE_TTL_MS : MEMORY_ONLY_TTL_MS;
}

function fresh(item, now = Date.now()) {
  return item && isFreshStamp(item.at, now) ? item : null;
}

function current(key) {
  // Só no navegador: no servidor esta memória seria compartilhada entre pessoas.
  if (typeof window === "undefined" || !key || !entry) return null;
  if (entry.key !== key || Date.now() - entry.at > ttlFor(key)) {
    entry = null;
    return null;
  }
  return entry;
}

// Formato antigo de leitura ({ view, details: Map<id, detail> }) mantido para as telas que já o usam.
export function readChatView(key) {
  const memory = current(key);
  if (!memory) return null;
  const now = Date.now();
  const details = new Map();
  for (const [id, item] of memory.details) if (fresh(item, now)) details.set(id, item.value);
  return { key, view: memory.view && isFreshStamp(memory.viewAt, now) ? memory.view : null, details };
}

function ensure(key) {
  if (typeof window === "undefined" || !key) return null;
  if (!entry || entry.key !== key) entry = { key, at: Date.now(), view: null, viewAt: 0, details: new Map(), data: new Map() };
  entry.at = Date.now();
  return entry;
}

function snapshotEntry() {
  const memory = entry;
  if (!memory) return null;
  return {
    view: memory.view ? { at: memory.viewAt, value: memory.view } : null,
    details: [...memory.details].map(([id, item]) => ({ id, at: item.at, value: item.value })),
    data: [...memory.data].map(([name, item]) => ({ name, at: item.at, value: item.value }))
  };
}

function persist(key) {
  scheduleDevicePersist(key, () => (entry?.key === key ? snapshotEntry() : null));
}

function putDetail(memory, id, value, at) {
  memory.details.delete(id);
  memory.details.set(id, { value, at });
  while (memory.details.size > MAX_DETAILS) memory.details.delete(memory.details.keys().next().value);
}

export function saveChatView(key, view) {
  const memory = ensure(key);
  if (!memory) return;
  memory.view = view;
  memory.viewAt = Date.now();
  persist(key);
}

export function saveChatDetail(key, id, detail) {
  const memory = ensure(key);
  if (!memory || !id || !detail) return;
  putDetail(memory, id, detail, Date.now());
  persist(key);
}

// Dados de outras telas, por nome (ex.: "performance:month"). Mesma chave por conta real + efetiva.
export function readViewerData(key, name) {
  return fresh(current(key)?.data.get(name))?.value ?? null;
}

export function saveViewerData(key, name, value) {
  const memory = ensure(key);
  if (!memory || !value) return;
  memory.data.set(name, { value, at: Date.now() });
  persist(key);
}

export function forgetChatDetail(key, id) {
  if (entry?.key === key) {
    entry.details.delete(id);
    persist(key);
  }
}

// ---------- o que ficou guardado no aparelho (abertura do app do zero) ----------

// Lista/filtros do Chat guardados no aparelho (só esta conta, até 24 h). As últimas conversas abertas voltam para a
// memória (com a data original) para abrirem na hora ao tocar; a tela decide se usa a lista.
export async function restoreChatView(key) {
  const snapshot = await loadDeviceSnapshot(key);
  if (!snapshot) return null;
  const memory = ensure(key);
  if (memory) {
    for (const item of [...snapshot.details].reverse()) {
      if (!memory.details.has(item.id)) putDetail(memory, item.id, item.value, item.at);
    }
  }
  return snapshot.view ? { view: snapshot.view.value, at: snapshot.view.at } : null;
}

// Dado de uma tela guardado no aparelho ({ value, at }) ou null. Volta para a memória com a data original (não renova
// a validade) só se a memória ainda não tiver uma versão mais nova.
export async function restoreViewerData(key, name) {
  const snapshot = await loadDeviceSnapshot(key);
  const item = snapshot?.data.find((candidate) => candidate.name === name);
  if (!item) return null;
  const memory = ensure(key);
  if (memory && !fresh(memory.data.get(name))) memory.data.set(name, { value: item.value, at: item.at });
  return { value: item.value, at: item.at };
}

// Outros caches do Chat (ex.: contagem de não lidas) se registram aqui para zerar junto.
export function onChatCacheClear(handler) {
  clearHandlers.add(handler);
  return () => clearHandlers.delete(handler);
}

// Sair, sessão caída, login e "Alterar conta": zera a memória E o que está guardado no aparelho.
export function clearChatCache() {
  entry = null;
  for (const handler of clearHandlers) handler();
  return wipeDeviceCache();
}
