// Acesso ao Supabase da Academia (F2). Recebe o client (service role, só no servidor) por parâmetro: assim o
// módulo roda no `node --test` com um client falso, e quem o instancia (lib/academy-server.js) é server-only.
// Nenhuma regra de negócio aqui: só consultas e as duas funções atômicas do banco (academy_record_attempt,
// academy_complete_lesson). Toda consulta de dado do aluno filtra por user_id/enrollment_id vindos do servidor.
import { AcademyError } from "./academy-access-core.mjs";

const ACTIVE = ["assigned", "in_progress"];
const LIVE = ["assigned", "in_progress", "completed"];

// Mensagens levantadas pelas funções SQL/triggers -> erro de negócio (código, status HTTP)
const DB_ERRORS = [
  ["attempts_exhausted", "attempts_exhausted", 403], ["already_passed", "already_passed", 409],
  ["enrollment_not_found", "enrollment_not_found", 404], ["enrollment_not_active", "enrollment_not_active", 409],
  ["exam_not_in_enrollment", "exam_not_in_enrollment", 404], ["lesson_not_in_enrollment", "lesson_not_in_enrollment", 404],
  ["exam_required", "exam_required", 409], ["exam_without_limit", "exam_without_limit", 409],
  ["attempts_not_exhausted", "attempts_not_exhausted", 409], ["grant_already_given", "grant_already_given", 409],
  ["academy_published_content_is_immutable", "version_not_editable", 409], ["academy_published_version_is_immutable", "version_not_editable", 409],
  ["draft_exists", "draft_exists", 409], ["not_a_draft", "not_a_draft", 409], ["version_not_found", "version_not_found", 404],
  ["track_not_found", "track_not_found", 404], ["version_not_in_track", "version_not_in_track", 400],
  ["certificate_not_found", "certificate_not_found", 404], ["already_revoked", "already_revoked", 409], ["reason_required", "reason_required", 400],
  ["enrollment_not_completed", "enrollment_not_completed", 409], ["publish_invalid_empty", "publish_blocked", 409], ["publish_invalid_module_without_lessons", "publish_blocked", 409],
  ["publish_invalid_final_without_exam", "publish_blocked", 409], ["publish_invalid_module_exam_missing", "publish_blocked", 409], ["publish_invalid_exam_without_question", "publish_blocked", 409]
];

export function dbError(error) {
  const msg = String(error?.message || "");
  const hit = DB_ERRORS.find(([m]) => msg.includes(m));
  if (hit) return new AcademyError(hit[1], hit[2], { db: hit[0] });
  const err = new Error("academy_db_error");
  err.cause = error;
  err.dbCode = error?.code || null;
  return err;
}
const fail = dbError;

export function createAcademyRepo(db) {
  const rows = async (q) => { const { data, error } = await q; if (error) throw fail(error); return data || []; };
  const row = async (q) => { const { data, error } = await q.maybeSingle(); if (error) throw fail(error); return data || null; };

  return {
    getTrackBySlug: (slug) => row(db.from("academy_tracks").select("id,slug,title,status").eq("slug", slug)),
    getTrackById: (id) => row(db.from("academy_tracks").select("id,slug,title,status").eq("id", id)),
    getPublishedVersion: (trackId) => row(db.from("academy_track_versions").select("id,track_id,version_number,status,settings").eq("track_id", trackId).eq("status", "published")),
    getVersionById: (id) => row(db.from("academy_track_versions").select("id,track_id,version_number,status,settings").eq("id", id)),

    async findEnrollment({ userId, trackId }) {
      const list = await rows(db.from("academy_enrollments").select("id,user_id,track_id,track_version_id,status,started_at,created_at,completed_at,required,due_at")
        .eq("user_id", userId).eq("track_id", trackId).in("status", LIVE).order("created_at", { ascending: false }).limit(1));
      return list[0] || null;
    },
    async findActiveEnrollmentForVersion({ userId, versionId }) {
      const list = await rows(db.from("academy_enrollments").select("id,user_id,track_id,track_version_id,status,started_at,created_at")
        .eq("user_id", userId).eq("track_version_id", versionId).in("status", ACTIVE).limit(1));
      return list[0] || null;
    },
    async createEnrollment({ userId, trackId, versionId, source, startedAt }) {
      const { data, error } = await db.from("academy_enrollments")
        .insert({ user_id: userId, track_id: trackId, track_version_id: versionId, source, status: "in_progress", started_at: startedAt })
        .select("id,user_id,track_id,track_version_id,status,started_at,created_at,completed_at,required,due_at").single();
      if (error) {
        if (error.code === "23505") return this.findEnrollment({ userId, trackId }); // acesso simultâneo: já existe
        throw fail(error);
      }
      const ev = await db.from("academy_events").insert({ actor_user_id: userId, user_id: userId, action: "enrollment_started", ref: data.id, meta: { source } });
      if (ev.error) console.error("academy: evento de matrícula não gravado", ev.error.message);
      return data;
    },

    async getVersionStructure(versionId) {
      const modules = await rows(db.from("academy_modules").select("id,track_version_id,position,title,is_final,requires_exam").eq("track_version_id", versionId).order("position"));
      const ids = modules.map((m) => m.id);
      const lessons = ids.length ? await rows(db.from("academy_lessons").select("id,module_id,position,title,est_minutes,kind,body").in("module_id", ids).order("position")) : [];
      const lessonIds = lessons.map((l) => l.id);
      const activities = lessonIds.length ? await rows(db.from("academy_activities").select("id,lesson_id,position,kind,config").in("lesson_id", lessonIds).order("position")) : [];
      const exams = await rows(db.from("academy_exams").select("id,track_version_id,module_id,lesson_id,kind,pass_score,max_attempts,selection").eq("track_version_id", versionId));
      return { modules, lessons, activities, exams };
    },
    getExam: (id) => row(db.from("academy_exams").select("id,track_version_id,module_id,lesson_id,kind,pass_score,max_attempts,selection").eq("id", id)),
    async getLesson(lessonId) {
      const lesson = await row(db.from("academy_lessons").select("id,module_id,kind").eq("id", lessonId));
      if (!lesson) return null;
      const mod = await row(db.from("academy_modules").select("track_version_id").eq("id", lesson.module_id));
      return mod ? { ...lesson, track_version_id: mod.track_version_id } : null;
    },
    // COM gabarito: só o serviço (servidor) usa; quem monta a resposta ao navegador remove `correct`/`explanation`.
    async getExamQuestions(examIds) {
      if (!examIds.length) return [];
      const links = await rows(db.from("academy_exam_questions").select("exam_id,question_id,position,weight").in("exam_id", examIds));
      const qids = [...new Set(links.map((l) => l.question_id))];
      const qs = qids.length ? await rows(db.from("academy_questions").select("id,qversion,type,statement,options,correct,explanation,topic").in("id", qids)) : [];
      const byId = new Map(qs.map((q) => [q.id, q]));
      return links.filter((l) => byId.has(l.question_id)).map((l) => ({ exam_id: l.exam_id, position: l.position, weight: Number(l.weight), question: byId.get(l.question_id) }));
    },

    // Certificado da matrícula: o VÁLIDO (não revogado) ou, se só houver revogado, o mais recente.
    async getCertificate(enrollmentId) {
      const list = await rows(db.from("academy_certificates").select("id,user_id,enrollment_id,code,issued_at,issued_by,issued_by_email,snapshot,revoked_at,revoked_reason").eq("enrollment_id", enrollmentId).order("issued_at", { ascending: false }));
      return list.find((c) => !c.revoked_at) || list[0] || null;
    },
    getCertificateById: (id) => row(db.from("academy_certificates").select("id,user_id,enrollment_id,code,issued_at,issued_by,issued_by_email,snapshot,revoked_at,revoked_reason").eq("id", id)),
    getCertificateByCode: (code) => row(db.from("academy_certificates").select("id,user_id,enrollment_id,code,issued_at,issued_by,issued_by_email,snapshot,revoked_at,revoked_reason").eq("code", code)),
    async issueCertificate({ enrollmentId, actor }) {
      const { data, error } = await db.rpc("academy_issue_certificate", { p_enrollment_id: enrollmentId, p_actor: actor?.userId || null, p_actor_email: actor?.email || null });
      if (error) throw fail(error);
      return data;
    },
    async revokeCertificate({ certificateId, actor, reason }) {
      const { data, error } = await db.rpc("academy_revoke_certificate", { p_certificate_id: certificateId, p_actor: actor.userId, p_actor_email: actor.email || null, p_reason: reason || "" });
      if (error) throw fail(error);
      return data;
    },
    getGrants: (enrollmentId) => rows(db.from("academy_attempt_grants").select("exam_id,granted_at,granted_by,granted_by_email").eq("enrollment_id", enrollmentId)),
    getProgress: (enrollmentId) => rows(db.from("academy_lesson_progress").select("lesson_id,status,completed_at,seconds_spent").eq("enrollment_id", enrollmentId)),
    getAttempts: (enrollmentId) => rows(db.from("academy_exam_attempts").select("exam_id,attempt_number,passed,score,submitted_at").eq("enrollment_id", enrollmentId)),

    async recordAttempt({ userId, enrollmentId, examId, served, answers, score, passed }) {
      const { data, error } = await db.rpc("academy_record_attempt", {
        p_user_id: userId, p_enrollment_id: enrollmentId, p_exam_id: examId, p_served: served, p_answers: answers, p_score: score, p_passed: passed
      });
      if (error) throw fail(error);
      return data;
    },
    async completeLesson({ userId, enrollmentId, lessonId, seconds }) {
      const { data, error } = await db.rpc("academy_complete_lesson", { p_user_id: userId, p_enrollment_id: enrollmentId, p_lesson_id: lessonId, p_seconds: seconds || 0 });
      if (error) throw fail(error);
      return data;
    }
  };
}
