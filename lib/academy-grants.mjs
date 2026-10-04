// Liberação manual de +1 tentativa (F3) — regra oficial do dono (2026-10-04, ACA-2): esgotadas as 3 tentativas de uma
// prova, Admin e Gerente podem liberar UMA tentativa adicional, manualmente, para um aluno e uma prova específicos, com
// registro de quem liberou e quando. Nunca automática nem ilimitada: 1 liberação por (matrícula, prova), no banco.
// Gerente só libera para a própria equipe (scope.ids = managedUserIds); Admin para qualquer aluno (scope.admin).
import { AcademyError } from "./academy-access-core.mjs";
import { attemptStatus } from "./academy-core.mjs";

const inScope = (scope, userId) => scope.admin || (scope.ids || []).includes(userId);

export function createAcademyGrants(repo) {
  // Quem esgotou as tentativas e ainda não recebeu a liberação (pending) + liberações já feitas (granted).
  async function list(scope) {
    const enrollments = await repo.listActiveEnrollments(scope.admin ? null : scope.ids || []);
    const ids = enrollments.map((e) => e.id);
    const [attempts, grants] = await Promise.all([repo.listAttemptsFor(ids), repo.listGrantsFor(ids)]);
    const examIds = [...new Set([...attempts.map((a) => a.exam_id), ...grants.map((g) => g.exam_id)])];
    const exams = await repo.listExamsByIds(examIds);
    const examById = new Map(exams.map((x) => [x.id, x]));
    const lessons = await repo.listLessonsByIds([...new Set(exams.map((x) => x.lesson_id).filter(Boolean))]);
    const lessonTitle = new Map(lessons.map((l) => [l.id, l.title]));
    const grantKey = (g) => `${g.enrollment_id}:${g.exam_id}`;
    const granted = new Set(grants.map(grantKey));
    const pending = [];
    for (const e of enrollments) {
      const mine = attempts.filter((a) => a.enrollment_id === e.id);
      for (const examId of new Set(mine.map((a) => a.exam_id))) {
        const x = examById.get(examId);
        if (!x || x.max_attempts == null || granted.has(`${e.id}:${examId}`)) continue;
        const ofExam = mine.filter((a) => a.exam_id === examId);
        const st = attemptStatus({ attemptsUsed: ofExam.length, maxAttempts: x.max_attempts, passed: ofExam.some((a) => a.passed) });
        if (st.exhausted) pending.push({ enrollmentId: e.id, examId, userId: e.user_id, lessonTitle: lessonTitle.get(x.lesson_id) || "Prova", attemptsUsed: st.attemptsUsed, maxAttempts: st.maxAttempts });
      }
    }
    const names = await repo.getAdminNames([...pending.map((p) => p.userId), ...enrollments.filter((e) => grants.some((g) => g.enrollment_id === e.id)).map((e) => e.user_id), ...grants.map((g) => g.granted_by)]);
    const enrollById = new Map(enrollments.map((e) => [e.id, e]));
    return {
      pending: pending.map((p) => ({ ...p, studentName: names[p.userId] || "Aluno" })),
      granted: grants.slice(0, 50).map((g) => ({
        id: g.id, studentName: names[enrollById.get(g.enrollment_id)?.user_id] || "Aluno", lessonTitle: lessonTitle.get(examById.get(g.exam_id)?.lesson_id) || "Prova",
        grantedBy: names[g.granted_by] || g.granted_by_email || null, grantedAt: g.granted_at, reason: g.reason || null
      }))
    };
  }

  // O aluno vem da MATRÍCULA (nunca de um id solto): confere o escopo do gestor antes de chamar o banco.
  async function grant(actor, scope, { enrollmentId, examId, reason }) {
    const enrollment = await repo.getEnrollmentById(enrollmentId);
    if (!enrollment) throw new AcademyError("enrollment_not_found", 404);
    if (!inScope(scope, enrollment.user_id)) throw new AcademyError("out_of_scope", 403);
    const text = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
    const r = await repo.grantExtraAttempt({ enrollmentId, examId, actor, reason: text || null });
    return { grantId: r.grant_id, grantedAt: r.granted_at, maxAttempts: r.max_attempts };
  }

  return { list, grant };
}
