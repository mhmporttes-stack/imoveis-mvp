import test from "node:test";
import assert from "node:assert/strict";
import { decideUnmatchedAlert, emptyUnmatchedState, markUnmatchedAlerted, pruneUnmatchedState, recordUnmatchedSighting, summarizeUnmatchedNetworks, unmatchedAlertText, UNMATCHED_MAX_PREFIXES, UNMATCHED_MAX_USERS } from "../lib/office-unmatched-core.mjs";

const sp = (iso) => Date.parse(`${iso}-03:00`);
const KEY = "2804:7f0:7500:80dd::/64";

test("registra o prefixo e o usuário; throttle de 10 min por usuário/prefixo", () => {
  const t0 = sp("2026-11-21T09:00:00");
  let r = recordUnmatchedSighting(emptyUnmatchedState(), { key: KEY, userId: "u1", nowMs: t0 });
  assert.equal(r.changed, true);
  assert.deepEqual(Object.keys(r.state.prefixes[KEY].users), ["u1"]);
  const again = recordUnmatchedSighting(r.state, { key: KEY, userId: "u1", nowMs: t0 + 9 * 60000 });
  assert.equal(again.changed, false, "dentro de 10 min não grava");
  assert.equal(recordUnmatchedSighting(r.state, { key: KEY, userId: "u1", nowMs: t0 + 10 * 60000 }).changed, true);
  assert.equal(recordUnmatchedSighting(r.state, { key: KEY, userId: "u2", nowMs: t0 + 60000 }).changed, true, "outro usuário não é limitado");
  assert.equal(recordUnmatchedSighting(r.state, { key: "", userId: "u1", nowMs: t0 }).changed, false);
});

test("aviso só com 2+ usuários diferentes no mesmo dia, um por prefixo por dia", () => {
  const t0 = sp("2026-11-21T09:00:00");
  let { state } = recordUnmatchedSighting(emptyUnmatchedState(), { key: KEY, userId: "u1", nowMs: t0 });
  assert.equal(decideUnmatchedAlert(state, KEY, t0).alert, false);
  ({ state } = recordUnmatchedSighting(state, { key: KEY, userId: "u1", nowMs: t0 + 11 * 60000 }));
  assert.equal(decideUnmatchedAlert(state, KEY, t0 + 11 * 60000).alert, false, "mesmo usuário repetido não conta");
  ({ state } = recordUnmatchedSighting(state, { key: KEY, userId: "u2", nowMs: t0 + 12 * 60000 }));
  const d = decideUnmatchedAlert(state, KEY, t0 + 12 * 60000);
  assert.deepEqual(d, { alert: true, users: 2 });
  state = markUnmatchedAlerted(state, KEY, t0 + 12 * 60000);
  assert.equal(decideUnmatchedAlert(state, KEY, t0 + 13 * 60000).alert, false, "já avisou hoje");
  // dia seguinte: usuários de ontem não contam; precisa de 2 novos
  const next = t0 + 24 * 3600 * 1000;
  ({ state } = recordUnmatchedSighting(state, { key: KEY, userId: "u1", nowMs: next }));
  assert.equal(decideUnmatchedAlert(state, KEY, next).alert, false);
  ({ state } = recordUnmatchedSighting(state, { key: KEY, userId: "u3", nowMs: next + 60000 }));
  assert.equal(decideUnmatchedAlert(state, KEY, next + 60000).alert, true, "novo dia, novo aviso");
});

test("dias em São Paulo: 22h50 e 00h10 locais são dias diferentes", () => {
  const a = sp("2026-11-21T23:50:00");
  let { state } = recordUnmatchedSighting(emptyUnmatchedState(), { key: KEY, userId: "u1", nowMs: a });
  ({ state } = recordUnmatchedSighting(state, { key: KEY, userId: "u2", nowMs: sp("2026-11-22T00:10:00") }));
  assert.equal(decideUnmatchedAlert(state, KEY, sp("2026-11-22T00:10:00")).alert, false);
});

test("limpeza: 3 dias, no máx. 30 prefixos e 20 usuários por prefixo", () => {
  const now = sp("2026-11-21T12:00:00");
  const old = new Date(now - 4 * 24 * 3600 * 1000).toISOString();
  const fresh = new Date(now - 3600 * 1000).toISOString();
  const pruned = pruneUnmatchedState({ prefixes: { velho: { users: { a: old } }, novo: { users: { a: old, b: fresh } } } }, now);
  assert.deepEqual(Object.keys(pruned.prefixes), ["novo"]);
  assert.deepEqual(Object.keys(pruned.prefixes.novo.users), ["b"]);
  const many = { prefixes: {} };
  for (let i = 0; i < 40; i++) many.prefixes[`p${i}`] = { users: { u: new Date(now - i * 60000).toISOString() } };
  const cut = pruneUnmatchedState(many, now);
  assert.equal(Object.keys(cut.prefixes).length, UNMATCHED_MAX_PREFIXES);
  assert.ok(cut.prefixes.p0 && !cut.prefixes.p39, "ficam os mais recentes");
  const users = {};
  for (let i = 0; i < 30; i++) users[`u${i}`] = new Date(now - i * 60000).toISOString();
  assert.equal(Object.keys(pruneUnmatchedState({ prefixes: { x: { users } } }, now).prefixes.x.users).length, UNMATCHED_MAX_USERS);
  assert.deepEqual(pruneUnmatchedState(null, now), { prefixes: {} });
});

test("resumo da tela esconde redes já cadastradas e ordena pela última vez", () => {
  const now = sp("2026-11-21T12:00:00");
  let { state } = recordUnmatchedSighting(emptyUnmatchedState(), { key: "a::/64", userId: "u1", nowMs: now - 3600000 });
  ({ state } = recordUnmatchedSighting(state, { key: KEY, userId: "u1", nowMs: now - 60000 }));
  ({ state } = recordUnmatchedSighting(state, { key: KEY, userId: "u2", nowMs: now - 30000 }));
  const list = summarizeUnmatchedNetworks(state, { nowMs: now });
  assert.deepEqual(list.map((n) => [n.key, n.users, n.usersToday]), [[KEY, 2, 2], ["a::/64", 1, 1]]);
  assert.deepEqual(summarizeUnmatchedNetworks(state, { registeredKeys: [KEY], nowMs: now }).map((n) => n.key), ["a::/64"]);
});

test("texto do aviso é curto e traz só o prefixo", () => {
  assert.equal(unmatchedAlertText(2, KEY), "2 corretores estão em uma rede nova (2804:7f0:7500:80dd::/64). Cadastre em Supervisão › Online.");
});
