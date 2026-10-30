import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EMPTY_SCOPE_ID,
  DailyReportScopeError,
  applyDailyReportScope,
  breakdownBrokerIds,
  resolveDailyReportScope
} from "../lib/daily-report-scope.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const MANAGER = "44444444-4444-4444-8444-444444444444";

function recorder() {
  const calls = [];
  const q = {
    calls,
    eq: (...args) => { calls.push(["eq", ...args]); return q; },
    in: (...args) => { calls.push(["in", ...args]); return q; },
    or: (...args) => { calls.push(["or", ...args]); return q; }
  };
  return q;
}

test("admin geral: sem corretor = tudo; com corretor = só ele(s)", () => {
  assert.deepEqual(resolveDailyReportScope({ isGeneralAdmin: true }), { all: true });
  assert.deepEqual(
    resolveDailyReportScope({ isGeneralAdmin: true, requestedBrokerIds: [A, B, A] }),
    { all: false, ids: [A, B], includeUnassigned: false }
  );
});

test("gestor sem seleção: toda a equipe (+ fila sem corretor, como no resto do CRM)", () => {
  const scope = resolveDailyReportScope({ isManager: true, profileId: MANAGER, managedUserIds: [MANAGER, A, B] });
  assert.deepEqual(scope, { all: false, ids: [MANAGER, A, B], includeUnassigned: true });
});

test("gestor escolhe um corretor da equipe: somente ele, sem fila sem corretor", () => {
  const scope = resolveDailyReportScope({ isManager: true, profileId: MANAGER, managedUserIds: [MANAGER, A, B], requestedBrokerIds: [A] });
  assert.deepEqual(scope, { all: false, ids: [A], includeUnassigned: false });
});

test("gestor escolhe corretor FORA da equipe: recusado (403)", () => {
  assert.throws(
    () => resolveDailyReportScope({ isManager: true, profileId: MANAGER, managedUserIds: [MANAGER, A], requestedBrokerIds: [A, C] }),
    (error) => error instanceof DailyReportScopeError && error.status === 403
  );
});

test("corretor: só ele mesmo; pedir outro corretor é recusado", () => {
  assert.deepEqual(
    resolveDailyReportScope({ isBroker: true, profileId: A }),
    { all: false, ids: [A], includeUnassigned: false }
  );
  assert.throws(() => resolveDailyReportScope({ isBroker: true, profileId: A, requestedBrokerIds: [B] }), DailyReportScopeError);
});

test("perfil sem escopo utilizável não vê nada", () => {
  const scope = resolveDailyReportScope({ isManager: true, profileId: MANAGER, hasDatabaseScope: false });
  assert.deepEqual(scope.ids, [EMPTY_SCOPE_ID]);
  assert.deepEqual(resolveDailyReportScope({}).ids, [EMPTY_SCOPE_ID]);
});

test("applyDailyReportScope: eq/in/or e tabela embutida", () => {
  let q = recorder();
  applyDailyReportScope(q, { all: true });
  assert.equal(q.calls.length, 0);

  q = recorder();
  applyDailyReportScope(q, { all: false, ids: [A], includeUnassigned: false });
  assert.deepEqual(q.calls, [["eq", "responsible_user_id", A]]);

  q = recorder();
  applyDailyReportScope(q, { all: false, ids: [A, B], includeUnassigned: false }, "scope.responsible_user_id", "scope");
  assert.deepEqual(q.calls, [["in", "scope.responsible_user_id", [A, B]]]);

  q = recorder();
  applyDailyReportScope(q, { all: false, ids: [A, B], includeUnassigned: true }, "scope.responsible_user_id", "scope");
  assert.deepEqual(q.calls, [["or", `responsible_user_id.in.(${A},${B}),responsible_user_id.is.null`, { referencedTable: "scope" }]]);
});

test("tabela Por corretor respeita o escopo", () => {
  assert.deepEqual(breakdownBrokerIds({ all: true }, [A, B]), [A, B]);
  assert.deepEqual(breakdownBrokerIds({ all: false, ids: [B], includeUnassigned: false }, [A, B]), [B]);
});

test("getDailyReport: TODOS os blocos usam o mesmo escopo e a API devolve 403", () => {
  const lib = readFileSync(new URL("../lib/daily-report.js", import.meta.url), "utf8");
  assert.match(lib, /loadRegistrationsInRange\(supabase, range, scope\)/);
  assert.match(lib, /loadStatusHistoryInRange\(supabase, range, scope\)/);
  assert.match(lib, /loadBrokerBreakdown\(supabase, auth, scope\)/);
  assert.doesNotMatch(lib, /applyResponsibleUserScope|loadScopedClientIds/);
  const route = readFileSync(new URL("../app/api/daily-report/route.js", import.meta.url), "utf8");
  assert.match(route, /status === 403/);
});

test("tela: ao carregar não mostra número do filtro anterior", () => {
  const ui = readFileSync(new URL("../components/DailyReportDashboard.jsx", import.meta.url), "utf8");
  assert.match(ui, /const display = \(value\) => \(loading \? "…"/);
  assert.match(ui, /setReport\(null\)/);
});
