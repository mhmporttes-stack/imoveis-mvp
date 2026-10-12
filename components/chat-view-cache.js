"use client";

// Chat "já carregado" ao voltar para a tela (pedido do dono, 2026-10-12): guarda, SÓ NA MEMÓRIA desta aba, o que o Chat
// já mostrou (lista, aba, filtros e as últimas conversas abertas). Ao voltar, a tela aparece na hora e atualiza em
// seguida pelas APIs de sempre (o servidor continua decidindo o escopo de cada perfil).
// - Chave = conta REAL + conta EFETIVA ("Alterar conta"): trocar de conta descarta tudo, nunca mostra dado de outra.
// - Nada vai para o disco (sem sessionStorage/localStorage): fechar o app ou recarregar a página zera.
// - Expira em 30 min sem uso; limpo ao sair da conta, ao trocar de conta e quando a sessão cai.
const MAX_DETAILS = 8;
const TTL_MS = 30 * 60 * 1000;

let entry = null; // { key, at, view, details: Map }
const clearHandlers = new Set();

export function readChatView(key) {
  // Só no navegador: no servidor esta memória seria compartilhada entre pessoas.
  if (typeof window === "undefined" || !key || !entry) return null;
  if (entry.key !== key || Date.now() - entry.at > TTL_MS) {
    entry = null;
    return null;
  }
  return entry;
}

function ensure(key) {
  if (typeof window === "undefined" || !key) return null;
  if (!entry || entry.key !== key) entry = { key, at: Date.now(), view: null, details: new Map() };
  entry.at = Date.now();
  return entry;
}

export function saveChatView(key, view) {
  const current = ensure(key);
  if (current) current.view = view;
}

export function saveChatDetail(key, id, detail) {
  const current = ensure(key);
  if (!current || !id || !detail) return;
  current.details.delete(id);
  current.details.set(id, detail);
  while (current.details.size > MAX_DETAILS) current.details.delete(current.details.keys().next().value);
}

export function forgetChatDetail(key, id) {
  if (entry?.key === key) entry.details.delete(id);
}

// Outros caches do Chat (ex.: contagem de não lidas) se registram aqui para zerar junto.
export function onChatCacheClear(handler) {
  clearHandlers.add(handler);
  return () => clearHandlers.delete(handler);
}

export function clearChatCache() {
  entry = null;
  for (const handler of clearHandlers) handler();
}
