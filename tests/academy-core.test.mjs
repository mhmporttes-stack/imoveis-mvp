import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "../lib/academy-core.mjs";
import { SAMPLE_QUESTIONS, buildInitialCoreState } from "../lib/academy-sample.mjs";

const T = "2026-09-14T12:00:00.000Z";
const lessonIdx = (s, i) => core.orderedLessons(s)[i].id;
const mod = (s, n) => s.modules.find((m) => m.position === n);

test("estado inicial: 9/18 = 50%, 6 módulos, 18 aulas (2+3+5+2+5+1)", () => {
  const s = buildInitialCoreState();
  assert.deepEqual(core.trackProgress(s), { done: 9, total: 18, percent: 50 });
  assert.deepEqual(s.modules.map((m) => s.lessons.filter((l) => l.module_id === m.id).length), [2, 3, 5, 2, 5, 1]);
});

test("desbloqueio sequencial: módulo 4 bloqueado até concluir o 3", () => {
  let s = buildInitialCoreState();
  assert.equal(core.unlockState(s, mod(s, 3).id).unlocked, true);
  const u = core.unlockState(s, mod(s, 4).id);
  assert.equal(u.unlocked, false);
  assert.equal(u.reason, "previous_module");
  assert.equal(core.lessonState(s, lessonIdx(s, 10)), "locked");
  s = core.completeLesson(s, lessonIdx(s, 9), T).state;
  assert.equal(core.unlockState(s, mod(s, 4).id).unlocked, true);
  assert.equal(core.lessonState(s, lessonIdx(s, 10)), "now");
});

test("estados das aulas: done / now / locked; atual = aula 5 do módulo 3", () => {
  const s = buildInitialCoreState();
  assert.equal(core.currentLesson(s).id, lessonIdx(s, 9));
  assert.equal(core.lessonState(s, lessonIdx(s, 0)), "done");
  assert.equal(core.lessonState(s, lessonIdx(s, 9)), "now");
  assert.equal(core.nextLesson(s), null);
});

test("concluir a aula 5: 50% -> 56%, módulo 3 concluído só agora", () => {
  const s = buildInitialCoreState();
  assert.equal(core.moduleProgress(s, mod(s, 3).id).complete, false);
  const r = core.completeLesson(s, lessonIdx(s, 9), T);
  assert.equal(r.changed, true);
  assert.equal(r.event.progress_before, 50);
  assert.equal(r.event.progress_after, 56);
  assert.equal(r.event.module_completed, mod(s, 3).id);
  assert.equal(core.moduleProgress(r.state, mod(s, 3).id).complete, true);
  assert.equal(core.moduleJustCompleted(s, r.state), mod(s, 3).id);
  assert.equal(core.moduleJustCompleted(r.state, r.state), null);
  assert.equal(r.state.completed[lessonIdx(s, 9)], T);
});

test("completeLesson é idempotente e não muta o estado", () => {
  const s = buildInitialCoreState();
  const before = JSON.stringify(s);
  const r1 = core.completeLesson(s, lessonIdx(s, 9), T);
  const r2 = core.completeLesson(r1.state, lessonIdx(s, 9), "2030-01-01T00:00:00.000Z");
  assert.equal(JSON.stringify(s), before);
  assert.equal(r2.changed, false);
  assert.equal(r2.event, null);
  assert.equal(r2.state, r1.state);
  assert.equal(r2.state.completed[lessonIdx(s, 9)], T);
});

test("não conclui aula bloqueada nem fora de ordem (sequencial); modo free libera módulos", () => {
  const s = buildInitialCoreState();
  assert.equal(core.completeLesson(s, lessonIdx(s, 12), T).error, "lesson_locked");
  assert.equal(core.completeLesson(s, "nao-existe", T).error, "unknown_lesson");
  const free = { ...s, settings: { ...s.settings, unlock_mode: "free" } };
  assert.equal(core.unlockState(free, mod(free, 6).id).unlocked, true);
});

test("prova do módulo (requires_exam) segura a liberação do seguinte", () => {
  let s = buildInitialCoreState();
  s = { ...s, modules: s.modules.map((m) => (m.position === 3 ? { ...m, requires_exam: true } : m)) };
  s = core.completeLesson(s, lessonIdx(s, 9), T).state;
  assert.equal(core.unlockState(s, mod(s, 4).id).reason, "previous_exam");
  s = { ...s, passedModuleExams: [mod(s, 3).id] };
  assert.equal(core.unlockState(s, mod(s, 4).id).unlocked, true);
});

test("gradeQuestion: só aqui; publicQuestion não vaza gabarito", () => {
  const q = Object.values(SAMPLE_QUESTIONS)[0];
  const pub = core.publicQuestion(q);
  assert.equal("correct" in pub, false);
  assert.equal("explanation" in pub, false);
  assert.equal(JSON.stringify(pub).includes("(correta)") , true); // texto de exemplo da alternativa, não o campo de gabarito
  assert.equal(core.gradeQuestion(q, "a").correct, false);
  assert.equal(core.gradeQuestion(q, "a").correctOptionIds, null);
  assert.equal(core.gradeQuestion(q, "b").correct, true);
  assert.deepEqual(core.gradeQuestion(q, ["b"]).correctOptionIds, ["b"]);
  assert.equal(core.gradeQuestion(q, null).correct, false);
});

test("certificado: só com todas as aulas E prova final", () => {
  let s = buildInitialCoreState();
  let e = core.certificateEligibility(s);
  assert.equal(e.eligible, false);
  for (let i = 9; i < 18; i++) s = core.completeLesson(s, lessonIdx(s, i), T).state;
  e = core.certificateEligibility(s);
  assert.equal(e.eligible, true);
  assert.equal(core.trackProgress(s).percent, 100);
  // todas as aulas sem prova final => inelegível
  const noExam = { ...s, finalExamPassed: false };
  const e2 = core.certificateEligibility(noExam);
  assert.equal(e2.eligible, false);
  assert.deepEqual(e2.reasons, ["prova_final_pendente"]);
});

test("core não usa relógio, rede nem Supabase", () => {
  for (const f of ["../lib/academy-core.mjs", "../lib/academy-sample.mjs", "../lib/academy-sample-store.mjs"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.equal(/supabase|server-only|fetch\(|localStorage|XMLHttpRequest/.test(src.replace(/\/\/.*$/gm, "")), false, f);
  }
  assert.equal(/Date\.now|new Date\(\)/.test(readFileSync(new URL("../lib/academy-core.mjs", import.meta.url), "utf8")), false);
});
