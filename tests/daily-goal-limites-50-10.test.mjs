import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_WALLET_LIMIT, DEFAULT_DAILY_NEW_CONTACTS, walletSlotsAvailable } from "../lib/daily-goal-wallet-core.mjs";
import { dailyGoalOverallProgress, dailyGoalPercent } from "../lib/daily-goal-progress.mjs";
import { HARD_DAILY_CAP } from "../lib/daily-goal-auto-core.mjs";

const slots = (current, requested = 10) => walletSlotsAvailable({ current, requested });

test("padrões novos: carteira 50 e 10 novos contatos", () => {
  assert.equal(DEFAULT_WALLET_LIMIT, 50);
  assert.equal(DEFAULT_DAILY_NEW_CONTACTS, 10);
});
test("acima de 50 não adiciona (83, 52) e exatamente 50 não adiciona", () => {
  assert.equal(slots(83), 0);
  assert.equal(slots(52), 0);
  assert.equal(slots(50), 0);
});
test("abaixo de 50 completa no máximo até 50", () => {
  assert.equal(slots(49), 1);
  assert.equal(slots(30, 20), 20);
  assert.equal(slots(30, 100), 20);
  assert.equal(slots(0, 10), 10);
});
test("quem está acima do teto mantém todos (nada é removido pela reserva)", () => {
  const wallet = [83, 52, 50, 49, 30];
  const after = wallet.map((n) => n + slots(n));
  assert.deepEqual(after, [83, 52, 50, 50, 40]);
});
test("progresso/100% seguem com a meta nova (10 novos + pendentes)", () => {
  assert.equal(dailyGoalOverallProgress({ prospectingDone: 10, prospectingTarget: 10, pendingDone: 5, pendingTotal: 5 }).percent, 100);
  assert.equal(dailyGoalPercent(11, 10), 101);
});
test("HARD_DAILY_CAP (envios automáticos) inalterado em 100", () => {
  assert.equal(HARD_DAILY_CAP, 100);
});
test("migration: 100->50 e 20->10 só se ainda forem os valores antigos", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261003220000_meta_diaria_limites_50_10.sql", import.meta.url), "utf8");
  assert.match(sql, /set wallet_limit = 50[\s\S]*where id = 'default' and wallet_limit = 100/);
  assert.match(sql, /quota = 20/);
  assert.match(sql, /values \(10, now\(\), null, null\)/);
  assert.doesNotMatch(sql, /delete\s+from|truncate|drop\s/i);
});
