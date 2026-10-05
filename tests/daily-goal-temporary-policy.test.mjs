import test from "node:test";
import assert from "node:assert/strict";
import { applyPolicyV2, planV2Schedule, temporaryPolicyOverrideFor, v2SendBlockReason, saoPauloInstantMs } from "../lib/daily-goal-policy-core.mjs";

// Exceção por DATA/corretor (dono, 2026-10-05): dia de teste lento. Só vale em 05/10/2026 e só para os 3 corretores.
const JENNYFER = "3fdc31e6-9c4c-4e8a-a50f-95567fc022ec";
const OTHER = "00000000-0000-0000-0000-000000000000";
const noon = Date.parse("2026-10-05T15:00:00-03:00");

test("override vale só na data e só para os 3 corretores", () => {
  assert.ok(temporaryPolicyOverrideFor(JENNYFER, noon));
  assert.equal(temporaryPolicyOverrideFor(OTHER, noon), null);
  assert.equal(temporaryPolicyOverrideFor(JENNYFER, Date.parse("2026-10-06T10:00:00-03:00")), null, "volta ao normal no dia seguinte");
  const normal = applyPolicyV2({ broker_id: OTHER });
  assert.equal(normal.window_end_minutes, 15 * 60 + 30);
  assert.equal(normal.policy_no_pauses, false);
});

test("com o override: janela até 18:00, intervalo 17–21 min, teto 15, sem pausas", () => {
  const realNow = Date.now;
  Date.now = () => noon;
  try {
    const s = applyPolicyV2({ broker_id: JENNYFER });
    assert.equal(s.window_end_minutes, 18 * 60);
    assert.equal(s.daily_cap_override, 15);
    assert.deepEqual(s.policy_gap_seconds, { minSeconds: 17 * 60, maxSeconds: 21 * 60 });
    assert.equal(s.policy_no_pauses, true);
    const plan = planV2Schedule({ count: 10, nowMs: noon, dateStr: "2026-10-05", settings: s });
    assert.equal(plan.length > 0 && plan.length <= 10, true);
    for (let i = 1; i < plan.length; i += 1) {
      const gap = (plan[i] - plan[i - 1]) / 60000;
      assert.ok(gap >= 17 && gap <= 21.01, `intervalo ${gap}`);
    }
    assert.ok(plan[plan.length - 1] <= saoPauloInstantMs("2026-10-05", 18 * 60));
    const usage = { total: 15, metaByAttempt: { 1: 10, 2: 5, 3: 0 }, lastSendMs: null, sendTimesMs: [] };
    assert.equal(v2SendBlockReason({ nowMs: noon, usage, settings: s, attemptNumber: 1 }), "teto_diario_politica");
  } finally {
    Date.now = realNow;
  }
});
