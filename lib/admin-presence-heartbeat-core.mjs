// Puro (sem React, sem DOM global) — lógica do heartbeat de presença do navegador,
// testável em tests/admin-presence-heartbeat.test.mjs. Usado por
// components/AdminPresenceHeartbeat.jsx.
//
// Regras (não mudam os limiares Online 5 min / Ausente 30 min / Roleta 5 min):
//   - só com a aba VISÍVEL e só com interação real (nunca timer periódico);
//   - no máximo 1 sinal por minuto no caso normal;
//   - resposta !ok: 401/403 = sessão expirada/sem acesso -> NÃO tenta de novo
//     (AdminSessionKeeper já faz a renovação/redirect); 5xx ou falha de rede ->
//     UMA nova tentativa depois de um pequeno atraso; outros 4xx -> desiste;
//   - voltou a internet (evento "online") dispara de novo, respeitando o 1/min
//     contado só a partir de sinais que o servidor de fato aceitou.

export const HEARTBEAT_MIN_INTERVAL_MS = 60000;
export const HEARTBEAT_RETRY_DELAY_MS = 5000;

export function createHeartbeatController({
  send,
  isVisible,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  minIntervalMs = HEARTBEAT_MIN_INTERVAL_MS,
  retryDelayMs = HEARTBEAT_RETRY_DELAY_MS
}) {
  let lastSentAt = 0;
  let inFlight = false;
  let cancelled = false;
  let retryTimer = null;

  // Devolve "ok" | "retry" | "stop"
  async function attempt() {
    try {
      const response = await send();
      if (response && response.ok) return "ok";
      const status = Number(response?.status) || 0;
      if (status >= 500) return "retry";
      return "stop"; // 401 (sessão expirada), 403 e demais 4xx: não insistir
    } catch {
      return "retry"; // falha de rede
    }
  }

  async function ping({ isRetry = false } = {}) {
    if (cancelled || inFlight) return;
    if (!isVisible()) return;
    const at = now();
    if (!isRetry && at - lastSentAt < minIntervalMs) return;

    inFlight = true;
    // Reserva o minuto já na tentativa: rajadas de interação (e um 401 repetido)
    // não geram mais de 1 requisição por minuto.
    lastSentAt = at;
    let outcome;
    try {
      outcome = await attempt();
    } finally {
      inFlight = false;
    }

    if (outcome === "ok") return;
    if (outcome === "stop") return; // sem laço: o minuto continua reservado
    // "retry": uma única nova tentativa, com atraso; se também falhar, espera a
    // próxima interação (que respeita o intervalo de 1/min).
    if (isRetry || cancelled) return;
    retryTimer = setTimer(() => {
      retryTimer = null;
      ping({ isRetry: true });
    }, retryDelayMs);
  }

  function cancel() {
    cancelled = true;
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = null;
  }

  return { ping, cancel };
}
