// Regras puras das SEQUÊNCIAS e dos PERÍODOS dos reconhecimentos (RAN-9c, dono 2026-10-30). Testadas em
// tests/celebrations-sequences.test.mjs. Só servidor (importa a fórmula da Meta Diária) — a cena do navegador usa
// lib/celebrations-core.mjs, que é leve.
import { dailyGoalOverallProgress } from "./daily-goal-progress.mjs";
import { shiftPlainDate } from "./celebrations-core.mjs";

// Marcos de "dias seguidos de meta batida" (dono, 2026-10-30). Além do último, a cada 10 dias.
export const DEFAULT_STREAK_MILESTONES = [2, 3, 5, 7, 10, 15, 20, 30];
// Uma sequência velha demais (corretor longe do CRM) não vira reconhecimento: o último dia batido precisa ser dos
// últimos 3 dias (cobre o fim de semana: sexta batida, segunda de manhã).
const STREAK_FRESH_DAYS = 3;

export function plainDow(day) {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export function streakMilestones(config) {
  const list = (Array.isArray(config?.thresholds) ? config.thresholds : DEFAULT_STREAK_MILESTONES)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 2);
  return [...new Set(list.length ? list : DEFAULT_STREAK_MILESTONES)].sort((a, b) => a - b);
}

// O marco a registrar para uma sequência: SÓ o mais alto já alcançado (nunca um menor depois de um maior — era o
// bug do "3 dias depois do 5"). Depois do último marco da lista, a cada 10 dias.
export function pickStreakMilestone(streak, milestones) {
  const value = Math.floor(Number(streak) || 0);
  const list = streakMilestones({ thresholds: milestones });
  let best = null;
  for (const milestone of list) if (milestone <= value) best = milestone;
  const last = list[list.length - 1];
  if (value > last) {
    const tens = Math.floor(value / 10) * 10;
    if (tens > last) best = tens;
  }
  return best;
}

// Sequência de dias de meta batida. `rows` = daily_goals FECHADOS ({ goal_date, goal_met }); `todayMet` = a meta de
// hoje já está batida (a cena sai no dia em que a sequência chega ao marco). Regra de dia de meta (a existente):
// cada linha de daily_goals é um dia; domingo (sem disparo, segunda a sábado) NUNCA quebra a sequência, mas conta
// se foi batido; dia sem linha é ignorado. Dia útil não batido quebra e reinicia (sem cena negativa).
export function goalStreakFromRows(rows, { today, todayMet = false } = {}) {
  const days = new Map();
  for (const row of rows || []) if (row?.goal_date) days.set(String(row.goal_date).slice(0, 10), row.goal_met === true);
  if (todayMet && today) days.set(today, true);

  let streak = 0;
  let startDate = null;
  let endDate = null;
  for (const date of [...days.keys()].sort().reverse()) {
    if (!days.get(date)) {
      if (plainDow(date) === 0) continue;
      break;
    }
    streak += 1;
    startDate = date;
    if (!endDate) endDate = date;
  }
  if (!streak || !today || endDate < shiftPlainDate(today, -STREAK_FRESH_DAYS)) return { streak: 0, startDate: null, endDate: null };
  return { streak, startDate, endDate };
}

// ---------------- meta semanal e mensal (opção B, dono 2026-10-30) ----------------

// Período que acabou de fechar, avaliado só no 1º dia depois dele: semana (segunda a domingo, como o ranking
// semanal) numa segunda-feira; mês no dia 1. Fora desses dias: null (nada a avaliar).
export function closedPeriodRange(kind, today) {
  if (!today) return null;
  if (kind === "week") {
    if (plainDow(today) !== 1) return null;
    const start = shiftPlainDate(today, -7);
    return { kind, start, end: shiftPlainDate(today, -1), triggerKey: "weekly_goal_met", eventKey: `weekly_goal_met:${start}` };
  }
  if (kind === "month") {
    if (today.slice(8, 10) !== "01") return null;
    const end = shiftPlainDate(today, -1);
    return { kind, start: `${end.slice(0, 7)}-01`, end, triggerKey: "monthly_goal_met", eventKey: `monthly_goal_met:${end.slice(0, 7)}` };
  }
  return null;
}

// Soma do período como a meta diária: prospecção e pendentes, cada um no seu teto, com compensação entre os dias
// (`dailyGoalOverallProgress`, a MESMA fórmula do dia). `rows` = daily_goals fechados do corretor no período
// ({ done_count, total_due, pending_done, pending_total }). Dia sem os pendentes gravados (anterior à migration)
// entra só com a prospecção — nunca inventa pendente.
export function summarizePeriodGoal(rows) {
  let prospectingDone = 0;
  let prospectingTarget = 0;
  let pendingDone = 0;
  let pendingTotal = 0;
  let days = 0;
  let pendingKnownDays = 0;
  for (const row of rows || []) {
    days += 1;
    prospectingDone += Math.max(0, Number(row.done_count) || 0);
    prospectingTarget += Math.max(0, Number(row.total_due) || 0);
    if (row.pending_total !== null && row.pending_total !== undefined) {
      pendingKnownDays += 1;
      pendingTotal += Math.max(0, Number(row.pending_total) || 0);
      pendingDone += Math.max(0, Number(row.pending_done) || 0);
    }
  }
  const progress = dailyGoalOverallProgress({ prospectingDone, prospectingTarget, pendingDone, pendingTotal });
  return { met: days > 0 && progress.required > 0 && progress.percent >= 100, percent: progress.percent, required: progress.required, days, pendingKnownDays };
}

// ---------------- erro de migration não aplicada ----------------

// Coluna/tabela ainda inexistente (migration não aplicada): o chamador degrada para o comportamento anterior em vez
// de quebrar. Qualquer outro erro continua subindo.
export function isMissingSchemaError(error) {
  if (!error) return false;
  if (["42703", "42P01", "PGRST204", "PGRST205"].includes(String(error.code || ""))) return true;
  return /does not exist|schema cache|could not find the/i.test(String(error.message || ""));
}
