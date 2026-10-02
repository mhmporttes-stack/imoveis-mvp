import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveTeamMetaScope, filterProfilesForScope, isBrokerInScope } from "../lib/team-meta-scope-core.mjs";
const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// Banco simulado (fictício): gestora M1 (A, B), gestora M2 (C).
const profiles = [{ id: "M1" }, { id: "A" }, { id: "B" }, { id: "M2" }, { id: "C" }];
const m1 = resolveTeamMetaScope({ isManager: true, profileId: "M1", managedUserIds: ["M1", "A", "B"] });

test("T-49: o card próprio usa getBrokerDailyGoal(auth) — só o perfil da sessão, sem id externo", () => {
  const page = src("app/admin/meta-diaria/page.jsx");
  assert.match(page, /viewer === "manager" && canLoadDailyGoal\(\)/);
  assert.match(page, /ownGoal = await getBrokerDailyGoal\(auth\)/);
  assert.doesNotMatch(page, /getBrokerDailyGoal\((?!auth\))/);
  const lib = src("lib/daily-goal.js");
  assert.match(lib, /export async function getBrokerDailyGoal\(auth\) \{\n  const brokerId = requireBrokerId\(auth\);/);
  const route = src("app/api/daily-goal/route.js");
  assert.match(route, /getBrokerDailyGoal\(auth\)/);
  assert.doesNotMatch(route, /searchParams|brokerId/);
});

test("T-49: card próprio vem ANTES da equipe e usa o mesmo componente do corretor (variant=card)", () => {
  const page = src("app/admin/meta-diaria/page.jsx");
  assert.ok(page.indexOf('variant="card"') > 0 && page.indexOf('variant="card"') < page.indexOf("<TeamDailyPerformance initialOverview={overview}"));
  const dash = src("components/DailyGoalDashboard.jsx");
  assert.match(dash, /variant = "full"/);
  assert.match(dash, /<DailyGoalCompensationNotice notice=\{goal\.compensation\} \/>/);
  assert.match(dash, /goal\.prospectingBlocked/);
});

test("T-49: equipe continua isolada; a gestora não aparece na lista e não lê outra equipe", () => {
  assert.deepEqual(filterProfilesForScope(profiles, m1).map((p) => p.id), ["A", "B"]);
  assert.equal(isBrokerInScope(m1, "C"), false);
  assert.equal(isBrokerInScope(m1, "M2"), false);
  assert.equal(isBrokerInScope(resolveTeamMetaScope({ isOwner: true }), "C"), true);
  assert.equal(resolveTeamMetaScope({}).mode, "denied");
});

test("T-49: corretor e admin sem regressão (variant padrão = tela completa; admin usa visão de equipe sem card)", () => {
  const page = src("app/admin/meta-diaria/page.jsx");
  assert.match(page, /<DailyGoalDashboard initialGoal=\{goal\} \/>/);
  assert.match(page, /viewer === "manager" \? \(/);
});

test("T-50: cabeçalho do card — badges numa linha e WhatsApp + Google Contacts juntos na linha de ícones", () => {
  const t = src("components/TeamDailyPerformance.jsx");
  const badges = t.slice(t.indexOf("data-card-badges"), t.indexOf("data-card-icons"));
  assert.match(badges, /WhatsappStateChip/);
  assert.doesNotMatch(badges, /IntegrationStatusIcon/);
  const icons = t.slice(t.indexOf("data-card-icons"), t.indexOf("<RestrictionValidationActions", t.indexOf("data-card-icons")));
  assert.match(icons, /kind="whatsapp"/);
  assert.match(icons, /kind="google"/);
  assert.doesNotMatch(icons, /WhatsappStateChip/);
});
