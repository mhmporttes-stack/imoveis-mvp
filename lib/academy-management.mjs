// Gestão de equipe, atribuição e acompanhamento (F6). Recebe `repo` (lib/academy-content-repo.mjs + academy-repo.mjs).
// Escopo (regra do plano, igual a lib/admin-profiles.js resolveTeamVisibilityScope): Admin vê e atribui para todos;
// Gerente só para a própria equipe (managedUserIds, inclui associados dos corretores); nunca para fora dela.
// Atrasado = tem prazo (due_at) vencido e a matrícula ainda não concluiu. NENHUMA notificação é disparada aqui (F7: só preparar).
import { AcademyError } from "./academy-access-core.mjs";
import { cleanTitle } from "./academy-content-core.mjs";

const inScope = (scope, userId) => scope.admin || (scope.ids || []).includes(userId);
const LIVE = new Set(["assigned", "in_progress"]);

export function summarizeEnrollment(e, { totals, progress, attempts, cert, nowMs }) {
  // percentual da gestão = aulas concluídas / aulas da versão (a prova final é uma aula; prova de módulo não conta aqui)
  const total = totals?.lessons || 0;
  const lessonsDone = Math.min(progress.length, total || progress.length);
  const percent = total ? Math.round((lessonsDone / total) * 100) : 0;
  const last = [e.started_at, e.created_at, ...progress.map((p) => p.completed_at), ...attempts.map((a) => a.submitted_at)].filter(Boolean).sort().at(-1) || null;
  const overdue = Boolean(e.due_at) && LIVE.has(e.status) && Date.parse(e.due_at) < nowMs;
  return {
    enrollmentId: e.id, trackId: e.track_id, status: e.status, source: e.source, required: Boolean(e.required), dueAt: e.due_at || null, overdue,
    startedAt: e.started_at || null, completedAt: e.completed_at || null, lastActivityAt: last, percent: e.status === "completed" ? 100 : Math.min(percent, 99),
    lessonsDone, lessonsTotal: total, attemptsCount: attempts.length, failedAttempts: attempts.filter((a) => a.passed === false).length,
    certificate: cert ? { id: cert.id, code: cert.code, revoked: Boolean(cert.revoked_at) } : null
  };
}

export function createAcademyManagement(repo, { now = () => new Date().toISOString() } = {}) {
  async function loadTeam(scope, { trackId } = {}) {
    const users = (await repo.listUsers(scope.admin ? null : scope.ids || [])).filter((u) => u.status !== "inactive");
    const userIds = users.map((u) => u.id);
    const enrollments = await repo.listEnrollmentsFor(scope.admin ? null : userIds, { trackId });
    const ids = enrollments.map((e) => e.id);
    const [progress, attempts, certs, totals, tracks] = await Promise.all([
      repo.listProgressFor(ids), repo.listAttemptsDetailed(ids), repo.listCertificatesFor(ids),
      repo.listVersionTotals([...new Set(enrollments.map((e) => e.track_version_id))]), repo.listTracks()
    ]);
    const trackTitle = new Map(tracks.map((t) => [t.id, t.title]));
    const nowMs = Date.parse(now());
    const rowsOf = (u) => enrollments.filter((e) => e.user_id === u.id).map((e) => ({
      ...summarizeEnrollment(e, {
        totals: totals[e.track_version_id], progress: progress.filter((p) => p.enrollment_id === e.id), attempts: attempts.filter((a) => a.enrollment_id === e.id),
        cert: certs.filter((c) => c.enrollment_id === e.id).sort((a, b) => (a.revoked_at ? 1 : 0) - (b.revoked_at ? 1 : 0))[0], nowMs
      }),
      trackTitle: trackTitle.get(e.track_id) || "Trilha"
    }));
    const members = users.map((u) => ({ userId: u.id, name: u.name || u.email, email: u.email, role: u.role, enrollments: rowsOf(u) }));
    return { members, tracks: tracks.map((t) => ({ id: t.id, slug: t.slug, title: t.title, kind: t.kind, status: t.status })) };
  }

  // Lista da equipe com filtros. status: "overdue" | "completed" | "in_progress" | "not_started" | "all"
  async function listTeam(scope, { trackId, status = "all", q } = {}) {
    const { members, tracks } = await loadTeam(scope, { trackId });
    const text = String(q || "").trim().toLowerCase();
    const keep = members.filter((m) => {
      if (text && !`${m.name} ${m.email}`.toLowerCase().includes(text)) return false;
      const es = m.enrollments;
      if (status === "overdue") return es.some((e) => e.overdue);
      if (status === "completed") return es.some((e) => e.status === "completed");
      if (status === "in_progress") return es.some((e) => LIVE.has(e.status));
      if (status === "not_started") return es.length === 0;
      return true;
    });
    const all = members.flatMap((m) => m.enrollments);
    return {
      members: keep, tracks,
      summary: { people: members.length, withEnrollment: members.filter((m) => m.enrollments.length).length, completed: all.filter((e) => e.status === "completed").length, overdue: all.filter((e) => e.overdue).length, inProgress: all.filter((e) => LIVE.has(e.status)).length }
    };
  }

  // Detalhe de um aluno (histórico de tentativas por prova). Fora do escopo = 404.
  async function getStudent(scope, userId) {
    if (!inScope(scope, userId)) throw new AcademyError("student_not_found", 404);
    const { members } = await loadTeam({ admin: false, ids: [userId] });
    const member = members.find((m) => m.userId === userId);
    if (!member) throw new AcademyError("student_not_found", 404);
    const ids = member.enrollments.map((e) => e.enrollmentId);
    const attempts = await repo.listAttemptsDetailed(ids);
    const exams = await repo.listExamsByIds([...new Set(attempts.map((a) => a.exam_id))]);
    const lessons = await repo.listLessonsByIds([...new Set(exams.map((x) => x.lesson_id).filter(Boolean))]);
    const title = new Map(lessons.map((l) => [l.id, l.title]));
    const examTitle = (id) => { const x = exams.find((e) => e.id === id); return x?.lesson_id ? title.get(x.lesson_id) || "Prova" : "Prova do módulo"; };
    return {
      ...member,
      attempts: attempts.sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))).slice(0, 100).map((a) => ({
        enrollmentId: a.enrollment_id, exam: examTitle(a.exam_id), examId: a.exam_id, number: a.attempt_number, score: a.score == null ? null : Number(a.score), passed: Boolean(a.passed), at: a.submitted_at
      }))
    };
  }

  // Atribuir uma trilha a pessoas. Gerente: só equipe (qualquer um fora dela é recusado SEM criar nada). Sem trilha publicada: erro.
  async function assign(actor, scope, { userIds, trackId, required = false, dueAt = null }) {
    if (!Array.isArray(userIds) || !userIds.length || userIds.length > 200) throw new AcademyError("invalid_assignment", 400);
    const unique = [...new Set(userIds)];
    if (unique.some((id) => !inScope(scope, id))) throw new AcademyError("out_of_scope", 403);
    const due = dueAt ? new Date(dueAt) : null;
    if (due && (Number.isNaN(due.getTime()) || due.getTime() < Date.parse(now()) - 24 * 3600 * 1000)) throw new AcademyError("invalid_due_date", 400);
    const track = (await repo.listTracks()).find((t) => t.id === trackId);
    if (!track || track.status !== "active") throw new AcademyError("track_not_found", 404);
    const version = await repo.getPublishedVersion(trackId);
    if (!version) throw new AcademyError("track_not_published", 409);
    const users = await repo.listUsers(unique);
    const active = new Set(users.filter((u) => u.status !== "inactive").map((u) => u.id));
    const created = []; const skipped = [];
    for (const userId of unique) {
      if (!active.has(userId)) { skipped.push({ userId, reason: "inactive" }); continue; }
      try {
        const e = await repo.insertEnrollment({ user_id: userId, track_id: trackId, track_version_id: version.id, source: "manual", required: Boolean(required), due_at: due ? due.toISOString() : null, status: "assigned", assigned_by: actor.userId });
        await repo.logEvent({ actor_user_id: actor.userId, real_actor_email: actor.email || null, user_id: userId, action: "enrollment_assigned", ref: e.id, meta: { track_id: trackId, required: Boolean(required), due_at: due ? due.toISOString() : null } });
        created.push(userId);
      } catch (err) {
        if (err instanceof AcademyError && err.code === "already_enrolled") skipped.push({ userId, reason: "already_enrolled" }); else throw err;
      }
    }
    return { created, skipped };
  }

  async function setDue(actor, scope, { enrollmentId, dueAt }) {
    const e = await repo.getEnrollmentFull(enrollmentId);
    if (!e || !inScope(scope, e.user_id)) throw new AcademyError("enrollment_not_found", 404);
    if (!LIVE.has(e.status)) throw new AcademyError("enrollment_not_active", 409);
    const due = dueAt ? new Date(dueAt) : null;
    if (dueAt && Number.isNaN(due.getTime())) throw new AcademyError("invalid_due_date", 400);
    await repo.updateEnrollment(enrollmentId, { due_at: due ? due.toISOString() : null, updated_at: now() });
    await repo.logEvent({ actor_user_id: actor.userId, real_actor_email: actor.email || null, user_id: e.user_id, action: "due_date_changed", ref: e.id, meta: { due_at: due ? due.toISOString() : null } });
    return { ok: true };
  }

  // Nova trilha (Admin e Gerente, ACA-1): cria a trilha em rascunho e um rascunho vazio da versão 1. Só aparece para alunos ao publicar.
  async function createTrack(actor, { title, kind = "aperfeicoamento" }) {
    const KINDS = ["formacao_inicial", "aperfeicoamento", "especializacao", "reciclagem", "atualizacao"];
    if (!KINDS.includes(kind)) throw new AcademyError("invalid_track", 400);
    const clean = cleanTitle(title);
    const base = clean.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "trilha";
    let slug = base; let n = 1;
    while (await repo.slugExists(slug)) { n += 1; slug = `${base}-${n}`; }
    const track = await repo.insertTrack({ slug, title: clean, kind, status: "draft", is_mandatory_default: false });
    const versionId = await repo.createDraft({ trackId: track.id, fromVersionId: null, actor, note: "Versão inicial" });
    return { trackId: track.id, slug, versionId };
  }

  return { listTeam, getStudent, assign, setDue, createTrack };
}
