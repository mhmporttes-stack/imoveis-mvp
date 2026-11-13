// Captura leve dos últimos erros de JS da tela, só em memória (nunca gravada no aparelho nem enviada sozinha): vai junto do
// chamado quando o usuário toca em Enviar. Sem dados pessoais: o servidor ainda limpa o texto (scrubSensitive).
export function createErrorBuffer(size = 5) {
  const items = [];
  return {
    push(kind, message, at = Date.now()) {
      const text = String(message ?? "").trim();
      if (!text) return;
      items.push({ kind: kind === "promise" ? "promise" : "error", message: text.slice(0, 200), at });
      while (items.length > size) items.shift();
    },
    list: () => items.map((item) => ({ ...item })),
    clear: () => { items.length = 0; }
  };
}

// Mensagem do evento "error": só o texto e o arquivo/linha do bundle (nada de objeto do erro).
export function describeWindowError(event) {
  const base = String(event?.message || event?.error?.message || "Erro de JavaScript");
  const file = String(event?.filename || "").split("/").pop().split("?")[0];
  return file ? `${base} (${file}${event?.lineno ? `:${event.lineno}` : ""})` : base;
}

export function describeRejection(event) {
  const reason = event?.reason;
  return String(typeof reason === "string" ? reason : reason?.message || "Promessa rejeitada");
}
