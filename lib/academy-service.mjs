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
  attemptStatus, completeLesson as coreComplete, effectivePassScore, gradeAttempt, lessonState, pickExamQuestions, publicQuestion,
  summarizeGraded, trackProgress
} from "./academy-core.mjs";
import { AcademyError, assertCanWriteOwnProgress } from "./academy-access-core.mjs";
import { certView } from "./academy-certificates.mjs";

export const ACADEMY_DEFAULT_TRACK_SLUG = "formacao-inicial";

const byPosition = (a, b) => a.position - b.position;

// Chave de uma prova na tela: a aula dela (quiz/prova final) ou, na prova de MÓDULO, o próprio id da prova (a prova de módulo
// aparece como uma "aula" virtual no fim do módulo: ganha andar, desbloqueia o próximo módulo e entra no percentual).
export const examKey = (exam) => exam.lesson_id || exam.id;

function buildState({ track, version, enrollment, structure, progress, attempts, nowIso }) {
  const completed = {};
  for (const p of progress) if (p.status === "completed" && p.completed_at) completed[p.lesson_id] = p.completed_at;
  const passedAt = new Map();
  for (const a of attempts) if (a.passed && !passedAt.has(a.exam_id)) passedAt.set(a.exam_id, a.submitted_at || nowIso);
  const finalExamPassed = structure.exams.some((x) => x.kind === "final" && passedAt.has(x.id));
  const modules = [...structure.modules].sort(byPosition);
  const settings = { unlock_mode: "sequential", pass_score: 70, max_attempts: 3, certificate_rule: "all_lessons_and_final_exam", ...(version.settings || {}) };
  const moduleExamLessons = structure.exams.filter((x) => x.kind === "module" && x.module_id).map((x) => {
    const mod = modules.find((m) => m.id === x.module_id);
    if (passedAt.has(x.id)) completed[x.id] = passedAt.get(x.id);
    const maxPos = structure.lessons.filter((l) => l.module_id === x.module_id).reduce((m, l) => Math.max(m, l.position), 0);
    return {
      id: x.id, module_id: x.module_id, position: maxPos + 1, title: `Prova do Módulo ${mod?.position ?? ""}`.trim(), est_minutes: 15, kind: "module_exam", activities: [],
      body: { sample: false, blocks: [{ type: "paragraph", text: `Prova com questões do módulo. Nota mínima: ${effectivePassScore(x, settings)}%${x.max_attempts ? `, até ${x.max_attempts} tentativas` : ""}.` }] }
    };
  });
  return {
    track: { id: track.id, title: track.title },
    startedAt: enrollment?.started_at || enrollment?.created_at || nowIso,
    settings,
    // requires_exam fica falso no núcleo: a prova de módulo já entra como aula virtual (module_exam) que precisa ser concluída
    modules: modules.map((m) => ({ id: m.id, position: m.position, title: m.title, is_final: Boolean(m.is_final), requires_exam: false })),
    lessons: [
      ...structure.lessons.map((l) => ({
        id: l.id, module_id: l.module_id, position: l.position, title: l.title, est_minutes: l.est_minutes, kind: l.kind, body: l.body,
        activities: (structure.activities || []).filter((a) => a.lesson_id === l.id).sort(byPosition).map((a) => ({ id: a.id, kind: a.kind, config: a.config }))
      })),
      ...moduleExamLessons
    ],
    completed,
    passedModuleExams: [],
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
      const key = examKey(x);
      const rows = examRows.filter((r) => r.exam_id === x.id).sort(byPosition);
      const randomPick = x.selection?.mode === "random" && Number(x.selection.count) >= 1 && Number(x.selection.count) < rows.length;
      const multi = x.kind === "module" || rows.length > 1 || randomPick;
      if (!multi && rows[0]) questions[key] = publicQuestion({ id: rows[0].question.id, stem: rows[0].question.statement, options: rows[0].question.options, type: rows[0].question.type });
      const used = byExam.get(x.id) || { used: 0, passed: false };
      const st = attemptStatus({ attemptsUsed: used.used, maxAttempts: effectiveMax(x, grants), passed: used.passed });
      const history = attempts.filter((a) => a.exam_id === x.id).sort((p, q) => q.attempt_number - p.attempt_number).slice(0, 10)
        .map((a) => ({ n: a.attempt_number, score: a.score == null ? null : Number(a.score), passed: Boolean(a.passed), at: a.submitted_at || null }));
      exams[key] = {
        examId: x.id, kind: x.kind, multi, questionCount: randomPick ? Number(x.selection.count) : rows.length,
        passScore: effectivePassScore(x, core.settings), maxAttempts: st.maxAttempts, attemptsUsed: st.attemptsUsed, exhausted: st.exhausted, passed: st.passed, history
      };
    }
    // Certificado real (F5): emitido pelo banco ao concluir. Matrícula concluída sem certificado (concluída antes da F5) é emitida
    // aqui, uma vez, de forma idempotente (só se pode gravar).
    let certificate = enrollment ? await repo.getCertificate(enrollment.id) : null;
    if (enrollment?.status === "completed" && !certificate && !actor.readOnly) {
      try { await repo.issueCertificate({ enrollmentId: enrollment.id, actor: null }); certificate = await repo.getCertificate(enrollment.id); } catch (e) { console.error("academia: emissão de certificado pendente", e?.message || e); }
    }
    // Formações disponíveis (F6): todas as trilhas ativas com versão publicada + a situação do aluno em cada uma.
    let tracks = [];
    if (repo.listPublishedTracks && actor.userId) {
      const [published, mine] = await Promise.all([repo.listPublishedTracks(), repo.listEnrollmentsFor([actor.userId])]);
      const nowMs = Date.parse(now());
      tracks = published.map((t) => {
        const e = mine.find((x) => x.track_id === t.id && ["assigned", "in_progress"].includes(x.status)) || mine.find((x) => x.track_id === t.id && x.status === "completed");
        return {
          slug: t.slug, title: t.title, kind: t.kind, current: t.id === track.id,
          status: e?.status || null, required: Boolean(e?.required), dueAt: e?.due_at || null,
          overdue: Boolean(e?.due_at) && ["assigned", "in_progress"].includes(e.status) && Date.parse(e.due_at) < nowMs
        };
      });
    }
    return {
      status: "ok",
      tracks,
      certificate: certView(certificate),
      readOnly: actor.readOnly, readOnlyReason: actor.reason,
      holderName: actor.name || "",
      enrollment: enrollment ? { id: enrollment.id, status: enrollment.status, required: Boolean(enrollment.required), dueAt: enrollment.due_at || null } : null,
      core, questions, exams
    };
  }

  // Contexto comum de "tentar uma prova": prova, matrícula do PRÓPRIO aluno, estado, limite efetivo e o conjunto de questões
  // desta tentativa (sorteio determinístico). Gabarito fica só neste objeto (servidor).
  async function prepareAttempt(actor, examId) {
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
    const picked = pickExamQuestions(rows, exam.selection, `${enrollment.id}:${exam.id}:${used.used + 1}`);
    const questions = picked.map((r) => ({
      id: r.question.id, type: r.question.type, options: r.question.options, correct: r.question.correct, explanation: r.question.explanation,
      statement: r.question.statement, topic: r.question.topic || null, qversion: r.question.qversion ?? 1, position: r.position, weight: r.weight
    }));
    return { exam, enrollment, core, progress, attempts, used, maxAttempts, questions, passScore: effectivePassScore(exam, core.settings) };
  }

  // Confere que o aluno PODE tentar agora (não esgotou, aula/módulo liberados). Aprovado antes não passa por aqui.
  function assertCanAttemptNow(ctx) {
    const { exam, core, used, maxAttempts } = ctx;
    const st = attemptStatus({ attemptsUsed: used.used, maxAttempts, passed: false });
    if (st.exhausted) throw new AcademyError("attempts_exhausted", 403, { attemptsUsed: st.attemptsUsed, maxAttempts: st.maxAttempts });
    const ls = lessonState(core, examKey(exam));
    if (ls === "done") throw new AcademyError("lesson_already_done", 409);
    if (ls === "locked" || (core.settings.unlock_mode !== "free" && ls !== "now")) throw new AcademyError(exam.module_id ? "module_locked" : "lesson_locked", 409);
  }

  // Questões da PRÓXIMA tentativa (sem gabarito) — usado pelas provas com várias questões. Leitura: também em modo de visualização.
  async function getExamQuestions(actor, examId) {
    if (!actor?.userId) throw new AcademyError("no_profile", 403);
    const ctx = await prepareAttempt(actor, examId);
    if (ctx.used.passed) return { examId, alreadyPassed: true, questions: [], attemptsUsed: ctx.used.used, maxAttempts: ctx.maxAttempts, passScore: ctx.passScore };
    assertCanAttemptNow(ctx);
    return {
      examId, alreadyPassed: false, attemptNumber: ctx.used.used + 1, attemptsUsed: ctx.used.used, maxAttempts: ctx.maxAttempts, passScore: ctx.passScore,
      questions: ctx.questions.map((q) => publicQuestion({ id: q.id, stem: q.statement, options: q.options, type: q.type }))
    };
  }

  // Envia uma tentativa de prova/quiz. Correção 100% aqui, sobre o conjunto sorteado para ESTA tentativa.
  async function submitAttempt(actor, examId, answers) {
    assertCanWriteOwnProgress(actor);
    const ctx = await prepareAttempt(actor, examId);
    const { exam, enrollment, progress, used, maxAttempts, questions, passScore } = ctx;

    // já aprovado antes: mostra o resultado, sem nova tentativa (idempotente)
    if (used.passed) {
      const done = progress.find((p) => p.lesson_id === exam.lesson_id);
      return { alreadyPassed: true, correct: true, feedback: questions[0].explanation || "Resposta correta.", correctOptionIds: questions.length === 1 ? questions[0].correct : null, attemptsUsed: used.used, maxAttempts, exhausted: false, lessonCompleted: false, completedAt: done?.completed_at || null, score: null };
    }
    assertCanAttemptNow(ctx);

    const given = answers && typeof answers === "object" ? answers : {};
    const known = new Set(questions.map((q) => q.id));
    if (!Object.keys(given).length || Object.keys(given).some((k) => !known.has(k))) throw new AcademyError("invalid_answers", 400);

    const graded = gradeAttempt({ questions, answers: given, passScore });
    const summary = summarizeGraded(graded, questions, graded.passed);
    const served = questions.map((q) => ({ question_id: q.id, qversion: q.qversion, position: q.position, statement: q.statement, options: q.options }));
    const rec = await repo.recordAttempt({
      userId: actor.userId, enrollmentId: enrollment.id, examId: exam.id, served,
      answers: graded.details.map(({ question_id, answer, is_correct, points }) => ({ question_id, answer, is_correct, points })),
      score: graded.score, passed: graded.passed
    });
    const after = attemptStatus({ attemptsUsed: rec.attempt_number, maxAttempts: rec.max_attempts ?? maxAttempts, passed: graded.passed });
    const single = questions.length === 1;
    return {
      alreadyPassed: false, correct: graded.passed,
      feedback: graded.passed ? (single ? graded.details[0].explanation || "Resposta correta." : "Aprovado.") : (single ? "Resposta incorreta. Tente novamente." : `Nota ${graded.score}%. Mínimo: ${passScore}%.`),
      // gabarito só depois de aprovado (uma questão: ids; várias: `review` por questão)
      correctOptionIds: graded.passed && single ? questions[0].correct.map(String) : null,
      ...summary, passScore,
      score: graded.score, attemptNumber: rec.attempt_number, attemptsUsed: after.attemptsUsed, maxAttempts: after.maxAttempts, exhausted: after.exhausted,
      lessonCompleted: Boolean(rec.lesson_completed), examPassed: graded.passed, moduleExam: Boolean(exam.module_id),
      completedAt: rec.completed_at || (graded.passed && exam.module_id ? now() : null), enrollmentStatus: rec.enrollment_status
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

  return { loadStudent, getExamQuestions, submitAttempt, completeLessonNoExam };
}
