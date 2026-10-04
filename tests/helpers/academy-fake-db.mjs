// Client Supabase FALSO em memória para testar lib/academy-repo.mjs e lib/academy-service.mjs sem banco.
// O esquema (tabelas/colunas) é lido das MIGRATIONS reais: coluna inexistente em select/insert/filtro/order falha o
// teste. As duas funções RPC espelham, em JS, as funções SQL (a versão real é testada em supabase/tests/academy_f2.sql
// contra um Postgres de verdade) e checam os nomes dos parâmetros contra a assinatura da migration.
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const MIG = new URL("../../supabase/migrations/", import.meta.url);
const files = readdirSync(MIG).filter((f) => /^20261004\d{6}_academy_/.test(f)).sort();
const sql = files.map((f) => readFileSync(new URL(f, MIG), "utf8")).join("\n");

export const SCHEMA = {};
for (const m of sql.matchAll(/create table if not exists public\.(academy_\w+) \(([\s\S]*?)\n\);/g)) {
  SCHEMA[m[1]] = [...m[2].matchAll(/^  ([a-z_]+) (?:uuid|text|integer|boolean|timestamptz|jsonb|numeric)/gm)].map((x) => x[1]);
}
export const RPC_PARAMS = {};
for (const m of sql.matchAll(/create or replace function public\.(academy_(?:record_attempt|complete_lesson))\(([\s\S]*?)\)\s*returns jsonb/g)) {
  RPC_PARAMS[m[1]] = [...m[2].matchAll(/(p_[a-z_]+) /g)].map((x) => x[1]).sort();
}

const err = (message, code = null) => ({ message, code });

export function createFakeDb({ now = () => new Date().toISOString() } = {}) {
  const t = Object.fromEntries(Object.keys(SCHEMA).map((k) => [k, []]));
  const checkCols = (table, cols) => {
    if (!SCHEMA[table]) throw new Error(`tabela inexistente: ${table}`);
    for (const c of cols) if (!SCHEMA[table].includes(c)) throw new Error(`coluna inexistente: ${table}.${c}`);
  };
  const ACTIVE = new Set(["assigned", "in_progress"]);

  function insertRow(table, obj) {
    checkCols(table, Object.keys(obj));
    const r = { id: randomUUID(), created_at: now(), ...obj };
    if (table === "academy_enrollments") {
      r.status ??= "in_progress"; r.required ??= false;
      if (ACTIVE.has(r.status) && t[table].some((x) => x.user_id === r.user_id && x.track_id === r.track_id && ACTIVE.has(x.status))) {
        return { error: err("duplicate key value violates unique constraint", "23505") };
      }
    }
    t[table].push(r);
    return { data: r };
  }

  function builder(table, op = null) {
    const st = { cols: null, filters: [], order: null, limit: null, single: false, payload: null, op };
    const run = () => {
      if (st.op === "insert") {
        const res = insertRow(table, st.payload);
        if (res.error) return res;
        return { data: st.cols ? project(res.data) : null };
      }
      let list = t[table].filter((r) => st.filters.every((f) => f(r)));
      if (st.order) list = [...list].sort((a, b) => (a[st.order.col] > b[st.order.col] ? 1 : -1) * (st.order.asc ? 1 : -1));
      if (st.limit != null) list = list.slice(0, st.limit);
      list = list.map(project);
      if (st.single) return { data: list[0] || null };
      return { data: list };
    };
    const project = (r) => (st.cols ? Object.fromEntries(st.cols.map((c) => [c, structuredClone(r[c])])) : r);
    const api = {
      select(cols) { st.cols = String(cols).split(",").map((c) => c.trim()); checkCols(table, st.cols); return api; },
      insert(payload) { st.op = "insert"; st.payload = payload; return api; },
      eq(col, v) { checkCols(table, [col]); st.filters.push((r) => r[col] === v); return api; },
      in(col, vs) { checkCols(table, [col]); st.filters.push((r) => vs.includes(r[col])); return api; },
      order(col, o = {}) { checkCols(table, [col]); st.order = { col, asc: o.ascending !== false }; return api; },
      limit(n) { st.limit = n; return api; },
      maybeSingle() { st.single = true; return api; },
      single() { st.single = true; return api; },
      then(res, rej) { try { return Promise.resolve(run()).then((r) => ({ error: null, ...r })).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
    };
    return api;
  }

  // ---- espelho em JS das funções SQL (a versão real é testada em supabase/tests/academy_f2.sql) ----
  const refresh = (enrollment) => {
    const lessons = t.academy_lessons.filter((l) => t.academy_modules.find((m) => m.id === l.module_id)?.track_version_id === enrollment.track_version_id);
    const done = t.academy_lesson_progress.filter((p) => p.enrollment_id === enrollment.id && p.status === "completed").length;
    const pending = t.academy_exams.filter((x) => x.track_version_id === enrollment.track_version_id && ["module", "final"].includes(x.kind)
      && !t.academy_exam_attempts.some((a) => a.enrollment_id === enrollment.id && a.exam_id === x.id && a.passed === true));
    if (lessons.length && done >= lessons.length && !pending.length) { enrollment.status = "completed"; enrollment.completed_at ??= now(); }
    return enrollment.status;
  };
  const rpcs = {
    academy_record_attempt(p) {
      const e = t.academy_enrollments.find((x) => x.id === p.p_enrollment_id);
      if (!e || e.user_id !== p.p_user_id) return { error: err("enrollment_not_found") };
      if (!ACTIVE.has(e.status)) return { error: err("enrollment_not_active") };
      const x = t.academy_exams.find((q) => q.id === p.p_exam_id);
      if (!x || x.track_version_id !== e.track_version_id) return { error: err("exam_not_in_enrollment") };
      const mine = t.academy_exam_attempts.filter((a) => a.enrollment_id === e.id && a.exam_id === x.id);
      if (mine.some((a) => a.passed === true)) return { error: err("already_passed") };
      if (x.max_attempts != null && mine.length >= x.max_attempts) return { error: err("attempts_exhausted") };
      const n = mine.length + 1;
      const a = { id: randomUUID(), enrollment_id: e.id, exam_id: x.id, attempt_number: n, submitted_at: now(), score: p.p_score, passed: p.p_passed, status: "submitted", served: p.p_served };
      t.academy_exam_attempts.push(a);
      for (const r of p.p_answers) t.academy_attempt_answers.push({ id: randomUUID(), attempt_id: a.id, question_id: r.question_id, answer: r.answer, is_correct: r.is_correct, points: r.points });
      t.academy_events.push({ id: randomUUID(), user_id: p.p_user_id, action: "attempt_submitted", ref: a.id, meta: {} });
      let inserted = false; let at = null;
      if (p.p_passed && x.lesson_id) {
        if (!t.academy_lesson_progress.some((q) => q.enrollment_id === e.id && q.lesson_id === x.lesson_id)) {
          t.academy_lesson_progress.push({ id: randomUUID(), enrollment_id: e.id, lesson_id: x.lesson_id, status: "completed", completed_at: now(), seconds_spent: 0 });
          inserted = true;
        }
        at = t.academy_lesson_progress.find((q) => q.enrollment_id === e.id && q.lesson_id === x.lesson_id).completed_at;
      }
      return { data: { attempt_id: a.id, completed_at: at, attempt_number: n, max_attempts: x.max_attempts, passed: p.p_passed, lesson_completed: inserted, enrollment_status: refresh(e) } };
    },
    academy_complete_lesson(p) {
      const e = t.academy_enrollments.find((x) => x.id === p.p_enrollment_id);
      if (!e || e.user_id !== p.p_user_id) return { error: err("enrollment_not_found") };
      if (!ACTIVE.has(e.status)) return { error: err("enrollment_not_active") };
      if (t.academy_exams.some((x) => x.lesson_id === p.p_lesson_id)) return { error: err("exam_required") };
      let inserted = false;
      if (!t.academy_lesson_progress.some((q) => q.enrollment_id === e.id && q.lesson_id === p.p_lesson_id)) {
        t.academy_lesson_progress.push({ id: randomUUID(), enrollment_id: e.id, lesson_id: p.p_lesson_id, status: "completed", completed_at: now(), seconds_spent: p.p_seconds });
        inserted = true;
      }
      const at = t.academy_lesson_progress.find((q) => q.enrollment_id === e.id && q.lesson_id === p.p_lesson_id).completed_at;
      return { data: { lesson_completed: inserted, completed_at: at, enrollment_status: refresh(e) } };
    }
  };

  return {
    tables: t,
    from: (table) => builder(table),
    // RPC assíncrona com um "tick" antes de executar: permite testar duas chamadas simultâneas
    async rpc(name, params) {
      const expected = RPC_PARAMS[name];
      if (!expected) throw new Error(`função inexistente: ${name}`);
      const got = Object.keys(params).sort();
      if (JSON.stringify(got) !== JSON.stringify(expected)) throw new Error(`parâmetros de ${name} diferem da migration: ${got} vs ${expected}`);
      await Promise.resolve();
      const r = rpcs[name](params);
      return { error: null, ...r };
    },
    insertRow
  };
}
