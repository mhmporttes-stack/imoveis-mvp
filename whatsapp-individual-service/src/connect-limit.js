import { DEFAULT_CONFIG, FORBIDDEN_LIMIT_CODE, evaluateForbiddenConnectLimit } from "./reconnect-policy.js";

// Porta do LIMITE DE TENTATIVAS DEPOIS DE UM 403 (REGRA OFICIAL — dono, 2026-10-13). A decisão é a função pura
// evaluateForbiddenConnectLimit (reconnect-policy.js); aqui só buscamos a telemetria GRAVADA do número no CRM (o serviço
// reinicia e não tem banco) e traduzimos o veredito em erro. Nada aqui abre socket nem fala com o WhatsApp: a tentativa
// recusada nunca chega a existir (nem vira connect_attempt).
//
// Sem histórico (CRM antigo/fora do ar, resposta inválida, demora) a conexão SEGUE, com aviso no log: sem isso um CRM
// ainda sem o tipo `connect_events` (deploy em ordem trocada) impediria TODA conexão. Não é silencioso: o log diz o motivo.

export const GATE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, setTimer = setTimeout, clearTimer = clearTimeout) {
  let timer = null;
  const timeout = new Promise((_, reject) => { timer = setTimer(() => reject(new Error("timeout")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimer(timer));
}

export function connectCooldownError(verdict) {
  const error = new Error(verdict.message);
  error.code = FORBIDDEN_LIMIT_CODE;
  error.retryAfterMinutes = verdict.waitMinutes;
  return error;
}

// fetchEvents(sessionId, windowMs) -> [{ type, statusCode, trigger, occurredAt }] | null (indisponível).
// flushTelemetry: grava na hora o que está na fila (a tentativa anterior ainda pode não ter chegado ao banco).
export function createConnectLimitGate({ fetchEvents, flushTelemetry = async () => {}, now = Date.now, config = DEFAULT_CONFIG, timeoutMs = GATE_TIMEOUT_MS, log = console } = {}) {
  return {
    // -> { blocked: false, checked } | { blocked: true, ... } (ver evaluateForbiddenConnectLimit)
    async check(sessionId) {
      let events = null;
      let failure = "";
      try {
        events = await withTimeout((async () => {
          await flushTelemetry();
          return fetchEvents(sessionId, config.forbiddenWindowMs);
        })(), timeoutMs);
      } catch (error) {
        failure = error?.message || String(error);
      }
      if (!Array.isArray(events)) {
        log.warn?.(`[${sessionId}] Limite de tentativas depois de um 403 NÃO verificado (histórico indisponível${failure ? `: ${failure}` : ""}); a conexão segue.`);
        return { blocked: false, checked: false };
      }
      return { ...evaluateForbiddenConnectLimit(events, { now: now(), config }), checked: true };
    }
  };
}
