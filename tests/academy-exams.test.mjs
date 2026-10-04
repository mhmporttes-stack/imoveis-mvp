import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN, STUDENT_A, STUDENT_B, buildWorld, student } from "./helpers/academy-world.mjs";
import { pickExamQuestions, seededShuffle } from "../lib/academy-core.mjs";

const rejects = (p, code, status) => assert.rejects(p, (e) => e.code === code && (status == null || e.status === status), `esperava ${code}`);
const Q = (n, topic = `Tema ${n}`) => ({ statement: `Pergunta ${n}?`, options: ["Certa", "Errada 1", "Errada 2"], correct: [0], explanation: `EXPL-${n}`, topic });
async function bank(w, n) { const ids = []; for (let i = 1; i <= n; i++) ids.push((await w.content.run(ADMIN, "bankSave", Q(i))).questionId); return ids; }
const answersFor = (served, rightCount) => Object.fromEntries(served.map((q, i) => [q.id, [i < rightCount ? "a" : "b"]]));

test("sorteio determinístico: mesma tentativa = mesmo conjunto; tentativas diferentes variam; fixa devolve tudo", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ position: i + 1, id: `q${i}` }));
  const a = pickExamQuestions(rows, { mode: "random", count: 4 }, "enr:ex:1");
  assert.equal(a.length, 4);
  assert.deepEqual(pickExamQuestions(rows, { mode: "random", count: 4 }, "enr:ex:1"), a);
  const others = [2, 3, 4, 5].map((n) => pickExamQuestions(rows, { mode: "random", count: 4 }, `enr:ex:${n}`).map((r) => r.id).join());
  assert.ok(others.some((o) => o !== a.map((r) => r.id).join()), "sorteios variam entre tentativas");
  assert.equal(pickExamQuestions(rows, { mode: "fixed" }, "x").length, 10);
  assert.equal(pickExamQuestions(rows, { mode: "random", count: 10 }, "x").length, 10);
  assert.deepEqual(seededShuffle([1, 2, 3, 4, 5], "s"), seededShuffle([1, 2, 3, 4, 5], "s"));
});

test("banco: criar, editar (nova versão), aposentar; prova só aceita questão ativa e nota >= 70", async () => {
  const w = buildWorld();
  const [q1, q2] = await bank(w, 2);
  const v2 = (await w.content.run(ADMIN, "bankSave", { questionId: q1, ...Q(1), statement: "Pergunta 1 revisada?" })).questionId;
  const list = await w.content.bankList();
  assert.equal(list.filter((q) => /^Tema/.test(q.topic)).length, 2, "uma linha por questão (última versão)");
  assert.equal(list.find((q) => q.id === v2).qversion, 2);
  assert.ok(w.db.tables.academy_questions.some((q) => q.id === q1 && q.statement === "Pergunta 1?"), "versão antiga preservada");
  await rejects(w.content.run(ADMIN, "bankSave", { statement: "x", options: ["a"], correct: [0] }), "invalid_question", 400);
  await w.content.run(ADMIN, "bankRetire", { questionId: q2 });
  const d = (await w.content.run(ADMIN, "createDraft", { trackId: w.track.id })).versionId;
  const t = await w.content.getEditTree(d);
  const lesson = t.modules[0].lessons[0].id;
  await rejects(w.content.run(ADMIN, "setExam", { lessonId: lesson, questionIds: [q2] }), "question_retired", 409);
  await rejects(w.content.run(ADMIN, "setExam", { lessonId: lesson, questionIds: [v2], passScore: 60 }), "invalid_pass_score", 400);
  await rejects(w.content.run(ADMIN, "setExam", { lessonId: lesson, questionIds: [v2, q1] }), "invalid_exam", 400);
  await rejects(w.content.run(ADMIN, "setExam", { lessonId: lesson, questionIds: [v2], mode: "random", count: 3 }), "invalid_selection", 400);
  await w.content.run(ADMIN, "setExam", { lessonId: lesson, questionIds: [v2], passScore: 80 });
  assert.equal((await w.content.getEditTree(d)).modules[0].lessons[0].exam.passScore, 80);
});

test("prova com várias questões sorteadas: o aluno recebe o conjunto sem gabarito; corrige no servidor; gabarito só ao passar", async () => {
  const w = buildWorld();
  const ids = await bank(w, 5);
  const d = (await w.content.run(ADMIN, "createDraft", { trackId: w.track.id })).versionId;
  const lesson = (await w.content.getEditTree(d)).modules[0].lessons[0].id;
  await w.content.run(ADMIN, "setExam", { lessonId: lesson, questionIds: ids, mode: "random", count: 3 });
  await w.content.run(ADMIN, "publish", { versionId: d });
  const p = await w.svc.loadStudent(student(STUDENT_B));
  const les = p.core.lessons.find((l) => l.title === "Aula 1");
  assert.equal(p.exams[les.id].multi, true);
  assert.equal(p.exams[les.id].questionCount, 3);
  assert.equal(p.questions[les.id], undefined, "prova multi não vai no payload inicial");
  const examId = p.exams[les.id].examId;
  const first = await w.svc.getExamQuestions(student(STUDENT_B), examId);
  assert.equal(first.questions.length, 3);
  assert.deepEqual((await w.svc.getExamQuestions(student(STUDENT_B), examId)).questions.map((q) => q.id), first.questions.map((q) => q.id), "mesmo conjunto");
  assert.ok(!JSON.stringify(first).includes("EXPL-") && !/"correct"/.test(JSON.stringify(first)));
  // questão fora do conjunto sorteado é recusada
  const outside = ids.find((id) => !first.questions.some((q) => q.id === id));
  await rejects(w.svc.submitAttempt(student(STUDENT_B), examId, { [outside]: ["a"] }), "invalid_answers", 400);
  // 2 de 3 = 66,67% < 70: reprova, mostra temas errados, não revela gabarito
  const bad = await w.svc.submitAttempt(student(STUDENT_B), examId, answersFor(first.questions, 2));
  assert.deepEqual([bad.correct, bad.score, bad.correctCount, bad.total], [false, 66.67, 2, 3]);
  assert.equal(bad.wrongTopics.length, 1);
  assert.equal(bad.review, null);
  assert.ok(!JSON.stringify(bad).includes("EXPL-"));
  assert.equal(bad.lessonCompleted, false);
  // próxima tentativa: novo conjunto determinístico; acertando tudo aprova e revela o gabarito
  const second = await w.svc.getExamQuestions(student(STUDENT_B), examId);
  assert.equal(second.attemptNumber, 2);
  const ok = await w.svc.submitAttempt(student(STUDENT_B), examId, answersFor(second.questions, 3));
  assert.deepEqual([ok.correct, ok.score, ok.lessonCompleted], [true, 100, true]);
  assert.equal(ok.review.length, 3);
  assert.ok(ok.review[0].explanation.startsWith("EXPL-"));
  const rec = w.db.tables.academy_exam_attempts.filter((a) => a.exam_id === examId);
  assert.deepEqual(rec.map((a) => [a.attempt_number, a.passed]), [[1, false], [2, true]]);
  assert.equal(rec[0].served.length, 3, "snapshot do que foi servido");
  assert.equal(w.db.tables.academy_attempt_answers.filter((a) => a.attempt_id === rec[0].id).length, 3);
  // histórico para o aluno
  const again = await w.svc.loadStudent(student(STUDENT_B));
  assert.deepEqual(again.exams[les.id].history.map((h) => [h.n, h.passed]), [[2, true], [1, false]]);
  await rejects(w.svc.getExamQuestions(student(STUDENT_A), examId), "enrollment_not_found", 404);
});

test("nota mínima da prova pode ser maior que 70 (nunca menor) e as 3 tentativas valem", async () => {
  const w = buildWorld();
  const ids = await bank(w, 5);
  const d = (await w.content.run(ADMIN, "createDraft", { trackId: w.track.id })).versionId;
  const t = await w.content.getEditTree(d);
  const finalLesson = t.modules[1].lessons[0].id;
  await w.content.run(ADMIN, "setExam", { lessonId: finalLesson, questionIds: ids, passScore: 80 });
  assert.equal(w.db.tables.academy_exams.find((x) => x.lesson_id === finalLesson && x.track_version_id === d).max_attempts, 3);
  await w.content.run(ADMIN, "publish", { versionId: d });
  await w.svc.loadStudent(student(STUDENT_B));
  const p = await w.svc.loadStudent(student(STUDENT_B));
  const key = p.core.lessons.find((l) => l.kind === "final_exam").id;
  assert.equal(p.exams[key].passScore, 80);
  // conclui as aulas 1 e 2 (quizzes antigos de 1 questão)
  for (const title of ["Aula 1", "Aula 2"]) {
    const lid = p.core.lessons.find((l) => l.title === title).id;
    const ex = p.exams[lid].examId;
    const q = w.db.tables.academy_exam_questions.find((r) => r.exam_id === ex).question_id;
    await w.svc.submitAttempt(student(STUDENT_B), ex, { [q]: ["b"] });
  }
  const examId = p.exams[key].examId;
  const qs = (await w.svc.getExamQuestions(student(STUDENT_B), examId)).questions;
  assert.equal(qs.length, 5);
  const r = await w.svc.submitAttempt(student(STUDENT_B), examId, answersFor(qs, 3)); // 60%
  assert.equal(r.correct, false);
  const r2 = await w.svc.submitAttempt(student(STUDENT_B), examId, answersFor((await w.svc.getExamQuestions(student(STUDENT_B), examId)).questions, 4)); // 80%
  assert.deepEqual([r2.correct, r2.score], [true, 80]);
  assert.equal(r2.enrollmentStatus, "completed");
});

test("prova de módulo: aparece como aula virtual no fim do módulo, trava o próximo módulo e libera ao aprovar", async () => {
  const w = buildWorld();
  const ids = await bank(w, 3);
  const d = (await w.content.run(ADMIN, "createDraft", { trackId: w.track.id })).versionId;
  const t = await w.content.getEditTree(d);
  const m1 = t.modules[0].id;
  // módulo exige prova mas ainda sem prova: bloqueia a publicação
  await w.content.run(ADMIN, "updateModule", { moduleId: m1, title: "Módulo 1" });
  w.db.tables.academy_modules.find((m) => m.id === m1).requires_exam = true;
  await assert.rejects(w.content.run(ADMIN, "publish", { versionId: d }), (e) => e.code === "publish_blocked" && e.extra.issues.some((i) => i.code === "module_exam_missing"));
  await w.content.run(ADMIN, "setExam", { moduleId: m1, questionIds: ids });
  assert.equal(w.db.tables.academy_exams.find((x) => x.module_id === m1).kind, "module");
  await w.content.run(ADMIN, "publish", { versionId: d });
  let p = await w.svc.loadStudent(student(STUDENT_B));
  const virtual = p.core.lessons.find((l) => l.kind === "module_exam");
  assert.deepEqual([virtual.title, virtual.position], ["Prova do Módulo 1", 3]);
  assert.equal(p.core.lessons.length, 4);
  const examId = p.exams[virtual.id].examId;
  assert.equal(virtual.id, examId);
  await rejects(w.svc.submitAttempt(student(STUDENT_B), examId, { x: ["a"] }), "module_locked", 409);
  for (const title of ["Aula 1", "Aula 2"]) {
    const lid = p.core.lessons.find((l) => l.title === title).id;
    const ex = p.exams[lid].examId;
    await w.svc.submitAttempt(student(STUDENT_B), ex, { [w.db.tables.academy_exam_questions.find((r) => r.exam_id === ex).question_id]: ["b"] });
  }
  const qs = (await w.svc.getExamQuestions(student(STUDENT_B), examId)).questions;
  assert.equal(qs.length, 3);
  const bad = await w.svc.submitAttempt(student(STUDENT_B), examId, answersFor(qs, 1));
  assert.deepEqual([bad.correct, bad.examPassed], [false, false]);
  const ok = await w.svc.submitAttempt(student(STUDENT_B), examId, answersFor((await w.svc.getExamQuestions(student(STUDENT_B), examId)).questions, 3));
  assert.deepEqual([ok.correct, ok.moduleExam, ok.lessonCompleted], [true, true, false]);
  assert.ok(ok.completedAt);
  p = await w.svc.loadStudent(student(STUDENT_B));
  assert.ok(p.core.completed[examId], "concluída a partir da tentativa aprovada");
  assert.equal(p.core.lessons.filter((l) => p.core.completed[l.id]).length, 3);
  // enrollment ainda não concluída (falta a prova final)
  assert.equal(w.db.tables.academy_enrollments.find((e) => e.user_id === STUDENT_B).status, "in_progress");
});
