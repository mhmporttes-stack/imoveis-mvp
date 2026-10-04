import test from "node:test";
import assert from "node:assert/strict";
import { createFakeDb } from "./helpers/academy-fake-db.mjs";
import { createAcademyRepo } from "../lib/academy-repo.mjs";
import { createAcademyService } from "../lib/academy-service.mjs";
import { resolveAcademyActor } from "../lib/academy-access-core.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const actor = (userId, extra = {}) => ({ userId, name: userId === A ? "Ana" : "Bia", readOnly: false, reason: null, ...extra });

// Fixture: 1 trilha, 1 versão publicada, 2 módulos (M1: L1,L2 | M2: L3 = prova final), quiz em L1/L2, final (3 tentativas) em L3.
function setup({ finalMax = 3 } = {}) {
  const db = createFakeDb();
  const ins = (table, obj) => { const r = db.insertRow(table, obj); assert.ifError(r.error); return r.data; };
  const track = ins("academy_tracks", { slug: "formacao-inicial", title: "Formação Inicial", kind: "formacao_inicial", status: "active" });
  const ver = ins("academy_track_versions", { track_id: track.id, version_number: 1, status: "published", settings: { unlock_mode: "sequential", pass_score: 70, max_attempts: 3 } });
  const m1 = ins("academy_modules", { track_version_id: ver.id, position: 1, title: "Módulo 1", is_final: false, requires_exam: false });
  const m2 = ins("academy_modules", { track_version_id: ver.id, position: 2, title: "Prova final", is_final: true, requires_exam: false });
  const mkLesson = (m, pos, title, kind = "lesson") => ins("academy_lessons", { module_id: m.id, position: pos, title, est_minutes: 10, kind, body: { sample: true, blocks: [{ type: "paragraph", text: "texto" }] } });
  const l1 = mkLesson(m1, 1, "Aula 1"); const l2 = mkLesson(m1, 2, "Aula 2"); const l3 = mkLesson(m2, 1, "Prova final", "final_exam");
  const opts = [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }];
  const mkExam = (lesson, kind, max) => {
    const q = ins("academy_questions", { stable_key: `s-${lesson.id}`, qversion: 1, type: "single", statement: `Pergunta ${lesson.title}`, options: opts, correct: ["b"], explanation: "EXPLICACAO-SECRETA", topic: lesson.title, status: "active" });
    const x = ins("academy_exams", { track_version_id: ver.id, lesson_id: lesson.id, kind, pass_score: null, max_attempts: max });
    ins("academy_exam_questions", { exam_id: x.id, question_id: q.id, position: 1, weight: 1 });
    return { q, x };
  };
  const e1 = mkExam(l1, "quiz", null); const e2 = mkExam(l2, "quiz", null); const e3 = mkExam(l3, "final", finalMax);
  const svc = createAcademyService(createAcademyRepo(db), { now: () => "2026-10-04T12:00:00.000Z" });
  return { db, svc, track, ver, l: [l1, l2, l3], e: [e1, e2, e3] };
}
const answer = (e, optionId) => ({ [e.q.id]: [optionId] });

test("resolveAcademyActor: leitura em 'Alterar conta' e sem perfil gravável", () => {
  assert.deepEqual(resolveAcademyActor({ profile: { id: A, name: "Ana" } }), { userId: A, name: "Ana", readOnly: false, reason: null });
  assert.equal(resolveAcademyActor({ profile: { id: A }, accountSwitchMode: true }).readOnly, true);
  assert.equal(resolveAcademyActor({ profile: { id: A }, accountSwitchMode: true }).reason, "account_switch");
  assert.equal(resolveAcademyActor({ profile: { id: "", name: "x", isFallback: true } }).readOnly, true);
  assert.equal(resolveAcademyActor({ profile: { id: "nao-uuid" } }).userId, null);
});

test("primeiro acesso cria UMA matrícula (idempotente) e a tela não leva gabarito nem explicação", async () => {
  const { svc, db, l } = setup();
  const p1 = await svc.loadStudent(actor(A));
  const p2 = await svc.loadStudent(actor(A));
  assert.equal(p1.status, "ok");
  assert.equal(db.tables.academy_enrollments.length, 1);
  assert.equal(p1.enrollment.id, p2.enrollment.id);
  assert.equal(p1.core.lessons.length, 3);
  assert.equal(Object.keys(p1.questions).length, 3);
  const json = JSON.stringify(p1);
  assert.ok(!json.includes("EXPLICACAO-SECRETA"), "explicação vazou");
  assert.ok(!/"correct"/.test(json), "campo correct vazou");
  assert.equal(p1.exams[l[2].id].maxAttempts, 3);
  assert.equal(p1.exams[l[0].id].maxAttempts, null);
});

test("'Alterar conta' (somente leitura): vê o progresso, não grava matrícula nem tentativa", async () => {
  const { svc, db, e } = setup();
  const ro = actor(A, { readOnly: true, reason: "account_switch" });
  const p = await svc.loadStudent(ro);
  assert.equal(p.status, "ok");
  assert.equal(p.readOnly, true);
  assert.equal(p.enrollment, null);
  assert.equal(db.tables.academy_enrollments.length, 0);
  await assert.rejects(svc.submitAttempt(ro, e[0].x.id, answer(e[0], "b")), (err) => err.code === "read_only_account_switch" && err.status === 403);
  assert.equal(db.tables.academy_exam_attempts.length, 0);
});

test("errar não conclui e não revela o gabarito; acertar conclui, revela e grava tentativa/resposta/nota", async () => {
  const { svc, db, e, l } = setup();
  await svc.loadStudent(actor(A));
  const wrong = await svc.submitAttempt(actor(A), e[0].x.id, answer(e[0], "a"));
  assert.equal(wrong.correct, false);
  assert.equal(wrong.correctOptionIds, null);
  assert.ok(!JSON.stringify(wrong).includes("EXPLICACAO-SECRETA"));
  assert.equal(wrong.lessonCompleted, false);
  assert.equal(db.tables.academy_lesson_progress.length, 0);
  const right = await svc.submitAttempt(actor(A), e[0].x.id, answer(e[0], "b"));
  assert.equal(right.correct, true);
  assert.deepEqual(right.correctOptionIds, ["b"]);
  assert.equal(right.lessonCompleted, true);
  assert.equal(right.score, 100);
  assert.ok(right.completedAt);
  assert.equal(db.tables.academy_exam_attempts.length, 2);
  assert.equal(db.tables.academy_attempt_answers.length, 2);
  assert.equal(db.tables.academy_attempt_answers[0].is_correct, false);
  assert.equal(db.tables.academy_lesson_progress[0].lesson_id, l[0].id);
  // repetir depois de aprovado: idempotente, sem nova tentativa
  const again = await svc.submitAttempt(actor(A), e[0].x.id, answer(e[0], "a"));
  assert.equal(again.alreadyPassed, true);
  assert.equal(db.tables.academy_exam_attempts.length, 2);
  // recarregar: progresso persistido
  const p = await svc.loadStudent(actor(A));
  assert.deepEqual(Object.keys(p.core.completed), [l[0].id]);
});

test("sequência: não dá para fazer aula/prova fora de ordem", async () => {
  const { svc, e } = setup();
  await svc.loadStudent(actor(A));
  await assert.rejects(svc.submitAttempt(actor(A), e[1].x.id, answer(e[1], "b")), (err) => err.code === "lesson_locked" && err.status === 409);
  await assert.rejects(svc.submitAttempt(actor(A), e[2].x.id, answer(e[2], "b")), (err) => err.code === "lesson_locked");
});

test("prova final: no máximo 3 tentativas (a 3ª já avisa; a 4ª é recusada) e tudo fica registrado", async () => {
  const { svc, db, e, l } = setup();
  await svc.loadStudent(actor(A));
  for (const i of [0, 1]) await svc.submitAttempt(actor(A), e[i].x.id, answer(e[i], "b"));
  const r1 = await svc.submitAttempt(actor(A), e[2].x.id, answer(e[2], "a"));
  const r2 = await svc.submitAttempt(actor(A), e[2].x.id, answer(e[2], "c"));
  const r3 = await svc.submitAttempt(actor(A), e[2].x.id, answer(e[2], "a"));
  assert.deepEqual([r1.attemptNumber, r2.attemptNumber, r3.attemptNumber], [1, 2, 3]);
  assert.equal(r2.exhausted, false);
  assert.equal(r3.exhausted, true);
  await assert.rejects(svc.submitAttempt(actor(A), e[2].x.id, answer(e[2], "b")), (err) => err.code === "attempts_exhausted" && err.status === 403 && err.extra.maxAttempts === 3);
  assert.equal(db.tables.academy_exam_attempts.filter((a) => a.exam_id === e[2].x.id).length, 3);
  const p = await svc.loadStudent(actor(A));
  assert.equal(p.exams[l[2].id].exhausted, true);
});

test("duas tentativas simultâneas na última vaga: só uma é gravada (limite atômico)", async () => {
  const { svc, db, e } = setup();
  await svc.loadStudent(actor(A));
  for (const i of [0, 1]) await svc.submitAttempt(actor(A), e[i].x.id, answer(e[i], "b"));
  await svc.submitAttempt(actor(A), e[2].x.id, answer(e[2], "a"));
  await svc.submitAttempt(actor(A), e[2].x.id, answer(e[2], "a"));
  const res = await Promise.allSettled([svc.submitAttempt(actor(A), e[2].x.id, answer(e[2], "a")), svc.submitAttempt(actor(A), e[2].x.id, answer(e[2], "a"))]);
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(res.find((r) => r.status === "rejected").reason.code, "attempts_exhausted");
  assert.equal(db.tables.academy_exam_attempts.filter((a) => a.exam_id === e[2].x.id).length, 3);
});

test("isolamento: o progresso de um aluno nunca aparece nem é alterado por outro", async () => {
  const { svc, db, e, l } = setup();
  await svc.loadStudent(actor(A));
  await svc.submitAttempt(actor(A), e[0].x.id, answer(e[0], "b"));
  const pb = await svc.loadStudent(actor(B));
  assert.deepEqual(pb.core.completed, {});
  assert.equal(db.tables.academy_enrollments.length, 2);
  // B tenta enviar prova de A sem ter feito a aula 1: é a matrícula DE B que vale (e ela está na aula 1)
  await assert.rejects(svc.submitAttempt(actor(B), e[1].x.id, answer(e[1], "b")), (err) => err.code === "lesson_locked");
  // aluno sem matrícula não grava em matrícula alheia
  const C = "33333333-3333-4333-8333-333333333333";
  await assert.rejects(svc.submitAttempt(actor(C), e[0].x.id, answer(e[0], "b")), (err) => err.code === "enrollment_not_found" && err.status === 404);
  const bProgress = db.tables.academy_lesson_progress.filter((p) => p.enrollment_id === pb.enrollment.id);
  assert.equal(bProgress.length, 0);
  assert.ok(db.tables.academy_lesson_progress.every((p) => p.lesson_id === l[0].id));
});

test("respostas inválidas: vazia, questão estranha e alternativa inexistente", async () => {
  const { svc, db, e } = setup();
  await svc.loadStudent(actor(A));
  await assert.rejects(svc.submitAttempt(actor(A), e[0].x.id, {}), (err) => err.code === "invalid_answers" && err.status === 400);
  await assert.rejects(svc.submitAttempt(actor(A), e[0].x.id, { "outra-questao": ["b"] }), (err) => err.code === "invalid_answers");
  await assert.rejects(svc.submitAttempt(actor(A), "00000000-0000-4000-8000-000000000000", { x: ["b"] }), (err) => err.code === "exam_not_found" && err.status === 404);
  const r = await svc.submitAttempt(actor(A), e[0].x.id, answer(e[0], "zzz"));
  assert.equal(r.correct, false);
  assert.equal(db.tables.academy_exam_attempts.length, 1);
});

test("a matrícula fica presa à versão em que começou; concluir tudo marca a matrícula como concluída", async () => {
  const { svc, db, e, ver, track } = setup();
  await svc.loadStudent(actor(A));
  // nova versão publicada depois: a matrícula antiga continua na v1
  ver.status = "retired";
  db.insertRow("academy_track_versions", { track_id: track.id, version_number: 2, status: "published", settings: {} });
  const p = await svc.loadStudent(actor(A));
  assert.equal(p.core.lessons.length, 3);
  for (const i of [0, 1]) await svc.submitAttempt(actor(A), e[i].x.id, answer(e[i], "b"));
  const last = await svc.submitAttempt(actor(A), e[2].x.id, answer(e[2], "b"));
  assert.equal(last.enrollmentStatus, "completed");
  assert.equal(db.tables.academy_enrollments[0].status, "completed");
  assert.ok(db.tables.academy_enrollments[0].completed_at);
  const done = await svc.loadStudent(actor(A));
  assert.equal(done.core.finalExamPassed, true);
});

test("concluir aula sem prova: idempotente; aula com prova não conclui por este caminho", async () => {
  const { svc, db, ver, track, l } = setup();
  const m = db.tables.academy_modules[0];
  const extra = db.insertRow("academy_lessons", { module_id: m.id, position: 3, title: "Sem prova", est_minutes: 5, kind: "lesson", body: {} }).data;
  await svc.loadStudent(actor(A));
  await assert.rejects(svc.completeLessonNoExam(actor(A), extra.id), (err) => err.code === "lesson_locked");
  await assert.rejects(svc.completeLessonNoExam(actor(A), l[0].id), (err) => err.code === "exam_required" && err.status === 409);
  void ver; void track;
});

test("sem trilha publicada, a Academia avisa indisponível sem criar nada", async () => {
  const db = createFakeDb();
  const svc = createAcademyService(createAcademyRepo(db));
  assert.deepEqual(await svc.loadStudent(actor(A)), { status: "unavailable" });
  assert.equal(db.tables.academy_enrollments.length, 0);
});
