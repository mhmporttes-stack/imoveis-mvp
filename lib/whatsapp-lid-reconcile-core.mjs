// Plano da rede de segurança das conversas "Número não identificado" (reconcileLidPlaceholders, cron
// scheduled-activities a cada 2 min). Antes, toda rodada procurava o telefone de TODAS as conversas "lid:" (até 200)
// em whatsapp_messages — a rotina mais cara do banco (397 mil chamadas/2.260 s em 22 dias, medido em 20/10/2026).
// Agora: rodada comum só olha conversa "lid:" com novidade (mensagem ou atualização) desde a última checagem; a
// varredura completa, que pega o caso de o telefone aparecer em OUTRA conversa, roda no máximo a cada 30 min.
// Puro — testado em tests/whatsapp-lid-reconcile-core.test.mjs. Estado em crm_settings.id = LID_RECONCILE_SETTINGS_ID.

export const LID_RECONCILE_SETTINGS_ID = "whatsapp_lid_reconcile";
export const LID_RECONCILE_FULL_INTERVAL_MS = 30 * 60 * 1000;
// Folga para não perder conversa gravada enquanto a rodada anterior rodava (relógios do app e do banco).
export const LID_RECONCILE_OVERLAP_MS = 2 * 60 * 1000;

function toMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// state: { lastCheckedAt, lastFullAt } (ISO) ou vazio. Devolve { full, since, nextState }.
// full = true -> varre todas as conversas "lid:"; senão, só as com last_message_at/updated_at >= since.
export function planLidReconcile({ now = new Date(), state = null } = {}) {
  const nowMs = toMs(now) ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const lastCheckedMs = toMs(state?.lastCheckedAt);
  const lastFullMs = toMs(state?.lastFullAt);
  const full = lastCheckedMs === null || lastFullMs === null || lastFullMs > nowMs
    || nowMs - lastFullMs >= LID_RECONCILE_FULL_INTERVAL_MS;
  if (full) return { full: true, since: null, nextState: { lastCheckedAt: nowIso, lastFullAt: nowIso } };
  const sinceMs = Math.min(lastCheckedMs, nowMs) - LID_RECONCILE_OVERLAP_MS;
  return {
    full: false,
    since: new Date(sinceMs).toISOString(),
    nextState: { lastCheckedAt: nowIso, lastFullAt: new Date(lastFullMs).toISOString() }
  };
}
