import test from "node:test";
import assert from "node:assert/strict";
import { aggregateStatusCounts, cacheFreshness } from "../lib/crm-metrics/status-counts-core.mjs";

const normalize = (status) => (["pending", "in_service", "approved", "archived"].includes(status) ? status : "pending");
const GROUPS = [
  { key: "all", statuses: [] },
  { key: "service", statuses: ["in_service"] },
  { key: "simulation", statuses: ["pending"] },
  { key: "archived", statuses: ["archived"] }
];

test("contagem por status: normaliza desconhecidos e soma os grupos", () => {
  const rows = [
    { status: "pending", total: "4" },
    { status: "in_service", total: 3 },
    { status: "", total: 2 },
    { status: null, total: 1 },
    { status: "inventado", total: 5 },
    { status: "archived", total: 6 }
  ];
  const result = aggregateStatusCounts(rows, normalize, GROUPS);
  assert.equal(result.total, 21);
  assert.deepEqual(result.byStatus, { pending: 12, in_service: 3, archived: 6 });
  assert.deepEqual(result.byGroup, { all: 21, service: 3, simulation: 12, archived: 6 });
});

test("contagem vazia ou sem linhas", () => {
  assert.deepEqual(aggregateStatusCounts([], normalize, GROUPS), { total: 0, byStatus: {}, byGroup: { all: 0, service: 0, simulation: 0, archived: 0 } });
  assert.deepEqual(aggregateStatusCounts(undefined, normalize, undefined), { total: 0, byStatus: {}, byGroup: {} });
});

test("janela de validade do cache", () => {
  const now = Date.parse("2026-10-07T15:00:00Z");
  assert.deepEqual(cacheFreshness("2026-10-07T14:55:00Z", 10, now), { fresh: true, ageMinutes: 5 });
  assert.deepEqual(cacheFreshness("2026-10-07T14:40:00Z", 10, now), { fresh: false, ageMinutes: 20 });
  assert.deepEqual(cacheFreshness("2026-10-07T15:00:00Z", 10, now), { fresh: true, ageMinutes: 0 });
  assert.deepEqual(cacheFreshness("invalido", 10, now), { fresh: false, ageMinutes: null });
  assert.deepEqual(cacheFreshness("2026-10-07T15:05:00Z", 10, now), { fresh: true, ageMinutes: 0 });
});
