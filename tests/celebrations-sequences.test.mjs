import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STREAK_MILESTONES,
  closedPeriodRange,
  goalStreakFromRows,
  isMissingSchemaError,
  pickStreakMilestone,
  streakMilestones,
  summarizePeriodGoal
} from "../lib/celebrations-sequences-core.mjs";
import { rankingLeaderStreak } from "../lib/celebrations-ranking-core.mjs";
import { fallbackMessageFor, resolveMessageText, shiftPlainDate } from "../lib/celebrations-core.mjs";

const met = (goal_date) => ({ goal_date, goal_met: true });
const missed = (goal_date) => ({ goal_date, goal_met: false });

// ---------- dias seguidos de meta batida ----------

test("sequência: conta dias consecutivos de meta batida até ontem", () => {
  const rows = [met("2026-10-26"), met("2026-10-27"), met("2026-10-28")];
  assert.deepEqual(goalStreakFromRows(rows, { today: "2026-10-29" }), { streak: 3, startDate: "2026-10-26", endDate: "2026-10-28" });
});

test("sequência: a meta de hoje já batida entra na conta (a cena sai no dia do marco)", () => {
  const rows = [met("2026-10-27"), met("2026-10-28")];
  assert.equal(goalStreakFromRows(rows, { today: "2026-10-29", todayMet: false }).streak, 2);
  assert.equal(goalStreakFromRows(rows, { today: "2026-10-29", todayMet: true }).streak, 3);
});

test("sequência: dia útil não batido quebra e reinicia — sem cena negativa (streak 0 / recomeça)", () => {
  const rows = [met("2026-10-20"), met("2026-10-21"), missed("2026-10-22"), met("2026-10-23"), met("2026-10-26")];
  const result = goalStreakFromRows(rows, { today: "2026-10-27" });
  assert.equal(result.streak, 2);
  assert.equal(result.startDate, "2026-10-23");
  assert.equal(goalStreakFromRows([met("2026-10-27"), missed("2026-10-28")], { today: "2026-10-29" }).streak, 0);
});

test("sequência: domingo não batido não quebra (segunda a sábado); domingo batido conta; dia sem linha é ignorado", () => {
  // 2026-10-24 sábado, 2026-10-25 domingo, 2026-10-26 segunda
  const sundayMissed = [met("2026-10-23"), met("2026-10-24"), missed("2026-10-25"), met("2026-10-26")];
  assert.equal(goalStreakFromRows(sundayMissed, { today: "2026-10-27" }).streak, 3);
  const sundayMet = [met("2026-10-24"), met("2026-10-25"), met("2026-10-26")];
  assert.equal(goalStreakFromRows(sundayMet, { today: "2026-10-27" }).streak, 3);
  const noSundayRow = [met("2026-10-24"), met("2026-10-26")];
  assert.equal(goalStreakFromRows(noSundayRow, { today: "2026-10-27" }).streak, 2);
});

test("sequência: velha demais (corretor longe do CRM) não vira reconhecimento; fim de semana cabe", () => {
  assert.equal(goalStreakFromRows([met("2026-10-10"), met("2026-10-11")], { today: "2026-10-29" }).streak, 0);
  // sexta batida, segunda de manhã (sábado e domingo sem linha)
  assert.equal(goalStreakFromRows([met("2026-10-22"), met("2026-10-23")], { today: "2026-10-26" }).streak, 2);
});

// ---------- marcos ----------

test("marcos: lista padrão 2, 3, 5, 7, 10, 15, 20, 30 e depois a cada 10", () => {
  assert.deepEqual(DEFAULT_STREAK_MILESTONES, [2, 3, 5, 7, 10, 15, 20, 30]);
  assert.equal(pickStreakMilestone(1, DEFAULT_STREAK_MILESTONES), null);
  assert.equal(pickStreakMilestone(2, DEFAULT_STREAK_MILESTONES), 2);
  assert.equal(pickStreakMilestone(4, DEFAULT_STREAK_MILESTONES), 3);
  assert.equal(pickStreakMilestone(9, DEFAULT_STREAK_MILESTONES), 7);
  assert.equal(pickStreakMilestone(30, DEFAULT_STREAK_MILESTONES), 30);
  assert.equal(pickStreakMilestone(39, DEFAULT_STREAK_MILESTONES), 30);
  assert.equal(pickStreakMilestone(40, DEFAULT_STREAK_MILESTONES), 40);
  assert.equal(pickStreakMilestone(57, DEFAULT_STREAK_MILESTONES), 50);
});

test("marcos: configuração do admin vale; lista inválida cai no padrão", () => {
  assert.deepEqual(streakMilestones({ thresholds: [10, 3, 5, 5, "x", 1] }), [3, 5, 10]);
  assert.deepEqual(streakMilestones({ thresholds: [] }), DEFAULT_STREAK_MILESTONES);
  assert.deepEqual(streakMilestones(null), DEFAULT_STREAK_MILESTONES);
  assert.equal(pickStreakMilestone(6, [3, 5, 10]), 5);
});

test("bug corrigido: cada marco sai UMA vez por sequência, em ordem, e o 3 nunca vem depois do 5", () => {
  // Simula o servidor dia a dia: todo dia a meta é batida; a chave é marco:início-da-sequência.
  const fired = [];
  const seen = new Set();
  const rows = [];
  let day = "2026-09-01"; // terça
  for (let i = 0; i < 12; i += 1) {
    // detecção no dia em que a meta é batida (hoje conta como batida)
    const { streak, startDate } = goalStreakFromRows(rows, { today: day, todayMet: true });
    const milestone = pickStreakMilestone(streak, DEFAULT_STREAK_MILESTONES);
    const key = milestone ? `goal_streak:${milestone}:${startDate}` : null;
    if (key && !seen.has(key)) {
      seen.add(key);
      fired.push(milestone);
    }
    rows.push(met(day)); // fechamento do dia
    day = shiftPlainDate(day, 1);
  }
  assert.deepEqual(fired, [2, 3, 5, 7, 10]);
});

test("quebra de sequência reinicia: nova sequência pode disparar o mesmo marco de novo, em outra chave", () => {
  const first = goalStreakFromRows([met("2026-10-05"), met("2026-10-06")], { today: "2026-10-07", todayMet: false });
  const second = goalStreakFromRows([met("2026-10-05"), met("2026-10-06"), missed("2026-10-07"), met("2026-10-08")], { today: "2026-10-09", todayMet: true });
  assert.equal(pickStreakMilestone(first.streak, DEFAULT_STREAK_MILESTONES), 2);
  assert.equal(pickStreakMilestone(second.streak, DEFAULT_STREAK_MILESTONES), 2);
  assert.notEqual(first.startDate, second.startDate);
});

// ---------- meta semanal e mensal (opção B) ----------

test("período: semana só é avaliada na segunda-feira, e cobre segunda a domingo anteriores", () => {
  assert.deepEqual(closedPeriodRange("week", "2026-10-26"), {
    kind: "week", start: "2026-10-19", end: "2026-10-25", triggerKey: "weekly_goal_met", eventKey: "weekly_goal_met:2026-10-19"
  });
  assert.equal(closedPeriodRange("week", "2026-10-27"), null);
  assert.equal(closedPeriodRange("week", "2026-10-25"), null);
});

test("período: mês só é avaliado no dia 1, cobrindo o mês anterior inteiro (inclusive virada de ano)", () => {
  assert.deepEqual(closedPeriodRange("month", "2026-11-01"), {
    kind: "month", start: "2026-10-01", end: "2026-10-31", triggerKey: "monthly_goal_met", eventKey: "monthly_goal_met:2026-10"
  });
  assert.equal(closedPeriodRange("month", "2027-01-01").eventKey, "monthly_goal_met:2026-12");
  assert.equal(closedPeriodRange("month", "2026-11-02"), null);
  assert.equal(closedPeriodRange("year", "2026-11-01"), null);
});

test("período: prospecção + pendentes, cada um no seu teto, com compensação entre dias", () => {
  // Dia 1 sobrou prospecção (15/10), dia 2 faltou (5/10): a soma 20/20 bate. Pendentes 4/4 e 3/3.
  const rows = [
    { done_count: 15, total_due: 10, pending_done: 4, pending_total: 4 },
    { done_count: 5, total_due: 10, pending_done: 3, pending_total: 3 }
  ];
  const summary = summarizePeriodGoal(rows);
  assert.equal(summary.met, true);
  assert.equal(summary.required, 27);
  assert.equal(summary.pendingKnownDays, 2);
});

test("período: pendente não resolvido impede, e excesso de prospecção NÃO paga pendente", () => {
  const rows = [
    { done_count: 40, total_due: 10, pending_done: 0, pending_total: 5 },
    { done_count: 40, total_due: 10, pending_done: 1, pending_total: 5 }
  ];
  const summary = summarizePeriodGoal(rows);
  assert.equal(summary.met, false);
  assert.ok(summary.percent < 100);
});

test("período: dia anterior à migration (pendentes NULL) entra só com a prospecção; sem colunas = comportamento atual", () => {
  const legacy = [
    { done_count: 10, total_due: 10 },
    { done_count: 10, total_due: 10, pending_done: null, pending_total: null }
  ];
  const summary = summarizePeriodGoal(legacy);
  assert.equal(summary.met, true);
  assert.equal(summary.pendingKnownDays, 0);
  assert.equal(summarizePeriodGoal([{ done_count: 9, total_due: 10 }]).met, false);
});

test("período: sem dias fechados ou sem meta nunca bate", () => {
  assert.equal(summarizePeriodGoal([]).met, false);
  assert.equal(summarizePeriodGoal([{ done_count: 0, total_due: 0, pending_done: 0, pending_total: 0 }]).met, false);
});

test("migration não aplicada é reconhecida (e só ela)", () => {
  assert.equal(isMissingSchemaError({ code: "42703", message: 'column "pending_done" does not exist' }), true);
  assert.equal(isMissingSchemaError({ code: "PGRST204", message: "Could not find the 'pending_done' column of 'daily_goals' in the schema cache" }), true);
  assert.equal(isMissingSchemaError({ code: "42P01", message: 'relation "celebration_daily_leaders" does not exist' }), true);
  assert.equal(isMissingSchemaError({ code: "23505", message: "duplicate key" }), false);
  assert.equal(isMissingSchemaError(null), false);
});

// ---------- liderança diária em sequência ----------

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const lead = (day, leader_broker_id) => ({ day, leader_broker_id });

test("liderança: 4 dias seguidos em 1º até ontem → líder A, 4 dias", () => {
  const records = [lead("2026-10-22", A), lead("2026-10-23", A), lead("2026-10-24", A), lead("2026-10-26", A)];
  // hoje terça 27/10: ontem segunda 26 (A), domingo 25 sem ranking (pulado), sábado 24, sexta 23, quinta 22
  assert.deepEqual(rankingLeaderStreak(records, "2026-10-27"), { leaderId: A, days: 4 });
});

test("liderança: outro líder ou dia útil sem líder quebra a sequência", () => {
  assert.deepEqual(rankingLeaderStreak([lead("2026-10-26", A), lead("2026-10-23", B), lead("2026-10-24", B)], "2026-10-27"), { leaderId: A, days: 1 });
  assert.deepEqual(rankingLeaderStreak([lead("2026-10-26", A), lead("2026-10-24", A)], "2026-10-28"), { leaderId: null, days: 0 });
  // sexta 23 sem líder (null) quebra, mesmo com A em 24 e 26
  assert.deepEqual(rankingLeaderStreak([lead("2026-10-26", A), lead("2026-10-24", A), lead("2026-10-23", null), lead("2026-10-22", A)], "2026-10-27"), { leaderId: A, days: 2 });
});

test("liderança: domingo sem ranking é pulado; domingo COM líder conta", () => {
  assert.equal(rankingLeaderStreak([lead("2026-10-24", A), lead("2026-10-26", A)], "2026-10-27").days, 2);
  assert.equal(rankingLeaderStreak([lead("2026-10-24", A), lead("2026-10-25", A), lead("2026-10-26", A)], "2026-10-27").days, 3);
  assert.equal(rankingLeaderStreak([lead("2026-10-24", A), lead("2026-10-25", B), lead("2026-10-26", A)], "2026-10-27").days, 1);
});

test("liderança: ontem sem registro (e não domingo) = sem sequência; hoje nunca entra", () => {
  assert.deepEqual(rankingLeaderStreak([lead("2026-10-27", A)], "2026-10-27"), { leaderId: null, days: 0 });
  assert.deepEqual(rankingLeaderStreak([], "2026-10-27"), { leaderId: null, days: 0 });
  // segunda de manhã: o último dia de ranking é o sábado (domingo pulado)
  assert.deepEqual(rankingLeaderStreak([lead("2026-10-23", A), lead("2026-10-24", A)], "2026-10-26"), { leaderId: A, days: 2 });
});

// ---------- textos ----------

test("texto: [N] e [N+1] da liderança em sequência", () => {
  const template = "[nome], você manteve a liderança diária por [N] dias seguidos. Vamos buscar o [N+1]º e manter a liderança!";
  assert.equal(resolveMessageText(template, { name: "Ana", n: 4 }), "Ana, você manteve a liderança diária por 4 dias seguidos. Vamos buscar o 5º e manter a liderança!");
  assert.equal(resolveMessageText("[N] dias, [nome]", { name: "Ana", n: 3 }), "3 dias, Ana");
});

test("texto de reserva dos gatilhos de sequência", () => {
  assert.match(fallbackMessageFor("goal_streak", { name: "Ana", n: 3 }), /3º dia seguido de meta batida/);
  assert.match(fallbackMessageFor("ranking_streak", { name: "Ana", n: 4 }), /4 dias seguidos.*5º/);
  assert.match(fallbackMessageFor("first_of_day", { name: "Ana" }), /Parabéns, Ana/);
});
