import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN, MANAGER, STUDENT_A, STUDENT_B, answer, buildWorld, student } from "./helpers/academy-world.mjs";
import { planRuleEnrollments } from "../lib/academy-rules.mjs";

const rejects = (p, code, status) => assert.rejects(p, (e) => e.code === code && (status == null || e.status === status), `esperava ${code}`);
const ALL = { admin: true, ids: null };
const TEAM = { admin: false, ids: [MANAGER.userId, STUDENT_A] };
const DAY = 24 * 3600 * 1000;
const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

function users(w, { aCreated = 2, bCreated = 400 } = {}) {
  w.db.tables.admin_users.push(
    { id: ADMIN.userId, name: "Chefe", email: ADMIN.email, role: "admin", status: "active", created_at: iso(900) },
    { id: MANAGER.userId, name: "Gestora", email: MANAGER.email, role: "manager", status: "active", created_at: iso(900) },
    { id: STUDENT_A, name: "Ana", email: "ana@x", role: "broker", status: "active", created_at: iso(aCreated) },
    { id: STUDENT_B, name: "Bia", email: "bia@x", role: "associate", status: "active", created_at: iso(bCreated) }
  );
}

test("plano puro: novo usuário só entra se criado depois do início da regra, no papel certo, sem matrícula prévia", () => {
  const rule = { kind: "new_user", audience_roles: ["broker", "associate"], starts_at: iso(10), every_days: null };
  const u = (id, role, created, status = "active") => ({ id, role, created_at: iso(created), status });
  const plan = planRuleEnrollments(rule, [u("novo", "broker", 2), u("antigo", "broker", 30), u("gestor", "manager", 1), u("inativo", "broker", 1, "inactive"), u("ja", "associate", 3)],
    [{ user_id: "ja", status: "completed", completed_at: iso(1) }], NOW);
  assert.deepEqual(plan, [{ userId: "novo", source: "auto_new_broker" }]);
  const rec = { kind: "recycle", audience_roles: ["broker"], starts_at: iso(900), every_days: 365 };
  const done = (user_id, days, status = "completed") => ({ user_id, status, completed_at: iso(days) });
  assert.deepEqual(planRuleEnrollments(rec, [u("a", "broker", 800), u("b", "broker", 800), u("c", "broker", 800)], [done("a", 400), done("b", 300), { user_id: "c", status: "in_progress" }, done("c", 500)], NOW), [{ userId: "a", source: "recycle" }], "só quem concluiu há >= 365 dias e não está refazendo");
});

test("regra nova nasce desligada; salvar valida; ligar é explícito; só aplica regra ativa", async () => {
  const w = buildWorld(); users(w);
  const r = await w.rules.save(ADMIN, { trackId: w.track.id, kind: "new_user", audienceRoles: ["broker", "associate"], dueDays: 30 });
  assert.equal(r.created, true);
  assert.equal(w.db.tables.academy_assignment_rules[0].active, false);
  const noop = await w.rules.apply(ADMIN, {});
  assert.deepEqual([noop.planned, noop.created], [0, 0]);
  await rejects(w.rules.save(ADMIN, { trackId: w.track.id, kind: "recycle", audienceRoles: ["broker"], everyDays: 10 }), "invalid_rule", 400);
  await rejects(w.rules.save(ADMIN, { trackId: w.track.id, kind: "new_user", audienceRoles: ["dono"] }), "invalid_rule", 400);
  await rejects(w.rules.save(ADMIN, { trackId: w.track.id, kind: "new_user", audienceRoles: ["broker"], dueDays: 0 }), "invalid_rule", 400);
  await rejects(w.rules.save(ADMIN, { trackId: "00000000-0000-4000-8000-000000000000", kind: "new_user", audienceRoles: ["broker"] }), "track_not_found", 404);
  const up = await w.rules.save(ADMIN, { trackId: w.track.id, kind: "new_user", audienceRoles: ["broker", "associate"], dueDays: 45, active: true });
  assert.equal(up.created, false);
  assert.equal(w.db.tables.academy_assignment_rules.length, 1);
  assert.deepEqual([w.db.tables.academy_assignment_rules[0].active, w.db.tables.academy_assignment_rules[0].due_days], [true, 45]);
});

test("aplicar: matricula só os NOVOS (obrigatória, com prazo), é idempotente e simulação não grava", async () => {
  const w = buildWorld(); users(w);
  w.db.tables.academy_assignment_rules.push({ id: "r1", track_id: w.track.id, kind: "new_user", audience_roles: ["broker", "associate"], due_days: 30, every_days: null, starts_at: iso(10), active: true });
  const dry = await w.rules.apply(ADMIN, { dryRun: true });
  assert.deepEqual([dry.planned, dry.created, w.db.tables.academy_enrollments.length], [1, 0, 0]);
  const res = await w.rules.apply(ADMIN, {});
  assert.equal(res.created, 1);
  const e = w.db.tables.academy_enrollments[0];
  assert.deepEqual([e.user_id, e.source, e.required, e.status, e.track_version_id, e.due_at], [STUDENT_A, "auto_new_broker", true, "assigned", w.ver.id, new Date(NOW + 30 * DAY).toISOString()]);
  assert.ok(w.db.tables.academy_events.some((x) => x.action === "enrollment_auto" && x.user_id === STUDENT_A));
  assert.equal((await w.rules.apply(ADMIN, {})).created, 0, "idempotente");
  const p = await w.svc.loadStudent(student(STUDENT_A));
  assert.deepEqual([p.enrollment.required, p.enrollment.status], [true, "assigned"]);
  assert.equal(w.db.tables.academy_enrollments.length, 1, "o aluno usa a matrícula automática");
});

test("matrícula preguiçosa do próprio usuário ao abrir (só ele); trilha sem versão publicada é ignorada", async () => {
  const w = buildWorld(); users(w, { aCreated: 1, bCreated: 1 });
  w.db.tables.academy_assignment_rules.push({ id: "r1", track_id: w.track.id, kind: "new_user", audience_roles: ["broker", "associate"], due_days: null, every_days: null, starts_at: iso(10), active: true });
  const r = await w.rules.apply({ userId: STUDENT_A, email: null }, { onlyUserId: STUDENT_A });
  assert.equal(r.created, 1);
  assert.deepEqual(w.db.tables.academy_enrollments.map((e) => e.user_id), [STUDENT_A]);
  w.ver.status = "retired";
  assert.equal((await w.rules.apply(ADMIN, {})).created, 0, "sem versão publicada não matricula");
});

test("reciclagem: quem concluiu há mais de N dias recebe nova matrícula (origem recycle) e o certificado antigo fica", async () => {
  const w = buildWorld(); users(w);
  w.db.tables.academy_enrollments.push({ id: "old1", user_id: STUDENT_B, track_id: w.track.id, track_version_id: w.ver.id, status: "completed", completed_at: iso(400), started_at: iso(420), created_at: iso(420) });
  w.db.tables.academy_assignment_rules.push({ id: "r2", track_id: w.track.id, kind: "recycle", audience_roles: ["associate"], due_days: 60, every_days: 365, starts_at: iso(900), active: true });
  const res = await w.rules.apply(ADMIN, {});
  assert.equal(res.created, 1);
  const fresh = w.db.tables.academy_enrollments.find((e) => e.id !== "old1");
  assert.deepEqual([fresh.user_id, fresh.source, fresh.status, fresh.required], [STUDENT_B, "recycle", "assigned", true]);
  assert.equal(w.db.tables.academy_enrollments.find((e) => e.id === "old1").status, "completed", "histórico preservado");
  assert.equal((await w.rules.apply(ADMIN, {})).created, 0);
});

test("recomendações: gestor só da equipe; duplicada aberta bloqueada; aceitar matricula; dispensar; origem da auditoria só pelo servidor/Admin", async () => {
  const w = buildWorld(); users(w);
  await rejects(w.recommendations.create(MANAGER, TEAM, { userId: STUDENT_B, trackId: w.track.id, reason: "x" }), "out_of_scope", 403);
  await rejects(w.recommendations.create(MANAGER, TEAM, { userId: STUDENT_A, trackId: w.track.id, reason: "   " }), "invalid_recommendation", 400);
  const a = await w.recommendations.create(MANAGER, TEAM, { userId: STUDENT_A, trackId: w.track.id, reason: "Vácuo em 3 atendimentos" });
  await rejects(w.recommendations.create(MANAGER, TEAM, { userId: STUDENT_A, trackId: w.track.id, reason: "de novo" }), "recommendation_exists", 409);
  assert.deepEqual((await w.recommendations.list(TEAM)).recommendations.map((r) => [r.userName, r.status, r.source]), [["Ana", "open", "manual"]]);
  assert.equal((await w.recommendations.list({ admin: false, ids: [MANAGER.userId] })).recommendations.length, 0, "fora da equipe não vê");
  const acc = await w.recommendations.accept(MANAGER, TEAM, { recommendationId: a.id });
  const e = w.db.tables.academy_enrollments.find((x) => x.id === acc.enrollmentId);
  assert.deepEqual([e.user_id, e.source, e.required, e.assigned_by], [STUDENT_A, "recommendation", false, MANAGER.userId]);
  const rec = w.db.tables.academy_recommendations[0];
  assert.deepEqual([rec.status, rec.enrollment_id, rec.decided_by_email], ["accepted", e.id, MANAGER.email]);
  await rejects(w.recommendations.accept(MANAGER, TEAM, { recommendationId: a.id }), "recommendation_closed", 409);
  // dispensar; e aceitar quando já está matriculado só vincula a matrícula existente
  const b = await w.recommendations.create(ADMIN, ALL, { userId: STUDENT_B, trackId: w.track.id, reason: "Qualidade do atendimento", source: "atendimento_audit" });
  await w.recommendations.dismiss(ADMIN, ALL, { recommendationId: b.id });
  assert.equal(w.db.tables.academy_recommendations.find((r) => r.id === b.id).status, "dismissed");
  const c = await w.recommendations.create(MANAGER, TEAM, { userId: STUDENT_A, trackId: w.track.id, reason: "Reforço" });
  const linked = await w.recommendations.accept(MANAGER, TEAM, { recommendationId: c.id });
  assert.equal(linked.enrollmentId, e.id, "vincula a matrícula existente");
  assert.equal(w.db.tables.academy_enrollments.filter((x) => x.user_id === STUDENT_A).length, 1);
  await rejects(w.recommendations.dismiss(MANAGER, TEAM, { recommendationId: "00000000-0000-4000-8000-000000000000" }), "recommendation_not_found", 404);
  assert.equal(answer, answer);
});
