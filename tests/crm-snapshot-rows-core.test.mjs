import test from "node:test";
import assert from "node:assert/strict";
import { closeRows, pendenciasFromSnapshot, pendenciasRows } from "../lib/crm-metrics/snapshot-rows-core.mjs";

const OVERVIEW = {
  metrics: { newClients: 12, prospecting: 300, service: 9, simulation: 4, approval: 2, sale: 3 },
  team: [
    { id: "b1", name: "Bruna", newClients: 4, prospecting: 120, approval: 1, sale: 2, points: 195 },
    { id: "", name: "Sem id", newClients: 1, prospecting: 1, approval: 0, sale: 0, points: 0 }
  ]
};
const GOAL = {
  summary: { metaPercent: 77 },
  brokers: [
    { id: "b1", name: "Bruna", percent: 120, done: 12, total: 10, prospectingDone: 120 },
    { id: "b2", name: "Eduardo", percent: 50, done: 5, total: 10, prospectingDone: 40 },
    { id: "b3", name: "Carlos", percent: 0, done: 0, total: 0, prospectingDone: 0 }
  ]
};

test("fechamento: linhas do time e por corretor vêm dos números das telas", () => {
  const rows = closeRows("2026-10-06", OVERVIEW, GOAL);
  const pick = (metric, type, key) => rows.find((r) => r.metric === metric && r.dimensionType === type && r.dimensionKey === key);
  assert.equal(pick("vendas", "team", "all").valueNum, 3);
  assert.equal(pick("vendas", "broker", "b1").valueNum, 2);
  assert.equal(pick("pontos", "broker", "b1").valueJson.name, "Bruna");
  assert.equal(pick("meta_percentual", "team", "all").valueNum, 77);
  assert.equal(pick("meta_bateram", "team", "all").valueNum, 1);
  assert.equal(pick("meta_percentual", "broker", "b2").valueNum, 50);
  assert.equal(rows.filter((r) => r.dimensionKey === "").length, 0);
  assert.ok(rows.every((r) => r.date === "2026-10-06"));
});

test("fechamento sem dados não gera linhas e pendências ficam consultáveis por dia", () => {
  assert.deepEqual(closeRows("2026-10-06", null, null), []);
  assert.deepEqual(pendenciasRows("2026-10-06", { brokers: [] }), []);
  const rows = pendenciasRows("2026-10-06", { brokers: [{ id: "b1", name: "Bruna", remaining: 5 }, { id: "b2", name: "Eduardo", remaining: 9 }] });
  assert.equal(rows[0].valueNum, 14);
  const stored = rows.map((r) => ({ dimension_type: r.dimensionType, dimension_key: r.dimensionKey, value_num: r.valueNum, value_json: r.valueJson }));
  assert.deepEqual(pendenciasFromSnapshot(stored, "pendencias"), { count: 14, items: [] });
  assert.deepEqual(pendenciasFromSnapshot(stored, "pendencias_ranking").items.map((i) => i.name), ["Eduardo", "Bruna"]);
  assert.equal(pendenciasFromSnapshot([], "pendencias"), null);
  assert.deepEqual(pendenciasFromSnapshot(stored, "sem_contato"), { unavailable: "historico" });
});
