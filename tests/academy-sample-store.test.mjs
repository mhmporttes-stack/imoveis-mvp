import test from "node:test";
import assert from "node:assert/strict";
import { createAcademyDemoStore } from "../lib/academy-sample-store.mjs";

const NOW = () => "2026-09-14T12:00:00.000Z";
const mk = () => createAcademyDemoStore({ now: NOW });

test("snapshot inicial: 50%, 9/18, agora = aula 5 de 5 do Módulo 3, módulo 4 próximo bloqueado", () => {
  const s = mk().getSnapshot();
  assert.equal(s.home.percent, 50);
  assert.equal(s.home.done, 9);
  assert.equal(s.home.total, 18);
  assert.equal(s.home.floorsLit, 9);
  assert.equal(s.home.module.n, 3);
  assert.equal(s.home.lesson.label, "Aula 5 de 5");
  assert.equal(s.home.lesson.state, "current");
  assert.equal(s.home.nextAction.kind, "continue_lesson");
  const states = s.trail.modules.map((m) => m.state);
  assert.deepEqual(states, ["done", "done", "inProgress", "next", "locked", "locked"]);
  assert.equal(s.trail.modules[0].collapsed, true);
  assert.equal(s.trail.modules[3].lockHint, "libera ao concluir o Módulo 3");
  assert.equal(s.trail.next.moduleN, 4);
  assert.equal(s.trail.certification.state, "locked");
  assert.equal(s.certificate.eligible, false);
  assert.equal(s.lesson.title, s.home.lesson.title);
  assert.equal(s.lesson.isSample, true);
});

test("snapshot é imutável e estável até mudar", () => {
  const st = mk();
  const a = st.getSnapshot();
  assert.equal(Object.isFrozen(a), true);
  assert.equal(Object.isFrozen(a.trail.modules[0].lessons[0]), true);
  assert.equal(st.getSnapshot(), a);
  assert.throws(() => { "use strict"; a.home.percent = 1; });
  st.setReducedMotion(true);
  assert.notEqual(st.getSnapshot(), a);
  assert.equal(st.getSnapshot().reducedMotion, true);
});

test("gabarito ausente antes de responder; resposta errada permite tentar de novo; certa conclui", () => {
  const st = mk();
  const lessonId = st.getSnapshot().home.lesson.id;
  const before = st.getSnapshot().quiz;
  assert.equal(before.status, "unanswered");
  assert.equal(before.correctOptionIds, null);
  assert.equal(before.question.options.length, 3);
  assert.equal(JSON.stringify(st.getSnapshot()).includes('"correct"'), false);

  assert.equal(st.answerQuiz(lessonId, 0).correct, false);
  let q = st.getSnapshot().quiz;
  assert.equal(q.status, "incorrect");
  assert.equal(q.attempts, 1);
  assert.equal(q.correctOptionIds, null);
  assert.equal(st.getSnapshot().home.done, 9);

  assert.equal(st.answerQuiz(lessonId, 1).correct, true);
  q = st.getSnapshot().quiz;
  assert.equal(q.status, "correct");
  assert.deepEqual(q.correctOptionIds, ["b"]);
  assert.equal(q.attempts, 2);
  assert.equal(st.getSnapshot().home.done, 10);
});

test("Conquista: 50 -> 56, módulo 3 concluído, módulo 4 liberado", () => {
  const st = mk();
  const id = st.getSnapshot().home.lesson.id;
  st.answerQuiz(id, 1);
  const s = st.getSnapshot();
  assert.equal(s.achievement.available, true);
  assert.equal(s.achievement.before, 50);
  assert.equal(s.achievement.after, 56);
  assert.equal(s.achievement.text, "Você foi de 50% para 56%.");
  assert.equal(s.achievement.newFloor, 10);
  assert.equal(s.achievement.moduleCompleted.n, 3);
  assert.equal(s.achievement.nextModule.n, 4);
  assert.equal(s.home.percent, 56);
  assert.equal(s.trail.modules[2].state, "done");
  assert.equal(s.trail.modules[3].state, "inProgress");
  assert.equal(s.trail.modules[3].lockHint, null);
  assert.equal(s.home.module.n, 4);
});

test("completeLesson do store é idempotente; reset volta ao inicial", () => {
  const st = mk();
  const id = st.getSnapshot().home.lesson.id;
  const r1 = st.completeLesson(id);
  const snap = st.getSnapshot();
  const r2 = st.completeLesson(id);
  assert.equal(r1.changed, true);
  assert.equal(r2.changed, false);
  assert.equal(st.getSnapshot(), snap);
  st.resetExample();
  const s = st.getSnapshot();
  assert.equal(s.home.percent, 50);
  assert.equal(s.achievement.available, false);
  assert.equal(s.quiz.status, "unanswered");
});

test("evolução derivada das datas e certificado só com 100% + prova final", () => {
  const st = mk();
  let s = st.getSnapshot();
  assert.equal(s.evolution.today.percent, 50);
  assert.equal(s.evolution.weeks[0].done, 2);
  assert.equal(s.evolution.weeks.at(-1).done, 9);
  assert.equal(s.evolution.milestones[0].state, "done");
  assert.equal(s.evolution.milestones[2].state, "inProgress");
  for (let i = 0; i < 9; i++) st.answerQuiz(st.getSnapshot().home.lesson.id, 1);
  s = st.getSnapshot();
  assert.equal(s.home.percent, 100);
  assert.equal(s.home.lesson, null);
  assert.equal(s.certificate.eligible, true);
  assert.equal(s.certificate.state, "available");
  assert.equal(s.home.nextAction.kind, "get_certificate");
  assert.equal(s.trail.certification.state, "available");
});

test("subscribe notifica e cancela", () => {
  const st = mk();
  let n = 0;
  const off = st.subscribe(() => n++);
  st.setReducedMotion(true);
  off();
  st.setReducedMotion(false);
  assert.equal(n, 1);
});

test("answerQuiz inválido e aula bloqueada não alteram nada", () => {
  const st = mk();
  const snap = st.getSnapshot();
  assert.equal(st.answerQuiz("x", 0).ok, false);
  assert.equal(st.answerQuiz(snap.home.lesson.id, 9).ok, false);
  const blocked = snap.trail.modules[3].lessons[0].id;
  assert.equal(st.answerQuiz(blocked, 1).ok, false);
  assert.equal(st.getSnapshot(), snap);
});
