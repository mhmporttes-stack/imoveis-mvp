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
  let ui = { openLessonId: null, answers: {}, lastEvent: null, reducedMotion: false, notice: null };
  let inFlight = false;
  let noticeSeq = 0;
  let snapshot;
  const listeners = new Set();

  const opts = {
    publicQuestionFor: (lessonId) => questions[lessonId] || null,
    examInfoFor: (lessonId) => (exams[lessonId] ? { attemptsUsed: exams[lessonId].attemptsUsed, maxAttempts: exams[lessonId].maxAttempts, exhausted: exams[lessonId].exhausted } : null),
    holderName: initial.holderName || "",
    certificateIsSample: true
  };

  function rebuild() {
    snapshot = deepFreeze({ isSample: false, readOnly, notice: ui.notice, reducedMotion: ui.reducedMotion, openLessonId: ui.openLessonId, ...buildViews(core, ui, now(), opts) });
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
