// Orquestração do ciclo de vida do SERVIÇO: lease -> espera de assentamento -> retomada escalonada ->
// reconciliação periódica; perda do lease -> suspende sem logout; SIGTERM -> encerramento gracioso.
// Módulo sem Baileys/rede/processo: tudo injetado (testado com dublês em tests/whatsapp-service-lease.test.mjs).

import { createShutdown } from "./shutdown.js";
import { resumeSettleMs } from "./resume.js";

export function createServiceRuntime({
  lease,
  resumeRunner,
  reconciler,
  suspendAllSessions,
  flushPendingWrites = async () => {},
  flushTelemetry = async () => {},
  record = () => {},
  settleOverrideMs = null,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  exit = (code) => process.exit(code),
  log = console,
  shutdownTimeouts = {}
} = {}) {
  let shuttingDown = false;

  // null = pode conectar; senão o motivo. Instalada em sessions.js (setConnectGuard).
  const guard = () => {
    if (shuttingDown) return "shutting_down";
    return lease.isHolder() ? null : "waiting_lease";
  };

  async function startServing(info) {
    const settle = resumeSettleMs({ mode: info?.mode, previousReleased: info?.previousReleased, override: settleOverrideMs });
    if (settle > 0) {
      log.log?.(`[boot] Aguardando ${Math.round(settle / 1000)} s para o dono anterior terminar de fechar as sessões antes de retomar.`);
      await sleep(settle);
    }
    if (shuttingDown || !lease.isHolder()) return { skipped: true };
    const resumed = await resumeRunner.run();
    if (!shuttingDown && lease.isHolder()) {
      reconciler.start();
      await reconciler.runOnce();
    }
    return { resumed };
  }

  async function boot() {
    const info = await lease.start();
    if (!info || info.mode === "stopped") return { stopped: true };
    return startServing(info);
  }

  // Lease perdido: outro serviço assumiu — recua sem logout e sem gravar estado.
  async function onLost() {
    reconciler.stop();
    await suspendAllSessions({ shutdown: false });
  }

  const shutdown = createShutdown({
    stopAccepting: async () => { shuttingDown = true; lease.stop(); reconciler.stop(); },
    closeSockets: () => suspendAllSessions({ shutdown: true }),
    flushCredentials: flushPendingWrites,
    releaseLease: () => lease.release("shutdown"),
    flushTelemetry,
    record: (signal) => record(null, "service_shutdown", { reason: signal }),
    exit,
    log,
    ...shutdownTimeouts
  });

  return {
    guard,
    boot,
    onLost,
    onRegained: (info) => startServing(info),
    shutdown,
    get shuttingDown() { return shuttingDown; },
    health() {
      return { ok: true, lease: shuttingDown ? "shutting_down" : lease.state(), serving: !shuttingDown && lease.isHolder() };
    }
  };
}
