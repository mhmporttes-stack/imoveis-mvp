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
//   408 timedOut/connectionLost  QR sem escanear ("QR refs attempts ended"), keep-alive perdido,
//                         ETIMEDOUT/ENOTFOUND (rede). QR sem escanear NÃO é queda de rede.
//   411 multideviceMismatch
//   428 connectionClosed  socket fechado
//   440 connectionReplaced stream "conflict": outra conexão assumiu a sessão
//   500 badSession        padrão (default) quando o WhatsApp manda <stream:error> sem código
//                         conhecido — ex.: "Stream Errored (ack)" — e para erro de WebSocket desconhecido
//   503 unavailableService
//   515 restartRequired   o WhatsApp SEMPRE pede isso logo depois de aceitar o QR/código
// Este módulo não importa o Baileys de propósito (testável sem instalar nada).

export const KIND = Object.freeze({
  LOGOUT: "logout",
  TRANSIENT: "transient",
  RESTART: "restart",
  QR_TIMEOUT: "qr_timeout",
  INTERVENTION: "intervention"
});

export const ACTION = Object.freeze({
  LOGOUT: "logout",
  RETRY: "retry",
  // 515 normal pós-pareamento: reinício imediato do socket (não é falha, não consome tentativa de reconexão).
  RESTART: "restart",
  INTERVENE: "intervene",
  GIVE_UP: "give_up",
  GIVE_UP_PAIRING: "give_up_pairing"
});

export const DEFAULT_CONFIG = Object.freeze({
  maxRetries: 6, // reconexões automáticas por ciclo (além da tentativa inicial)
  // (sem retentativa automática de QR: sessão ainda não pareada que cai NUNCA gera QR sozinha)
  maxPairingRetries: 0,
  baseDelayMs: 4000,
  maxDelayMs: 120_000,
  restartDelayMs: 1000, // 515 depois do pareamento
  pairingDelayMs: 2000,
  jitterRatio: 0.25,
  stableMs: 180_000, // só depois de tanto tempo conectada o ciclo é considerado resolvido
  // 515 é esperado UMA vez após parear; mais que isso, sem nunca ter conectado, é laço anormal.
  restartLoopMax: 3,
  restartLoopWindowMs: 60_000,
  // 500/"Stream Errored": reconecta com backoff, mas repetição em janela curta = para e pede atenção.
  streamErrorMax: 3,
  streamErrorWindowMs: 600_000,
  // Limite por NÚMERO em janela longa (dono, 2026-10-10): caso real = 12 quedas 500 e 17 conexões numa noite, cada uma
  // espaçada demais para cair no limite de 3 em 10 min. Mais que `dropLimitMax` quedas recuperáveis em
  // `dropLimitWindowMs` = para e pede atenção (needs_attention:repeated_drops). A janela NÃO zera quando a conexão
  // estabiliza (é justamente o padrão "cai, estabiliza, cai"); só zera em conexão manual (humano agiu) ou reinício do serviço.
  dropLimitMax: 6,
  dropLimitWindowMs: 3 * 3_600_000
});

const INTERVENTION_REASONS = Object.freeze({
  forbidden: "O WhatsApp recusou a conexão (403). A reconexão automática foi interrompida para não insistir; verifique o número antes de reconectar manualmente.",
  connection_replaced: "Outra conexão assumiu esta sessão (440). A reconexão automática foi interrompida para as duas não ficarem se derrubando.",
  multidevice_mismatch: "O WhatsApp informou incompatibilidade de multi-aparelho (411). A reconexão automática foi interrompida.",
  repeated_drops: "A conexão caiu muitas vezes em poucas horas. A reconexão automática foi interrompida para não insistir; reconecte manualmente quando o celular estiver com internet estável.",
  repeated_stream_errors: "O WhatsApp derrubou a conexão com erro de comunicação (500) várias vezes em pouco tempo. A reconexão automática foi interrompida; reconecte manualmente quando for seguro.",
  restart_loop: "O WhatsApp pediu reinício (515) repetidamente sem a conexão estabilizar. A reconexão automática foi interrompida.",
  no_active_attempt: "A sessão estava marcada como reconectando, mas nenhuma tentativa estava em andamento. Reconecte manualmente.",
  unrecognized_code: "O WhatsApp encerrou a conexão com um código não previsto. A reconexão automática foi interrompida para evitar insistência."
});

function toCode(statusCode) {
  if (statusCode === null || statusCode === undefined || statusCode === "") return null;
  const code = Number(statusCode);
  return Number.isInteger(code) ? code : null;
}

// Sessão JÁ PAREADA? `creds.registered` do Baileys só vira true no pareamento por CÓDIGO
// (messages-recv.js); no pareamento por QR ele continua false para sempre — por isso a prova
// de pareamento é `creds.me` (preenchido no pair-success). Antes: `registered === false` tratava
// TODA sessão pareada por QR como "não pareada" (backoff de 2 s em vez do exponencial).
export function isPairedCreds(creds) {
  return Boolean(creds?.me?.id) || creds?.registered === true;
}

// -> { kind, code, reason }. `message` (opcional) distingue QR sem escanear de timeout de rede (ambos 408).
export function classifyDisconnect(statusCode, message = "") {
  const code = toCode(statusCode);
  if (code === 401) return { kind: KIND.LOGOUT, code, reason: "logged_out" };
  if (code === 515) return { kind: KIND.RESTART, code, reason: "restart_required" };
  if (code === 403) return { kind: KIND.INTERVENTION, code, reason: "forbidden" };
  if (code === 440) return { kind: KIND.INTERVENTION, code, reason: "connection_replaced" };
  if (code === 411) return { kind: KIND.INTERVENTION, code, reason: "multidevice_mismatch" };
  if (code === 408 && /QR refs attempts ended/i.test(String(message || ""))) return { kind: KIND.QR_TIMEOUT, code, reason: "qr_expired" };
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
    stableMs: boundedInt(env.WHATSAPP_RECONNECT_STABLE_MS, DEFAULT_CONFIG.stableMs, 30_000, 3_600_000),
    dropLimitMax: boundedInt(env.WHATSAPP_RECONNECT_DROP_LIMIT, DEFAULT_CONFIG.dropLimitMax, 3, 20)
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
  const state = { cycleId: null, active: false, attempt: 0, openedAt: null, stableTimer: null, restarts: [], streamErrors: [], drops: [] };

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
      state.restarts = [];
      // Conexão pedida por uma pessoa (botão Conectar) recomeça a contagem de quedas; retomada no boot não.
      if (trigger === "manual") { state.drops = []; state.streamErrors = []; }
      emit("cycle_start", { trigger });
      emit("connect_attempt", { trigger });
      return { cycleId: state.cycleId, attempt: state.attempt };
    },

    // Reinício pedido pelo próprio WhatsApp (515, normal logo após parear): NÃO consome tentativa de
    // reconexão — continua o mesmo ciclo, com o mesmo número de tentativa.
    beginRestart() {
      if (!state.active) {
        state.cycleId = newId();
        state.active = true;
        state.attempt = 1;
        emit("cycle_start", { trigger: "restart" });
      }
      state.openedAt = null;
      emit("connect_attempt", { trigger: "restart" });
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
      state.restarts = []; // conectou de verdade: o 515 anterior era o reinício normal
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
    onClose({ statusCode, unpaired = false, message = "" } = {}) {
      clearStable();
      const connectedMs = state.openedAt ? now() - state.openedAt : null;
      state.openedAt = null;
      const verdict = classifyDisconnect(statusCode, message);
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

      const intervene = (reason) => {
        emit("intervention_required", { statusCode: verdict.code, reason });
        endCycle("intervention");
        return { action: ACTION.INTERVENE, kind: KIND.INTERVENTION, code: verdict.code, reason, message: interventionMessage(reason) };
      };

      // 515: o WhatsApp manda reiniciar o socket logo depois de aceitar o QR/código — comportamento NORMAL.
      // Reinício rápido, sem backoff de falha e sem consumir tentativa; só o laço anormal
      // (mais de `restartLoopMax` em `restartLoopWindowMs` sem nunca conectar) para e pede atenção.
      if (verdict.kind === KIND.RESTART) {
        const t = now();
        state.restarts = state.restarts.filter((at) => t - at < config.restartLoopWindowMs);
        state.restarts.push(t);
        if (state.restarts.length > config.restartLoopMax) return intervene("restart_loop");
        emit("retry_scheduled", { nextAttempt: state.attempt, delayMs: config.restartDelayMs, statusCode: verdict.code, reason: verdict.reason });
        return { action: ACTION.RESTART, kind: verdict.kind, code: verdict.code, reason: verdict.reason, delayMs: config.restartDelayMs, nextAttempt: state.attempt };
      }

      // Sessão AINDA NÃO PAREADA que cai (QR sem escanear, falha ao pedir código...): nunca gera QR
      // sozinha — termina como "desconectada" e só um humano pede QR novo.
      if (unpaired) {
        const qr = verdict.kind === KIND.QR_TIMEOUT;
        endCycle(qr ? "qr_expired" : "pairing_interrupted");
        return { action: ACTION.GIVE_UP_PAIRING, kind: verdict.kind, code: verdict.code, reason: qr ? "qr_expired" : "pairing_interrupted" };
      }

      const dropNow = now();
      state.drops = state.drops.filter((at) => dropNow - at < config.dropLimitWindowMs);
      state.drops.push(dropNow);

      // 500 / "Stream Errored": reconecta com backoff, mas repetição em janela curta para e pede atenção.
      if (verdict.code === 500) {
        const t = now();
        state.streamErrors = state.streamErrors.filter((at) => t - at < config.streamErrorWindowMs);
        state.streamErrors.push(t);
        if (state.streamErrors.length >= config.streamErrorMax) return intervene("repeated_stream_errors");
      }

      // Recuperável (transitório; QR_TIMEOUT de sessão pareada cai aqui como timeout comum).
      const limit = config.maxRetries;
      const retriesUsed = state.attempt - 1;
      if (retriesUsed >= limit) {
        emit("interrupted_limit", { statusCode: verdict.code, reason: verdict.reason, maxRetries: limit });
        endCycle("limit");
        return { action: ACTION.GIVE_UP, kind: verdict.kind, code: verdict.code, reason: verdict.reason, maxRetries: limit };
      }
      if (state.drops.length > config.dropLimitMax) return intervene("repeated_drops");
      const delayMs = computeBackoffDelay(retriesUsed + 1, config, random);
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
