import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_AUTO_TRAINING_DEFAULT_BUDGET_USD,
  HENRY_AUTO_TRAINING_LOCK_MS,
  HENRY_AUTO_TRAINING_SINCE,
  HENRY_TRAINING_MAX_EXCHANGES,
  appendTrainingScenario,
  decideHenryAutoTraining,
  estimateHenryTrainingCostUsd,
  henryAutoTrainingBudgetUsd,
  henryAutoTrainingCanContinue,
  henryTrainingTotalSteps,
  isHenryAutoTrainingLocked,
  parseTrainingRounds,
  summarizeTrainingRound
} from "../lib/henry-training-core.mjs";

// Treino automático do Henry (dono, 2026-10-25: "executar esses testes sozinho … Gaste até 10,00" = R$ 10 ≈ US$ 1,80).
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-25T20:00:00.000Z");
const fullRound = estimateHenryTrainingCostUsd(Math.min(HENRY_TRAINING_MAX_EXCHANGES, henryTrainingTotalSteps()));

test("teto: padrão US$ 1,80 (≈ R$ 10), configurável pelo env; valor inválido volta ao padrão", () => {
  assert.equal(HENRY_AUTO_TRAINING_DEFAULT_BUDGET_USD, 1.8);
  assert.equal(henryAutoTrainingBudgetUsd(undefined), 1.8);
  assert.equal(henryAutoTrainingBudgetUsd(""), 1.8);
  assert.equal(henryAutoTrainingBudgetUsd("abc"), 1.8);
  assert.equal(henryAutoTrainingBudgetUsd("-1"), 1.8);
  assert.equal(henryAutoTrainingBudgetUsd("0"), 1.8);
  assert.equal(henryAutoTrainingBudgetUsd("2,5"), 2.5);
  assert.equal(henryAutoTrainingBudgetUsd("3"), 3);
  assert.equal(HENRY_AUTO_TRAINING_SINCE, "2026-10-25T17:30:00.000Z");
});

test("teto: recusa (409) se o gasto + a rodada estimada passa do teto; aceita se cabe", () => {
  assert.ok(fullRound > 0 && fullRound < 1.8, `rodada estimada ${fullRound}`);
  assert.deepEqual(decideHenryAutoTraining({ spentUsd: 0, budgetUsd: 1.8, estimateUsd: fullRound, now: NOW }), { ok: true });
  const over = decideHenryAutoTraining({ spentUsd: 1.8 - fullRound / 2, budgetUsd: 1.8, estimateUsd: fullRound, now: NOW });
  assert.equal(over.ok, false);
  assert.equal(over.status, 409);
  assert.equal(over.reason, "budget");
  assert.equal(decideHenryAutoTraining({ spentUsd: 5, budgetUsd: 1.8, estimateUsd: 0, now: NOW }).reason, "budget");
});

test("trava: uma rodada automática por vez, vence sozinha em 10 min", () => {
  assert.equal(HENRY_AUTO_TRAINING_LOCK_MS, 600000);
  const lock = { until: new Date(NOW + 60000).toISOString(), roundId: "x" };
  assert.equal(isHenryAutoTrainingLocked(lock, NOW), true);
  assert.equal(isHenryAutoTrainingLocked({ until: new Date(NOW - 1).toISOString() }, NOW), false);
  assert.equal(isHenryAutoTrainingLocked({ until: null }, NOW), false);
  assert.equal(isHenryAutoTrainingLocked(null, NOW), false);
  const busy = decideHenryAutoTraining({ spentUsd: 0, budgetUsd: 1.8, estimateUsd: 0.1, lock, now: NOW });
  assert.equal(busy.ok, false);
  assert.equal(busy.status, 409);
  assert.equal(busy.reason, "running");
});

test("meio da rodada: só começa o próximo cenário se ainda cabe no teto", () => {
  assert.equal(henryAutoTrainingCanContinue({ spentBeforeUsd: 1, roundUsd: 0.5, nextEstimateUsd: 0.2, budgetUsd: 1.8 }), true);
  assert.equal(henryAutoTrainingCanContinue({ spentBeforeUsd: 1, roundUsd: 0.7, nextEstimateUsd: 0.2, budgetUsd: 1.8 }), false);
});

test("histórico: rodada automática guarda e mostra o selo; a da tela não", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const ex = [{ scenarioId: "papo", owner: "E aí?", reply: "Opa, tudo certo.", mode: "question", ms: 800 }];
  const first = appendTrainingScenario([], { roundId: id, scenarioLabel: "Papo casual", exchanges: ex, auto: true });
  assert.equal(first.round.auto, true);
  const second = appendTrainingScenario(first.rounds, { roundId: id, scenarioLabel: "Música", exchanges: ex });
  assert.equal(second.round.auto, true, "o 2º cenário mantém a marca da rodada");
  assert.equal(parseTrainingRounds(JSON.parse(JSON.stringify({ rounds: second.rounds })))[0].auto, true);
  assert.equal(summarizeTrainingRound(second.round).auto, true);
  const manual = appendTrainingScenario([], { roundId: id, scenarioLabel: "Papo casual", exchanges: ex }).round;
  assert.equal("auto" in manual, false);
  assert.match(read("../components/henry/HenryTrainingCard.jsx"), /round\.auto \?[\s\S]{0,200}automático/);
});

test("rota de cron: mesma autenticação dos crons, 202 só com { ok, roundId }, rodada depois da resposta", () => {
  const route = read("../app/api/cron/henry-treino/route.js");
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /SUPABASE_CRON_TOKEN_HASH/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /status: 401/);
  assert.match(route, /after\(\(\) => runHenryAutoTrainingRound\(run\)\)/);
  assert.match(route, /NextResponse\.json\(\{ ok: true, roundId: run\.roundId \}, \{ status: 202 \}\)/);
  assert.doesNotMatch(route, /exchanges|sandbox|reply/);
  assert.match(route, /export const maxDuration = 300;/);
  const runner = read("../lib/henry-training.js");
  // Mesmo caminho do treino da tela (withHenryTraining dentro de runHenryTrainingScenario), dono simulado ligado, marcado auto.
  assert.match(runner, /runHenryTrainingScenario\(auth, \{ scenarioId: scenario\.id, roundId, sandbox, usedExchanges: used, simulateOwner: true, auto: true \}\)/);
  assert.match(runner, /isOwnerAdminEmail\(row\.email\)/);
  assert.match(runner, /accountSwitchMode: false/);
  assert.match(runner, /\.eq\("feature", HENRY_TRAINING_FEATURE\)/);
  assert.match(runner, /\.gte\("created_at", HENRY_AUTO_TRAINING_SINCE\)/);
  assert.match(runner, /HENRY_AUTO_TRAINING_BUDGET_USD/);
});
