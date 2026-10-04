import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizeAutoQueueForCard, formatAutoQueueCardLine } from "../lib/daily-goal-policy-core.mjs";

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const rows = (attempt, n, source = "meta") => Array.from({ length: n }, () => ({ attempt_number: attempt, source }));

test("card: fila limpa 10/10/10 aparece como 30 de 30 (caso Bruna 04/10, 83 rodadas na carteira não entram na conta)", () => {
  const q = summarizeAutoQueueForCard({ openRows: [...rows(1, 10), ...rows(2, 10), ...rows(3, 10)], settings: { policy_v2_enabled: true } });
  assert.equal(q.total, 30);
  assert.equal(formatAutoQueueCardLine(q), "Fila automática de hoje: 30 de 30 (1ª 10/10 · 2ª 10/10 · 3ª 10/10)");
});

test("card: caso Caroline (10/9/10 na fila) = 29 de 30", () => {
  const q = summarizeAutoQueueForCard({ openRows: [...rows(1, 10), ...rows(2, 9), ...rows(3, 10)] });
  assert.equal(formatAutoQueueCardLine(q), "Fila automática de hoje: 29 de 30 (1ª 10/10 · 2ª 9/10 · 3ª 10/10)");
});

test("card: enviadas hoje + na fila por tentativa, com teto de 10 por tentativa e 30 no total", () => {
  const q = summarizeAutoQueueForCard({ sentTodayRows: rows(1, 4), openRows: [...rows(1, 3), ...rows(2, 12)] });
  assert.deepEqual([q.byAttempt[1].planned, q.byAttempt[2].planned, q.byAttempt[3].planned], [7, 10, 0]);
  assert.equal(q.total, 17);
  const cheio = summarizeAutoQueueForCard({ sentTodayRows: rows(1, 10), openRows: [...rows(1, 5), ...rows(2, 20), ...rows(3, 20)] });
  assert.equal(cheio.total, 30);
});

test("card: fila extra soma só no total (limitado a 30), nunca numa tentativa", () => {
  const q = summarizeAutoQueueForCard({ openRows: [...rows(1, 10), ...rows(2, 10), ...rows(3, 5), ...rows(1, 8, "extra")] });
  assert.equal(q.extra, 8);
  assert.equal(q.byAttempt[1].planned, 10);
  assert.equal(q.total, 30);
});

test("card: sem fila = 0 de 30; teto manual menor limita o total", () => {
  assert.equal(formatAutoQueueCardLine(summarizeAutoQueueForCard({})), "Fila automática de hoje: 0 de 30 (1ª 0/10 · 2ª 0/10 · 3ª 0/10)");
  assert.equal(summarizeAutoQueueForCard({ openRows: [...rows(1, 10), ...rows(2, 10)], settings: { daily_cap_override: 12 } }).total, 12);
  assert.equal(formatAutoQueueCardLine(null), "");
});

test("card: rótulos separam atividades da meta, fila automática e carteira (código)", () => {
  const card = src("components/TeamDailyPerformance.jsx");
  assert.match(card, /atividades da meta/);
  assert.match(card, /formatAutoQueueCardLine\(automation\.policyV2Queue\)/);
  assert.match(card, /Carteira ativa \{broker\.wallet\.current\}\/\{broker\.wallet\.limit\}/);
  assert.match(card, /aguardando 1ª:/);
  const lib = src("lib/daily-goal-auto.js");
  assert.match(lib, /policyV2Queue: isPolicyV2Enabled\(settingsRow\) \? summarizeAutoQueueForCard/);
  assert.match(lib, /\.in\("status", \["pending", "sending"\]\)/);
});
