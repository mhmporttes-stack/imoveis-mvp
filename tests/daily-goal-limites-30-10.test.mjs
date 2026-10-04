// Limites da Meta Diária: carteira ativa (regra do dono 2026-10-04: no máximo 30; era 50 desde 2026-10-02) e
// 10 novos contatos/dia. A migration 20261003220000 (100->50 e 20->10) continua sendo o histórico aplicado.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_WALLET_LIMIT, DEFAULT_DAILY_NEW_CONTACTS, MAX_WALLET_LIMIT, walletSlotsAvailable } from "../lib/daily-goal-wallet-core.mjs";
import { dailyGoalOverallProgress, dailyGoalPercent } from "../lib/daily-goal-progress.mjs";
import { HARD_DAILY_CAP } from "../lib/daily-goal-auto-core.mjs";

const slots = (current, requested = 10) => walletSlotsAvailable({ current, requested });

test("padrões: carteira 30 (uma só constante) e 10 novos contatos", () => {
  assert.equal(MAX_WALLET_LIMIT, 30);
  assert.equal(DEFAULT_WALLET_LIMIT, 30);
  assert.equal(DEFAULT_DAILY_NEW_CONTACTS, 10);
});
test("acima de 30 não adiciona (83, 52, 31) e exatamente 30 não adiciona", () => {
  assert.equal(slots(83), 0);
  assert.equal(slots(52), 0);
  assert.equal(slots(31), 0);
  assert.equal(slots(30), 0);
});
test("abaixo de 30 completa no máximo até 30 (29 + cota 5 concede 1)", () => {
  assert.equal(slots(29, 5), 1);
  assert.equal(slots(29), 1);
  assert.equal(slots(20, 20), 10);
  assert.equal(slots(20, 100), 10);
  assert.equal(slots(0, 10), 10);
  assert.equal(slots(0, 100), 30);
});
test("nenhuma reserva leva a carteira acima de 30", () => {
  for (let current = 0; current <= 40; current += 1) {
    for (const requested of [1, 5, 10, 20, 100]) {
      assert.ok(current + slots(current, requested) <= Math.max(current, 30), `${current}+${requested}`);
    }
  }
});
test("quem está acima do teto não ganha nada pela reserva (o excedente sai pelo rebalanceamento, não por ela)", () => {
  const wallet = [83, 52, 30, 29, 20];
  const after = wallet.map((n) => n + slots(n));
  assert.deepEqual(after, [83, 52, 30, 30, 30]);
});
test("progresso/100% seguem com a meta nova (10 novos + pendentes)", () => {
  assert.equal(dailyGoalOverallProgress({ prospectingDone: 10, prospectingTarget: 10, pendingDone: 5, pendingTotal: 5 }).percent, 100);
  assert.equal(dailyGoalPercent(11, 10), 101);
});
test("HARD_DAILY_CAP (envios automáticos) inalterado em 100", () => {
  assert.equal(HARD_DAILY_CAP, 100);
});
test("migration histórica 100->50 e 20->10 continua só ajustando valores antigos", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261003220000_meta_diaria_limites_50_10.sql", import.meta.url), "utf8");
  assert.match(sql, /set wallet_limit = 50[\s\S]*where id = 'default' and wallet_limit = 100/);
  assert.match(sql, /quota = 20/);
  assert.match(sql, /values \(10, now\(\), null, null\)/);
  assert.doesNotMatch(sql, /delete\s+from|truncate|drop\s/i);
});
