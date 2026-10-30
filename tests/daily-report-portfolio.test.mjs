import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACTIVE_CLIENT_STATUS_VALUES } from "../lib/client-status.js";
import { PORTFOLIO_STATUS_BY_METRIC } from "../lib/daily-report-portfolio.mjs";
import { applyDailyReportScope, resolveDailyReportScope } from "../lib/daily-report-scope.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const MANAGER = "44444444-4444-4444-8444-444444444444";

test("Carteira agora: cada cartão usa o MESMO status do cartão 'no período'", () => {
  assert.deepEqual(PORTFOLIO_STATUS_BY_METRIC.awaitingDocumentation, ["documentation_pending"]);
  assert.deepEqual(PORTFOLIO_STATUS_BY_METRIC.documentsPending, ["documents_pending"]);
  assert.deepEqual(PORTFOLIO_STATUS_BY_METRIC.sentForApproval, ["approval_pending"]);
  assert.deepEqual(PORTFOLIO_STATUS_BY_METRIC.approved, ["approved"]);
  assert.deepEqual(PORTFOLIO_STATUS_BY_METRIC.rejected, ["rejected"]);
  assert.deepEqual(PORTFOLIO_STATUS_BY_METRIC.salesCompleted, ["sale_completed"]);
});

test("Cadastros: o 'agora' é Em andamento (MET-7 = ACTIVE_CLIENT_STATUS_VALUES), sem definição nova", () => {
  assert.deepEqual([...PORTFOLIO_STATUS_BY_METRIC.newRegistrations].sort(), [...ACTIVE_CLIENT_STATUS_VALUES].sort());
});

test("Todo cartão da tela tem 'agora'", () => {
  const ui = readFileSync(new URL("../components/DailyReportDashboard.jsx", import.meta.url), "utf8");
  const keys = [...ui.matchAll(/key: "(\w+)",\n(?:\s+nowLabel: "[^"]+",\n)?\s+title:/g)].map((match) => match[1]);
  assert.ok(keys.length >= 7, keys.join(","));
  for (const key of keys) assert.ok(PORTFOLIO_STATUS_BY_METRIC[key], `sem carteira para ${key}`);
  assert.match(ui, /nowValue=\{display\(metricsNow\[metric\.key\]\)\}/);
  assert.match(ui, /Carteira agora/);
});

test("A carteira usa o escopo do relatório (corretor selecionado + permissão) e ignora o prazo", () => {
  const lib = readFileSync(new URL("../lib/daily-report.js", import.meta.url), "utf8");
  const start = lib.indexOf("async function loadPortfolioNow");
  const body = lib.slice(start, lib.indexOf("\n}\n", start));
  assert.match(body, /applyDailyReportScope\(/);
  assert.match(body, /, scope, "responsible_user_id"\)/);
  assert.match(body, /\.is\(PORTFOLIO_EXCLUDES_PRIVATE_COLUMN, null\)/);
  assert.doesNotMatch(body, /range|created_at|changed_at/);
  assert.match(lib, /loadPortfolioNow\(supabase, scope\)/);
  assert.match(lib, /metricsNow: portfolioNow/);
});

test("Escopo da carteira: gestor escolhe um corretor = só ele; sem escolha = equipe; fora da equipe = 403", () => {
  const calls = [];
  const q = { in: (...a) => { calls.push(["in", ...a]); return q; }, eq: (...a) => { calls.push(["eq", ...a]); return q; }, or: (...a) => { calls.push(["or", ...a]); return q; } };

  const one = resolveDailyReportScope({ isManager: true, profileId: MANAGER, managedUserIds: [MANAGER, A, B], requestedBrokerIds: [A] });
  applyDailyReportScope(q, one, "responsible_user_id");
  assert.deepEqual(calls.pop(), ["eq", "responsible_user_id", A]);

  const team = resolveDailyReportScope({ isManager: true, profileId: MANAGER, managedUserIds: [MANAGER, A, B] });
  applyDailyReportScope(q, team, "responsible_user_id");
  assert.deepEqual(calls.pop()[0], "or");

  assert.throws(() => resolveDailyReportScope({ isManager: true, profileId: MANAGER, managedUserIds: [MANAGER, A], requestedBrokerIds: [B] }), { status: 403 });
});
