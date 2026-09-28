import test from "node:test";
import assert from "node:assert/strict";
import { canCompeteInRanking, dailyRankingLeader, weeklyChampionTitle } from "../lib/ranking-display.mjs";

test("gestor permanece fora da disputa; corretores seguem elegíveis", () => {
  assert.equal(canCompeteInRanking({ role: "manager" }), false);
  assert.equal(canCompeteInRanking({ role: "broker" }), true);
  assert.equal(canCompeteInRanking({ role: "associate" }), true);
});

test("título semanal respeita o gênero cadastrado", () => {
  assert.equal(weeklyChampionTitle("female"), "Campeã da Semana");
  assert.equal(weeklyChampionTitle("male"), "Campeão da Semana");
  assert.equal(weeklyChampionTitle(""), "Campeão(ã) da Semana");
});

test("Melhor do Dia só aparece com pontuação positiva", () => {
  assert.equal(dailyRankingLeader([]), null);
  assert.equal(dailyRankingLeader([{ points: 0 }]), null);
  assert.equal(dailyRankingLeader([{ points: -50 }]), null);
  assert.deepEqual(dailyRankingLeader([{ points: 5 }]), { points: 5 });
});
