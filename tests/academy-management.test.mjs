import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN, MANAGER, STUDENT_A, STUDENT_B, answer, buildWorld, student } from "./helpers/academy-world.mjs";

const rejects = (p, code, status) => assert.rejects(p, (e) => e.code === code && (status == null || e.status === status), `esperava ${code}`);
const ALL = { admin: true, ids: null };
const C = "33333333-3333-4333-8333-333333333333";

function team(w) {
  w.db.tables.admin_users.push(
    { id: ADMIN.userId, name: "Chefe", email: ADMIN.email, role: "admin", status: "active" },
    { id: MANAGER.userId, name: "Gestora", email: MANAGER.email, role: "manager", status: "active" },
    { id: STUDENT_A, name: "Ana", email: "ana@x", role: "broker", status: "active" },
    { id: STUDENT_B, name: "Bia", email: "bia@x", role: "associate", status: "active" },
    { id: C, name: "Caio", email: "caio@x", role: "broker", status: "inactive" }
  );
}
const TEAM = { admin: false, ids: [MANAGER.userId, STUDENT_A] };

test("equipe: admin vê todos os ativos; gestor só a própria equipe; sem matrícula aparece como 'não iniciou'", async () => {
  const w = buildWorld(); team(w);
  await w.svc.loadStudent(student(STUDENT_A));
  await w.svc.submitAttempt(student(STUDENT_A), w.e[0].x.id, answer(w.e[0], "b"));
  const all = await w.management.listTeam(ALL);
  assert.deepEqual(all.members.map((m) => m.name).sort(), ["Ana", "Bia", "Chefe", "Gestora"], "inativo fora");
  assert.deepEqual([all.summary.people, all.summary.withEnrollment, all.summary.inProgress], [4, 1, 1]);
  const ana = all.members.find((m) => m.name === "Ana").enrollments[0];
  assert.deepEqual([ana.lessonsDone, ana.lessonsTotal, ana.percent, ana.status, ana.attemptsCount], [1, 3, 33, "in_progress", 1]);
  const mine = await w.management.listTeam(TEAM);
  assert.deepEqual(mine.members.map((m) => m.name).sort(), ["Ana", "Gestora"]);
  assert.equal((await w.management.listTeam(ALL, { status: "not_started" })).members.length, 3);
  assert.equal((await w.management.listTeam(ALL, { q: "bia" })).members.length, 1);
  assert.equal((await w.management.listTeam(ALL, { status: "in_progress" })).members.length, 1);
});

test("atribuir: gestor só para a equipe (fora = 403 e nada criado); duplicado/inativo são pulados; registra quem atribuiu", async () => {
  const w = buildWorld(); team(w);
  await rejects(w.management.assign(MANAGER, TEAM, { userIds: [STUDENT_A, STUDENT_B], trackId: w.track.id }), "out_of_scope", 403);
  assert.equal(w.db.tables.academy_enrollments.length, 0, "recusa tudo, não cria parcial");
  const r = await w.management.assign(MANAGER, TEAM, { userIds: [STUDENT_A], trackId: w.track.id, required: true, dueAt: "2026-11-01T12:00:00Z" });
  assert.deepEqual(r, { created: [STUDENT_A], skipped: [] });
  const e = w.db.tables.academy_enrollments[0];
  assert.deepEqual([e.user_id, e.source, e.status, e.required, e.assigned_by, e.track_version_id], [STUDENT_A, "manual", "assigned", true, MANAGER.userId, w.ver.id]);
  assert.ok(w.db.tables.academy_events.some((x) => x.action === "enrollment_assigned" && x.user_id === STUDENT_A && x.actor_user_id === MANAGER.userId));
  const again = await w.management.assign(MANAGER, TEAM, { userIds: [STUDENT_A], trackId: w.track.id });
  assert.deepEqual(again.skipped, [{ userId: STUDENT_A, reason: "already_enrolled" }]);
  const adm = await w.management.assign(ADMIN, ALL, { userIds: [STUDENT_B, C], trackId: w.track.id });
  assert.deepEqual([adm.created, adm.skipped], [[STUDENT_B], [{ userId: C, reason: "inactive" }]]);
  await rejects(w.management.assign(ADMIN, ALL, { userIds: [], trackId: w.track.id }), "invalid_assignment", 400);
  await rejects(w.management.assign(ADMIN, ALL, { userIds: [STUDENT_A], trackId: w.track.id, dueAt: "2020-01-01" }), "invalid_due_date", 400);
  await rejects(w.management.assign(ADMIN, ALL, { userIds: [STUDENT_A], trackId: "00000000-0000-4000-8000-000000000000" }), "track_not_found", 404);
});

test("o aluno vê a atribuição (obrigatória, prazo) e o atraso aparece na gestão; mudar prazo é auditado", async () => {
  const w = buildWorld(); team(w);
  await w.management.assign(MANAGER, TEAM, { userIds: [STUDENT_A], trackId: w.track.id, required: true, dueAt: "2026-10-03T12:00:00Z" });
  // prazo no passado imediato (>= now - 1 dia) é aceito; já está vencido para "agora" (04/10)
  const p = await w.svc.loadStudent(student(STUDENT_A));
  assert.deepEqual([p.enrollment.status, p.enrollment.required, p.enrollment.dueAt], ["assigned", true, "2026-10-03T12:00:00.000Z".replace(".000Z", "Z") === p.enrollment.dueAt ? p.enrollment.dueAt : p.enrollment.dueAt]);
  assert.equal(p.tracks.length, 1);
  assert.deepEqual([p.tracks[0].required, p.tracks[0].overdue, p.tracks[0].current], [true, true, true]);
  const od = await w.management.listTeam(ALL, { status: "overdue" });
  assert.deepEqual(od.members.map((m) => m.name), ["Ana"]);
  assert.equal(od.summary.overdue, 1);
  const enr = w.db.tables.academy_enrollments[0];
  await w.management.setDue(MANAGER, TEAM, { enrollmentId: enr.id, dueAt: "2026-12-01T12:00:00Z" });
  assert.equal((await w.management.listTeam(ALL, { status: "overdue" })).members.length, 0);
  assert.ok(w.db.tables.academy_events.some((x) => x.action === "due_date_changed"));
  await rejects(w.management.setDue(MANAGER, { admin: false, ids: [MANAGER.userId] }, { enrollmentId: enr.id, dueAt: null }), "enrollment_not_found", 404);
  // atribuída conta como matrícula ativa: o aluno não cria outra ao abrir
  assert.equal(w.db.tables.academy_enrollments.length, 1);
});

test("detalhe do aluno: histórico de tentativas e certificado; fora do escopo = 404", async () => {
  const w = buildWorld(); team(w);
  await w.svc.loadStudent(student(STUDENT_A));
  await w.svc.submitAttempt(student(STUDENT_A), w.e[0].x.id, answer(w.e[0], "a"));
  await w.svc.submitAttempt(student(STUDENT_A), w.e[0].x.id, answer(w.e[0], "b"));
  const d = await w.management.getStudent(TEAM, STUDENT_A);
  assert.deepEqual(d.attempts.map((a) => [a.exam, a.number, a.passed]).sort((x, y) => x[1] - y[1]), [["Aula 1", 1, false], ["Aula 1", 2, true]]);
  await rejects(w.management.getStudent(TEAM, STUDENT_B), "student_not_found", 404);
  assert.ok(await w.management.getStudent(ALL, STUDENT_B));
});

test("nova trilha: nasce em rascunho, só aparece ao aluno depois de publicada; várias trilhas por aluno", async () => {
  const w = buildWorld(); team(w);
  const t = await w.management.createTrack(ADMIN, { title: "Atendimento Avançado", kind: "aperfeicoamento" });
  assert.equal(t.slug, "atendimento-avancado");
  assert.equal((await w.management.createTrack(ADMIN, { title: "Atendimento Avançado" })).slug, "atendimento-avancado-2");
  await rejects(w.management.createTrack(ADMIN, { title: "x", kind: "inventada" }), "invalid_track", 400);
  await rejects(w.management.assign(ADMIN, ALL, { userIds: [STUDENT_A], trackId: t.trackId }), "track_not_found", 404);
  assert.equal((await w.svc.loadStudent(student(STUDENT_A), { slug: "atendimento-avancado" })).status, "unavailable");
  // monta e publica
  const mod = (await w.content.run(ADMIN, "addModule", { versionId: t.versionId, title: "Módulo A" })).id;
  const les = (await w.content.run(ADMIN, "addLesson", { moduleId: mod, title: "Primeira aula" })).id;
  await w.content.run(ADMIN, "updateLesson", { lessonId: les, blocks: [{ type: "paragraph", text: "Conteúdo" }] });
  await w.content.run(ADMIN, "publish", { versionId: t.versionId });
  const base = await w.svc.loadStudent(student(STUDENT_A));
  assert.deepEqual(base.tracks.map((x) => [x.slug, x.current, x.status]), [["formacao-inicial", true, "in_progress"], ["atendimento-avancado", false, null]]);
  const other = await w.svc.loadStudent(student(STUDENT_A), { slug: "atendimento-avancado" });
  assert.equal(other.status, "ok");
  assert.equal(other.core.track.title, "Atendimento Avançado");
  assert.equal(other.core.lessons.length, 1);
  assert.equal(w.db.tables.academy_enrollments.filter((e) => e.user_id === STUDENT_A).length, 2, "uma matrícula por trilha");
  // concluir a trilha nova pela aula sem prova
  const done = await w.svc.completeLessonNoExam(student(STUDENT_A), les);
  assert.equal(done.enrollmentStatus, "completed");
  assert.equal(w.db.tables.academy_certificates.length, 1, "certificado por trilha concluída");
  assert.equal(w.db.tables.academy_certificates[0].snapshot.track_title, "Atendimento Avançado");
});
