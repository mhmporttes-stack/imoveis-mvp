import assert from "node:assert/strict";
import test from "node:test";
import { brtNowParts, evaluateFailureBrake, isScheduleDueNow, normalizeDaysOfWeek, normalizeRunTime } from "../lib/whatsapp-broadcast-schedule-core.mjs";

test("horário de Brasília: 08:00 BRT = 11:00 UTC; virada de dia respeita o fuso", () => {
  const morning = brtNowParts(new Date("2026-09-28T11:00:30Z")); // segunda-feira
  assert.deepEqual(morning, { dateKey: "2026-09-28", weekday: 1, minutes: 480 });
  const lateNight = brtNowParts(new Date("2026-09-29T02:30:00Z")); // ainda é dia 28 às 23:30 em Brasília
  assert.equal(lateNight.dateKey, "2026-09-28");
  assert.equal(lateNight.minutes, 23 * 60 + 30);
});

test("normalização do horário e dos dias", () => {
  assert.equal(normalizeRunTime("8:00"), "08:00");
  assert.equal(normalizeRunTime("25:00"), "08:00");
  assert.equal(normalizeRunTime("abc"), "08:00");
  assert.deepEqual(normalizeDaysOfWeek([1, 3, 3, 9, "x"]), [1, 3]);
  assert.deepEqual(normalizeDaysOfWeek([]), [0, 1, 2, 3, 4, 5, 6]);
});

test("a rotina vence no horário, uma vez por dia, só nos dias marcados e com tolerância de 6h", () => {
  const base = { runTime: "08:00", daysOfWeek: [1, 2, 3, 4, 5], lastRunDate: "2026-09-25", dateKey: "2026-09-28", weekday: 1 };
  assert.equal(isScheduleDueNow({ ...base, minutes: 479 }), false); // 07:59
  assert.equal(isScheduleDueNow({ ...base, minutes: 480 }), true); // 08:00
  assert.equal(isScheduleDueNow({ ...base, minutes: 12 * 60 }), true); // atrasou 4h: ainda roda
  assert.equal(isScheduleDueNow({ ...base, minutes: 15 * 60 }), false); // passou de 6h: pula o dia
  assert.equal(isScheduleDueNow({ ...base, minutes: 480, lastRunDate: "2026-09-28" }), false); // já rodou hoje
  assert.equal(isScheduleDueNow({ ...base, minutes: 480, weekday: 0, dateKey: "2026-09-27" }), false); // domingo fora dos dias
});

test("freio: pausa com muitas falhas, ignora lotes pequenos ou ainda em andamento", () => {
  assert.equal(evaluateFailureBrake({ status: "completed", sent: 20, failed: 10, maxFailureRate: 0.3 }).pause, true);
  assert.equal(evaluateFailureBrake({ status: "completed", sent: 28, failed: 2, maxFailureRate: 0.3 }).pause, false);
  assert.equal(evaluateFailureBrake({ status: "completed", sent: 3, failed: 5, maxFailureRate: 0.3 }).pause, false); // amostra pequena
  assert.equal(evaluateFailureBrake({ status: "processing", sent: 0, failed: 40 }).pause, false); // ainda rodando
  assert.match(evaluateFailureBrake({ status: "failed", sent: 0, failed: 30 }).reason, /100% de falhas/);
});
