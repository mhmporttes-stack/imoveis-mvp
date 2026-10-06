import { AsyncLocalStorage } from "node:async_hooks";

// Memória POR REQUISIÇÃO (2026-10-06): dentro de runWithRequestMemo, chamadas com a mesma chave
// compartilham UMA execução (em andamento ou já concluída) — a Meta Diária do administrador
// calculava os mesmos números de cada corretor duas vezes e fazia ~214 consultas ao banco.
// Fora de runWithRequestMemo nada é guardado (comportamento de sempre): nunca vale entre
// requisições, então não existe dado "velho" além da própria requisição.
const storage = new AsyncLocalStorage();

export function runWithRequestMemo(fn) {
  if (storage.getStore()) return fn();
  return storage.run(new Map(), fn);
}

export function memoInRequest(key, loader) {
  const memo = storage.getStore();
  if (!memo) return loader();
  if (!memo.has(key)) {
    const promise = Promise.resolve().then(loader);
    memo.set(key, promise);
    promise.catch(() => memo.delete(key)); // erro não fica guardado
  }
  return memo.get(key);
}
