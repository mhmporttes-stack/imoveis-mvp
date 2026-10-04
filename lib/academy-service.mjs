// Serviço da Academia (F2): regras de matrícula, progresso e provas, SEM acesso direto ao banco — recebe um
// `repo` (lib/academy-repo.js em produção; um duplo em memória nos testes). Só roda no servidor: aqui existe o
// gabarito (`correct`). Nada deste módulo é importado por componentes client.
//
// Segurança (regras desta camada):
//  - o aluno é SEMPRE actor.userId (perfil efetivo da sessão); nenhum userId vem de corpo/URL;
//  - o gabarito e a explicação só saem DEPOIS de aprovado (ou se já aprovado antes);
//  - gravação (matrícula, tentativa, conclusão) só com actor.readOnly === false (ACA-10: "Alterar conta" = leitura);
//  - limite de tentativas e nota mínima são aplicados aqui E no banco (trigger + função atômica).
import {
  attemptStatus, completeLesson as coreComplete, effectivePassScore, gradeAttempt, lessonState, moduleProgress, publicQuestion,
  trackProgress, unlockState
} from "./academy-core.mjs";
import { AcademyError, assertCanWriteOwnProgress } from "./academy-access-core.mjs";

export const ACADEMY_DEFAULT_TRACK_SLUG = "formacao-inicial";

const byPosition = (a, b) => a.position - b.position;

function buildState({ track, version, enrollment, structure, progress, attempts, nowIso }) {
  const completed = {};
  for (const p of progress) if (p.status === "completed" && p.completed_at) completed[p.lesson_id] = p.completed_at;
  const passedExam = new Set(attempts.filter((a) => a.passed).map((a) => a.exam_id));
  const passedModuleExams = structure.exams.filter((x) => x.kind === "module" && passedExam.has(x.id)).map((x) => x.module_id);
  const finalExamPassed = structure.exams.some((x) => x.kind === "final" && passedExam.has(x.id));
  const modules = [...structure.modules].sort(byPosition);
  return {
    track: { id: track.id, title: track.title },
    startedAt: enrollment?.started_at || enrollment?.created_at || nowIso,
    settings: { unlock_mode: "sequential", pass_score: 70, max_attempts: 3, certificate_rule: "all_lessons_and_final_exam", ...(version.settings || {}) },
    modules: modules.map((m) => ({ id: m.id, position: m.position, title: m.title, is_final: Boolean(m.is_final), requires_exam: Boolean(m.requires_exam) })),
    lessons: structure.lessons.map((l) => ({
      id: l.id, module_id: l.module_id, position: l.position, title: l.title, est_minutes: l.est_minutes, kind: l.kind, body: l.body,
      activities: (structure.activities || []).filter((a) => a.lesson_id === l.id).sort(byPosition).map((a) => ({ id: a.id, kind: a.kind, config: a.config }))
    })),
    completed,
    passedModuleExams,
    finalExamPassed
  };
}

// Limite efetivo da prova: max_attempts + 1 se Admin/Gerente liberou a tentativa extra para esta matrícula/prova.
const effectiveMax = (exam, grants) => (exam.max_attempts == null ? null : exam.max_attempts + (grants.some((g) => g.exam_id === exam.id) ? 1 : 0));

function attemptsByExam(attempts) {
  const map = new Map();
  for (const a of attempts) {
    const cur = map.get(a.exam_id) || { used: 0, passed: false };
    cur.used += 1;
    cur.passed = cur.passed || Boolean(a.passed);
    map.set(a.exam_id, cur);
  }
  return map;
}

export function createAcademyService(repo, { now = () => new Date().toISOString() } = {}) {
  async function resolveTrack(slug = ACADEMY_DEFAULT_TRACK_SLUG) {
    const track = await repo.getTrackBySlug(slug);
    if (!track || track.status !== "active") return { track: null, version: null };
    return { track, version: await repo.getPublishedVersion(track.id) };
  }

  async function loadEnrollmentState(track, version, enrollment) {
    const structure = await repo.getVersionStructure(version.id);
    const [progress, attempts, grants] = enrollment ? await Promise.all([repo.getProgress(enrollment.id), repo.getAttempts(enrollment.id), repo.getGrants(enrollment.id)]) : [[], [], []];
    return { structure, progress, attempts, grants, core: buildState({ track, version, enrollment, structure, progress, attempts, nowIso: now() }) };
  }

  // Dados iniciais da tela (o que a página entrega ao store do navegador). Sem gabarito.
  async function loadStudent(actor, { slug } = {}) {
    const { track, version } = await resolveTrack(slug);
    if (!track || !version) return { status: "unavailable" };
    let enrollment = actor.userId ? await repo.findEnrollment({ userId: actor.userId, trackId: track.id }) : null;
    if (!enrollment && !actor.readOnly) {
      // primeiro acesso: matrícula própria na versão publicada (idempotente; a versão fica "presa" à matrícula)
      enrollment = await repo.createEnrollment({ userId: actor.userId, trackId: track.id, versionId: version.id, source: "self_start", startedAt: now() });
    }
    // matrícula existente mantém a versão em que começou (nova versão publicada depois não a altera)
    const pinned = enrollment && enrollment.track_version_id !== version.id ? await repo.getVersionById(enrollment.track_version_id) : version;
    const { structure, attempts, grants, core } = await loadEnrollmentState(track, pinned || version, enrollment);
    const examRows = await repo.getExamQuestions(structure.exams.map((x) => x.id));
    const byExam = attemptsByExam(attempts);
    const questions = {};
    const exams = {};
    for (const x of structure.exams) {
      if (!x.lesson_id) continue;
      const rows = examRows.filter((r) => r.exam_id === x.id).sort(byPosition);
      const first = rows[0]?.question;
      if (first) questions[x.lesson_id] = publicQuestion({ id: first.id, stem: first.statement, options: first.options, type: first.type });
      const used = byExam.get(x.id) || { used: 0, passed: false };
      const st = attemptStatus({ attemptsUsed: used.used, maxAttempts: effectiveMax(x, grants), passed: used.passed });
      exams[x.lesson_id] = { examId: x.id, kind: x.kind, passScore: effectivePassScore(x, core.settings), maxAttempts: st.maxAttempts, attemptsUsed: st.attemptsUsed, exhausted: st.exhausted, passed: st.passed };
    }
    return {
      status: "ok",
      readOnly: actor.readOnly, readOnlyReason: actor.reason,
      holderName: actor.name || "",
      enrollment: enrollment ? { id: enrollment.id, status: enrollment.status } : null,
      core, questions, exams
    };
  }

  // Envia uma tentativa de prova/quiz. Correção 100% aqui.
  async function submitAttempt(actor, examId, answers) {
    assertCanWriteOwnProgress(actor);
    const exam = await repo.getExam(examId);
    if (!exam) throw new AcademyError("exam_not_found", 404);
    const enrollment = await repo.findActiveEnrollmentForVersion({ userId: actor.userId, versionId: exam.track_version_id });
    if (!enrollment) throw new AcademyError("enrollment_not_found", 404);
    const version = await repo.getVersionById(exam.track_version_id);
    const track = await repo.getTrackById(version.track_id);
    const { progress, attempts, grants, core } = await loadEnrollmentState(track, version, enrollment);
    const maxAttempts = effectiveMax(exam, grants);

    const used = attemptsByExam(attempts).get(exam.id) || { used: 0, passed: false };
    const rows = (await repo.getExamQuestions([exam.id])).filter((r) => r.exam_id === exam.id).sort(byPosition);
    if (!rows.length) throw new AcademyError("exam_without_questions", 409);
    const questions = rows.map((r) => ({ id: r.question.id, type: r.question.type, options: r.question.options, correct: r.question.correct, explanation: r.question.explanation, weight: r.weight }));

    // já aprovado antes: mostra o resultado, sem nova tentativa (idempotente)
    if (used.passed) {
      const done = progress.find((p) => p.lesson_id === exam.lesson_id);
      return { alreadyPassed: true, correct: true, feedback: questions[0].explanation || "Resposta correta.", correctOptionIds: questions.length === 1 ? questions[0].correct : null, attemptsUsed: used.used, maxAttempts, exhausted: false, lessonCompleted: false, completedAt: done?.completed_at || null, score: null };
    }
    const st = attemptStatus({ attemptsUsed: used.used, maxAttempts, passed: false });
    if (st.exhausted) throw new AcademyError("attempts_exhausted", 403, { attemptsUsed: st.attemptsUsed, maxAttempts: st.maxAttempts });

    // liberação: a aula precisa estar liberada (sequência) — quem tenta fora de ordem é recusado
    if (exam.lesson_id) {
      const ls = lessonState(core, exam.lesson_id);
      if (ls === "done") throw new AcademyError("lesson_already_done", 409);
      if (ls === "locked" || (core.settings.unlock_mode !== "free" && ls !== "now")) throw new AcademyError("lesson_locked", 409);
    } else if (exam.module_id) {
      if (!unlockState(core, exam.module_id).unlocked) throw new AcademyError("module_locked", 409);
      const mp = moduleProgress({ ...core, passedModuleExams: [] }, exam.module_id);
      if (mp.done < mp.total) throw new AcademyError("lessons_pending", 409);
    }

    const given = answers && typeof answers === "object" ? answers : {};
    const known = new Set(questions.map((q) => q.id));
    if (!Object.keys(given).length || Object.keys(given).some((k) => !known.has(k))) throw new AcademyError("invalid_answers", 400);

    const graded = gradeAttempt({ questions, answers: given, passScore: effectivePassScore(exam, core.settings) });
    const served = rows.map((r) => ({ question_id: r.question.id, qversion: r.question.qversion ?? 1, position: r.position, statement: r.question.statement, options: r.question.options }));
    const rec = await repo.recordAttempt({
      userId: actor.userId, enrollmentId: enrollment.id, examId: exam.id, served,
      answers: graded.details.map(({ question_id, answer, is_correct, points }) => ({ question_id, answer, is_correct, points })),
      score: graded.score, passed: graded.passed
    });
    const after = attemptStatus({ attemptsUsed: rec.attempt_number, maxAttempts: rec.max_attempts ?? maxAttempts, passed: graded.passed });
    return {
      alreadyPassed: false, correct: graded.passed,
      feedback: graded.passed ? graded.details.length === 1 ? graded.details[0].explanation || "Resposta correta." : "Aprovado." : "Resposta incorreta. Tente novamente.",
      // gabarito só depois de aprovado
      correctOptionIds: graded.passed && questions.length === 1 ? questions[0].correct.map(String) : null,
      score: graded.score, attemptNumber: rec.attempt_number, attemptsUsed: after.attemptsUsed, maxAttempts: after.maxAttempts, exhausted: after.exhausted,
      lessonCompleted: Boolean(rec.lesson_completed), completedAt: rec.completed_at || null, enrollmentStatus: rec.enrollment_status
    };
  }

  // Concluir uma aula SEM prova (aula com prova só conclui aprovada). Idempotente.
  async function completeLessonNoExam(actor, lessonId, { seconds = 0 } = {}) {
    assertCanWriteOwnProgress(actor);
    const lesson = await repo.getLesson(lessonId);
    if (!lesson) throw new AcademyError("lesson_not_found", 404);
    const enrollment = await repo.findActiveEnrollmentForVersion({ userId: actor.userId, versionId: lesson.track_version_id });
    if (!enrollment) throw new AcademyError("enrollment_not_found", 404);
    const version = await repo.getVersionById(lesson.track_version_id);
    const track = await repo.getTrackById(version.track_id);
    const { core } = await loadEnrollmentState(track, version, enrollment);
    const local = coreComplete(core, lessonId, now());
    if (local.error === "lesson_locked") throw new AcademyError("lesson_locked", 409);
    if (local.error) throw new AcademyError(local.error, 404);
    const rec = await repo.completeLesson({ userId: actor.userId, enrollmentId: enrollment.id, lessonId, seconds });
    const p = trackProgress(local.state);
    return { lessonCompleted: Boolean(rec.lesson_completed), completedAt: rec.completed_at || null, enrollmentStatus: rec.enrollment_status, percent: p.percent };
  }

  return { loadStudent, submitAttempt, completeLessonNoExam };
}
