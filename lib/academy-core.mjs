// Núcleo PURO da Academia (F1). Sem I/O, sem React, sem relógio: `now` entra por parâmetro.
// Todas as funções são determinísticas e NUNCA mutam o estado recebido.
//
// CONTRATO — estado normalizado `state`:
//   { settings:{unlock_mode:"sequential"|"free", pass_score, max_attempts, certificate_rule},
//     modules:[{id,position,title,is_final?,requires_exam?}],           // ordenados ou não (usa position)
//     lessons:[{id,module_id,position,title,est_minutes,kind?}],        // kind "final_exam" = prova final
//     completed:{[lessonId]: "<ISO>"},                                  // aulas concluídas e quando
//     passedModuleExams:[moduleId,...], finalExamPassed:boolean }
// Saídas principais:
//   trackProgress(state) -> {done,total,percent}      (percent = round(done/total*100); 9/18=50, 10/18=56)
//   moduleProgress(state, moduleId) -> {done,total,percent,complete}
//   lessonState(state, lessonId) -> "done"|"now"|"next"|"locked"
//   unlockState(state, moduleId) -> {unlocked, reason:null|"previous_module"|"previous_exam", previousModuleId}
//   currentLesson / nextLesson(state) -> lesson|null
//   completeLesson(state, lessonId, now) -> {state, event|null, changed, error|null}
//   gradeQuestion(question, answer) -> {correct, feedback, correctOptionIds}   (única correção; gabarito só aqui)
//   publicQuestion(question) -> questão SEM `correct`/`explanation` (a que vai à UI antes de responder)
//   moduleJustCompleted(prev, next) -> moduleId|null
//   certificateEligibility(state) -> {eligible, allLessonsDone, finalExamPassed, reasons[]}  (não emite nada)

const sortByPosition = (a, b) => a.position - b.position;

export function orderedModules(state) {
  return [...state.modules].sort(sortByPosition);
}

export function orderedLessons(state) {
  const modules = orderedModules(state);
  const rank = new Map(modules.map((m, i) => [m.id, i]));
  return [...state.lessons].sort((a, b) => (rank.get(a.module_id) - rank.get(b.module_id)) || sortByPosition(a, b));
}

const isDone = (state, lessonId) => Boolean(state.completed?.[lessonId]);
const percentOf = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);

export function trackProgress(state) {
  const total = state.lessons.length;
  const done = state.lessons.filter((l) => isDone(state, l.id)).length;
  return { done, total, percent: percentOf(done, total) };
}

export function moduleProgress(state, moduleId) {
  const lessons = state.lessons.filter((l) => l.module_id === moduleId);
  const done = lessons.filter((l) => isDone(state, l.id)).length;
  const lessonsComplete = lessons.length > 0 && done === lessons.length;
  const mod = state.modules.find((m) => m.id === moduleId);
  const examOk = !mod?.requires_exam || (state.passedModuleExams || []).includes(moduleId);
  return { done, total: lessons.length, percent: percentOf(done, lessons.length), complete: lessonsComplete && examOk };
}

export function unlockState(state, moduleId) {
  const modules = orderedModules(state);
  const idx = modules.findIndex((m) => m.id === moduleId);
  if (idx < 0) return { unlocked: false, reason: "unknown_module", previousModuleId: null };
  if (state.settings?.unlock_mode === "free" || idx === 0) return { unlocked: true, reason: null, previousModuleId: null };
  const prev = modules[idx - 1];
  const prog = moduleProgress(state, prev.id);
  if (prog.complete) return { unlocked: true, reason: null, previousModuleId: prev.id };
  const lessonsDone = prog.total > 0 && prog.done === prog.total;
  return { unlocked: false, reason: lessonsDone ? "previous_exam" : "previous_module", previousModuleId: prev.id };
}

// Primeira aula não concluída de um módulo liberado ("Agora").
export function currentLesson(state) {
  return orderedLessons(state).find((l) => !isDone(state, l.id) && unlockState(state, l.module_id).unlocked) || null;
}

// Aula imediatamente seguinte à atual, só se for do mesmo módulo (senão o próximo é um módulo).
export function nextLesson(state) {
  const now = currentLesson(state);
  if (!now) return null;
  const lessons = orderedLessons(state);
  const after = lessons[lessons.findIndex((l) => l.id === now.id) + 1];
  return after && after.module_id === now.module_id ? after : null;
}

export function lessonState(state, lessonId) {
  const lesson = state.lessons.find((l) => l.id === lessonId);
  if (!lesson) return "locked";
  if (isDone(state, lessonId)) return "done";
  if (!unlockState(state, lesson.module_id).unlocked) return "locked";
  const now = currentLesson(state);
  if (now && now.id === lessonId) return "now";
  if (state.settings?.unlock_mode === "free") return "next";
  return nextLesson(state)?.id === lessonId ? "next" : "locked";
}

export function completeLesson(state, lessonId, now) {
  const lesson = state.lessons.find((l) => l.id === lessonId);
  if (!lesson) return { state, event: null, changed: false, error: "unknown_lesson" };
  if (isDone(state, lessonId)) return { state, event: null, changed: false, error: null }; // idempotente
  const st = lessonState(state, lessonId);
  if (st === "locked" || (state.settings?.unlock_mode !== "free" && st !== "now")) {
    return { state, event: null, changed: false, error: "lesson_locked" };
  }
  const next = {
    ...state,
    completed: { ...state.completed, [lessonId]: now },
    finalExamPassed: state.finalExamPassed || lesson.kind === "final_exam"
  };
  const before = trackProgress(state);
  const after = trackProgress(next);
  const event = {
    type: "lesson_completed",
    lesson_id: lessonId,
    module_id: lesson.module_id,
    at: now,
    progress_before: before.percent,
    progress_after: after.percent,
    done_before: before.done,
    done_after: after.done,
    module_completed: moduleJustCompleted(state, next)
  };
  return { state: next, event, changed: true, error: null };
}

export function moduleJustCompleted(prev, next) {
  const mod = orderedModules(next).find((m) => moduleProgress(next, m.id).complete && !moduleProgress(prev, m.id).complete);
  return mod ? mod.id : null;
}

const asIds = (answer) => (Array.isArray(answer) ? answer : answer == null ? [] : [answer]).map(String).sort();

// Correção exclusivamente aqui. question.correct = lista de ids de alternativas corretas.
export function gradeQuestion(question, answer) {
  const correctIds = asIds(question.correct);
  const given = asIds(answer);
  const correct = given.length > 0 && given.length === correctIds.length && given.every((id, i) => id === correctIds[i]);
  return {
    correct,
    feedback: correct ? question.explanation || "Resposta correta." : "Resposta incorreta. Tente novamente.",
    correctOptionIds: correct ? correctIds : null
  };
}

// Visão enviada à UI antes de responder: sem gabarito nem explicação.
export function publicQuestion(question) {
  return {
    id: question.id,
    stem: question.stem,
    options: question.options.map((o) => ({ id: o.id, text: o.text })),
    multiple: question.type === "multi"
  };
}

export function certificateEligibility(state) {
  const { done, total } = trackProgress(state);
  const allLessonsDone = total > 0 && done === total;
  const finalExamPassed = Boolean(state.finalExamPassed);
  const reasons = [];
  if (!allLessonsDone) reasons.push("aulas_pendentes");
  if (!finalExamPassed) reasons.push("prova_final_pendente");
  return { eligible: allLessonsDone && finalExamPassed, allLessonsDone, finalExamPassed, reasons };
}

// ---------------------------------------------------------------------------------------------
// F2 — provas e tentativas (puro). Regras do dono (2026-10-04): nota mínima 70% (7,0) em quizzes, provas de
// módulo e prova final; máximo de 3 tentativas por PROVA (quiz de aula sem limite). O limite vive em
// `exam.max_attempts` (null = sem limite); a gravação atômica e o limite são garantidos também no banco.
// ---------------------------------------------------------------------------------------------
export const DEFAULT_PASS_SCORE = 70;

export function effectivePassScore(exam, settings) {
  const v = exam?.pass_score ?? settings?.pass_score ?? DEFAULT_PASS_SCORE;
  return Number.isFinite(Number(v)) ? Number(v) : DEFAULT_PASS_SCORE;
}

// attemptsUsed = tentativas já gravadas; passed = já existe tentativa aprovada.
export function attemptStatus({ attemptsUsed = 0, maxAttempts = null, passed = false }) {
  const max = maxAttempts == null ? null : Number(maxAttempts);
  const exhausted = !passed && max != null && attemptsUsed >= max;
  return { attemptsUsed, maxAttempts: max, passed, exhausted, canAttempt: !passed && !exhausted, attemptsLeft: max == null ? null : Math.max(0, max - attemptsUsed) };
}

// Corrige uma tentativa. `questions` = [{id,type,options,correct,explanation,weight}] (COM gabarito, só no servidor).
// `answers` = {[questionId]: optionId | optionId[]}. Questão sem resposta vale 0. Aprovação é comparada com inteiros
// (earned*100 >= passScore*total), sem arredondar antes: 69,99% nunca vira 70%.
export function gradeAttempt({ questions, answers, passScore = DEFAULT_PASS_SCORE }) {
  const given = answers && typeof answers === "object" ? answers : {};
  let earned = 0;
  let total = 0;
  const details = questions.map((q) => {
    const weight = Number(q.weight ?? 1);
    total += weight;
    const ids = asIds(given[q.id]).filter((id) => q.options.some((o) => String(o.id) === id));
    const result = gradeQuestion(q, ids);
    if (result.correct) earned += weight;
    return { question_id: q.id, answer: ids, is_correct: result.correct, points: result.correct ? weight : 0, explanation: q.explanation || null, correct: asIds(q.correct) };
  });
  const score = total > 0 ? Math.round((earned / total) * 10000) / 100 : 0;
  const passed = total > 0 && earned * 100 >= Number(passScore) * total;
  return { score, passed, earned, total, details };
}

// ---------------------------------------------------------------------------------------------
// F4 — seleção de questões da prova. Determinística: a MESMA tentativa (matrícula + prova + nº) sempre sorteia as mesmas
// questões, então não precisa gravar a tentativa antes de enviar (quem pega as questões e quem corrige chegam ao mesmo
// conjunto). `selection` = {mode:"fixed"} (todas, na ordem) | {mode:"random", count:N} (N do banco da prova).
// ---------------------------------------------------------------------------------------------
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function seededShuffle(items, seed) {
  const rnd = mulberry32(hash32(String(seed)));
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function pickExamQuestions(rows, selection, seed) {
  const ordered = [...rows].sort((a, b) => a.position - b.position);
  const count = Number(selection?.count);
  if (selection?.mode === "random" && Number.isInteger(count) && count >= 1 && count < ordered.length) return seededShuffle(ordered, seed).slice(0, count);
  return ordered;
}

// Resumo de uma prova corrigida para mostrar ao aluno. O gabarito (review) só sai se APROVADO; reprovado mostra a nota
// e os TEMAS das questões erradas (sem dizer qual alternativa é a certa).
export function summarizeGraded(graded, questions, passed) {
  const topics = [...new Set(graded.details.filter((d) => !d.is_correct).map((d) => questions.find((q) => q.id === d.question_id)?.topic).filter(Boolean))];
  return {
    correctCount: graded.details.filter((d) => d.is_correct).length, total: graded.details.length,
    wrongTopics: passed ? [] : topics,
    review: passed ? graded.details.map((d) => ({ questionId: d.question_id, correctOptionIds: d.correct.map(String), explanation: d.explanation })) : null
  };
}
