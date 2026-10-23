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

import { buildRankingPositionMap, formatRankingBadge } from "../lib/ranking-display.mjs";

test("buildRankingPositionMap devolve pontos e posição na ordem do Ranking oficial", () => {
  const map = buildRankingPositionMap([
    { profile: { id: "a" }, points: 191 },
    { profile: { id: "b" }, points: 141 },
    { profile: { id: "c" }, points: 0 }
  ]);
  assert.deepEqual(map.get("a"), { points: 191, position: 1, total: 3 });
  assert.deepEqual(map.get("c"), { points: 0, position: 3, total: 3 });
  assert.equal(map.get("fora"), undefined);
  assert.equal(buildRankingPositionMap(undefined).size, 0);
});

test("formatRankingBadge: selo 'X pts · Nº lugar', destaque só do 1º com pontos, nada sem ranking", () => {
  assert.equal(formatRankingBadge(null), null);
  const first = formatRankingBadge({ points: 191, position: 1, total: 7 }, "Hoje");
  assert.equal(first.text, "191 pts · 1º lugar");
  assert.equal(first.first, true);
  assert.match(first.title, /\(hoje\)/);
  assert.equal(formatRankingBadge({ points: 141, position: 2, total: 7 }).first, false);
  assert.equal(formatRankingBadge({ points: 0, position: 1, total: 7 }).first, false);
  assert.equal(formatRankingBadge({ points: -20, position: 7, total: 7 }).text, "-20 pts · 7º lugar");
});
