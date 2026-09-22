import { CLIENT_STATUS, CLIENT_FUNNEL_STAGES, getClientFunnelStage, isOverdueActivityClient, isAwaitingFutureActivityClient, hasFutureScheduledActivity } from "./client-status.js";

// Motor determinístico da Central de Oportunidades: score (potencial),
// urgência (necessidade de agir agora) e prioridade final (combinação dos
// dois) — nunca inventado por IA, sempre a mesma saída para a mesma entrada.
// Pesos fixos nesta fase (configuráveis pelo admin só na Fase 2).

const STAGE_ORDER = CLIENT_FUNNEL_STAGES.map((stage) => stage.key);
const STAGE_SCORE = { service: 10, simulation: 20, documentation: 30, approval: 40, approved: 55, meeting: 50, sale: 0 };

const STALE_DAYS_THRESHOLD = 3;
const RECENT_RESPONSE_DAYS = 3;
const APPROVED_STALE_DAYS = 5;

export const PRIORITY_BANDS = [
  { min: 90, key: "hot", label: "Muito quente", emoji: "🔥" },
  { min: 70, key: "high", label: "Alta oportunidade", emoji: "" },
  { min: 50, key: "developing", label: "Em desenvolvimento", emoji: "" },
  { min: 0, key: "reactivation", label: "Reativação", emoji: "" }
];

function stageIndex(status) {
  return STAGE_ORDER.indexOf(getClientFunnelStage(status));
}

function daysBetween(fromIso, toMs = Date.now()) {
  const fromMs = new Date(fromIso || "").getTime();
  if (!Number.isFinite(fromMs)) return null;
  return Math.max(0, (toMs - fromMs) / (24 * 60 * 60 * 1000));
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function priorityBand(priority) {
  return PRIORITY_BANDS.find((band) => priority >= band.min) || PRIORITY_BANDS[PRIORITY_BANDS.length - 1];
}

// signals: { documentationStatus: "not_started"|"incomplete"|"complete",
//            recentInboundWhatsappAt: isoString|null,
//            lastInteractionAt: isoString|null }
// client (já com scheduledActivityAt/scheduledActivityCompletedAt mesclados
// via mergeActivitySignal, feito por quem chama): id, status, createdAt,
// approvedAt, lastStatusChangeAt, lastWhatsappContactAt, scheduledActivityAt,
// scheduledActivityCompletedAt.
export function computeOpportunityScore(client, signals = {}) {
  const now = Date.now();
  const status = client?.status;
  const stage = getClientFunnelStage(status);
  const idx = stageIndex(status);
  const documentationStatus = signals.documentationStatus || "not_started";
  const hasFutureActivity = hasFutureScheduledActivity(client, now);
  const overdueActivity = isOverdueActivityClient(client, now);
  const noFutureActivity = isAwaitingFutureActivityClient(client, now);
  const staleDays = daysBetween(client?.lastWhatsappContactAt || client?.createdAt, now);
  const recentResponseDays = daysBetween(signals.recentInboundWhatsappAt, now);
  const approvedDays = status === CLIENT_STATUS.APPROVED ? daysBetween(client?.approvedAt || client?.lastStatusChangeAt || client?.createdAt, now) : null;
  const recentAdvanceDays = daysBetween(client?.lastStatusChangeAt, now);

  const scoreFactors = [];
  const urgencyFactors = [];

  // ---- SCORE (potencial da oportunidade) ----
  let score = STAGE_SCORE[stage] ?? 10;
  scoreFactors.push({ label: `Etapa: ${stageLabel(stage)}`, weight: STAGE_SCORE[stage] ?? 10 });

  if (documentationStatus === "complete") {
    score += 15;
    scoreFactors.push({ label: "Documentação completa", weight: 15 });
  }

  if (recentResponseDays !== null && recentResponseDays <= RECENT_RESPONSE_DAYS) {
    const label = recentResponseDays < 1 ? "Respondeu hoje" : recentResponseDays < 2 ? "Respondeu ontem" : "Respondeu recentemente";
    score += 12;
    scoreFactors.push({ label, weight: 12 });
  }

  if (recentAdvanceDays !== null && recentAdvanceDays <= RECENT_RESPONSE_DAYS && idx > 0) {
    score += 10;
    scoreFactors.push({ label: "Avançou de etapa recentemente", weight: 10 });
  }

  if (staleDays !== null && staleDays > STALE_DAYS_THRESHOLD) {
    const penalty = -Math.min(20, Math.round(staleDays - STALE_DAYS_THRESHOLD));
    score += penalty;
    scoreFactors.push({ label: `Sem contato há ${Math.floor(staleDays)} dias`, weight: penalty });
  }

  score = clamp(Math.round(score));

  // ---- URGÊNCIA (necessidade de agir agora) ----
  let urgency = 0;

  if (overdueActivity) {
    urgency += 35;
    urgencyFactors.push({ label: "Atividade atrasada", weight: 35 });
  }

  if (status === CLIENT_STATUS.APPROVED && !hasFutureActivity) {
    urgency += 25;
    urgencyFactors.push({ label: "Sem reunião agendada", weight: 25 });
  } else if (noFutureActivity) {
    urgency += 18;
    urgencyFactors.push({ label: "Sem atividade futura", weight: 18 });
  }

  if (approvedDays !== null && approvedDays > APPROVED_STALE_DAYS) {
    const bump = Math.min(20, Math.round(approvedDays - APPROVED_STALE_DAYS));
    urgency += bump;
    urgencyFactors.push({ label: `Aprovado há ${Math.floor(approvedDays)} dias sem avanço`, weight: bump });
  }

  if (recentResponseDays !== null && recentResponseDays <= 1) {
    urgency += 15;
    urgencyFactors.push({ label: "Respondeu recentemente, aguardando retorno", weight: 15 });
  }

  if (staleDays !== null && staleDays > STALE_DAYS_THRESHOLD) {
    const bump = Math.min(25, Math.round((staleDays - STALE_DAYS_THRESHOLD) * 2));
    urgency += bump;
    urgencyFactors.push({ label: `${Math.floor(staleDays)} dias sem interação`, weight: bump });
  }

  urgency = clamp(Math.round(urgency));

  const priority = clamp(Math.round(score * 0.6 + urgency * 0.4));
  const band = priorityBand(priority);

  const reasons = [...scoreFactors, ...urgencyFactors]
    .filter((factor) => factor.weight !== 0)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 4)
    .map((factor) => factor.label);

  const tags = buildTags({ status, stage, documentationStatus, hasFutureActivity, noFutureActivity, overdueActivity, recentResponseDays });

  return {
    score,
    urgency,
    priority,
    category: band.key,
    categoryLabel: band.label,
    categoryEmoji: band.emoji,
    reasons,
    tags,
    recommendedAction: getRecommendedAction({ client, status, stage, idx, documentationStatus, hasFutureActivity, recentResponseDays, staleDays })
  };
}

function stageLabel(stageKey) {
  return CLIENT_FUNNEL_STAGES.find((stage) => stage.key === stageKey)?.label || "Prospecção";
}

function buildTags({ status, stage, documentationStatus, hasFutureActivity, noFutureActivity, overdueActivity, recentResponseDays }) {
  const tags = [];
  if (status === CLIENT_STATUS.APPROVED && !hasFutureActivity) tags.push("approved_no_meeting");
  if (documentationStatus === "incomplete") tags.push("awaiting_documentation");
  if (stage === "meeting" && status === CLIENT_STATUS.MEETING_DONE) tags.push("meeting_done");
  if (recentResponseDays !== null && recentResponseDays <= RECENT_RESPONSE_DAYS) tags.push("recent_response");
  if (noFutureActivity || overdueActivity) tags.push("no_future_activity");
  return tags;
}

// Regras objetivas, ordem de prioridade fixa — a primeira que casar vence.
// Documentação é cruzada com a etapa do funil (ver .claude/rules): ausência
// de checklist só vira "solicitar documentação" se o cliente já chegou numa
// etapa em que isso é esperado (documentation em diante); antes disso não é
// relevante ainda.
function getRecommendedAction({ client, status, stage, idx, documentationStatus, hasFutureActivity, recentResponseDays, staleDays }) {
  if (hasFutureActivity && client?.scheduledActivityAt) {
    return { type: "scheduled", label: `Atividade programada para ${formatScheduled(client.scheduledActivityAt)}` };
  }

  if (documentationStatus === "incomplete") {
    return { type: "request_docs", label: "Solicitar documentação" };
  }

  if (documentationStatus === "not_started" && idx >= STAGE_ORDER.indexOf("documentation")) {
    return { type: "request_docs", label: "Solicitar/Iniciar documentação" };
  }

  if (documentationStatus === "complete" && stage === "approval") {
    return { type: "follow_analysis", label: "Acompanhar análise" };
  }

  if (status === CLIENT_STATUS.APPROVED) {
    return { type: "schedule_meeting", label: "Agendar reunião" };
  }

  if (status === CLIENT_STATUS.MEETING_DONE) {
    return { type: "follow_up", label: "Realizar follow-up" };
  }

  if (recentResponseDays !== null && recentResponseDays <= RECENT_RESPONSE_DAYS) {
    return { type: "resume_service", label: "Retomar atendimento" };
  }

  if (staleDays !== null && staleDays > STALE_DAYS_THRESHOLD * 3) {
    return { type: "reactivate", label: "Realizar reativação" };
  }

  return { type: "follow_up", label: "Acompanhar cliente" };
}

function formatScheduled(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const datePart = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  const timePart = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return `${datePart} às ${timePart}`;
}
