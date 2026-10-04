// Gestão de conteúdo da Academia (F3) — regras de quem edita, o que edita e como publica. Recebe `repo`
// (lib/academy-content-repo.mjs). Só roda no servidor (vê o gabarito). Quem chama (rotas) já passou por
// requireBrokerManagementApi (Admin e Gerente — ACA-1) e entrega um `actor` {userId|null, email}.
//
// Modelo: o conteúdo PUBLICADO é imutável (trigger no banco). Editar = criar um RASCUNHO (nova versão, clone da
// publicada ou de uma versão antiga = "restaurar") e publicá-lo. Matrículas existentes ficam na versão em que
// começaram; novas matrículas pegam a publicada mais recente. Descartar apaga só o rascunho.
import { AcademyError } from "./academy-access-core.mjs";
import {
  assertSameIds, cleanActivity, cleanBlocks, cleanMinutes, cleanNote, cleanPassScore, cleanQuestion, cleanQuestionIds, cleanSelection, cleanSummary,
  cleanTitle, cleanTopic, validateTree
} from "./academy-content-core.mjs";

const byPosition = (a, b) => a.position - b.position;
const nextPosition = (items) => (items.reduce((m, i) => Math.max(m, i.position), 0) + 1);

export function createAcademyContent(repo) {
  async function requireDraft(versionId, code = "version_not_editable") {
    const version = await repo.getVersion(versionId);
    if (!version) throw new AcademyError("version_not_found", 404);
    if (version.status !== "draft") throw new AcademyError(code, 409);
    return version;
  }

  async function loadTree(versionId) {
    const version = await repo.getVersion(versionId);
    if (!version) throw new AcademyError("version_not_found", 404);
    const structure = await repo.getVersionStructure(versionId);
    const links = await repo.getExamQuestions(structure.exams.map((x) => x.id));
    const examByLesson = new Map(structure.exams.filter((x) => x.lesson_id).map((x) => [x.lesson_id, x]));
    const examByModule = new Map(structure.exams.filter((x) => x.module_id).map((x) => [x.module_id, x]));
    const examView = (exam) => {
      if (!exam) return null;
      const qs = links.filter((l) => l.exam_id === exam.id).sort(byPosition).map((l) => ({ id: l.question.id, stableKey: l.question.stable_key, statement: l.question.statement, topic: l.question.topic || null, type: l.question.type, retired: l.question.status === "retired" }));
      return { examId: exam.id, kind: exam.kind, selection: exam.selection || { mode: "fixed" }, passScore: exam.pass_score, maxAttempts: exam.max_attempts, questions: qs };
    };
    const questionOf = (lessonId) => {
      const exam = examByLesson.get(lessonId);
      const link = exam && links.filter((l) => l.exam_id === exam.id).sort(byPosition)[0];
      if (!link) return exam ? { examId: exam.id, missing: true } : null;
      const q = link.question;
      return { examId: exam.id, id: q.id, type: q.type, statement: q.statement, options: q.options, correct: q.correct, explanation: q.explanation, maxAttempts: exam.max_attempts };
    };
    const modules = [...structure.modules].sort(byPosition).map((m) => ({
      id: m.id, position: m.position, title: m.title, summary: m.summary, is_final: m.is_final, requires_exam: m.requires_exam, exam: examView(examByModule.get(m.id)),
      lessons: structure.lessons.filter((l) => l.module_id === m.id).sort(byPosition).map((l) => ({
        id: l.id, position: l.position, title: l.title, est_minutes: l.est_minutes, kind: l.kind, body: l.body || {},
        activities: (structure.activities || []).filter((a) => a.lesson_id === l.id).sort(byPosition),
        question: questionOf(l.id), exam: examView(examByLesson.get(l.id))
      }))
    }));
    return { version, modules };
  }

  // ---------- leitura ----------
  async function listTracks() {
    const tracks = await repo.listTracks();
    const versions = await repo.listVersions(tracks.map((t) => t.id));
    const names = await repo.getAdminNames(versions.map((v) => v.published_by));
    const events = await repo.listContentEvents();
    return tracks.map((t) => {
      const vs = versions.filter((v) => v.track_id === t.id).map((v) => ({
        id: v.id, number: v.version_number, status: v.status, publishedAt: v.published_at, publishedBy: names[v.published_by] || null,
        changeNote: v.change_note, createdAt: v.created_at
      }));
      const history = events.filter((e) => e.meta?.track_id === t.id).slice(0, 30).map((e) => ({
        id: e.id, action: e.action, at: e.created_at, by: e.real_actor_email || null, versionNumber: e.meta?.version_number ?? null
      }));
      return { id: t.id, slug: t.slug, title: t.title, kind: t.kind, status: t.status, versions: vs, history };
    });
  }

  async function getEditTree(versionId) {
    const tree = await loadTree(versionId);
    const validation = validateTree(tree);
    return { version: { ...tree.version, editable: tree.version.status === "draft" }, modules: tree.modules, validation };
  }

  // ---------- versões ----------
  async function createDraft(actor, { trackId, fromVersionId, note }) {
    const versionId = await repo.createDraft({ trackId, fromVersionId: fromVersionId || null, actor, note: cleanNote(note) });
    return { versionId };
  }
  async function discardDraft(actor, { versionId }) {
    await requireDraft(versionId, "not_a_draft");
    await repo.discardDraft({ versionId, actor });
    return { ok: true };
  }
  async function publish(actor, { versionId, note }) {
    await requireDraft(versionId, "not_a_draft");
    const { validation } = await getEditTree(versionId);
    if (!validation.ok) throw new AcademyError("publish_blocked", 409, { issues: validation.blocking });
    const result = await repo.publishVersion({ versionId, actor, note: cleanNote(note) });
    return { versionId, versionNumber: result.version_number, previousVersionId: result.previous_version_id || null };
  }

  // ---------- módulos ----------
  async function addModule(actor, { versionId, title, summary }) {
    await requireDraft(versionId);
    const existing = (await repo.getVersionStructure(versionId)).modules;
    const m = await repo.insertModule({ track_version_id: versionId, position: nextPosition(existing), title: cleanTitle(title), summary: cleanSummary(summary), is_final: false, requires_exam: false });
    return { id: m.id };
  }
  async function updateModule(actor, { moduleId, title, summary }) {
    const m = await repo.getModule(moduleId);
    if (!m) throw new AcademyError("module_not_found", 404);
    await requireDraft(m.track_version_id);
    const patch = {};
    if (title !== undefined) patch.title = cleanTitle(title);
    if (summary !== undefined) patch.summary = cleanSummary(summary);
    if (Object.keys(patch).length) await repo.updateModule(moduleId, patch);
    return { ok: true };
  }
  async function deleteModule(actor, { moduleId }) {
    const m = await repo.getModule(moduleId);
    if (!m) throw new AcademyError("module_not_found", 404);
    await requireDraft(m.track_version_id);
    const moduleExam = await repo.getExamByModule(moduleId);
    if (moduleExam) { await repo.unlinkExamQuestions(moduleExam.id); await repo.deleteExam(moduleExam.id); }
    for (const lessonId of await repo.listLessonIds(moduleId)) await removeLessonRows(lessonId);
    await repo.deleteModule(moduleId);
    return { ok: true };
  }

  // ---------- aulas ----------
  async function addLesson(actor, { moduleId, title, estMinutes = 10, kind = "lesson" }) {
    const m = await repo.getModule(moduleId);
    if (!m) throw new AcademyError("module_not_found", 404);
    await requireDraft(m.track_version_id);
    if (!["lesson", "final_exam"].includes(kind)) throw new AcademyError("invalid_lesson", 400);
    const lessons = (await repo.getVersionStructure(m.track_version_id)).lessons.filter((l) => l.module_id === moduleId);
    const l = await repo.insertLesson({ module_id: moduleId, position: nextPosition(lessons), title: cleanTitle(title), est_minutes: cleanMinutes(estMinutes), kind, body: { blocks: [], sample: false } });
    return { id: l.id };
  }
  async function updateLesson(actor, { lessonId, title, estMinutes, blocks }) {
    const l = await repo.getLessonWithVersion(lessonId);
    if (!l) throw new AcademyError("lesson_not_found", 404);
    await requireDraft(l.track_version_id);
    const patch = {};
    if (title !== undefined) patch.title = cleanTitle(title);
    if (estMinutes !== undefined) patch.est_minutes = cleanMinutes(estMinutes);
    if (blocks !== undefined) patch.body = { ...(l.body || {}), blocks: cleanBlocks(blocks), sample: false };
    if (Object.keys(patch).length) await repo.updateLesson(lessonId, patch);
    return { ok: true };
  }
  async function removeLessonRows(lessonId) {
    const exam = await repo.getExamByLesson(lessonId);
    if (exam) { await repo.unlinkExamQuestions(exam.id); await repo.deleteExam(exam.id); }
    await repo.deleteActivitiesOfLesson(lessonId);
    await repo.deleteLesson(lessonId);
  }
  async function deleteLesson(actor, { lessonId }) {
    const l = await repo.getLessonWithVersion(lessonId);
    if (!l) throw new AcademyError("lesson_not_found", 404);
    await requireDraft(l.track_version_id);
    await removeLessonRows(lessonId);
    return { ok: true };
  }
  // Move a aula para o fim de outro módulo da MESMA versão.
  async function moveLesson(actor, { lessonId, toModuleId }) {
    const l = await repo.getLessonWithVersion(lessonId);
    const to = await repo.getModule(toModuleId);
    if (!l || !to) throw new AcademyError("lesson_not_found", 404);
    if (to.track_version_id !== l.track_version_id) throw new AcademyError("invalid_order", 400);
    await requireDraft(l.track_version_id);
    const siblings = (await repo.getVersionStructure(l.track_version_id)).lessons.filter((x) => x.module_id === toModuleId);
    await repo.updateLesson(lessonId, { module_id: toModuleId, position: nextPosition(siblings) });
    return { ok: true };
  }

  // ---------- questão da aula (quiz; a prova final é a questão da aula "final_exam") ----------
  async function setQuestion(actor, { lessonId, ...input }) {
    const l = await repo.getLessonWithVersion(lessonId);
    if (!l) throw new AcademyError("lesson_not_found", 404);
    const version = await requireDraft(l.track_version_id);
    const q = cleanQuestion(input);
    const final = l.kind === "final_exam";
    let exam = await repo.getExamByLesson(lessonId);
    let stable;
    let qversion = 1;
    if (exam) {
      const link = (await repo.getExamLinks(exam.id))[0];
      const old = link ? await repo.getQuestion(link.question_id) : null;
      if (old) {
        stable = old.stable_key;
        qversion = Math.max(...(await repo.listQuestionVersions(old.stable_key)).map((r) => r.qversion)) + 1;
      }
      await repo.unlinkExamQuestions(exam.id);
      await repo.updateExam(exam.id, { selection: { mode: "fixed" } });
    } else {
      exam = await repo.insertExam({
        track_version_id: l.track_version_id, lesson_id: lessonId, kind: final ? "final" : "quiz",
        pass_score: null, max_attempts: final ? (version.settings?.max_attempts ?? 3) : null
      });
    }
    const row = await repo.insertQuestion({ ...(stable ? { stable_key: stable } : {}), qversion, type: q.type, statement: q.statement, options: q.options, correct: q.correct, explanation: q.explanation, topic: l.title, status: "active" });
    await repo.linkExamQuestion({ exam_id: exam.id, question_id: row.id, position: 1, weight: 1 });
    return { examId: exam.id, questionId: row.id };
  }
  async function removeQuestion(actor, { lessonId }) {
    const l = await repo.getLessonWithVersion(lessonId);
    if (!l) throw new AcademyError("lesson_not_found", 404);
    await requireDraft(l.track_version_id);
    const exam = await repo.getExamByLesson(lessonId);
    if (exam) { await repo.unlinkExamQuestions(exam.id); await repo.deleteExam(exam.id); }
    return { ok: true };
  }

  // ---------- atividades ----------
  async function addActivity(actor, { lessonId, kind, config }) {
    const l = await repo.getLessonWithVersion(lessonId);
    if (!l) throw new AcademyError("lesson_not_found", 404);
    await requireDraft(l.track_version_id);
    const structure = await repo.getVersionStructure(l.track_version_id);
    const a = await repo.insertActivity({ lesson_id: lessonId, position: nextPosition((structure.activities || []).filter((x) => x.lesson_id === lessonId)), kind, config: cleanActivity(kind, config) });
    return { id: a.id };
  }
  async function updateActivity(actor, { activityId, config }) {
    const a = await repo.getActivityWithVersion(activityId);
    if (!a) throw new AcademyError("activity_not_found", 404);
    await requireDraft(a.track_version_id);
    await repo.updateActivity(activityId, { config: cleanActivity(a.kind, config) });
    return { ok: true };
  }
  async function deleteActivity(actor, { activityId }) {
    const a = await repo.getActivityWithVersion(activityId);
    if (!a) throw new AcademyError("activity_not_found", 404);
    await requireDraft(a.track_version_id);
    await repo.deleteActivity(activityId);
    return { ok: true };
  }

  // ---------- ordem ----------
  // kind: "modules" (parentId = versão) | "lessons" (parentId = módulo) | "activities" (parentId = aula)
  async function reorder(actor, { kind, parentId, orderedIds }) {
    let table; let current; let versionId;
    if (kind === "modules") {
      versionId = parentId; table = "academy_modules";
      current = (await repo.getVersionStructure(parentId)).modules.map((m) => m.id);
    } else if (kind === "lessons") {
      const m = await repo.getModule(parentId);
      if (!m) throw new AcademyError("module_not_found", 404);
      versionId = m.track_version_id; table = "academy_lessons"; current = await repo.listLessonIds(parentId);
    } else if (kind === "activities") {
      const l = await repo.getLessonWithVersion(parentId);
      if (!l) throw new AcademyError("lesson_not_found", 404);
      versionId = l.track_version_id; table = "academy_activities";
      current = ((await repo.getVersionStructure(versionId)).activities || []).filter((a) => a.lesson_id === parentId).map((a) => a.id);
    } else throw new AcademyError("invalid_order", 400);
    await requireDraft(versionId);
    const ids = assertSameIds(current, orderedIds);
    await repo.setPositions(table, ids.map((id, i) => ({ id, position: i + 1 })));
    return { ok: true };
  }

  // ---------- banco de questões (F4) ----------
  // Cada edição cria uma NOVA versão da questão (mesma stable_key): provas já publicadas continuam apontando para a versão antiga.
  async function bankList() {
    const all = await repo.listQuestions();
    const latest = new Map();
    for (const q of all) { const cur = latest.get(q.stable_key); if (!cur || q.qversion > cur.qversion) latest.set(q.stable_key, q); }
    return [...latest.values()].map((q) => ({ id: q.id, stableKey: q.stable_key, qversion: q.qversion, type: q.type, statement: q.statement, options: q.options, correct: q.correct, explanation: q.explanation, topic: q.topic, status: q.status }));
  }
  async function bankSave(actor, { questionId, topic, ...input }) {
    const q = cleanQuestion(input);
    let stable; let qversion = 1;
    if (questionId) {
      const [old] = await repo.getQuestionsByIds([questionId]);
      if (!old) throw new AcademyError("question_not_found", 404);
      stable = old.stable_key;
      qversion = Math.max(...(await repo.listQuestionVersions(stable)).map((r) => r.qversion)) + 1;
    }
    const row = await repo.insertQuestion({ ...(stable ? { stable_key: stable } : {}), qversion, type: q.type, statement: q.statement, options: q.options, correct: q.correct, explanation: q.explanation, topic: cleanTopic(topic), status: "active" });
    return { questionId: row.id, qversion };
  }
  async function bankRetire(actor, { questionId, retired = true }) {
    const [q] = await repo.getQuestionsByIds([questionId]);
    if (!q) throw new AcademyError("question_not_found", 404);
    await repo.setQuestionStatus(q.stable_key, retired ? "retired" : "active");
    return { ok: true };
  }

  // Prova com questões do banco para uma aula (quiz/prova final) OU para um módulo (prova de módulo, obrigatória p/ concluir o módulo).
  async function resolveExamTarget({ lessonId, moduleId }) {
    if (lessonId) {
      const l = await repo.getLessonWithVersion(lessonId);
      if (!l) throw new AcademyError("lesson_not_found", 404);
      const version = await requireDraft(l.track_version_id);
      return { versionId: l.track_version_id, version, lesson: l, kind: l.kind === "final_exam" ? "final" : "quiz", existing: await repo.getExamByLesson(lessonId) };
    }
    if (moduleId) {
      const m = await repo.getModule(moduleId);
      if (!m) throw new AcademyError("module_not_found", 404);
      const version = await requireDraft(m.track_version_id);
      return { versionId: m.track_version_id, version, module: m, kind: "module", existing: await repo.getExamByModule(moduleId) };
    }
    throw new AcademyError("invalid_exam", 400);
  }
  async function setExam(actor, { lessonId, moduleId, questionIds, mode, count, passScore }) {
    const target = await resolveExamTarget({ lessonId, moduleId });
    const ids = cleanQuestionIds(questionIds);
    const found = await repo.getQuestionsByIds(ids);
    if (found.length !== ids.length) throw new AcademyError("question_not_found", 404);
    if (found.some((q) => q.status !== "active")) throw new AcademyError("question_retired", 409);
    if (new Set(found.map((q) => q.stable_key)).size !== found.length) throw new AcademyError("invalid_exam", 400);
    const selection = cleanSelection(mode, count, ids.length);
    const pass = cleanPassScore(passScore);
    const maxAttempts = target.kind === "quiz" ? null : (target.version.settings?.max_attempts ?? 3);
    let exam = target.existing;
    if (exam) {
      await repo.unlinkExamQuestions(exam.id);
      await repo.updateExam(exam.id, { selection, pass_score: pass });
    } else {
      exam = await repo.insertExam({
        track_version_id: target.versionId, ...(lessonId ? { lesson_id: lessonId } : { module_id: moduleId }), kind: target.kind,
        pass_score: pass, max_attempts: maxAttempts, selection
      });
    }
    for (let i = 0; i < ids.length; i++) await repo.linkExamQuestion({ exam_id: exam.id, question_id: ids[i], position: i + 1, weight: 1 });
    if (moduleId) await repo.updateModule(moduleId, { requires_exam: true });
    return { examId: exam.id };
  }
  async function removeExam(actor, { lessonId, moduleId }) {
    const target = await resolveExamTarget({ lessonId, moduleId });
    if (target.existing) { await repo.unlinkExamQuestions(target.existing.id); await repo.deleteExam(target.existing.id); }
    if (moduleId) await repo.updateModule(moduleId, { requires_exam: false });
    return { ok: true };
  }

  const actions = {
    createDraft, discardDraft, publish, addModule, updateModule, deleteModule, addLesson, updateLesson, deleteLesson, moveLesson,
    setQuestion, removeQuestion, addActivity, updateActivity, deleteActivity, reorder, bankSave, bankRetire, setExam, removeExam
  };
  async function run(actor, action, input) {
    const fn = actions[action];
    if (!fn) throw new AcademyError("invalid_action", 400);
    return fn(actor, input);
  }

  return { listTracks, getEditTree, bankList, run, actions: Object.keys(actions) };
}
