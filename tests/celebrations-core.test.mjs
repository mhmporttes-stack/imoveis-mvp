import test from "node:test";
import assert from "node:assert/strict";
import {
  highestDailyGoalMilestone,
  isRecognitionDayAllowed,
  recognitionDateChip,
  recognitionEventDate,
  shiftPlainDate
} from "../lib/celebrations-core.mjs";

const allOn = new Map([
  ["daily_goal_100", { enabled: true, config: {} }],
  ["daily_goal_150", { enabled: true, config: {} }],
  ["daily_goal_200", { enabled: true, config: {} }]
]);

test("meta: só o marco mais alto alcançado", () => {
  assert.equal(highestDailyGoalMilestone(99, allOn), null);
  assert.equal(highestDailyGoalMilestone(106, allOn).key, "daily_goal_100");
  assert.equal(highestDailyGoalMilestone(160, allOn).key, "daily_goal_150");
  const top = highestDailyGoalMilestone(230, allOn);
  assert.equal(top.key, "daily_goal_200");
  assert.equal(top.forcedAnimation, "combo_200");
});

test("meta: caso real 2026-10-01 — com 150% alcançado nunca tenta o 100% (não aparece 100% depois do 150%)", () => {
  // O laço antigo tentava o 100% quando o 150% já existia; a regra devolve sempre o mesmo marco para o mesmo percentual.
  assert.equal(highestDailyGoalMilestone(150, allOn).key, "daily_goal_150");
});

test("meta: gatilho desligado e limiar configurado", () => {
  const custom = new Map([
    ["daily_goal_100", { enabled: true, config: { threshold: 90 } }],
    ["daily_goal_150", { enabled: false, config: {} }],
    ["daily_goal_200", { enabled: true, config: {} }]
  ]);
  assert.equal(highestDailyGoalMilestone(92, custom).key, "daily_goal_100");
  assert.equal(highestDailyGoalMilestone(170, custom).key, "daily_goal_100");
  assert.equal(highestDailyGoalMilestone(150, new Map()), null);
});

test("servidor: só hoje ou ontem (até 24 h depois do fim do dia)", () => {
  assert.equal(isRecognitionDayAllowed("2026-10-29", "2026-10-29"), true);
  assert.equal(isRecognitionDayAllowed("2026-10-28", "2026-10-29"), true);
  assert.equal(isRecognitionDayAllowed("2026-10-27", "2026-10-29"), false);
  assert.equal(isRecognitionDayAllowed("2026-10-30", "2026-10-29"), false);
  assert.equal(isRecognitionDayAllowed("", "2026-10-29"), false);
  assert.equal(shiftPlainDate("2026-11-01", -1), "2026-10-31");
});

test("data real: meta pelo dia da chave; demais pelo dia em que o evento nasceu (São Paulo)", () => {
  // Caso real de 2026-10-17: meta batida no sábado e gravada no fechamento, às 03:01 do domingo (06:01 UTC).
  assert.equal(recognitionEventDate({ trigger_key: "daily_goal_100", event_key: "daily_goal_100:2026-10-17", created_at: "2026-10-18T06:01:00Z" }), "2026-10-17");
  // ranking_no1 de 24/10 visto em 25/10: data do evento, não a do dia em que foi visto.
  assert.equal(recognitionEventDate({ trigger_key: "ranking_no1", event_key: "ranking_no1:2026-10-24-turn1", created_at: "2026-10-24T15:12:00Z" }), "2026-10-24");
  assert.equal(recognitionEventDate({ trigger_key: "weekly_goal_met", event_key: "weekly_goal_met:2026-10-19", created_at: "2026-10-21T12:00:00Z" }), "2026-10-21");
  assert.equal(recognitionEventDate({ trigger_key: "first_of_day", event_key: "first_of_day:2026-10-29", created_at: "2026-10-30T02:30:00Z" }), "2026-10-29");
});

test("selo: 'Hoje' só para hoje; ontem e dias antes mostram a data", () => {
  const today = "2026-10-29";
  assert.equal(recognitionDateChip("2026-10-29", today).label, "Hoje");
  assert.equal(recognitionDateChip("2026-10-28", today).label, "Ontem");
  const older = recognitionDateChip("2026-10-24", today);
  assert.equal(older.label, "Dia");
  assert.match(older.value, /24\/10/);
  assert.equal(recognitionDateChip("", today).label, "Hoje");
  assert.match(recognitionDateChip("2026-10-29", today).value, /29\/10/);
});
