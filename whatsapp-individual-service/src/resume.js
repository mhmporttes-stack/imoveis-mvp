// RETOMADA (resume) das sessões depois de subir o serviço — escalonada e de execução única.
//
// Regras: (a) só roda com o lease (quem chama garante); (b) UMA sessão por vez, com intervalo e
// jitter, para não abrir tudo ao mesmo tempo; (c) nunca duas execuções simultâneas (single-flight);
// (d) para na hora se o serviço estiver encerrando ou tiver perdido o lease; (e) só retoma quem o
// banco diz 'connected' (shouldResume); (f) não retoma sessão que já está ativa neste processo;
// (g) NÃO envia nada e NÃO lê histórico (syncFullHistory segue desligado em sessions.js).
// Módulo sem Baileys/rede próprios: tudo injetado.

export function createResumeRunner({
  listIds,
  readRow,
  shouldResume,
  connect, // (userId) => Promise — abre a sessão (trigger "resume")
  isActive = () => false, // sessão já viva/conectando neste processo?
  shouldAbort = () => false, // encerrando ou sem lease
  record = () => {},
  spacingMs = () => 5000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console
} = {}) {
  let running = null;

  async function execute() {
    let userIds = [];
    try {
      userIds = await listIds();
    } catch (error) {
      log.error?.("Falha ao listar sessões para retomar:", error?.message || error);
      return { resumed: 0, total: 0, aborted: false, failed: true };
    }
    let resumed = 0;
    let aborted = false;
    for (let i = 0; i < userIds.length; i += 1) {
      const userId = userIds[i];
      if (shouldAbort()) { aborted = true; break; }
      let row = null;
      try {
        row = await readRow(userId);
      } catch (error) {
        // Sem confirmar o estado no banco, não reabre (conservador).
        log.error?.(`[${userId}] Não foi possível ler o estado para retomar; sessão não retomada:`, error?.message || error);
        record(userId, "resume_skipped", { reason: "state_unreadable" });
        continue;
      }
      if (!shouldResume(row)) {
        log.log?.(`[${userId}] Sessão não retomada no boot (estado: ${row?.status || "sem linha"}).`);
        record(userId, "resume_skipped", { reason: row?.status ? `status_${row.status}` : "no_row" });
        continue;
      }
      if (isActive(userId)) {
        record(userId, "resume_skipped", { reason: "already_active" });
        continue;
      }
      if (shouldAbort()) { aborted = true; break; }
      try {
        await connect(userId);
        resumed += 1;
        log.log?.(`[${userId}] Sessão retomada após subir o processo.`);
      } catch (error) {
        log.error?.(`[${userId}] Falha ao retomar a sessão:`, error?.message || error);
      }
      if (i < userIds.length - 1) await sleep(spacingMs());
    }
    record(null, "resume_done", { detail: `${aborted ? "aborted_" : ""}resumed_${resumed}_of_${userIds.length}` });
    return { resumed, total: userIds.length, aborted, failed: false };
  }

  return {
    run() {
      if (running) return running; // single-flight: nunca duas retomadas ao mesmo tempo
      running = execute().finally(() => { running = null; });
      return running;
    },
    get busy() { return Boolean(running); }
  };
}

// Espera antes da 1ª retomada. Passagem LIMPA (o dono anterior liberou o lease no SIGTERM): curta.
// Sem dono anterior conhecido (1º deploy com lease, instância antiga sem lease que ainda recebe SIGTERM)
// ou lease que expirou: margem maior, para a instância antiga terminar de fechar os sockets.
export function resumeSettleMs({ mode, previousReleased, override } = {}) {
  if (Number.isFinite(override) && override >= 0) return override;
  if (mode === "unleased") return 0; // já esperamos a carência inteira
  return previousReleased ? 3000 : 20_000;
}
