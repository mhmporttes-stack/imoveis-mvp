// ADAPTER VAZIO (fase 1). Nao executa nada, nao autentica no Claude, nao abre processo.
// Mesma interface do echo, para trocar depois sem reconstruir o poller.
export function createClaudeExecutor({ enabled = false } = {}) {
  return {
    name: "claude",
    async execute() {
      if (!enabled) throw new Error("Executor Claude desativado.");
      throw new Error("Executor Claude nao implementado na fase 1.");
    }
  };
}
