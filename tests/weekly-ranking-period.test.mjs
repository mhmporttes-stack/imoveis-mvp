import test from "node:test";
import assert from "node:assert/strict";
import { previousRankingWeek } from "../lib/weekly-ranking-period.mjs";

test("semana anterior completa de segunda a domingo em São Paulo", () => {
  assert.deepEqual(previousRankingWeek(new Date("2026-09-30T15:00:00Z")), {
    startDate: "2026-09-21", endDate: "2026-09-27"
  });
  assert.deepEqual(previousRankingWeek(new Date("2026-10-04T23:00:00Z")), {
    startDate: "2026-09-21", endDate: "2026-09-27"
  });
});

test("segunda mantém o resultado anterior até 00:01 local e troca nesse minuto", () => {
  assert.deepEqual(previousRankingWeek(new Date("2026-09-28T03:00:59Z")), {
    startDate: "2026-09-14", endDate: "2026-09-20"
  });
  assert.deepEqual(previousRankingWeek(new Date("2026-09-28T03:01:00Z")), {
    startDate: "2026-09-21", endDate: "2026-09-27"
  });
});
