// Acesso ao Supabase para a GESTÃO de conteúdo e as liberações de tentativa (F3). Só consultas e escritas simples;
// as operações que precisam de atomicidade (rascunho, publicar, descartar, liberar tentativa) são funções SQL.
// Imutabilidade da versão publicada é do banco (triggers): escrever fora de rascunho vira AcademyError("version_not_editable").
import { dbError } from "./academy-repo.mjs";
import { AcademyError } from "./academy-access-core.mjs";

const ENROLL = "id,user_id,track_id,track_version_id,status,source,required,due_at,started_at,completed_at,created_at,assigned_by";

export function createAcademyContentRepo(db) {
  const rows = async (q) => { const { data, error } = await q; if (error) throw dbError(error); return data || []; };
  const row = async (q) => { const { data, error } = await q.maybeSingle(); if (error) throw dbError(error); return data || null; };
  const write = async (q) => { const { error } = await q; if (error) throw dbError(error); };
  const insertOne = async (table, obj, cols) => {
    const { data, error } = await db.from(table).insert(obj).select(cols).single();
    if (error) throw dbError(error);
    return data;
  };
  const rpc = async (name, params) => { const { data, error } = await db.rpc(name, params); if (error) throw dbError(error); return data; };

  const MODULE = "id,track_version_id,position,title,summary,is_final,requires_exam";
  const LESSON = "id,module_id,position,title,est_minutes,kind,body";
  const ACTIVITY = "id,lesson_id,position,kind,config";
  const EXAM = "id,track_version_id,module_id,lesson_id,kind,pass_score,max_attempts,selection";

  return {
    // ---- leitura ----
    listTracks: () => rows(db.from("academy_tracks").select("id,slug,title,kind,status,is_mandatory_default").order("created_at")),
    listVersions: (trackIds) => (trackIds.length ? rows(db.from("academy_track_versions").select("id,track_id,version_number,status,published_at,published_by,change_note,settings,created_at").in("track_id", trackIds).order("version_number", { ascending: false })) : []),
    getVersion: (id) => row(db.from("academy_track_versions").select("id,track_id,version_number,status,published_at,published_by,change_note,settings").eq("id", id)),
    getModule: (id) => row(db.from("academy_modules").select(MODULE).eq("id", id)),
    async getLessonWithVersion(id) {
      const lesson = await row(db.from("academy_lessons").select(LESSON).eq("id", id));
      if (!lesson) return null;
      const mod = await row(db.from("academy_modules").select(MODULE).eq("id", lesson.module_id));
      return mod ? { ...lesson, track_version_id: mod.track_version_id } : null;
    },
    async getActivityWithVersion(id) {
      const act = await row(db.from("academy_activities").select(ACTIVITY).eq("id", id));
      if (!act) return null;
      const lesson = await this.getLessonWithVersion(act.lesson_id);
      return lesson ? { ...act, track_version_id: lesson.track_version_id } : null;
    },
    getExamByModule: (moduleId) => row(db.from("academy_exams").select(EXAM).eq("module_id", moduleId)),
    updateExam: (id, patch) => write(db.from("academy_exams").update(patch).eq("id", id)),
    listQuestions: () => rows(db.from("academy_questions").select("id,stable_key,qversion,type,statement,options,correct,explanation,topic,status,created_at").order("created_at", { ascending: false }).limit(2000)),
    getQuestionsByIds: (ids) => (ids.length ? rows(db.from("academy_questions").select("id,stable_key,qversion,type,statement,options,correct,explanation,topic,status").in("id", ids)) : []),
    setQuestionStatus: (stableKey, status) => write(db.from("academy_questions").update({ status }).eq("stable_key", stableKey)),
    getExamByLesson: (lessonId) => row(db.from("academy_exams").select(EXAM).eq("lesson_id", lessonId)),
    getQuestion: (id) => row(db.from("academy_questions").select("id,stable_key,qversion,type,statement,options,correct,explanation").eq("id", id)),
    getExamLinks: (examId) => rows(db.from("academy_exam_questions").select("exam_id,question_id,position,weight").eq("exam_id", examId)),
    async listQuestionVersions(stableKey) { return rows(db.from("academy_questions").select("id,qversion").eq("stable_key", stableKey)); },
    async getAdminNames(ids) {
      const u = [...new Set(ids.filter(Boolean))];
      if (!u.length) return {};
      const list = await rows(db.from("admin_users").select("id,name").in("id", u));
      return Object.fromEntries(list.map((r) => [r.id, r.name]));
    },
    listContentEvents: () => rows(db.from("academy_events").select("id,actor_user_id,real_actor_email,action,ref,meta,created_at")
      .in("action", ["draft_created", "version_published", "draft_discarded"]).order("created_at", { ascending: false }).limit(200)),

    // ---- escrita em rascunho ----
    insertModule: (obj) => insertOne("academy_modules", obj, MODULE),
    updateModule: (id, patch) => write(db.from("academy_modules").update(patch).eq("id", id)),
    deleteModule: (id) => write(db.from("academy_modules").delete().eq("id", id)),
    insertLesson: (obj) => insertOne("academy_lessons", obj, LESSON),
    updateLesson: (id, patch) => write(db.from("academy_lessons").update(patch).eq("id", id)),
    deleteLesson: (id) => write(db.from("academy_lessons").delete().eq("id", id)),
    listLessonIds: async (moduleId) => (await rows(db.from("academy_lessons").select("id").eq("module_id", moduleId))).map((r) => r.id),
    insertActivity: (obj) => insertOne("academy_activities", obj, ACTIVITY),
    updateActivity: (id, patch) => write(db.from("academy_activities").update(patch).eq("id", id)),
    deleteActivity: (id) => write(db.from("academy_activities").delete().eq("id", id)),
    deleteActivitiesOfLesson: (lessonId) => write(db.from("academy_activities").delete().eq("lesson_id", lessonId)),
    insertQuestion: (obj) => insertOne("academy_questions", obj, "id,stable_key,qversion"),
    insertExam: (obj) => insertOne("academy_exams", obj, EXAM),
    linkExamQuestion: (obj) => write(db.from("academy_exam_questions").insert(obj)),
    unlinkExamQuestions: (examId) => write(db.from("academy_exam_questions").delete().eq("exam_id", examId)),
    deleteExam: (id) => write(db.from("academy_exams").delete().eq("id", id)),
    setPositions: async (table, items) => { for (const { id, position } of items) await write(db.from(table).update({ position }).eq("id", id)); },

    // ---- funções atômicas ----
    createDraft: ({ trackId, fromVersionId, actor, note }) => rpc("academy_create_draft", { p_track_id: trackId, p_from_version_id: fromVersionId || null, p_actor: actor.userId, p_actor_email: actor.email || null, p_note: note || null }),
    // Descartar rascunho: apagamentos ordenados feitos pelo app (sem função SQL de DELETE). Só rascunho: os triggers de
    // imutabilidade recusam apagar conteúdo de versão publicada/aposentada e o último passo exige status = 'draft'.
    async discardDraft({ versionId, actor }) {
      const ver = await row(db.from("academy_track_versions").select("id,track_id,version_number,status").eq("id", versionId));
      if (!ver) throw new AcademyError("version_not_found", 404);
      if (ver.status !== "draft") throw new AcademyError("not_a_draft", 409);
      const modIds = (await rows(db.from("academy_modules").select("id").eq("track_version_id", versionId))).map((r) => r.id);
      const lessonIds = modIds.length ? (await rows(db.from("academy_lessons").select("id").in("module_id", modIds))).map((r) => r.id) : [];
      const examIds = (await rows(db.from("academy_exams").select("id").eq("track_version_id", versionId))).map((r) => r.id);
      if (examIds.length) {
        await write(db.from("academy_exam_questions").delete().in("exam_id", examIds));
        await write(db.from("academy_exams").delete().in("id", examIds));
      }
      if (lessonIds.length) {
        await write(db.from("academy_activities").delete().in("lesson_id", lessonIds));
        await write(db.from("academy_lessons").delete().in("id", lessonIds));
      }
      if (modIds.length) await write(db.from("academy_modules").delete().in("id", modIds));
      await write(db.from("academy_track_versions").delete().eq("id", versionId).eq("status", "draft"));
      await write(db.from("academy_events").insert({
        actor_user_id: actor.userId, real_actor_email: actor.email || null, action: "draft_discarded", ref: versionId,
        meta: { track_id: ver.track_id, version_number: ver.version_number }
      }));
    },
    publishVersion: ({ versionId, actor, note }) => rpc("academy_publish_version", { p_version_id: versionId, p_actor: actor.userId, p_actor_email: actor.email || null, p_note: note || null }),
    grantExtraAttempt: ({ enrollmentId, examId, actor, reason }) => rpc("academy_grant_extra_attempt", { p_enrollment_id: enrollmentId, p_exam_id: examId, p_actor: actor.userId, p_actor_email: actor.email || null, p_reason: reason || null }),

    // ---- gestão de equipe e atribuição (F6) ----
    listUsers: (ids) => (ids == null
      ? rows(db.from("admin_users").select("id,name,email,role,status,created_at").limit(2000))
      : ids.length ? rows(db.from("admin_users").select("id,name,email,role,status,created_at").in("id", ids)) : []),
    listEnrollmentsFor: (userIds, { trackId } = {}) => {
      if (userIds && !userIds.length) return [];
      let q = db.from("academy_enrollments").select(ENROLL).in("status", ["assigned", "in_progress", "completed", "expired"]);
      if (userIds) q = q.in("user_id", userIds);
      if (trackId) q = q.eq("track_id", trackId);
      return rows(q.order("created_at", { ascending: false }).limit(5000));
    },
    listProgressFor: (enrollmentIds) => (enrollmentIds.length ? rows(db.from("academy_lesson_progress").select("enrollment_id,lesson_id,completed_at").eq("status", "completed").in("enrollment_id", enrollmentIds)) : []),
    listAttemptsDetailed: (enrollmentIds) => (enrollmentIds.length ? rows(db.from("academy_exam_attempts").select("enrollment_id,exam_id,attempt_number,passed,score,submitted_at").in("enrollment_id", enrollmentIds)) : []),
    listCertificatesFor: (enrollmentIds) => (enrollmentIds.length ? rows(db.from("academy_certificates").select("id,enrollment_id,code,issued_at,revoked_at").in("enrollment_id", enrollmentIds)) : []),
    // totais por versão: aulas e provas de módulo
    async listVersionTotals(versionIds) {
      const out = Object.fromEntries(versionIds.map((v) => [v, { lessons: 0, moduleExams: 0 }]));
      if (!versionIds.length) return out;
      const mods = await rows(db.from("academy_modules").select("id,track_version_id").in("track_version_id", versionIds));
      const modVersion = new Map(mods.map((m) => [m.id, m.track_version_id]));
      const lessons = mods.length ? await rows(db.from("academy_lessons").select("id,module_id").in("module_id", mods.map((m) => m.id))) : [];
      for (const l of lessons) out[modVersion.get(l.module_id)].lessons += 1;
      const exams = await rows(db.from("academy_exams").select("id,track_version_id,kind").in("track_version_id", versionIds).eq("kind", "module"));
      for (const x of exams) out[x.track_version_id].moduleExams += 1;
      return out;
    },
    getEnrollmentFull: (id) => row(db.from("academy_enrollments").select(ENROLL).eq("id", id)),
    async insertEnrollment(obj) {
      const { data, error } = await db.from("academy_enrollments").insert(obj).select(ENROLL).single();
      if (error) { if (error.code === "23505") throw new AcademyError("already_enrolled", 409); throw dbError(error); }
      return data;
    },
    updateEnrollment: (id, patch) => write(db.from("academy_enrollments").update(patch).eq("id", id)),
    logEvent: (obj) => write(db.from("academy_events").insert(obj)),
    listPublishedTracks: async () => {
      const tracks = await rows(db.from("academy_tracks").select("id,slug,title,kind,status,is_mandatory_default").eq("status", "active").order("created_at"));
      if (!tracks.length) return [];
      const versions = await rows(db.from("academy_track_versions").select("id,track_id").eq("status", "published").in("track_id", tracks.map((t) => t.id)));
      const withVersion = new Set(versions.map((v) => v.track_id));
      return tracks.filter((t) => withVersion.has(t.id));
    },
    insertTrack: (obj) => insertOne("academy_tracks", obj, "id,slug,title,kind,status,is_mandatory_default"),
    async slugExists(slug) { return Boolean(await row(db.from("academy_tracks").select("id").eq("slug", slug))); },
    updateTrack: (id, patch) => write(db.from("academy_tracks").update(patch).eq("id", id)),

    // ---- regras e recomendações (F7) ----
    listRules: () => rows(db.from("academy_assignment_rules").select("id,track_id,kind,audience_roles,due_days,every_days,starts_at,active,updated_at").order("created_at")),
    getRule: ({ trackId, kind }) => row(db.from("academy_assignment_rules").select("id,track_id,kind,audience_roles,due_days,every_days,starts_at,active").eq("track_id", trackId).eq("kind", kind)),
    insertRule: (obj) => insertOne("academy_assignment_rules", obj, "id,track_id,kind,audience_roles,due_days,every_days,starts_at,active"),
    updateRule: (id, patch) => write(db.from("academy_assignment_rules").update(patch).eq("id", id)),
    listRecommendations: (userIds, status) => {
      if (userIds && !userIds.length) return [];
      let q = db.from("academy_recommendations").select("id,user_id,track_id,source,reason,status,created_by_email,created_at,decided_by_email,decided_at,enrollment_id");
      if (userIds) q = q.in("user_id", userIds);
      if (status) q = q.eq("status", status);
      return rows(q.order("created_at", { ascending: false }).limit(500));
    },
    getRecommendation: (id) => row(db.from("academy_recommendations").select("id,user_id,track_id,source,reason,status,enrollment_id").eq("id", id)),
    async insertRecommendation(obj) {
      const { data, error } = await db.from("academy_recommendations").insert(obj).select("id").single();
      if (error) { if (error.code === "23505") throw new AcademyError("recommendation_exists", 409); throw dbError(error); }
      return data;
    },
    updateRecommendation: (id, patch) => write(db.from("academy_recommendations").update(patch).eq("id", id)),
    findLiveEnrollment: async (userId, trackId) => (await rows(db.from("academy_enrollments").select(ENROLL).eq("user_id", userId).eq("track_id", trackId).in("status", ["assigned", "in_progress"]).limit(1)))[0] || null,

    // ---- liberações (lista de quem esgotou) ----
    getEnrollmentById: (id) => row(db.from("academy_enrollments").select("id,user_id,track_id,track_version_id,status").eq("id", id)),
    listActiveEnrollments: async (userIds) => {
      let q = db.from("academy_enrollments").select("id,user_id,track_id,track_version_id,status").in("status", ["assigned", "in_progress"]);
      if (userIds) { if (!userIds.length) return []; q = q.in("user_id", userIds); }
      return rows(q);
    },
    listAttemptsFor: (enrollmentIds) => (enrollmentIds.length ? rows(db.from("academy_exam_attempts").select("enrollment_id,exam_id,passed").in("enrollment_id", enrollmentIds)) : []),
    listGrantsFor: (enrollmentIds) => (enrollmentIds.length ? rows(db.from("academy_attempt_grants").select("id,enrollment_id,exam_id,granted_by,granted_by_email,reason,granted_at").in("enrollment_id", enrollmentIds).order("granted_at", { ascending: false })) : []),
    listExamsByIds: (ids) => (ids.length ? rows(db.from("academy_exams").select(EXAM).in("id", ids)) : []),
    listLessonsByIds: (ids) => (ids.length ? rows(db.from("academy_lessons").select("id,title").in("id", ids)) : [])
  };
}
