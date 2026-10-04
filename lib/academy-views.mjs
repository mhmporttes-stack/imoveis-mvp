// Visões da Academia (puro, client-safe): transforma o estado normalizado (academy-core) + o estado de interface
// no snapshot que os componentes consomem. Usado pelo store de exemplo (F1) e pelo store real (F2): a interface
// é a mesma; só muda de onde vêm as questões públicas, o nome do aluno e as marcas de "exemplo".
import {
  certificateEligibility, currentLesson, lessonState, moduleProgress,
  nextLesson, orderedLessons, orderedModules, trackProgress, unlockState
} from "./academy-core.mjs";

export const VIEW_STATE = { now: "current", done: "done", next: "next", locked: "locked" };
const WEEK_MS = 7 * 24 * 3600 * 1000;

export function deepFreeze(o) {
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

// opts: { publicQuestionFor(lessonId) -> {id,stem,options,multiple}|null, examInfoFor?(lessonId) -> {attemptsUsed,maxAttempts,exhausted}|null,
//         holderName, certificateIsSample }
export function buildViews(core, ui, nowIso, opts = {}) {
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
    ? { ...lessonView(openL), moduleN: openMod.position, moduleTitle: openMod.title, content: openL.body?.blocks?.[0]?.text || "Texto de exemplo.", blocks: openL.body?.blocks || [], activities: openL.activities || [], hasQuiz: Boolean(opts.publicQuestionFor(openL.id)), isSample: openL.body?.sample !== false }
    : null;

  const q = openL ? opts.publicQuestionFor(openL.id) : null;
  const a = openL ? ui.answers[openL.id] : null;
  const info = openL && opts.examInfoFor ? opts.examInfoFor(openL.id) : null;
  const exhausted = Boolean(info?.exhausted) && a?.status !== "correct";
  const quiz = q
    ? {
        lessonId: openL.id, question: q, selectedOptionId: a?.selected ?? null, status: a?.status || "unanswered",
        feedback: a?.feedback || "", attempts: a?.attempts || 0, correctOptionIds: a?.status === "correct" ? a.correctOptionIds : null,
        ...(info ? { attemptsUsed: info.attemptsUsed, maxAttempts: info.maxAttempts, exhausted } : {})
      }
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
    holderName: elig.eligible ? (opts.holderName ?? null) : null, trackTitle: elig.eligible ? core.track.title : null,
    completedAt: finishedAt, isSample: opts.certificateIsSample !== false
  };

  return { home, trail, evolution, lesson, quiz, achievement, certificate };
}
