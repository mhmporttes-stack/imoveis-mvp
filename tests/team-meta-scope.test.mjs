import test from "node:test";
import assert from "node:assert/strict";
import { TEAM_META_MODE, filterProfilesForScope, isBrokerInScope, resolveTeamMetaScope } from "../lib/team-meta-scope-core.mjs";
import { buildCompensationNotice } from "../lib/daily-goal-compensation-view-core.mjs";
import { resolveWhatsappBadge } from "../lib/whatsapp-restriction-core.mjs";

// Banco simulado (dados fictícios): gestora M1 (A, B + associada AS), gestora M2 (C, D), dono.
const profiles = [
  { id: "M1", name: "Gestora 1", role: "manager" },
  { id: "A", name: "Corretor A", role: "broker" },
  { id: "B", name: "Corretor B", role: "broker" },
  { id: "AS", name: "Associada de A", role: "associate" },
  { id: "M2", name: "Gestora 2", role: "manager" },
  { id: "C", name: "Corretor C", role: "broker" },
  { id: "D", name: "Corretor D", role: "broker" }
];
const m1 = resolveTeamMetaScope({ isManager: true, profileId: "M1", managedUserIds: ["M1", "A", "B", "AS"] });
const m2 = resolveTeamMetaScope({ isManager: true, profileId: "M2", managedUserIds: ["M2", "C", "D"] });
const owner = resolveTeamMetaScope({ isOwner: true, profileId: "OWN" });

test("Admin (dono) mantém a visão global atual", () => {
  assert.equal(owner.mode, TEAM_META_MODE.OWNER);
  assert.equal(filterProfilesForScope(profiles, owner).length, profiles.length);
  assert.equal(isBrokerInScope(owner, "C"), true);
});

test("gestora vê só os corretores da própria equipe (sem ela mesma)", () => {
  assert.deepEqual(filterProfilesForScope(profiles, m1).map((p) => p.id), ["A", "B", "AS"]);
  assert.deepEqual(filterProfilesForScope(profiles, m2).map((p) => p.id), ["C", "D"]);
});

test("gestora A não consegue consultar a Meta/WhatsApp dos corretores da gestora B (chamada direta)", () => {
  for (const other of ["C", "D", "M2"]) assert.equal(isBrokerInScope(m1, other), false, `M1 não pode ver ${other}`);
  for (const other of ["A", "B", "AS", "M1"]) assert.equal(isBrokerInScope(m2, other), false, `M2 não pode ver ${other}`);
  assert.equal(isBrokerInScope(m1, "A"), true);
  assert.equal(isBrokerInScope(m1, "M1"), false);
  assert.equal(isBrokerInScope(m1, ""), false);
  assert.equal(isBrokerInScope(null, "A"), false);
});

test("corretor, associado e outros perfis: negado (nada de visão de equipe)", () => {
  const broker = resolveTeamMetaScope({ isManager: false, isOwner: false, profileId: "A" });
  assert.equal(broker.mode, TEAM_META_MODE.DENIED);
  assert.deepEqual(filterProfilesForScope(profiles, broker), []);
  assert.equal(isBrokerInScope(broker, "A"), false);
});

test("gestora sem equipe configurada vê ninguém (nunca cai em visão global)", () => {
  const empty = resolveTeamMetaScope({ isManager: true, profileId: "M3", managedUserIds: null });
  assert.deepEqual(empty.ids, ["M3"]);
  assert.deepEqual(filterProfilesForScope(profiles, empty), []);
});

test("gestora nunca ganha acesso de dono: isManager vence isOwner mesmo com e-mail de dono (Alterar conta)", () => {
  const emulated = resolveTeamMetaScope({ isManager: true, isOwner: true, profileId: "M1", managedUserIds: ["M1", "A"] });
  assert.equal(emulated.mode, TEAM_META_MODE.TEAM);
  assert.equal(isBrokerInScope(emulated, "C"), false);
});

test("estados do WhatsApp no card: conectado, desconectado, restrição informada, restrição validada (mesma fonte)", () => {
  assert.match(resolveWhatsappBadge({ sessionStatus: "connected", openRestriction: null }).short, /conectado/i);
  assert.match(resolveWhatsappBadge({ sessionStatus: "disconnected", openRestriction: null }).short, /desconect/i);
  assert.match(resolveWhatsappBadge({ sessionStatus: "disconnected", openRestriction: { validation_status: "informed" } }).short, /informad/i);
  assert.match(resolveWhatsappBadge({ sessionStatus: "disconnected", openRestriction: { validation_status: "validated" } }).short, /validad/i);
});

test("compensação no card da gestora: prazo estendido, +Xh e dia impactado (mesma função da tela do corretor)", () => {
  const notice = buildCompensationNotice({
    restrictionStatus: "validated", sessionConnected: false, baseStartMinutes: 390, baseEndMinutes: 1140,
    creditMinutes: 120, effectiveEndMinutes: 1260, impacted: true, goalComplete: false
  });
  const text = notice.items.map((item) => item.text).join(" | ");
  assert.match(text, /\+2h por restrição validada/);
  assert.match(text, /Prazo estendido até 21:00/);
  assert.match(text, /Dia impactado por restrição\. Sem penalidade/);
  assert.equal(buildCompensationNotice({ restrictionStatus: null, sessionConnected: true, creditMinutes: 0 }), null);
});

// Ligação no BACKEND (não só na tela): garante por leitura do código-fonte que as rotas/libs aplicam o escopo.
import { readFileSync } from "node:fs";
const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("backend: rotas de equipe exigem gestão e a lib recorta por equipe antes de calcular", () => {
  for (const route of ["app/api/daily-goal/team-overview/route.js", "app/api/daily-goal/team-overview/[brokerId]/route.js"]) {
    assert.match(src(route), /requireBrokerManagementApi/);
    assert.doesNotMatch(src(route), /requireAdminApi/);
  }
  const lib = src("lib/daily-goal.js");
  assert.match(lib, /resolveTeamScopeOrThrow\(auth\)/);
  assert.match(lib, /filterProfilesForScope\(allProfiles, scope\)/);
  assert.match(lib, /isBrokerInScope\(resolveTeamScopeOrThrow\(auth\), String\(brokerId \|\| ""\)\)\) throw new AdminPermissionError/);
  assert.doesNotMatch(lib, /assertOwnerAdmin/);
});

test("backend: automação/WhatsApp da Supervisão só enxerga e opera a equipe da gestora", () => {
  const auto = src("lib/daily-goal-auto.js");
  assert.match(auto, /brokersQuery = brokersQuery\.in\("id", scopeIds\)/);
  for (const fn of ["adminRequeueBrokerQueue", "adminSetBrokerDailyCapOverride", "adminSetDailyGoalAutoPaused", "adminSetDailyGoalAutoEnabled"]) {
    const start = auto.indexOf(`export async function ${fn}(`);
    assert.ok(start > 0, fn);
    assert.match(auto.slice(start, start + 400), /assertCanAccessResponsibleUser\(auth, brokerId\)/, `${fn} sem checagem de equipe`);
  }
  const history = auto.slice(auto.indexOf("export async function adminGetDailyGoalAutoHistory"));
  assert.match(history.slice(0, 700), /assertCanAccessResponsibleUser\(auth, brokerId\)/);
  assert.match(history, /historyScopeIds/);
});

test("backend: o status do WhatsApp só dispara o alerta pelo caminho único (applyIndividualSessionStatus)", () => {
  const lib = src("lib/whatsapp-individual.js");
  assert.match(lib, /notifyWhatsappConnectionChange\(userId, prevRow, status(, \{ slot: sessionSlot \})?\)/);
  const alert = src("lib/whatsapp-connection-alert.js");
  assert.match(alert, /resolveResponsibleManager/);
  assert.match(alert, /recipient_id|createAlertDeliveries/);
  assert.doesNotMatch(alert, /resolveAudienceRecipients|audience.*team|audience.*global/);
});
