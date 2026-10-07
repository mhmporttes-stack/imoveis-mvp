// Aviso de ATIVIDADE AGENDADA (gatilhos activity_created / activity_upcoming / activity_overdue / activity_completed).
// Regra do dono (2026-10-06, mesma do aviso de cliente novo): notificar UMA vez por atividade, nunca a cada mudança no
// cliente. Causa do bug: a chave de deduplicação de "Atividade agendada" usava `updated_at` + etapa, então qualquer
// edição do cliente (etapa, observação, WhatsApp...) virava "evento novo" e o push saía de novo — inclusive para
// atividades que já tinham passado. Agora a identidade do aviso é a PRÓPRIA atividade (data/hora agendada).
// Puro e testado (tests/crm-automation-activity.test.mjs).

export const ACTIVITY_TRIGGERS = new Set(["activity_created", "activity_upcoming", "activity_overdue", "activity_completed"]);

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isActivityTrigger(triggerType) {
  return ACTIVITY_TRIGGERS.has(triggerType);
}

/** Momento que identifica a atividade do aviso: a conclusão (activity_completed) ou a data/hora agendada (demais). */
export function activityIdentity(triggerType, client = {}) {
  return toDate(triggerType === "activity_completed" ? client.scheduled_activity_completed_at : client.scheduled_activity_at);
}

/**
 * Âncora do prazo ("quando avisar"). "Antes da atividade" conta a partir da data/hora AGENDADA (antes contava de
 * `updated_at`, e o lembrete saía na hora de qualquer edição). "Atividade agendada" nos outros modos segue contando da
 * última alteração (é quando a atividade foi marcada); os demais gatilhos seguem como antes.
 */
export function activityAnchor(triggerType, timingMode, client = {}) {
  if (triggerType === "activity_created" && timingMode !== "before_activity") return toDate(client.updated_at);
  return activityIdentity(triggerType, client);
}

/** Chave única do aviso: UMA por atividade — a etapa e as edições do cliente NÃO entram. Reagendar = atividade nova. */
export function activityEventKey(triggerType, client = {}) {
  const identity = activityIdentity(triggerType, client);
  return identity ? `${triggerType}@${identity.toISOString()}` : null;
}

/** "Atividade agendada" só avisa atividade ainda por acontecer e não concluída (nunca atividade vencida/antiga). */
export function isActivityStillPending(triggerType, client = {}, now = Date.now()) {
  if (triggerType !== "activity_created") return true;
  const scheduled = toDate(client.scheduled_activity_at);
  return Boolean(scheduled && !client.scheduled_activity_completed_at && scheduled.getTime() > now);
}
