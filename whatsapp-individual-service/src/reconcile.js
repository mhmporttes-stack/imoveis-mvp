// RECONCILIAÇÃO de estado preso: uma sessão gravada como 'reconnecting'/'connecting' no banco SEM
// nenhuma tentativa real em andamento neste processo (nem socket, nem conexão em curso, nem
// reconexão agendada) há mais de `staleMs` não pode ficar assim para sempre — vira 'error' com
// motivo 'no_active_attempt' (needs_attention; exige ação humana, como as demais interrupções).
// Roda no boot (depois do lease) e a cada `intervalMs`, só com o lease. Não reconecta nada,
// não envia nada e não mexe em credenciais.

export const RECONCILE_STALE_MS = 10 * 60_000; // maior que toda a espera do backoff (~4 min)
export const RECONCILE_INTERVAL_MS = 2 * 60_000;
export const RECONCILE_STATUSES = Object.freeze(["reconnecting", "connecting"]);

// -> linhas a reconciliar. Puro.
export function planReconcile({ rows = [], isActive = () => false, now = Date.now(), staleMs = RECONCILE_STALE_MS } = {}) {
  const out = [];
  for (const row of rows) {
    if (!row?.user_id || !RECONCILE_STATUSES.includes(row.status)) continue;
    if (isActive(row.user_id)) continue; // tentativa real em andamento
    const updated = new Date(row.updated_at || 0).getTime();
    if (!Number.isFinite(updated) || updated <= 0) continue; // sem data confiável: não presume
    const ageMs = now - updated;
    if (ageMs < staleMs) continue;
    out.push({ userId: row.user_id, from: row.status, ageMs });
  }
  return out;
}

export function createReconciler({
  listTransientRows,
  isActive,
  notifyStatus,
  canRun = () => true, // só com o lease e fora de encerramento
  record = () => {},
  now = Date.now,
  staleMs = RECONCILE_STALE_MS,
  intervalMs = RECONCILE_INTERVAL_MS,
  setTimer = setInterval,
  clearTimer = clearInterval,
  log = console
} = {}) {
  let timer = null;
  let running = false;

  async function runOnce() {
    if (running || !canRun()) return { reconciled: 0, skipped: true };
    running = true;
    try {
      let rows;
      try {
        rows = await listTransientRows();
      } catch (error) {
        log.error?.("Reconciliação: falha ao listar sessões transitórias:", error?.message || error);
        return { reconciled: 0, failed: true };
      }
      const plan = planReconcile({ rows, isActive, now: now(), staleMs });
      let reconciled = 0;
      for (const item of plan) {
        if (!canRun() || isActive(item.userId)) continue; // reconferência: pode ter mudado
        try {
          await notifyStatus(item.userId, {
            status: "error",
            error: "needs_attention:no_active_attempt: A sessão estava marcada como reconectando, mas nenhuma tentativa estava em andamento. Reconecte manualmente."
          });
          record(item.userId, "session_reconciled", { reason: "no_active_attempt", detail: `from_${item.from}`, delayMs: item.ageMs });
          log.warn?.(`[${item.userId}] Estado '${item.from}' sem tentativa ativa há ${Math.round(item.ageMs / 60000)} min — marcado como 'error' (precisa de atenção).`);
          reconciled += 1;
        } catch (error) {
          log.error?.(`[${item.userId}] Falha ao reconciliar:`, error?.message || error);
        }
      }
      return { reconciled };
    } finally {
      running = false;
    }
  }

  return {
    runOnce,
    start() {
      if (timer) return;
      timer = setTimer(() => { runOnce().catch(() => {}); }, intervalMs);
      timer?.unref?.();
    },
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    }
  };
}
