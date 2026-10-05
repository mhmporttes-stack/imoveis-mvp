// Exclusão mútua por sessão (userId): duas operações de conectar/desconectar do MESMO corretor
// nunca correm ao mesmo tempo dentro do processo (retomada no boot x botão Conectar/QR x
// reconexão automática). Fila simples por chave; uma falha não trava quem vem depois.
export function createKeyedMutex() {
  const tails = new Map();
  return {
    async run(key, fn) {
      const previous = tails.get(key) || Promise.resolve();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const tail = previous.then(() => gate);
      tails.set(key, tail);
      await previous;
      try {
        return await fn();
      } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
    // para teste/diagnóstico
    get pendingKeys() { return tails.size; }
  };
}
