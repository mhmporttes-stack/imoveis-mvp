import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attemptStatus, effectivePassScore, gradeAttempt } from "../lib/academy-core.mjs";
import { SAMPLE_QUESTIONS, SAMPLE_TABLES } from "../lib/academy-sample.mjs";

const q = (id, weight = 1, correct = ["b"]) => ({ id, type: "single", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }], correct, explanation: "x", weight });

test("nota mínima 70%: 7 de 10 aprova; 6 de 10 reprova", () => {
  const qs = Array.from({ length: 10 }, (_, i) => q(`q${i}`));
  const ans = (hits) => Object.fromEntries(qs.map((x, i) => [x.id, [i < hits ? "b" : "a"]]));
  assert.equal(gradeAttempt({ questions: qs, answers: ans(7), passScore: 70 }).passed, true);
  assert.equal(gradeAttempt({ questions: qs, answers: ans(7), passScore: 70 }).score, 70);
  assert.equal(gradeAttempt({ questions: qs, answers: ans(6), passScore: 70 }).passed, false);
});

test("limite exato: 69,9% nunca arredonda para 70% (comparação sem arredondar)", () => {
  const qs = [q("a", 69.9), q("b", 30.1)];
  const r = gradeAttempt({ questions: qs, answers: { a: ["b"], b: ["a"] }, passScore: 70 });
  assert.equal(r.score, 69.9);
  assert.equal(r.passed, false);
  const ok = gradeAttempt({ questions: [q("a", 70), q("b", 30)], answers: { a: ["b"] }, passScore: 70 });
  assert.equal(ok.passed, true);
});

test("questão sem resposta vale zero; alternativa que não existe é descartada; múltipla escolha exige o conjunto exato", () => {
  const multi = q("m", 1, ["a", "b"]);
  assert.equal(gradeAttempt({ questions: [multi], answers: { m: ["a"] } }).passed, false);
  assert.equal(gradeAttempt({ questions: [multi], answers: { m: ["b", "a"] } }).passed, true);
  assert.equal(gradeAttempt({ questions: [multi], answers: { m: ["a", "b", "zzz"] } }).passed, true);
  assert.equal(gradeAttempt({ questions: [q("x")], answers: {} }).score, 0);
  assert.deepEqual(gradeAttempt({ questions: [q("x")], answers: { x: "b" } }).details[0].answer, ["b"]);
});

test("tentativas: máximo 3, sem limite quando null, nada após aprovado", () => {
  assert.deepEqual(attemptStatus({ attemptsUsed: 2, maxAttempts: 3 }), { attemptsUsed: 2, maxAttempts: 3, passed: false, exhausted: false, canAttempt: true, attemptsLeft: 1 });
  const s3 = attemptStatus({ attemptsUsed: 3, maxAttempts: 3 });
  assert.equal(s3.exhausted, true);
  assert.equal(s3.canAttempt, false);
  assert.equal(attemptStatus({ attemptsUsed: 50, maxAttempts: null }).canAttempt, true);
  assert.equal(attemptStatus({ attemptsUsed: 1, maxAttempts: 3, passed: true }).canAttempt, false);
  assert.equal(attemptStatus({ attemptsUsed: 3, maxAttempts: 3, passed: true }).exhausted, false);
});

test("nota mínima efetiva: da prova, senão da versão, senão 70", () => {
  assert.equal(effectivePassScore({ pass_score: 80 }, { pass_score: 70 }), 80);
  assert.equal(effectivePassScore({ pass_score: null }, { pass_score: 75 }), 75);
  assert.equal(effectivePassScore({}, {}), 70);
});

test("seed real (migration) espelha o conteúdo da F1 e as regras do dono", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261004130000_academy_seed_formacao_inicial.sql", import.meta.url), "utf8");
  const t = SAMPLE_TABLES;
  for (const m of t.academy_modules) assert.ok(sql.includes(m.id) && sql.includes(`'${m.title}'`), `módulo ${m.title}`);
  for (const l of t.academy_lessons) assert.ok(sql.includes(l.id) && sql.includes(`'${l.title}'`), `aula ${l.title}`);
  assert.equal((sql.match(/'single'/g) || []).length, Object.keys(SAMPLE_QUESTIONS).length);
  assert.equal((sql.match(/'a0000000-0000-4000-8000-000a\d{8}'::uuid, 'a0000000-0000-4000-8000-000200000001'::uuid/g) || []).length, 18);
  assert.equal((sql.match(/, 'final', null::int, 3\)/g) || []).length, 1, "uma prova final com 3 tentativas");
  assert.equal((sql.match(/, 'quiz', null::int, null::int\)/g) || []).length, 17, "quizzes sem limite");
  assert.ok(sql.includes('"pass_score":70') && sql.includes('"max_attempts":3'));
  assert.ok(!/insert into public\.academy_(enrollments|lesson_progress|exam_attempts)/.test(sql), "seed não cria progresso de ninguém");
  assert.ok(/status = 'published'/.test(sql), "publica no final");
});
