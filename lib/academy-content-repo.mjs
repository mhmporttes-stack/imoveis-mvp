// Acesso ao Supabase para a GESTÃO de conteúdo e as liberações de tentativa (F3). Só consultas e escritas simples;
// as operações que precisam de atomicidade (rascunho, publicar, descartar, liberar tentativa) são funções SQL.
// Imutabilidade da versão publicada é do banco (triggers): escrever fora de rascunho vira AcademyError("version_not_editable").
import { dbError } from "./academy-repo.mjs";
import { AcademyError } from "./academy-access-core.mjs";

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
  const EXAM = "id,track_version_id,module_id,lesson_id,kind,pass_score,max_attempts";

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
