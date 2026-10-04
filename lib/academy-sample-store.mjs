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
import {
  certificateEligibility, completeLesson as coreComplete, currentLesson, gradeQuestion, lessonState, moduleProgress,
  nextLesson, orderedLessons, orderedModules, publicQuestion, trackProgress, unlockState
} from "./academy-core.mjs";
import { SAMPLE_QUESTIONS, SAMPLE_USER, buildInitialCoreState } from "./academy-sample.mjs";

const VIEW_STATE = { now: "current", done: "done", next: "next", locked: "locked" };
const WEEK_MS = 7 * 24 * 3600 * 1000;

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

function moduleState(core, mod, currentModuleId) {
  if (moduleProgress(core, mod.id).complete) return "done";
  if (unlockState(core, mod.id).unlocked) return "inProgress";
  const mods = orderedModules(core);
  const i = mods.findIndex((m) => m.id === mod.id);
  return currentModuleId && mods[i - 1]?.id === currentModuleId ? "next" : "locked";
}

function lockHint(core, mod) {
  const u = unlockState(core, mod.id);
  if (u.unlocked) return null;
  const prev = core.modules.find((m) => m.id === u.previousModuleId);
  const n = prev?.position;
  return u.reason === "previous_exam" ? `libera ao ser aprovado na prova do Módulo ${n}` : `libera ao concluir o Módulo ${n}`;
}

function weekOf(core, iso) {
  return Math.floor((Date.parse(iso) - Date.parse(core.startedAt)) / WEEK_MS) + 1;
}

function buildViews(core, ui, nowIso) {
  const lessons = orderedLessons(core);
  const mods = orderedModules(core);
  const prog = trackProgress(core);
  const cur = currentLesson(core);
  const curMod = cur ? mods.find((m) => m.id === cur.module_id) : null;
  const inMod = (l) => lessons.filter((x) => x.module_id === l.module_id);
  const lessonView = (l) => {
    const list = inMod(l);
    const index = list.findIndex((x) => x.id === l.id) + 1;
    return { id: l.id, title: l.title, minutes: l.est_minutes, state: VIEW_STATE[lessonState(core, l.id)], index, of: list.length, label: `Aula ${index} de ${list.length}` };
  };
  const elig = certificateEligibility(core);

  const home = {
    track: core.track, percent: prog.percent, done: prog.done, total: prog.total,
    floorsLit: prog.done, floorsTotal: prog.total,
    module: curMod ? { n: curMod.position, title: curMod.title, lessonsDone: moduleProgress(core, curMod.id).done, lessonsTotal: moduleProgress(core, curMod.id).total } : null,
    lesson: cur ? lessonView(cur) : null,
    nextAction: cur
      ? { kind: "continue_lesson", lessonId: cur.id, label: "Continuar" }
      : elig.eligible ? { kind: "get_certificate", lessonId: null, label: "Ver certificado" } : { kind: "none", lessonId: null, label: "" }
  };

  const modulesView = mods.map((m) => {
    const p = moduleProgress(core, m.id);
    const state = moduleState(core, m, curMod?.id);
    return {
      n: m.position, id: m.id, title: m.title, state, lessonsTotal: p.total, lessonsDone: p.done,
      lockHint: lockHint(core, m), collapsed: state === "done",
      lessons: lessons.filter((l) => l.module_id === m.id).map((l) => ({ id: l.id, order: l.position, title: l.title, minutes: l.est_minutes, state: VIEW_STATE[lessonState(core, l.id)] }))
    };
  });
  const nextMod = modulesView.find((m) => m.state === "next") || null;
  const trail = {
    modules: modulesView,
    current: home.lesson,
    next: nextMod ? { moduleN: nextMod.n, title: nextMod.title, lessonsTotal: nextMod.lessonsTotal, lockHint: nextMod.lockHint } : null,
    certification: { state: elig.eligible ? "available" : "locked", hint: "ao concluir 100% das aulas e a prova final" }
  };

  // Evolução: série semanal DERIVADA das datas de conclusão (sem números inventados).
  const doneDates = Object.values(core.completed).sort();
  const lastWeek = Math.max(weekOf(core, nowIso), doneDates.length ? weekOf(core, doneDates[doneDates.length - 1]) : 1);
  const weeks = [];
  for (let w = 1; w <= lastWeek; w++) {
    const done = doneDates.filter((d) => weekOf(core, d) <= w).length;
    weeks.push({ week: w, startedAt: new Date(Date.parse(core.startedAt) + (w - 1) * WEEK_MS).toISOString(), done, percent: prog.total ? Math.round((done / prog.total) * 100) : 0 });
  }
  const milestones = modulesView.map((m) => {
    const dates = lessons.filter((l) => l.module_id === m.id).map((l) => core.completed[l.id]).filter(Boolean).sort();
    const completedAt = m.state === "done" ? dates[dates.length - 1] : null;
    return { moduleN: m.n, title: m.title, state: m.state, completedAt, week: completedAt ? weekOf(core, completedAt) : null };
  });
  const evolution = { weeks, today: { done: prog.done, percent: prog.percent }, milestones, floors: { lit: prog.done, total: prog.total } };

  const openId = ui.openLessonId || cur?.id || null;
  const openL = lessons.find((l) => l.id === openId) || null;
  const openMod = openL ? mods.find((m) => m.id === openL.module_id) : null;
  const lesson = openL
    ? { ...lessonView(openL), moduleN: openMod.position, moduleTitle: openMod.title, content: openL.body?.blocks?.[0]?.text || "Texto de exemplo.", isSample: true }
    : null;

  const q = openL ? SAMPLE_QUESTIONS[openL.id] : null;
  const a = openL ? ui.answers[openL.id] : null;
  const quiz = q
    ? { lessonId: openL.id, question: publicQuestion(q), selectedOptionId: a?.selected ?? null, status: a?.status || "unanswered", feedback: a?.feedback || "", attempts: a?.attempts || 0, correctOptionIds: a?.status === "correct" ? a.correctOptionIds : null }
    : null;

  let achievement = { available: false };
  const ev = ui.lastEvent;
  if (ev) {
    const doneMod = ev.module_completed ? mods.find((m) => m.id === ev.module_completed) : null;
    const nextM = doneMod ? mods[mods.indexOf(doneMod) + 1] : null;
    achievement = {
      available: true, before: ev.progress_before, after: ev.progress_after,
      text: `Você foi de ${ev.progress_before}% para ${ev.progress_after}%.`,
      floorsBefore: ev.done_before, floorsAfter: ev.done_after, newFloor: ev.done_after,
      lessonTitle: lessons.find((l) => l.id === ev.lesson_id)?.title || "",
      moduleCompleted: doneMod ? { n: doneMod.position, title: doneMod.title } : null,
      nextModule: nextM ? { n: nextM.position, title: nextM.title } : null
    };
  }

  const finishedAt = elig.eligible ? doneDates[doneDates.length - 1] : null;
  const certificate = {
    eligible: elig.eligible, state: elig.eligible ? "available" : "locked", reasons: elig.reasons, percent: prog.percent,
    holderName: elig.eligible ? SAMPLE_USER.name : null, trackTitle: elig.eligible ? core.track.title : null,
    completedAt: finishedAt, isSample: true
  };

  return { home, trail, evolution, lesson, quiz, achievement, certificate };
}

export function createAcademyDemoStore({ now = () => new Date().toISOString() } = {}) {
  let core;
  let ui;
  let snapshot;
  const listeners = new Set();

  const freshUi = () => ({ openLessonId: null, answers: {}, lastEvent: null, reducedMotion: ui ? ui.reducedMotion : false });

  function rebuild() {
    snapshot = deepFreeze({ isSample: true, reducedMotion: ui.reducedMotion, openLessonId: ui.openLessonId, ...buildViews(core, ui, now()) });
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
