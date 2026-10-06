// Pendentes da Meta Diária em lote para a visão da equipe (2026-10-06). O resultado em lote foi conferido
// em produção contra o cálculo individual (8 corretores, 0 diferenças) antes de publicar.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("o cálculo por corretor é UM só (progressFromLoaded), usado pelo caminho individual e pelo em lote", () => {
  const code = read("lib/daily-goal-pending.js");
  assert.equal((code.match(/progressFromLoaded\(/g) || []).length, 4, "definição + 2 usos no individual + 1 no lote");
  assert.ok(code.includes("export async function getDailyGoalPendingProgressBatch("));
  const batch = code.slice(code.indexOf("export async function getDailyGoalPendingProgressBatch("));
  assert.ok(batch.includes('.from("daily_goal_pending_freeze").select("*").in("broker_id", unique).eq("goal_date", day)'));
  assert.ok(batch.includes('.from("daily_goal_attempts").select("broker_id, client_id").in("broker_id", brokerIds).eq("goal_date", day)'));
  assert.ok(batch.includes("getDailyGoalPendingProgress(brokerId, day, { source })"), "sem congelamento do dia cai no individual (que congela)");
});

test("a visão da equipe usa o lote e cai no cálculo individual se o lote falhar", () => {
  const goal = read("lib/daily-goal.js");
  assert.ok(goal.includes("getDailyGoalPendingProgressBatch(shownBrokerIds, today)"));
  assert.ok(goal.includes("usando o cálculo individual"));
  assert.ok(goal.includes("safePendingProgress(id, today)"));
});
