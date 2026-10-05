// LEASE (arrendamento) do serviço — DONO ÚNICO das sessões do WhatsApp.
//
// Por quê: cada deploy no Railway sobe o serviço novo antes de o antigo morrer; com duas
// instâncias usando a MESMA sessão, o WhatsApp derruba uma com o erro 440 ("conexão
// substituída"). Aqui o serviço só conecta/retoma sessões enquanto detém o lease (tabela
// whatsapp_service_lease no Supabase, acessada pelo CRM: o serviço não tem a service role).
//
//   acquire -> dono livre/liberado/expirado/já nosso. Negado = outro serviço é o dono: ESPERA.
//   renew   -> a cada renewMs. "Perdi" (outro assumiu) = suspende as sessões sem logout.
//   release -> no SIGTERM, DEPOIS de fechar os sockets e gravar as credenciais.
//
// Sem a tabela/função (migration pendente) ou sem o endpoint (CRM antigo): depois de uma carência
// curta o serviço segue SEM lease (comportamento antigo) com aviso claro — nunca derruba nada.
// Módulo sem Baileys/rede próprios: `api` e relógio/timers são injetados (testável).

export const LEASE_MODE = Object.freeze({ LEASED: "leased", UNLEASED: "unleased", STOPPED: "stopped" });
export const LEASE_STATE = Object.freeze({ IDLE: "idle", WAITING: "waiting", LEASED: "leased", UNLEASED: "unleased", LOST: "lost", RELEASED: "released" });

export function createLeaseManager({
  api, // { acquire({ttlSeconds}), renew({ttlSeconds}), release() } -> resultados normalizados (ver db.js)
  ttlSeconds = 60,
  renewMs = 15_000,
  pollMs = 3000,
  pollMaxMs = 8000,
  unavailableGraceMs = 90_000,
  reprobeMs = 60_000,
  waitingLogMs = 30_000,
  random = Math.random,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  setTimer = setInterval,
  clearTimer = clearInterval,
  record = () => {},
  onLost = () => {},
  onRegained = () => {},
  log = console
} = {}) {
  let state = LEASE_STATE.IDLE;
  let stopped = false;
  let renewTimer = null;
  let reprobeTimer = null;
  let renewing = false;
  let acquiring = false;
  let lastRenewOkAt = null;
  let renewFailureStreak = 0;
  let lastWaitLogAt = 0;
  let lastUnavailableReason = null;

  const emit = (type, fields = {}) => {
    try { record(type, fields); } catch { /* telemetria nunca derruba o lease */ }
  };
  const jittered = (base) => Math.max(500, Math.round(base * (0.75 + random() * 0.5)));

  function stopTimers() {
    if (renewTimer) clearTimer(renewTimer);
    if (reprobeTimer) clearTimer(reprobeTimer);
    renewTimer = null;
    reprobeTimer = null;
  }

  function startRenewing() {
    if (renewTimer) clearTimer(renewTimer);
    renewTimer = setTimer(() => { renewOnce().catch(() => {}); }, renewMs);
    renewTimer?.unref?.();
  }

  async function renewOnce() {
    if (renewing || state !== LEASE_STATE.LEASED) return;
    renewing = true;
    try {
      let res;
      try { res = await api.renew({ ttlSeconds }); } catch (error) { res = { unavailable: true, reason: "network", error }; }
      if (state !== LEASE_STATE.LEASED) return; // liberado/encerrado durante a chamada
      if (res.renewed) {
        lastRenewOkAt = now();
        renewFailureStreak = 0;
        return;
      }
      if (res.unavailable) {
        // Não conseguiu falar com o banco/CRM: continua dono (só um outro dono real tira o lease).
        renewFailureStreak += 1;
        if (renewFailureStreak === 1 || renewFailureStreak % 10 === 0) {
          log.warn?.(`[lease] Falha ao renovar (${res.reason || "indisponível"}); seguindo como dono até conseguir.`);
          emit("lease_unavailable", { reason: `renew_${res.reason || "failed"}`, detail: `streak_${renewFailureStreak}` });
        }
        return;
      }
      // renewed=false: outro dono assumiu (ou o registro foi liberado/removido): PERDI.
      await lose("taken_by_other");
    } finally {
      renewing = false;
    }
  }

  async function lose(reason) {
    stopTimers();
    state = LEASE_STATE.LOST;
    log.warn?.(`[lease] Lease perdido (${reason}); sessões suspensas sem logout.`);
    emit("lease_lost", { reason });
    try { await onLost(reason); } catch (error) { log.error?.("[lease] onLost falhou:", error?.message || error); }
    if (stopped) return;
    // Volta a esperar: se o outro dono sumir, retomamos; se ele continuar, ficamos de fora.
    acquireLoop({ regained: true }).catch((error) => log.error?.("[lease] Falha ao readquirir:", error?.message || error));
  }

  // Laço de aquisição. Resolve com { mode, ... } quando: adquiriu (leased), seguiu sem lease (unleased)
  // ou foi interrompido (stopped).
  async function acquireLoop({ regained = false } = {}) {
    if (acquiring) return { mode: LEASE_MODE.STOPPED };
    acquiring = true;
    try {
      const startedAt = now();
      let unavailableSince = null;
      while (!stopped) {
        let res;
        try { res = await api.acquire({ ttlSeconds }); } catch (error) { res = { unavailable: true, reason: "network", error }; }
        if (stopped) {
          // Encerrando no meio da chamada: se o lease foi concedido agora, devolve em vez de segurar até expirar.
          if (res.acquired) { try { await api.release(); } catch { /* expira sozinho no TTL */ } }
          break;
        }

        if (res.acquired) {
          state = LEASE_STATE.LEASED;
          lastRenewOkAt = now();
          renewFailureStreak = 0;
          const how = res.previousReleased ? "handoff_released" : res.tookOver ? "expired_takeover" : res.first ? "first_owner" : "renewed_self";
          emit("lease_acquired", { reason: how, delayMs: now() - startedAt });
          log.log?.(`[lease] Lease adquirido (${how}) após ${now() - startedAt} ms.`);
          startRenewing();
          const info = { mode: LEASE_MODE.LEASED, how, previousReleased: Boolean(res.previousReleased), tookOver: Boolean(res.tookOver), first: Boolean(res.first), waitedMs: now() - startedAt };
          if (regained) { try { await onRegained(info); } catch (error) { log.error?.("[lease] onRegained falhou:", error?.message || error); } }
          return info;
        }

        if (res.unavailable) {
          unavailableSince ??= now();
          if (res.reason !== lastUnavailableReason) {
            lastUnavailableReason = res.reason;
            log.warn?.(`[lease] Lease indisponível (${res.reason || "desconhecido"}) — aguardando; se persistir, o serviço segue SEM lease (comportamento antigo).`);
            emit("lease_unavailable", { reason: res.reason || "unknown", delayMs: now() - startedAt });
          }
          if (now() - unavailableSince >= unavailableGraceMs) {
            state = LEASE_STATE.UNLEASED;
            log.warn?.("[lease] Seguindo SEM lease (migration/endpoint ausente ou rede). Isto NÃO protege contra duas instâncias — aplique a migration 20261004213000.");
            emit("lease_unavailable", { reason: "fallback_unleased", delayMs: now() - startedAt });
            startReprobe();
            const info = { mode: LEASE_MODE.UNLEASED, how: "unleased", waitedMs: now() - startedAt };
            if (regained) { try { await onRegained(info); } catch (error) { log.error?.("[lease] onRegained falhou:", error?.message || error); } }
            return info;
          }
          await sleep(jittered(pollMs));
          continue;
        }

        // Negado: outra instância é a dona. ESPERA (ela libera no SIGTERM ou expira em até o TTL).
        unavailableSince = null;
        lastUnavailableReason = null;
        state = LEASE_STATE.WAITING;
        if (lastWaitLogAt === 0 || now() - lastWaitLogAt >= waitingLogMs) {
          lastWaitLogAt = now();
          log.log?.(`[lease] Aguardando o dono atual liberar (deploy ${res.holderDeployId || "?"}).`);
          emit("lease_waiting", { reason: "holder_active", delayMs: now() - startedAt, detail: res.holderDeployId ? `holder_${res.holderDeployId}` : null });
        }
        const hint = Number.isFinite(res.retryAfterMs) ? res.retryAfterMs + 500 : pollMaxMs;
        await sleep(jittered(Math.min(pollMaxMs, Math.max(pollMs, hint))));
      }
      return { mode: LEASE_MODE.STOPPED };
    } finally {
      acquiring = false;
    }
  }

  // Sem lease: de tempos em tempos tenta de novo (a migration pode ter sido aplicada depois).
  function startReprobe() {
    if (reprobeTimer) clearTimer(reprobeTimer);
    reprobeTimer = setTimer(async () => {
      if (state !== LEASE_STATE.UNLEASED || stopped) return;
      let res;
      try { res = await api.acquire({ ttlSeconds }); } catch { return; }
      if (state !== LEASE_STATE.UNLEASED || stopped) return;
      if (res.acquired) {
        clearTimer(reprobeTimer);
        reprobeTimer = null;
        state = LEASE_STATE.LEASED;
        lastRenewOkAt = now();
        emit("lease_acquired", { reason: "late_start" });
        log.log?.("[lease] Lease passou a estar disponível e foi adquirido (sessões em andamento mantidas).");
        startRenewing();
        return;
      }
      if (!res.unavailable) {
        // Outro serviço (com lease) é o dono: este, que estava sem lease, recua para não brigar pela sessão.
        clearTimer(reprobeTimer);
        reprobeTimer = null;
        await lose("peer_leased");
      }
    }, reprobeMs);
    reprobeTimer?.unref?.();
  }

  return {
    // Resolve quando puder iniciar sessões (leased/unleased) ou for interrompido.
    start() { return acquireLoop({ regained: false }); },
    isHolder() { return state === LEASE_STATE.LEASED || state === LEASE_STATE.UNLEASED; },
    state() { return state; },
    get lastRenewOkAt() { return lastRenewOkAt; },
    // Para o laço de espera e as renovações (SIGTERM) sem liberar.
    stop() { stopped = true; stopTimers(); },
    // Libera (só o dono consegue) — chamar DEPOIS de fechar sockets e gravar credenciais.
    async release(reason = "shutdown") {
      const wasLeased = state === LEASE_STATE.LEASED;
      const wasUnleased = state === LEASE_STATE.UNLEASED;
      stopped = true;
      stopTimers();
      state = LEASE_STATE.RELEASED;
      if (!wasLeased) return { released: false, reason: wasUnleased ? "unleased" : "not_holder" };
      let released = false;
      try { released = Boolean((await api.release())?.released); } catch (error) { log.warn?.("[lease] Falha ao liberar (expira sozinho em até o TTL):", error?.message || error); }
      emit("lease_released", { reason: released ? reason : `${reason}_not_confirmed` });
      return { released };
    }
  };
}
