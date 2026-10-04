import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN, MANAGER, STUDENT_A, STUDENT_B, answer, buildWorld, student } from "./helpers/academy-world.mjs";

const rejects = (p, code, status) => assert.rejects(p, (e) => e.code === code && (status == null || e.status === status), `esperava ${code}`);
const ADMIN_SCOPE = { admin: true, ids: null };
const TEAM_SCOPE = (...ids) => ({ admin: false, ids });

// Ana passa as aulas 1 e 2 e erra a prova final 3 vezes (esgotada).
async function exhausted(w, who = STUDENT_A) {
  await w.svc.loadStudent(student(who));
  for (const i of [0, 1]) await w.svc.submitAttempt(student(who), w.e[i].x.id, answer(w.e[i], "b"));
  for (let i = 0; i < 3; i++) await w.svc.submitAttempt(student(who), w.e[2].x.id, answer(w.e[2], "a"));
  return w.db.tables.academy_enrollments.find((e) => e.user_id === who);
}

test("liberação: só depois das 3; +1 uma vez; registra quem e quando; a 5ª continua barrada", async () => {
  const w = buildWorld();
  const enr = await exhausted(w);
  w.db.tables.admin_users.push({ id: STUDENT_A, name: "Ana", email: "ana@x", role: "broker", status: "active" }, { id: ADMIN.userId, name: "Chefe", email: ADMIN.email, role: "admin", status: "active" });
  await assert.rejects(w.svc.submitAttempt(student(STUDENT_A), w.e[2].x.id, answer(w.e[2], "b")), (e) => e.code === "attempts_exhausted" && e.status === 403);

  const before = await w.grants.list(ADMIN_SCOPE);
  assert.deepEqual(before.pending.map((p) => [p.studentName, p.lessonTitle, p.attemptsUsed, p.maxAttempts]), [["Ana", "Prova final", 3, 3]]);
  assert.equal(before.granted.length, 0);

  const g = await w.grants.grant(ADMIN, ADMIN_SCOPE, { enrollmentId: enr.id, examId: w.e[2].x.id, reason: "  perdeu a conexão  " });
  assert.equal(g.maxAttempts, 4);
  const row = w.db.tables.academy_attempt_grants[0];
  assert.deepEqual([row.granted_by, row.granted_by_email, row.reason], [ADMIN.userId, ADMIN.email, "perdeu a conexão"]);
  assert.ok(row.granted_at);
  assert.ok(w.db.tables.academy_events.some((e) => e.action === "attempt_granted" && e.actor_user_id === ADMIN.userId && e.user_id === STUDENT_A));
  await rejects(w.grants.grant(ADMIN, ADMIN_SCOPE, { enrollmentId: enr.id, examId: w.e[2].x.id }), "grant_already_given", 409);

  // a tela do aluno passa a mostrar 4 tentativas e permite a 4ª; depois da 4ª, esgotada de novo (sem nova liberação automática)
  const p = await w.svc.loadStudent(student(STUDENT_A));
  assert.deepEqual([p.exams[w.l[2].id].maxAttempts, p.exams[w.l[2].id].exhausted], [4, false]);
  const r4 = await w.svc.submitAttempt(student(STUDENT_A), w.e[2].x.id, answer(w.e[2], "a"));
  assert.deepEqual([r4.attemptNumber, r4.maxAttempts, r4.exhausted], [4, 4, true]);
  await rejects(w.svc.submitAttempt(student(STUDENT_A), w.e[2].x.id, answer(w.e[2], "b")), "attempts_exhausted", 403);
  assert.equal(w.db.tables.academy_exam_attempts.filter((a) => a.exam_id === w.e[2].x.id).length, 4);
  const after = await w.grants.list(ADMIN_SCOPE);
  assert.equal(after.pending.length, 0, "já liberada: não aparece mais como pendente");
  assert.deepEqual([after.granted[0].studentName, after.granted[0].grantedBy, after.granted[0].reason], ["Ana", "Chefe", "perdeu a conexão"]);
});

test("liberação: acertar na tentativa extra aprova e conclui a formação", async () => {
  const w = buildWorld();
  const enr = await exhausted(w);
  await w.grants.grant(ADMIN, ADMIN_SCOPE, { enrollmentId: enr.id, examId: w.e[2].x.id });
  const r = await w.svc.submitAttempt(student(STUDENT_A), w.e[2].x.id, answer(w.e[2], "b"));
  assert.deepEqual([r.correct, r.lessonCompleted, r.enrollmentStatus], [true, true, "completed"]);
});

test("liberação: não antes de esgotar, não após aprovar, não em quiz, sem matrícula", async () => {
  const w = buildWorld();
  await w.svc.loadStudent(student(STUDENT_A));
  const enr = w.db.tables.academy_enrollments[0];
  await w.svc.submitAttempt(student(STUDENT_A), w.e[0].x.id, answer(w.e[0], "b"));
  await rejects(w.grants.grant(ADMIN, ADMIN_SCOPE, { enrollmentId: enr.id, examId: w.e[2].x.id }), "attempts_not_exhausted", 409);
  await rejects(w.grants.grant(ADMIN, ADMIN_SCOPE, { enrollmentId: enr.id, examId: w.e[0].x.id }), "exam_without_limit", 409);
  await rejects(w.grants.grant(ADMIN, ADMIN_SCOPE, { enrollmentId: "00000000-0000-4000-8000-000000000000", examId: w.e[2].x.id }), "enrollment_not_found", 404);
  assert.equal(w.db.tables.academy_attempt_grants.length, 0);
});

test("liberação: gestor só para a própria equipe; admin para qualquer um", async () => {
  const w = buildWorld();
  const ea = await exhausted(w, STUDENT_A);
  const eb = await exhausted(w, STUDENT_B);
  const team = TEAM_SCOPE(MANAGER.userId, STUDENT_A);
  assert.deepEqual((await w.grants.list(team)).pending.map((p) => p.userId), [STUDENT_A], "lista só a equipe");
  await rejects(w.grants.grant(MANAGER, team, { enrollmentId: eb.id, examId: w.e[2].x.id }), "out_of_scope", 403);
  assert.equal(w.db.tables.academy_attempt_grants.length, 0);
  await w.grants.grant(MANAGER, team, { enrollmentId: ea.id, examId: w.e[2].x.id });
  assert.equal(w.db.tables.academy_attempt_grants[0].granted_by, MANAGER.userId);
  await w.grants.grant(ADMIN, ADMIN_SCOPE, { enrollmentId: eb.id, examId: w.e[2].x.id });
  assert.equal(w.db.tables.academy_attempt_grants.length, 2);
  assert.deepEqual((await w.grants.list(TEAM_SCOPE(MANAGER.userId))).pending, [], "gestor sem equipe não vê ninguém");
});
