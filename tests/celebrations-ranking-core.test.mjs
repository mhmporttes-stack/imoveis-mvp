import test from "node:test";
import assert from "node:assert/strict";
import { resolveLeadingSince, saoPauloDateOf } from "../lib/celebrations-ranking-core.mjs";

const LEADER = "5467aa89-abc8-41bd-97ed-ba3e8d370e7f";
const OTHER = "11111111-1111-1111-1111-111111111111";

test("saoPauloDateOf usa o dia de São Paulo, não o UTC", () => {
  assert.equal(saoPauloDateOf("2026-10-29T02:30:00Z"), "2026-10-28");
  assert.equal(saoPauloDateOf("2026-10-29T15:00:00Z"), "2026-10-29");
  assert.equal(saoPauloDateOf("lixo"), "");
});

test("caso real 2026-10-29: mesmo líder de ontem recomeça a contagem no 1º tick do dia", () => {
  const state = { leader_broker_id: LEADER, leading_since: "2026-10-28T15:00:14.609Z" };
  const nowIso = "2026-10-29T15:00:00.000Z"; // 12:00 em São Paulo
  const result = resolveLeadingSince({ state, leaderId: LEADER, nowIso, today: "2026-10-29" });
  assert.deepEqual(result, { leadingSince: nowIso, changed: true });
});

test("mesmo líder no mesmo dia mantém o início da liderança", () => {
  const state = { leader_broker_id: LEADER, leading_since: "2026-10-29T15:00:00.000Z" };
  const result = resolveLeadingSince({ state, leaderId: LEADER, nowIso: "2026-10-29T15:12:00.000Z", today: "2026-10-29" });
  assert.deepEqual(result, { leadingSince: "2026-10-29T15:00:00.000Z", changed: false });
});

test("líder novo ou sem registro recomeça a contagem", () => {
  const nowIso = "2026-10-29T16:00:00.000Z";
  const state = { leader_broker_id: OTHER, leading_since: "2026-10-29T15:00:00.000Z" };
  assert.deepEqual(resolveLeadingSince({ state, leaderId: LEADER, nowIso, today: "2026-10-29" }), { leadingSince: nowIso, changed: true });
  assert.deepEqual(resolveLeadingSince({ state: null, leaderId: LEADER, nowIso, today: "2026-10-29" }), { leadingSince: nowIso, changed: true });
  assert.deepEqual(
    resolveLeadingSince({ state: { leader_broker_id: LEADER, leading_since: null }, leaderId: LEADER, nowIso, today: "2026-10-29" }),
    { leadingSince: nowIso, changed: true }
  );
});
