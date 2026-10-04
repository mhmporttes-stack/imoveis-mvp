// Política de RECONEXÃO do WhatsApp individual — módulo puro (sem Baileys, sem
// rede, sem banco), testado em tests/whatsapp-reconnect-policy.test.mjs.
//
// Por que existe: antes, só o código 401 (logout) encerrava a sessão; qualquer
// outro código reconectava em 4 s fixos, para sempre. Códigos de recusa/conflito
// (403, 440) entravam em laço infinito de conexões — ~22 h numa conta, ~15 h
// noutra — o que, para o antiabuso do WhatsApp, parece um robô martelando.
//
// Códigos conforme DisconnectReason do @whiskeysockets/baileys 6.7.24 (lido do
// pacote instalado, lib/Types/index.js) e de como lib/Socket/socket.js os produz:
//   401 loggedOut         logout / aparelho removido no celular
//   403 forbidden         "Connection Failure" com reason 403 (recusa do WhatsApp)
//   408 timedOut/connectionLost  QR sem escanear, keep-alive perdido, ETIMEDOUT/ENOTFOUND
//   411 multideviceMismatch
//   428 connectionClosed  socket fechado
//   440 connectionReplaced stream "conflict": outra conexão assumiu a sessão
//   500 badSession        também é o padrão de erro de stream/WebSocket desconhecido
//   503 unavailableService
//   515 restartRequired   o WhatsApp SEMPRE pede isso logo depois de aceitar o QR/código
// Este módulo não importa o Baileys de propósito (testável sem instalar nada).

export const KIND = Object.freeze({
  LOGOUT: "logout",
  TRANSIENT: "transient",
  RESTART: "restart",
  INTERVENTION: "intervention"
});

export const ACTION = Object.freeze({
  LOGOUT: "logout",
  RETRY: "retry",
  INTERVENE: "intervene",
  GIVE_UP: "give_up",
  GIVE_UP_PAIRING: "give_up_pairing"
});

export const DEFAULT_CONFIG = Object.freeze({
  maxRetries: 6, // reconexões automáticas por ciclo (além da tentativa inicial)
  maxPairingRetries: 5, // sessão ainda sem pareamento (QR sem escanear): ~2 min por QR
  baseDelayMs: 4000,
  maxDelayMs: 120_000,
  restartDelayMs: 1000, // 515 depois do pareamento
  pairingDelayMs: 2000, // renovação do QR de sessão não pareada
  jitterRatio: 0.25,
  stableMs: 180_000 // só depois de tanto tempo conectada o ciclo é considerado resolvido
});

const INTERVENTION_REASONS = Object.freeze({
  forbidden: "O WhatsApp recusou a conexão (403). A reconexão automática foi interrompida para não insistir; verifique o número antes de reconectar manualmente.",
  connection_replaced: "Outra conexão assumiu esta sessão (440). A reconexão automática foi interrompida para as duas não ficarem se derrubando.",
  multidevice_mismatch: "O WhatsApp informou incompatibilidade de multi-aparelho (411). A reconexão automática foi interrompida.",
  unrecognized_code: "O WhatsApp encerrou a conexão com um código não previsto. A reconexão automática foi interrompida para evitar insistência."
});

function toCode(statusCode) {
  if (statusCode === null || statusCode === undefined || statusCode === "") return null;
  const code = Number(statusCode);
  return Number.isInteger(code) ? code : null;
}

// -> { kind, code, reason }
export function classifyDisconnect(statusCode) {
  const code = toCode(statusCode);
  if (code === 401) return { kind: KIND.LOGOUT, code, reason: "logged_out" };
  if (code === 515) return { kind: KIND.RESTART, code, reason: "restart_required" };
  if (code === 403) return { kind: KIND.INTERVENTION, code, reason: "forbidden" };
  if (code === 440) return { kind: KIND.INTERVENTION, code, reason: "connection_replaced" };
  if (code === 411) return { kind: KIND.INTERVENTION, code, reason: "multidevice_mismatch" };
  if (code === 408) return { kind: KIND.TRANSIENT, code, reason: "timed_out" };
  if (code === 428) return { kind: KIND.TRANSIENT, code, reason: "connection_closed" };
  if (code === 500) return { kind: KIND.TRANSIENT, code, reason: "bad_session_or_stream_error" };
  if (code !== null && code >= 500 && code <= 599) return { kind: KIND.TRANSIENT, code, reason: code === 503 ? "unavailable_service" : `server_${code}` };
  // Erro sem código (não-Boom): ambíguo, mas sempre limitado pelo teto de tentativas.
  if (code === null) return { kind: KIND.TRANSIENT, code, reason: "unknown_error" };
  // Qualquer outro código numérico (402, 405, 406...): não sabemos que é recuperável → não insiste.
  return { kind: KIND.INTERVENTION, code, reason: "unrecognized_code" };
}

export function interventionMessage(reason) {
  return INTERVENTION_REASONS[reason] || INTERVENTION_REASONS.unrecognized_code;
}

// Atraso da n-ésima reconexão (retryIndex começa em 1): exponencial com teto e
// jitter. `random` injetável (0..1) para teste determinístico.
export function computeBackoffDelay(retryIndex, config = DEFAULT_CONFIG, random = Math.random) {
  const index = Math.max(1, Math.floor(retryIndex));
  const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** (index - 1));
  const jitter = 1 + (random() * 2 - 1) * config.jitterRatio;
  return Math.max(1000, Math.min(config.maxDelayMs, Math.round(exponential * jitter)));
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

// Ajustes opcionais por variável de ambiente (sempre dentro de limites seguros).
export function configFromEnv(env = {}) {
  return {
    ...DEFAULT_CONFIG,
    maxRetries: boundedInt(env.WHATSAPP_RECONNECT_MAX_RETRIES, DEFAULT_CONFIG.maxRetries, 1, 10),
    stableMs: boundedInt(env.WHATSAPP_RECONNECT_STABLE_MS, DEFAULT_CONFIG.stableMs, 30_000, 3_600_000)
  };
}

// Controlador do CICLO de reconexão de UMA sessão. Tudo injetável (relógio,
// aleatório, timers, registro de telemetria) — sem efeito colateral próprio.
//
// Ciclo = da conexão pedida (manual / retomada no boot) ou da primeira queda
// até: ficar estável, logout, intervenção, limite de tentativas ou nova conexão
// manual. `attempt` = nº da tentativa de conexão dentro do ciclo (1 = a inicial).
// O contador só zera quando a sessão fica conectada por `stableMs` — um simples
// "open" que cai logo depois NÃO zera.
export function createReconnectController({
  config = DEFAULT_CONFIG,
  now = Date.now,
  random = Math.random,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  newId = () => `${now().toString(36)}-${Math.floor(random() * 1e9).toString(36)}`,
  record = () => {}
} = {}) {
  const state = { cycleId: null, active: false, attempt: 0, openedAt: null, stableTimer: null };

  const emit = (type, fields = {}) => {
    try { record(type, { cycleId: state.cycleId, attempt: state.attempt, ...fields }); } catch { /* telemetria nunca derruba a sessão */ }
  };
  const clearStable = () => {
    if (state.stableTimer) clearTimer(state.stableTimer);
    state.stableTimer = null;
  };
  const endCycle = (reason) => {
    if (!state.active) return;
    emit("cycle_end", { reason });
    state.active = false;
  };

  return {
    state,

    // Conexão pedida de fora (botão Conectar, retomada no boot): ciclo novo, contador zerado.
    beginCycle(trigger = "manual") {
      clearStable();
      endCycle("superseded");
      state.cycleId = newId();
      state.active = true;
      state.attempt = 1;
      state.openedAt = null;
      emit("cycle_start", { trigger });
      emit("connect_attempt", { trigger });
      return { cycleId: state.cycleId, attempt: state.attempt };
    },

    // Reconexão automática agendada por este controlador.
    beginRetry() {
      if (!state.active) {
        state.cycleId = newId();
        state.active = true;
        state.attempt = 0;
        emit("cycle_start", { trigger: "drop" });
      }
      state.attempt += 1;
      state.openedAt = null;
      emit("connect_attempt", { trigger: "auto_reconnect" });
      return { cycleId: state.cycleId, attempt: state.attempt };
    },

    onOpen() {
      state.openedAt = now();
      emit("connected", {});
      clearStable();
      state.stableTimer = setTimer(() => {
        state.stableTimer = null;
        if (!state.active) return;
        emit("cycle_end", { reason: "stable", connectedMs: now() - state.openedAt });
        state.active = false;
        state.attempt = 0;
      }, config.stableMs);
      state.stableTimer?.unref?.();
    },

    // Queda da conexão. `unpaired` = sessão que nunca foi pareada (aguardando QR).
    // -> { action, delayMs?, nextAttempt?, code?, reason?, message?, kind }
    onClose({ statusCode, unpaired = false } = {}) {
      clearStable();
      const connectedMs = state.openedAt ? now() - state.openedAt : null;
      state.openedAt = null;
      const verdict = classifyDisconnect(statusCode);
      if (!state.active) {
        // Caiu depois de estável (ou sem ciclo): começa um ciclo novo; a conexão
        // que acabou de cair conta como a tentativa 1 dele.
        state.cycleId = newId();
        state.active = true;
        state.attempt = 1;
        emit("cycle_start", { trigger: "drop" });
      }
      emit("disconnected", { statusCode: verdict.code, reason: verdict.reason, kind: verdict.kind, connectedMs });

      if (verdict.kind === KIND.LOGOUT) {
        endCycle("logout");
        return { action: ACTION.LOGOUT, kind: verdict.kind, code: verdict.code, reason: verdict.reason };
      }
      if (verdict.kind === KIND.INTERVENTION) {
        emit("intervention_required", { statusCode: verdict.code, reason: verdict.reason });
        endCycle("intervention");
        return { action: ACTION.INTERVENE, kind: verdict.kind, code: verdict.code, reason: verdict.reason, message: interventionMessage(verdict.reason) };
      }

      // Recuperável (transitório / restart). Sessão não pareada: política própria, mais curta.
      const pairing = unpaired && verdict.kind !== KIND.RESTART;
      const limit = pairing ? config.maxPairingRetries : config.maxRetries;
      const retriesUsed = state.attempt - 1;
      if (retriesUsed >= limit) {
        emit("interrupted_limit", { statusCode: verdict.code, reason: verdict.reason, maxRetries: limit });
        endCycle("limit");
        return {
          action: pairing ? ACTION.GIVE_UP_PAIRING : ACTION.GIVE_UP,
          kind: verdict.kind, code: verdict.code, reason: verdict.reason, maxRetries: limit
        };
      }
      let delayMs;
      if (verdict.kind === KIND.RESTART) delayMs = config.restartDelayMs;
      else if (pairing) delayMs = config.pairingDelayMs;
      else delayMs = computeBackoffDelay(retriesUsed + 1, config, random);
      emit("retry_scheduled", { nextAttempt: state.attempt + 1, delayMs, statusCode: verdict.code, reason: verdict.reason });
      return { action: ACTION.RETRY, kind: verdict.kind, code: verdict.code, reason: verdict.reason, delayMs, nextAttempt: state.attempt + 1 };
    },

    // Desconexão pedida pelo corretor / sessão apagada: nada de reconexão pendente.
    cancel(reason = "manual_disconnect") {
      clearStable();
      endCycle(reason);
    }
  };
}

// Retomada no boot: SÓ reabre quem o banco diz que estava de fato conectada
// quando o processo caiu. Qualquer outro estado (reconnecting, error/intervenção,
// qr_required, disconnected, connecting, pairing_code_required, sem linha) fica
// quieto até alguém reconectar de propósito.
export const RESUMABLE_STATUSES = Object.freeze(["connected"]);

export function shouldResumeSession(row) {
  return Boolean(row) && RESUMABLE_STATUSES.includes(row.status);
}

// Intervalo entre sessões retomadas no boot (com jitter) para não abrir várias
// conexões coladas.
export const RESUME_SPACING_MS = 5000;
export const RESUME_JITTER_MS = 3000;
export function resumeSpacingMs(random = Math.random) {
  return RESUME_SPACING_MS + Math.floor(random() * RESUME_JITTER_MS);
}
