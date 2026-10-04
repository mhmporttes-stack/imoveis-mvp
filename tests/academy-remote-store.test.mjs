import test from "node:test";
import assert from "node:assert/strict";
import { createFakeDb } from "./helpers/academy-fake-db.mjs";
import { createAcademyRepo } from "../lib/academy-repo.mjs";
import { createAcademyService } from "../lib/academy-service.mjs";
import { AcademyError } from "../lib/academy-access-core.mjs";
import { createAcademyRemoteStore } from "../lib/academy-remote-store.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const actorOf = (extra = {}) => ({ userId: A, name: "Ana", readOnly: false, reason: null, ...extra });

function world({ finalMax = 3 } = {}) {
  const db = createFakeDb();
  const ins = (t, o) => { const r = db.insertRow(t, o); assert.ifError(r.error); return r.data; };
  const track = ins("academy_tracks", { slug: "formacao-inicial", title: "Formação Inicial", kind: "formacao_inicial", status: "active" });
  const ver = ins("academy_track_versions", { track_id: track.id, version_number: 1, status: "published", settings: {} });
  const m1 = ins("academy_modules", { track_version_id: ver.id, position: 1, title: "M1", is_final: false, requires_exam: false });
  const m2 = ins("academy_modules", { track_version_id: ver.id, position: 2, title: "Final", is_final: true, requires_exam: false });
  const lessons = [[m1, 1, "L1", "lesson"], [m1, 2, "L2", "lesson"], [m2, 1, "Prova", "final_exam"]].map(([m, pos, title, kind]) => ins("academy_lessons", { module_id: m.id, position: pos, title, est_minutes: 5, kind, body: { sample: true, blocks: [{ type: "paragraph", text: "t" }] } }));
  const opts = [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }];
  const exams = lessons.map((l, i) => {
    const q = ins("academy_questions", { stable_key: `k${i}`, qversion: 1, type: "single", statement: `P${i}`, options: opts, correct: ["b"], explanation: "EXPLICACAO-SECRETA", status: "active" });
    const x = ins("academy_exams", { track_version_id: ver.id, lesson_id: l.id, kind: l.kind === "final_exam" ? "final" : "quiz", max_attempts: l.kind === "final_exam" ? finalMax : null });
    ins("academy_exam_questions", { exam_id: x.id, question_id: q.id, position: 1, weight: 1 });
    return { q, x };
  });
  const svc = createAcademyService(createAcademyRepo(db));
  return { db, svc, lessons, exams };
}

// "HTTP" de mentira: chama o serviço como a rota faz e devolve o mesmo formato JSON.
function httpFor(svc, actor, log = []) {
  return async (url, init) => {
    log.push(url);
    const m = String(url).match(/\/exams\/([^/]+)\/attempts$/);
    try {
      const result = await svc.submitAttempt(actor, m[1], JSON.parse(init.body).answers);
      return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
    } catch (e) {
      if (!(e instanceof AcademyError)) throw e;
      return { ok: false, status: e.status, json: async () => ({ error: "msg", code: e.code, extra: e.extra }) };
    }
  };
}
async function open(w, actor = actorOf(), fetchImpl) {
  const initial = await w.svc.loadStudent(actor);
  const log = [];
  const store = createAcademyRemoteStore({ initial, fetchImpl: fetchImpl || httpFor(w.svc, actor, log), now: () => "2026-10-04T12:00:00.000Z" });
  return { store, log, initial };
}
const optionIndex = (store, lessonId, id) => { store.openLesson(lessonId); return store.getSnapshot().quiz.question.options.findIndex((o) => o.id === id); };

test("snapshot real: mesma forma da F1, isSample falso, sem gabarito", async () => {
  const w = world();
  const { store } = await open(w);
  const s = store.getSnapshot();
  assert.equal(s.isSample, false);
  assert.equal(s.home.total, 3);
  assert.equal(s.home.percent, 0);
  assert.equal(s.home.lesson.title, "L1");
  store.openLesson(w.lessons[0].id);
  const q = store.getSnapshot().quiz;
  assert.equal(q.correctOptionIds, null);
  assert.ok(!JSON.stringify(store.getSnapshot()).includes("EXPLICACAO-SECRETA"));
  assert.ok(!/"correct":/.test(JSON.stringify(store.getSnapshot())));
  assert.throws(() => { store.getSnapshot().home.percent = 9; }, TypeError);
});

test("errar mantém a aula aberta; acertar conclui, gera a Conquista e persiste no banco", async () => {
  const w = world();
  const { store } = await open(w);
  const l1 = w.lessons[0].id;
  const wrongIdx = optionIndex(store, l1, "a");
  const r1 = await store.answerQuiz(l1, wrongIdx);
  assert.deepEqual([r1.ok, r1.correct], [true, false]);
  assert.equal(store.getSnapshot().quiz.status, "incorrect");
  assert.equal(store.getSnapshot().quiz.correctOptionIds, null);
  assert.equal(store.getSnapshot().home.done, 0);
  const r2 = await store.answerQuiz(l1, optionIndex(store, l1, "b"));
  assert.deepEqual([r2.ok, r2.correct, r2.changed], [true, true, true]);
  const s = store.getSnapshot();
  assert.equal(s.quiz.status, "correct");
  assert.deepEqual(s.quiz.correctOptionIds, ["b"]);
  assert.equal(s.achievement.available, true);
  assert.equal(s.achievement.after, 33);
  assert.equal(s.home.done, 1);
  assert.equal(w.db.tables.academy_lesson_progress.length, 1);
  // recarregar a página: o progresso veio do banco
  const again = await open(w);
  assert.equal(again.store.getSnapshot().home.done, 1);
});

test("prova final: ao esgotar as 3 tentativas a interface mostra 'esgotada' e não chama mais a API", async () => {
  const w = world();
  const { store, log } = await open(w);
  for (const l of w.lessons.slice(0, 2)) await store.answerQuiz(l.id, optionIndex(store, l.id, "b"));
  const fin = w.lessons[2].id;
  for (let i = 0; i < 3; i++) await store.answerQuiz(fin, optionIndex(store, fin, "a"));
  store.openLesson(fin);
  let q = store.getSnapshot().quiz;
  assert.equal(q.exhausted, true);
  assert.equal(q.maxAttempts, 3);
  const calls = log.length;
  const r = await store.answerQuiz(fin, optionIndex(store, fin, "b"));
  assert.equal(r.error, "attempts_exhausted");
  assert.equal(log.length, calls, "não deve nem chamar a API");
  assert.ok(store.getSnapshot().notice.text.includes("tentativas"));
  // reabrir a tela: continua esgotada (vem do banco)
  const again = await open(w);
  again.store.openLesson(fin);
  q = again.store.getSnapshot().quiz;
  assert.equal(q.exhausted, true);
});

test("somente leitura ('Alterar conta'): não chama a API e avisa", async () => {
  const w = world();
  const ro = actorOf({ readOnly: true, reason: "account_switch" });
  const { store, log } = await open(w, ro);
  assert.equal(store.getSnapshot().readOnly, true);
  const l1 = w.lessons[0].id;
  const r = await store.answerQuiz(l1, optionIndex(store, l1, "b"));
  assert.equal(r.error, "read_only");
  assert.equal(log.length, 0);
  assert.equal(w.db.tables.academy_exam_attempts.length, 0);
  assert.ok(store.getSnapshot().notice.text.includes("visualização"));
});

test("falha de rede: avisa, não conclui e permite tentar de novo; clique duplo não envia duas vezes", async () => {
  const w = world();
  let fail = true;
  const real = httpFor(w.svc, actorOf());
  const calls = [];
  const flaky = async (url, init) => { calls.push(url); if (fail) throw new Error("offline"); return real(url, init); };
  const { store } = await open(w, actorOf(), flaky);
  const l1 = w.lessons[0].id;
  const idx = optionIndex(store, l1, "b");
  const r = await store.answerQuiz(l1, idx);
  assert.equal(r.error, "network");
  assert.equal(store.getSnapshot().home.done, 0);
  assert.ok(store.getSnapshot().notice);
  fail = false;
  const [x, y] = await Promise.all([store.answerQuiz(l1, idx), store.answerQuiz(l1, idx)]);
  assert.equal([x, y].filter((v) => v.ok).length, 1);
  assert.equal([x, y].filter((v) => v.error === "busy").length, 1);
  assert.equal(w.db.tables.academy_exam_attempts.length, 1);
});
