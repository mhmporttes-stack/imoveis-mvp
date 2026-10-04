import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN, STUDENT_A, STUDENT_B, answer, buildWorld, student } from "./helpers/academy-world.mjs";
import { assertCanManage, resolveManagementActor } from "../lib/academy-access-core.mjs";
import { cleanBlocks, cleanQuestion, validateTree } from "../lib/academy-content-core.mjs";

const rejects = (p, code, status) => assert.rejects(p, (e) => e.code === code && (status == null || e.status === status), `esperava ${code}`);
async function draftOf(w) { return (await w.content.run(ADMIN, "createDraft", { trackId: w.track.id, note: "ajustes" })).versionId; }

test("gestão: ator efetivo e somente leitura em 'Alterar conta'", () => {
  const a = resolveManagementActor({ profile: { id: ADMIN.userId, email: "p@x.com" }, user: { email: "Admin@X.com" } });
  assert.deepEqual([a.userId, a.email, a.readOnly], [ADMIN.userId, "admin@x.com", false]);
  const v = resolveManagementActor({ profile: { id: ADMIN.userId }, accountSwitchMode: true, realUser: { email: "real@x.com" }, user: { email: "emulado@x.com" } });
  assert.equal(v.readOnly, true);
  assert.equal(v.email, "real@x.com");
  assert.throws(() => assertCanManage(v), (e) => e.code === "read_only_account_switch" && e.status === 403);
  assert.equal(resolveManagementActor({ profile: { id: "", email: "dono@x.com" } }).userId, null);
});

test("validação do que se digita: blocos, questão e árvore", () => {
  assert.deepEqual(cleanBlocks([{ type: "heading", text: " Título " }, { type: "list", items: ["a", "b"] }]), [{ type: "heading", text: "Título" }, { type: "list", items: ["a", "b"] }]);
  assert.throws(() => cleanBlocks([{ type: "html", text: "<b>x</b>" }]), (e) => e.code === "invalid_content");
  assert.throws(() => cleanBlocks([{ type: "paragraph", text: "" }]), (e) => e.code === "invalid_content");
  assert.throws(() => cleanBlocks([{ type: "list", items: [] }]), (e) => e.code === "invalid_content");
  const q = cleanQuestion({ statement: "Qual?", options: ["Um", "Dois", "Três"], correct: [1] });
  assert.deepEqual([q.type, q.correct, q.options.map((o) => o.id)], ["single", ["b"], ["a", "b", "c"]]);
  assert.equal(cleanQuestion({ statement: "Quais?", options: ["Um", "Dois", "Três"], correct: [0, 2], multiple: true }).type, "multi");
  for (const bad of [{ statement: "x", options: ["só"], correct: [0] }, { statement: "x", options: ["a", "a"], correct: [0] }, { statement: "x", options: ["a", "b"], correct: [] },
    { statement: "x", options: ["a", "b"], correct: [0, 1] }, { statement: "x", options: ["a", "b"], correct: [5] }, { statement: " ", options: ["a", "b"], correct: [0] }, { statement: "x", options: ["a", "b"], correct: [0, 1], multiple: true }]) {
    assert.throws(() => cleanQuestion(bad), (e) => e.code === "invalid_question", JSON.stringify(bad));
  }
  const v = validateTree({ modules: [{ id: "m", title: "M", lessons: [] }] });
  assert.equal(v.ok, false);
  assert.equal(validateTree({ modules: [] }).blocking[0].code, "empty");
});

test("versão publicada é imutável; editar exige rascunho (um por trilha) clonado da publicada", async () => {
  const w = buildWorld();
  await rejects(w.content.run(ADMIN, "updateLesson", { lessonId: w.l[0].id, title: "Novo" }), "version_not_editable", 409);
  await rejects(w.content.run(ADMIN, "addModule", { versionId: w.ver.id, title: "X" }), "version_not_editable", 409);
  const draftId = await draftOf(w);
  const tree = await w.content.getEditTree(draftId);
  assert.equal(tree.version.editable, true);
  assert.equal(tree.version.version_number, 2);
  assert.equal(tree.modules.length, 2);
  assert.equal(tree.modules[0].lessons.length, 2);
  assert.equal(tree.modules[1].lessons[0].question.correct[0], "b");
  await rejects(w.content.run(ADMIN, "createDraft", { trackId: w.track.id }), "draft_exists", 409);
  assert.equal(w.db.tables.academy_track_versions.find((v) => v.id === w.ver.id).status, "published");
});

test("editar no rascunho: módulos, aulas, conteúdo, atividades, questão, ordem e exclusão", async () => {
  const w = buildWorld();
  const draftId = await draftOf(w);
  const base = await w.content.getEditTree(draftId);
  const [dm1, dm2] = base.modules;
  const mod = (await w.content.run(ADMIN, "addModule", { versionId: draftId, title: "  Módulo novo  ", summary: "resumo" })).id;
  const les = (await w.content.run(ADMIN, "addLesson", { moduleId: mod, title: "Aula nova", estMinutes: 15 })).id;
  await w.content.run(ADMIN, "updateLesson", { lessonId: les, blocks: [{ type: "heading", text: "Intro" }, { type: "paragraph", text: "Texto" }, { type: "list", items: ["x", "y"] }] });
  await rejects(w.content.run(ADMIN, "updateLesson", { lessonId: les, blocks: [{ type: "script", text: "x" }] }), "invalid_content", 400);
  await rejects(w.content.run(ADMIN, "addLesson", { moduleId: mod, title: "   " }), "invalid_title", 400);
  await rejects(w.content.run(ADMIN, "addLesson", { moduleId: mod, title: "ok", estMinutes: -1 }), "invalid_minutes", 400);
  const act = (await w.content.run(ADMIN, "addActivity", { lessonId: les, kind: "tip", config: { title: "Dica", text: "Faça assim" } })).id;
  await w.content.run(ADMIN, "addActivity", { lessonId: les, kind: "checklist", config: { items: ["um", "dois"] } });
  await rejects(w.content.run(ADMIN, "addActivity", { lessonId: les, kind: "checklist", config: { items: [] } }), "invalid_activity", 400);
  await rejects(w.content.run(ADMIN, "addActivity", { lessonId: les, kind: "quiz", config: {} }), "invalid_activity", 400);
  await w.content.run(ADMIN, "updateActivity", { activityId: act, config: { text: "Outra dica" } });

  // questão: criar, editar (nova qversion, mesma stable_key, histórico preservado) e remover
  await w.content.run(ADMIN, "setQuestion", { lessonId: les, statement: "Qual?", options: ["Um", "Dois"], correct: [0], explanation: "porque sim" });
  let t = await w.content.getEditTree(draftId);
  const newLesson = () => t.modules.find((m) => m.id === mod).lessons[0];
  const first = newLesson().question;
  assert.deepEqual(first.correct, ["a"]);
  await w.content.run(ADMIN, "setQuestion", { lessonId: les, statement: "Qual agora?", options: ["Um", "Dois", "Três"], correct: [2] });
  t = await w.content.getEditTree(draftId);
  const second = newLesson().question;
  assert.deepEqual([second.statement, second.correct], ["Qual agora?", ["c"]]);
  const rows = w.db.tables.academy_questions.filter((q) => q.stable_key === w.db.tables.academy_questions.find((r) => r.id === second.id).stable_key);
  assert.deepEqual(rows.map((r) => r.qversion).sort(), [1, 2]);
  assert.equal(w.db.tables.academy_questions.find((r) => r.id === first.id).statement, "Qual?", "questão antiga preservada");
  await w.content.run(ADMIN, "removeQuestion", { lessonId: les });
  assert.equal((await w.content.getEditTree(draftId)).modules.find((m) => m.id === mod).lessons[0].question, null);

  // conteúdo da aula editado deixa de ser "exemplo"
  assert.equal(newLesson().body.sample, false);
  t = await w.content.getEditTree(draftId);
  assert.deepEqual(newLesson().body.blocks.map((b) => b.type), ["heading", "paragraph", "list"]);
  assert.equal(newLesson().activities.length, 2);

  // ordem: mesmos ids, sem repetir
  const ids = t.modules.map((m) => m.id);
  await w.content.run(ADMIN, "reorder", { kind: "modules", parentId: draftId, orderedIds: [ids[2], ids[0], ids[1]] });
  assert.deepEqual((await w.content.getEditTree(draftId)).modules.map((m) => m.id), [ids[2], ids[0], ids[1]]);
  await rejects(w.content.run(ADMIN, "reorder", { kind: "modules", parentId: draftId, orderedIds: [ids[0], ids[0], ids[1]] }), "invalid_order", 400);
  await rejects(w.content.run(ADMIN, "reorder", { kind: "modules", parentId: draftId, orderedIds: [ids[0], ids[1]] }), "invalid_order", 400);
  await w.content.run(ADMIN, "reorder", { kind: "lessons", parentId: dm1.id, orderedIds: dm1.lessons.map((x) => x.id).reverse() });
  assert.equal((await w.content.getEditTree(draftId)).modules.find((m) => m.id === dm1.id).lessons[0].title, "Aula 2");

  // mover aula entre módulos e excluir módulo (apaga aulas, provas e atividades do RASCUNHO)
  await w.content.run(ADMIN, "moveLesson", { lessonId: les, toModuleId: dm2.id });
  t = await w.content.getEditTree(draftId);
  assert.equal(t.modules.find((m) => m.id === dm2.id).lessons.at(-1).id, les);
  await w.content.run(ADMIN, "deleteModule", { moduleId: mod });
  t = await w.content.getEditTree(draftId);
  assert.ok(!t.modules.some((m) => m.id === mod));
  await w.content.run(ADMIN, "deleteActivity", { activityId: act });
  await w.content.run(ADMIN, "deleteLesson", { lessonId: les });
  // a versão publicada segue idêntica
  const pub = await w.content.getEditTree(w.ver.id);
  assert.equal(pub.modules.length, 2);
  assert.equal(pub.modules[0].lessons.length, 2);
});

test("publicar: pendências bloqueiam; publicar aposenta a anterior; matrícula antiga fica na v1; nova pega a v2", async () => {
  const w = buildWorld();
  await w.svc.loadStudent(student(STUDENT_A)); // Ana matricula na v1
  const draftId = await draftOf(w);
  const mod = (await w.content.run(ADMIN, "addModule", { versionId: draftId, title: "Vazio" })).id;
  await assert.rejects(w.content.run(ADMIN, "publish", { versionId: draftId }), (e) => e.code === "publish_blocked" && e.extra.issues.some((i) => i.code === "module_without_lessons"));
  assert.equal(w.db.tables.academy_track_versions.find((v) => v.id === draftId).status, "draft");
  const les = (await w.content.run(ADMIN, "addLesson", { moduleId: mod, title: "Prova 2", kind: "final_exam" })).id;
  await assert.rejects(w.content.run(ADMIN, "publish", { versionId: draftId }), (e) => e.extra.issues.some((i) => i.code === "final_without_exam"));
  await w.content.run(ADMIN, "setQuestion", { lessonId: les, statement: "Final?", options: ["s", "n"], correct: [0] });
  const exam = w.db.tables.academy_exams.find((x) => x.lesson_id === les);
  assert.equal(exam.kind, "final");
  assert.equal(exam.max_attempts, 3, "prova final nova herda o limite de 3 da versão");
  await w.content.run(ADMIN, "updateLesson", { lessonId: w.l[0].id, title: "x" }).catch(() => {}); // aula da v1: recusada
  const out = await w.content.run(ADMIN, "publish", { versionId: draftId, note: "Segunda versão" });
  assert.equal(out.versionNumber, 2);
  assert.equal(out.previousVersionId, w.ver.id);
  const vs = w.db.tables.academy_track_versions;
  assert.equal(vs.find((v) => v.id === w.ver.id).status, "retired");
  const v2 = vs.find((v) => v.id === draftId);
  assert.deepEqual([v2.status, v2.published_by, v2.change_note], ["published", ADMIN.userId, "Segunda versão"]);
  await rejects(w.content.run(ADMIN, "publish", { versionId: draftId }), "not_a_draft", 409);
  await rejects(w.content.run(ADMIN, "updateModule", { moduleId: mod, title: "x" }), "version_not_editable", 409);
  // Ana segue na v1 (3 aulas); Bia entra na v2 (4 aulas)
  assert.equal((await w.svc.loadStudent(student(STUDENT_A))).core.lessons.length, 3);
  assert.equal((await w.svc.loadStudent(student(STUDENT_B))).core.lessons.length, 4);
  // histórico visível
  const [t] = await w.content.listTracks();
  assert.deepEqual(t.versions.map((v) => [v.number, v.status]), [[2, "published"], [1, "retired"]]);
  assert.ok(t.history.some((h) => h.action === "version_published" && h.by === ADMIN.email));
  assert.ok(t.history.some((h) => h.action === "draft_created"));
});

test("restaurar versão antiga = novo rascunho; descartar apaga só o rascunho", async () => {
  const w = buildWorld();
  const d1 = await draftOf(w);
  await w.content.run(ADMIN, "updateModule", { moduleId: (await w.content.getEditTree(d1)).modules[0].id, title: "Módulo renomeado" });
  await w.content.run(ADMIN, "publish", { versionId: d1 });
  const d2 = (await w.content.run(ADMIN, "createDraft", { trackId: w.track.id, fromVersionId: w.ver.id, note: "restaurar v1" })).versionId;
  const t = await w.content.getEditTree(d2);
  assert.equal(t.version.version_number, 3);
  assert.equal(t.modules[0].title, "Módulo 1", "veio da v1");
  await w.content.run(ADMIN, "discardDraft", { versionId: d2 });
  assert.ok(!w.db.tables.academy_track_versions.some((v) => v.id === d2));
  await rejects(w.content.run(ADMIN, "discardDraft", { versionId: d1 }), "not_a_draft", 409);
  assert.equal(w.db.tables.academy_modules.filter((m) => m.track_version_id === d1).length, 2, "publicada intacta");
  await rejects(w.content.run(ADMIN, "bogus", {}), "invalid_action", 400);
});

test("o aluno vê o conteúdo novo (blocos, atividades), sem gabarito; aula sem questão conclui por botão", async () => {
  const w = buildWorld();
  const d = await draftOf(w);
  const tree = await w.content.getEditTree(d);
  const les = (await w.content.run(ADMIN, "addLesson", { moduleId: tree.modules[0].id, title: "Sem questão" })).id;
  await w.content.run(ADMIN, "updateLesson", { lessonId: les, blocks: [{ type: "paragraph", text: "Conteúdo real" }] });
  await w.content.run(ADMIN, "addActivity", { lessonId: les, kind: "example", config: { text: "Exemplo prático" } });
  await w.content.run(ADMIN, "setQuestion", { lessonId: tree.modules[0].lessons[0].id, statement: "Nova?", options: ["s", "n"], correct: [1], explanation: "EXPLICACAO-NOVA" });
  await w.content.run(ADMIN, "publish", { versionId: d });
  const p = await w.svc.loadStudent(student(STUDENT_B));
  const byTitle = (t) => p.core.lessons.find((l) => l.title === t);
  const lesson = byTitle("Sem questão");
  assert.deepEqual(lesson.body.blocks[0], { type: "paragraph", text: "Conteúdo real" });
  assert.deepEqual(lesson.activities.map((a) => a.kind), ["example"]);
  assert.equal(p.questions[lesson.id], undefined, "sem questão");
  assert.ok(p.questions[byTitle("Aula 1").id], "Aula 1 tem a questão nova");
  const json = JSON.stringify(p);
  assert.ok(!json.includes("EXPLICACAO-NOVA") && !json.includes("EXPLICACAO-SECRETA") && !/"correct"/.test(json));
  // por prova: Aula 1 (resposta certa agora é "b" = índice 1) e Aula 2
  const examOf = (lessonId) => w.db.tables.academy_exams.find((x) => x.lesson_id === lessonId);
  const qOf = (lessonId) => w.db.tables.academy_exam_questions.find((r) => r.exam_id === examOf(lessonId).id).question_id;
  for (const t of ["Aula 1", "Aula 2"]) {
    const r = await w.svc.submitAttempt(student(STUDENT_B), examOf(byTitle(t).id).id, { [qOf(byTitle(t).id)]: ["b"] });
    assert.equal(r.lessonCompleted, true, t);
  }
  const done = await w.svc.completeLessonNoExam(student(STUDENT_B), lesson.id);
  assert.equal(done.lessonCompleted, true);
  assert.equal((await w.svc.completeLessonNoExam(student(STUDENT_B), lesson.id)).lessonCompleted, false, "idempotente");
  assert.equal(Object.keys((await w.svc.loadStudent(student(STUDENT_B))).core.completed).length, 3);
  // aula com prova não conclui pelo botão
  await assert.rejects(w.svc.completeLessonNoExam(student(STUDENT_B), byTitle("Aula 1").id), (e) => e.code === "exam_required");
});
