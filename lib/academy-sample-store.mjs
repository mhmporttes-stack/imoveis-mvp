// Store em memória da Academia (F1) — client-safe: sem server-only, Supabase, fetch ou localStorage.
// Compatível com React `useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)`.
// DADO DE EXEMPLO: a F2 troca a fonte por banco/API mantendo este formato de snapshot.
//
// CONTRATO
//   const store = createAcademyDemoStore({ now?: () => ISOstring })
//   store.getSnapshot()  -> objeto IMUTÁVEL (congelado), mesma referência até mudar algo
//   store.subscribe(fn)  -> unsubscribe
//   ações: completeLesson(lessonId) · answerQuiz(lessonId, optionIndex) · openLesson(lessonId|null)
//          resetExample() · setReducedMotion(bool)
// snapshot = { isSample:true, reducedMotion, openLessonId,
//   home:{ track, percent, done, total, floorsLit, floorsTotal, module:{n,title,lessonsDone,lessonsTotal}|null,
//          lesson:{id,title,minutes,state:"current",index,of,label}|null,
//          nextAction:{kind:"continue_lesson"|"get_certificate"|"none", lessonId, label} },
//   trail:{ modules:[{n,id,title,state:"done|inProgress|next|locked",lessonsTotal,lessonsDone,lockHint,collapsed,
//             lessons:[{id,order,title,minutes,state:"done|current|next|locked"}]}],
//           current, next:{moduleN,title,lessonsTotal,lockHint}|null, certification:{state:"locked|available",hint} },
//   evolution:{ weeks:[{week,startedAt,done,percent}], today:{done,percent}, milestones:[{moduleN,title,state,completedAt,week}],
//               floors:{lit,total} },
//   lesson:{ id,title,moduleN,moduleTitle,index,of,label,minutes,state,content,isSample:true },
//   quiz:{ lessonId, question:{id,stem,options:[{id,text}],multiple}, selectedOptionId, status:"unanswered|incorrect|correct",
//          feedback, attempts, correctOptionIds }   // correctOptionIds = null até acertar (gabarito nunca antes)
//   achievement:{ available, before, after, text, floorsBefore, floorsAfter, newFloor, lessonTitle,
//                 moduleCompleted:{n,title}|null, nextModule:{n,title}|null },
//   certificate:{ eligible, state:"locked|available", reasons, percent, holderName, trackTitle, completedAt, isSample:true } }
import { completeLesson as coreComplete, gradeQuestion, publicQuestion } from "./academy-core.mjs";
import { SAMPLE_QUESTIONS, SAMPLE_USER, buildInitialCoreState } from "./academy-sample.mjs";
import { buildViews as buildViewsCore, deepFreeze } from "./academy-views.mjs";

const SAMPLE_OPTS = {
  publicQuestionFor: (lessonId) => (SAMPLE_QUESTIONS[lessonId] ? publicQuestion(SAMPLE_QUESTIONS[lessonId]) : null),
  holderName: SAMPLE_USER.name,
  certificateIsSample: true
};

export function createAcademyDemoStore({ now = () => new Date().toISOString() } = {}) {
  let core;
  let ui;
  let snapshot;
  const listeners = new Set();

  const freshUi = () => ({ openLessonId: null, answers: {}, lastEvent: null, reducedMotion: ui ? ui.reducedMotion : false });

  function rebuild() {
    snapshot = deepFreeze({ isSample: true, reducedMotion: ui.reducedMotion, openLessonId: ui.openLessonId, ...buildViewsCore(core, ui, now(), SAMPLE_OPTS) });
    listeners.forEach((fn) => fn());
  }

  core = buildInitialCoreState();
  ui = freshUi();
  rebuild();

  return {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    completeLesson(lessonId) {
      const r = coreComplete(core, lessonId, now());
      if (r.changed) { core = r.state; ui = { ...ui, lastEvent: r.event }; rebuild(); }
      return r;
    },
    openLesson(lessonId = null) { ui = { ...ui, openLessonId: lessonId, lastEvent: null }; rebuild(); },
    // Acertar conclui a aula (e gera o evento da Conquista); errar permite tentar de novo.
    answerQuiz(lessonId, optionIndex) {
      const q = SAMPLE_QUESTIONS[lessonId];
      const option = q?.options[optionIndex];
      if (!q || !option) return { ok: false, error: "invalid_answer" };
      const prev = ui.answers[lessonId];
      if (prev?.status === "correct") return { ok: true, correct: true, changed: false };
      const result = gradeQuestion(q, option.id);
      let event = null;
      if (result.correct) {
        const r = coreComplete(core, lessonId, now());
        if (r.error) return { ok: false, error: r.error };
        if (r.changed) { core = r.state; event = r.event; }
      }
      ui = {
        ...ui, openLessonId: ui.openLessonId || lessonId, lastEvent: event || ui.lastEvent,
        answers: { ...ui.answers, [lessonId]: { selected: option.id, status: result.correct ? "correct" : "incorrect", feedback: result.feedback, attempts: (prev?.attempts || 0) + 1, correctOptionIds: result.correctOptionIds } }
      };
      rebuild();
      return { ok: true, correct: result.correct, changed: Boolean(event) };
    },
    resetExample() { core = buildInitialCoreState(); ui = freshUi(); rebuild(); },
    setReducedMotion(value) { ui = { ...ui, reducedMotion: Boolean(value) }; rebuild(); }
  };
}
