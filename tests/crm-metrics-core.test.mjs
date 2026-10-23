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
  // "all" sem os negativos da aba Todos (CLI-12a): os 6 arquivados saem.
  assert.deepEqual(result.byGroup, { all: 15, service: 3, simulation: 12, archived: 6 });
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

test("grupo Todos exclui 'Não contactar' (igual à tela), mas o total e o status o incluem", () => {
  const keep = (status) => status;
  const rows = [
    { status: "pending", total: 10 },
    { status: "do_not_contact", total: 4 }
  ];
  const result = aggregateStatusCounts(rows, keep, [{ key: "all", statuses: [] }, { key: "archived", statuses: ["archived", "do_not_contact"] }]);
  assert.equal(result.total, 14);
  assert.equal(result.byStatus.do_not_contact, 4);
  assert.equal(result.byGroup.all, 10);
  assert.equal(result.byGroup.archived, 4);
});

// Job dos pesados (2026-10-23): período anterior da comparação do Henry e validade de semana/mês.
import { OVERVIEW_VALID_MINUTES, previousOverviewIdFor, previousOverviewRange, rangeKeyOfRange } from "../lib/crm-metrics/overview-core.mjs";
import { TEAM_GOAL_VALID_MINUTES } from "../lib/crm-metrics/team-goal-core.mjs";
import { previousHenryPeriod, resolveHenryPeriod } from "../lib/henry-reports-core.mjs";

test("período anterior em cache = o mesmo intervalo que o Henry compara", () => {
  const today = "2026-10-23";
  assert.equal(rangeKeyOfRange(previousOverviewRange("este_mes_anterior", today)), "2026-09-01_2026-09-23");
  assert.equal(rangeKeyOfRange(previousOverviewRange("esta_semana_anterior", today)), "2026-10-14_2026-10-18");
  for (const base of ["este_mes", "esta_semana"]) {
    const previous = previousHenryPeriod(resolveHenryPeriod({ periodo: base }, today));
    assert.equal(previousOverviewIdFor(previous, today), `${base}_anterior`);
  }
  assert.equal(previousOverviewIdFor(previousHenryPeriod(resolveHenryPeriod({ periodo: "ultimos_7_dias" }, today)), today), null);
  assert.equal(previousOverviewIdFor({}, today), null);
});

test("validade de semana/mês cobre o job dos pesados (recalcula a cada ~30 min)", () => {
  for (const table of [OVERVIEW_VALID_MINUTES, TEAM_GOAL_VALID_MINUTES]) {
    assert.equal(table.este_mes, 45);
    assert.equal(table.esta_semana, 45);
  }
  assert.equal(OVERVIEW_VALID_MINUTES.este_mes_anterior, 1500);
});
