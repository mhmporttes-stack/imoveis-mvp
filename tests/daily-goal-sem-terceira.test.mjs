// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16] "Remova a terceira tentativa": a cadência da Meta Diária termina na 2ª.
// Testes puros + checagens de código (sem banco, sem rede).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DAILY_GOAL_MAX_ATTEMPTS, THIRD_ATTEMPT_REMOVED_REASON } from "../lib/daily-goal-progress.mjs";
import { CAP_BY_ATTEMPT, v2EnqueueAllowance, pickV2EnqueueCandidates, planV2Trim, summarizeV2Usage } from "../lib/daily-goal-policy-core.mjs";

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("constante única: no máximo 2 tentativas; a 3ª tem teto 0 na fila", () => {
  assert.equal(DAILY_GOAL_MAX_ATTEMPTS, 2);
  assert.equal(THIRD_ATTEMPT_REMOVED_REASON, "terceira_tentativa_removida");
  assert.equal(CAP_BY_ATTEMPT[3], 0);
  const allowance = v2EnqueueAllowance({ usage: summarizeV2Usage([]), pendingTodayByAttempt: {}, settings: { daily_cap_override: 15 } });
  assert.equal(allowance.byAttempt[3], 0);
  assert.equal(pickV2EnqueueCandidates([{ attempt: 3 }, { attempt: 3 }], allowance).length, 0, "nenhum item de 3ª entra na fila");
  assert.equal(allowance.totalLeft, 15, "volume diário por corretor continua o teto do dia (15)");
  assert.deepEqual(planV2Trim([{ id: "x", attempt_number: 3, scheduled_for: "2026-10-16T10:00:00Z" }]).trimIds, ["x"]);
});

test("a 2ª tentativa (manual e automática) encerra a rodada com o mesmo desfecho que a 3ª tinha", () => {
  const code = src("lib/daily-goal.js");
  assert.equal((code.match(/const willEnd = nextAttempt >= DAILY_GOAL_MAX_ATTEMPTS;/g) || []).length, 2, "manual e automática");
  assert.equal((code.match(/if \(nextAttempt > DAILY_GOAL_MAX_ATTEMPTS\) throw/g) || []).length, 3, "tentativa, automática e salvar modelo");
  assert.doesNotMatch(code, /nextAttempt >= 3|nextAttempt > 3/);
  assert.match(code, /if \(willEnd\) \{ roundUpdate\.status = "ended_no_conversion"; roundUpdate\.ended_at = now; \}/);
});

test("rodadas que esperavam a 3ª são encerradas (não ficam presas na carteira) e a fila da 3ª é cancelada com motivo", () => {
  const code = src("lib/daily-goal.js");
  const start = code.indexOf("export async function endDailyGoalRoundsPastLastAttempt");
  const body = code.slice(start, code.indexOf("async function reconcileDailyGoalRounds", start));
  assert.match(body, /\.update\(\{ status: "ended_no_conversion", ended_at: now \}\)\s*\.eq\("status", "active"\)\s*\.gte\("attempt_count", DAILY_GOAL_MAX_ATTEMPTS\)/);
  assert.match(body, /\.update\(\{ status: "canceled", skip_reason: THIRD_ATTEMPT_REMOVED_REASON, updated_at: now \}\)\s*\.eq\("status", "pending"\)\s*\.gt\("attempt_number", DAILY_GOAL_MAX_ATTEMPTS\)/);
  assert.match(body, /event_type: "daily_goal_round_ended"/);
  assert.doesNotMatch(body, /\.delete\(|prospecting_contacts|simulation_registrations/, "não apaga nada e não libera contato/cliente (igual ao fim da 3ª)");
  assert.match(code, /async function reconcileDailyGoalRounds\(brokerId\) \{\s*\n\s*await endDailyGoalRoundsPastLastAttempt\(\{ brokerId \}\);/);
  const auto = src("lib/daily-goal-auto.js");
  assert.match(auto, /await endDailyGoalRoundsPastLastAttempt\(\);/, "cron cobre todos os corretores");
  assert.match(auto, /if \(Number\(item\.attempt_number\) > DAILY_GOAL_MAX_ATTEMPTS\) \{\s*\n\s*await markItem\(item\.id, \{ status: "canceled", skip_reason: THIRD_ATTEMPT_REMOVED_REASON \}\);/, "envio barra a 3ª antes de tudo");
  assert.doesNotMatch(auto, /lt\("attempt_count", 3\)/);
});
