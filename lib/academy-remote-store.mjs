// Store REAL da Academia (F2) — client-safe (sem server-only, Supabase ou segredo). Mesmo contrato do store de exemplo
// (lib/academy-sample-store.mjs): getSnapshot/subscribe/openLesson/answerQuiz/completeLesson/setReducedMotion, para a
// interface da F1 funcionar sem mudança. A diferença: o progresso vem do servidor (`initial`) e cada resposta é
// enviada à API, que corrige, grava e devolve o resultado. O navegador NUNCA tem o gabarito: só recebe
// `correctOptionIds` depois de aprovado.
//
// snapshot = o mesmo do store de exemplo + { isSample:false, readOnly, notice:{id,text}|null }
// quiz ganha { attemptsUsed, maxAttempts, exhausted } (prova com limite de tentativas).
import { completeLesson as coreComplete } from "./academy-core.mjs";
import { buildViews, deepFreeze } from "./academy-views.mjs";

const ERRORS = {
  read_only_account_switch: "Modo de visualização: nada é gravado.",
  read_only: "Modo de visualização: nada é gravado.",
  no_profile: "Seu perfil não permite gravar progresso.",
  attempts_exhausted: "Você usou todas as tentativas desta prova.",
  lesson_locked: "Esta aula ainda está bloqueada.",
  network: "Sem conexão. Tente de novo."
};

export function createAcademyRemoteStore({ initial, fetchImpl, now = () => new Date().toISOString(), basePath = "/api/admin/academia" }) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  let core = initial.core;
  const questions = initial.questions || {};
  const exams = Object.fromEntries(Object.entries(initial.exams || {}).map(([k, v]) => [k, { ...v }]));
  const readOnly = Boolean(initial.readOnly);
  let ui = { openLessonId: null, answers: {}, lastEvent: null, reducedMotion: false, notice: null, exam: null };
  let inFlight = false;
  let noticeSeq = 0;
  let snapshot;
  const listeners = new Set();

  const opts = {
    publicQuestionFor: (lessonId) => questions[lessonId] || null,
    examInfoFor: (lessonId) => (exams[lessonId] ? { attemptsUsed: exams[lessonId].attemptsUsed, maxAttempts: exams[lessonId].maxAttempts, exhausted: exams[lessonId].exhausted, multi: Boolean(exams[lessonId].multi) } : null),
    holderName: initial.holderName || "",
    // certificado REAL (F5) quando a matrícula concluiu; sem ele a tela mostra o estado "libera ao concluir"
    certificate: initial.certificate || null,
    certificateIsSample: !initial.certificate
  };
  const setExam = (patch) => { ui = { ...ui, exam: patch === null ? null : { ...(ui.exam || {}), ...patch } }; };

  function rebuild() {
    snapshot = deepFreeze({ isSample: false, readOnly, notice: ui.notice, exam: ui.exam, reducedMotion: ui.reducedMotion, openLessonId: ui.openLessonId, ...buildViews(core, ui, now(), opts) });
    listeners.forEach((fn) => fn());
  }
  const notify = (code, fallback) => { ui = { ...ui, notice: { id: ++noticeSeq, text: ERRORS[code] || fallback || "Não foi possível concluir agora." } }; };

  async function post(path, body) {
    let res;
    try {
      res = await doFetch(`${basePath}${path}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    } catch {
      return { ok: false, code: "network" };
    }
    let json = null;
    try { json = await res.json(); } catch { /* corpo vazio */ }
    if (!res.ok) return { ok: false, code: json?.code || "error", message: json?.error, extra: json?.extra || {}, status: res.status };
    return { ok: true, json };
  }

  // Aplica ao estado local uma aula concluída pelo servidor (gera o evento da Conquista).
  function applyCompleted(lessonId, completedAt) {
    const r = coreComplete(core, lessonId, completedAt || now());
    if (r.changed) { core = r.state; return r.event; }
    if (!core.completed[lessonId] && completedAt) core = { ...core, completed: { ...core.completed, [lessonId]: completedAt } };
    return null;
  }

  core = initial.core;
  rebuild();

  return {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    openLesson(lessonId = null) { ui = { ...ui, openLessonId: lessonId, lastEvent: null }; rebuild(); },
    setReducedMotion(value) { ui = { ...ui, reducedMotion: Boolean(value) }; rebuild(); },
    // Em dados reais não há "reiniciar exemplo": nada a fazer (a interface esconde o botão).
    resetExample() { return { ok: false, error: "not_supported" }; },

    async answerQuiz(lessonId, optionIndex) {
      const q = questions[lessonId];
      const ex = exams[lessonId];
      const option = q?.options[optionIndex];
      if (!q || !ex || !option) return { ok: false, error: "invalid_answer" };
      const prev = ui.answers[lessonId];
      if (prev?.status === "correct") return { ok: true, correct: true, changed: false };
      if (readOnly) { notify("read_only"); rebuild(); return { ok: false, error: "read_only" }; }
      if (ex.exhausted) { notify("attempts_exhausted"); rebuild(); return { ok: false, error: "attempts_exhausted" }; }
      if (inFlight) return { ok: false, error: "busy" };
      inFlight = true;
      try {
        const res = await post(`/exams/${ex.examId}/attempts`, { answers: { [q.id]: [option.id] } });
        if (!res.ok) {
          if (res.code === "attempts_exhausted") exams[lessonId] = { ...ex, exhausted: true, attemptsUsed: res.extra.attemptsUsed ?? ex.maxAttempts };
          notify(res.code, res.message);
          rebuild();
          return { ok: false, error: res.code };
        }
        const r = res.json.result;
        exams[lessonId] = { ...ex, attemptsUsed: r.attemptsUsed ?? ex.attemptsUsed, exhausted: Boolean(r.exhausted), passed: Boolean(r.correct) };
        let event = null;
        if (r.correct) event = applyCompleted(lessonId, r.completedAt);
        ui = {
          ...ui, openLessonId: ui.openLessonId || lessonId, lastEvent: event || ui.lastEvent,
          answers: { ...ui.answers, [lessonId]: { selected: option.id, status: r.correct ? "correct" : "incorrect", feedback: r.feedback || "", attempts: (prev?.attempts || 0) + 1, correctOptionIds: r.correct ? r.correctOptionIds || null : null } }
        };
        rebuild();
        return { ok: true, correct: Boolean(r.correct), changed: Boolean(event) };
      } finally {
        inFlight = false;
      }
    },

    // ---- Provas com várias questões (F4) ----
    // Carrega as questões da próxima tentativa (sem gabarito). Em modo de visualização só lê.
    async openExam(key) {
      const ex = exams[key];
      if (!ex?.multi) return { ok: false, error: "not_multi" };
      setExam({ key, examId: ex.examId, status: "loading", questions: [], answers: {}, result: null, error: "", passScore: ex.passScore, maxAttempts: ex.maxAttempts, attemptsUsed: ex.attemptsUsed, history: ex.history || [] });
      rebuild();
      if (ex.passed) { setExam({ status: "passed" }); rebuild(); return { ok: true }; }
      if (ex.exhausted) { setExam({ status: "exhausted" }); rebuild(); return { ok: true }; }
      let res;
      try { res = await doFetch(`${basePath}/exams/${ex.examId}/questions`, { credentials: "same-origin" }); } catch { setExam({ status: "error", error: ERRORS.network }); rebuild(); return { ok: false, error: "network" }; }
      let json = null;
      try { json = await res.json(); } catch { /* vazio */ }
      if (!res.ok) {
        const exhausted = json?.code === "attempts_exhausted";
        if (exhausted) exams[key] = { ...ex, exhausted: true };
        setExam({ status: exhausted ? "exhausted" : "error", error: json?.error || "Não foi possível carregar a prova." });
        rebuild();
        return { ok: false, error: json?.code || "error" };
      }
      const r = json.result;
      if (r.alreadyPassed) { exams[key] = { ...ex, passed: true }; setExam({ status: "passed" }); rebuild(); return { ok: true }; }
      setExam({ status: "ready", questions: r.questions, attemptNumber: r.attemptNumber, maxAttempts: r.maxAttempts, passScore: r.passScore, attemptsUsed: r.attemptsUsed });
      rebuild();
      return { ok: true };
    },
    answerExam(questionId, optionId, multiple) {
      const ex = ui.exam;
      if (!ex || ex.status !== "ready") return;
      const cur = ex.answers[questionId] || [];
      const next = multiple ? (cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId]) : [optionId];
      setExam({ answers: { ...ex.answers, [questionId]: next } });
      rebuild();
    },
    async submitExam() {
      const ex = ui.exam;
      if (!ex || ex.status !== "ready") return { ok: false, error: "not_ready" };
      if (readOnly) { notify("read_only"); rebuild(); return { ok: false, error: "read_only" }; }
      if (inFlight) return { ok: false, error: "busy" };
      inFlight = true;
      setExam({ status: "submitting" }); rebuild();
      try {
        const res = await post(`/exams/${ex.examId}/attempts`, { answers: ex.answers });
        if (!res.ok) {
          if (res.code === "attempts_exhausted") { exams[ex.key] = { ...exams[ex.key], exhausted: true }; setExam({ status: "exhausted" }); } else setExam({ status: "ready" });
          notify(res.code, res.message); rebuild();
          return { ok: false, error: res.code };
        }
        const r = res.json.result;
        exams[ex.key] = { ...exams[ex.key], attemptsUsed: r.attemptsUsed ?? exams[ex.key].attemptsUsed, exhausted: Boolean(r.exhausted), passed: Boolean(r.correct),
          history: [{ n: r.attemptNumber, score: r.score, passed: Boolean(r.correct), at: new Date().toISOString() }, ...(exams[ex.key].history || [])].slice(0, 10) };
        let event = null;
        if (r.correct) {
          event = applyCompleted(ex.key, r.completedAt);
          if (event && r.moduleExam) event = { ...event, exam_score: r.score };
        }
        setExam({ status: "result", result: { score: r.score, passed: Boolean(r.correct), correctCount: r.correctCount, total: r.total, wrongTopics: r.wrongTopics || [], review: r.review || null, exhausted: Boolean(r.exhausted), attemptNumber: r.attemptNumber, maxAttempts: r.maxAttempts, passScore: r.passScore }, attemptsUsed: r.attemptsUsed, history: exams[ex.key].history });
        ui = { ...ui, lastEvent: event || ui.lastEvent };
        rebuild();
        return { ok: true, passed: Boolean(r.correct), changed: Boolean(event) };
      } finally { inFlight = false; }
    },
    closeExam() { setExam(null); rebuild(); },

    // Aula sem prova (nenhuma na Formação Inicial atual; a F3 pode criá-las).
    async completeLesson(lessonId) {
      if (readOnly) { notify("read_only"); rebuild(); return { ok: false, error: "read_only" }; }
      const res = await post(`/lessons/${lessonId}/complete`, {});
      if (!res.ok) { notify(res.code, res.message); rebuild(); return { ok: false, error: res.code }; }
      const event = applyCompleted(lessonId, res.json.result.completedAt);
      ui = { ...ui, lastEvent: event || ui.lastEvent };
      rebuild();
      return { ok: true, changed: Boolean(event) };
    }
  };
}
