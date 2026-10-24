// Congelamento da carteira x novos do dia (2026-10-24): os novos da cota entram na meta de hoje gerados antes OU
// depois do congelamento — o resultado não depende de quem roda primeiro. Dados fictícios; sem banco.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mergeFrozenRoundIds } from "../lib/daily-goal-wallet-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

// Simula as duas ordens: o congelamento pega as rodadas ativas no instante; a geração cria 10 e, se já houver
// congelamento, acrescenta as dela.
function simulate(order) {
  const carteira = ["a", "b", "c"];
  const novos = Array.from({ length: 10 }, (_, i) => `n${i}`);
  let active = [...carteira];
  let freeze = null;
  const congelar = () => { if (!freeze) freeze = [...active]; };
  const gerar = () => {
    active = [...active, ...novos];
    if (freeze) freeze = mergeFrozenRoundIds(freeze, novos).roundIds;
  };
  for (const step of order) (step === "congelar" ? congelar : gerar)();
  return [...freeze].sort();
}

test("mesma carteira congelada nas duas ordens (congelar→gerar e gerar→congelar)", () => {
  const a = simulate(["congelar", "gerar"]);
  const b = simulate(["gerar", "congelar"]);
  assert.deepEqual(a, b);
  assert.equal(a.length, 13);
});

test("mergeFrozenRoundIds: não repete, não perde o que já estava, avisa quando nada mudou", () => {
  assert.deepEqual(mergeFrozenRoundIds(["x", "y"], ["y", "z", "z", null]), { roundIds: ["x", "y", "z"], roundTotal: 3, changed: true });
  assert.deepEqual(mergeFrozenRoundIds(["x"], ["x"]), { roundIds: ["x"], roundTotal: 1, changed: false });
  assert.deepEqual(mergeFrozenRoundIds(null, []), { roundIds: [], roundTotal: 0, changed: false });
});

test("a geração da cota chama a inclusão no congelamento (e só ela)", () => {
  const goal = read("lib/daily-goal.js");
  const body = goal.slice(goal.indexOf("async function ensureDailyGoalGenerated("), goal.indexOf("// Mesma pessoa pode ter mais de uma linha"));
  assert.match(body, /includeGeneratedRoundsInWalletFreeze\(brokerId, today, assignedContactIds\)/);
  assert.equal(goal.match(/includeGeneratedRoundsInWalletFreeze\(/g).length, 1);
  const wallet = read("lib/daily-goal-wallet.js");
  assert.match(wallet, /export async function includeGeneratedRoundsInWalletFreeze/);
  assert.match(wallet, /isWalletFreezeTableMissing\(error\)\) return \{ added: 0 \}/);
});
