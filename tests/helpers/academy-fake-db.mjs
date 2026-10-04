// Client Supabase FALSO em memória para testar lib/academy-repo.mjs e lib/academy-service.mjs sem banco.
// O esquema (tabelas/colunas) é lido das MIGRATIONS reais: coluna inexistente em select/insert/filtro/order falha o
// teste. As duas funções RPC espelham, em JS, as funções SQL (a versão real é testada em supabase/tests/academy_f2.sql
// contra um Postgres de verdade) e checam os nomes dos parâmetros contra a assinatura da migration.
import { readFileSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const MIG = new URL("../../supabase/migrations/", import.meta.url);
const files = readdirSync(MIG).filter((f) => /^20261004\d{6}_academy_/.test(f)).sort();
const sql = files.map((f) => readFileSync(new URL(f, MIG), "utf8")).join("\n");

export const SCHEMA = {};
for (const m of sql.matchAll(/create table if not exists public\.(academy_\w+) \(([\s\S]*?)\n\);/g)) {
  SCHEMA[m[1]] = [...m[2].matchAll(/^  ([a-z_]+) (?:uuid|text|integer|boolean|timestamptz|jsonb|numeric)/gm)].map((x) => x[1]);
}
// tabela do CRM lida só para mostrar nomes (admin_users): colunas que o repo consulta
SCHEMA.admin_users = ["id", "name", "email", "role", "status", "created_at"];
export const RPC_PARAMS = {};
for (const m of sql.matchAll(/create or replace function public\.(academy_\w+)\(([^)]*)\)\s*returns (?:jsonb|uuid|void)/g)) {
  RPC_PARAMS[m[1]] = [...m[2].matchAll(/(p_[a-z_]+) /g)].map((x) => x[1]).sort();
}

const err = (message, code = null) => ({ message, code });
const md5uuid = (str) => { const h = createHash("md5").update(str).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

export function createFakeDb({ now = () => new Date().toISOString() } = {}) {
  const t = Object.fromEntries(Object.keys(SCHEMA).map((k) => [k, []]));
  const checkCols = (table, cols) => {
    if (!SCHEMA[table]) throw new Error(`tabela inexistente: ${table}`);
    for (const c of cols) if (!SCHEMA[table].includes(c)) throw new Error(`coluna inexistente: ${table}.${c}`);
  };
  const ACTIVE = new Set(["assigned", "in_progress"]);

  // espelho dos triggers de imutabilidade: módulos/aulas/atividades/provas só mudam em versão 'draft'
  const versionOf = (table, r) => {
    if (table === "academy_modules") return r.track_version_id;
    if (table === "academy_exams") return r.track_version_id;
    if (table === "academy_lessons") return t.academy_modules.find((m) => m.id === r.module_id)?.track_version_id;
    if (table === "academy_activities") return versionOf("academy_lessons", t.academy_lessons.find((l) => l.id === r.lesson_id) || {});
    if (table === "academy_exam_questions") return t.academy_exams.find((x) => x.id === r.exam_id)?.track_version_id;
    return undefined;
  };
  const GUARDED = ["academy_modules", "academy_lessons", "academy_activities", "academy_exams", "academy_exam_questions"];
  const isDraft = (versionId) => t.academy_track_versions.find((v) => v.id === versionId)?.status === "draft";
  function guard(table, op, oldRow, newRow) {
    if (!GUARDED.includes(table)) return null;
    if (op !== "INSERT" && !isDraft(versionOf(table, oldRow))) return "academy_published_content_is_immutable";
    if (op !== "DELETE" && !isDraft(versionOf(table, newRow))) return "academy_published_content_is_immutable";
    return null;
  }

  function insertRow(table, obj, skipGuard = false) {
    checkCols(table, Object.keys(obj));
    const r = { id: randomUUID(), created_at: now(), ...obj };
    if (table === "academy_questions") { r.stable_key ??= randomUUID(); r.qversion ??= 1; }
    if (table === "academy_modules") { r.is_final ??= false; r.requires_exam ??= false; }
    if (table === "academy_lessons") { r.body ??= {}; r.est_minutes ??= 0; r.kind ??= "lesson"; }
    if (table === "academy_exam_questions") { delete r.id; delete r.created_at; }
    if (table === "academy_recommendations") {
      r.status ??= "open";
      if (r.status === "open" && t[table].some((x) => x.user_id === r.user_id && x.track_id === r.track_id && x.status === "open")) return { error: err("duplicate key value violates unique constraint", "23505") };
    }
    if (table === "academy_assignment_rules") {
      r.active ??= false;
      if (t[table].some((x) => x.track_id === r.track_id && x.kind === r.kind)) return { error: err("duplicate key value violates unique constraint", "23505") };
    }
    const blocked = skipGuard ? null : guard(table, "INSERT", null, r);
    if (blocked) return { error: err(blocked) };
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
        const items = Array.isArray(st.payload) ? st.payload : [st.payload];
        const made = [];
        for (const it of items) {
          const res = insertRow(table, it);
          if (res.error) return res;
          made.push(res.data);
        }
        if (!st.cols) return { data: null };
        return Array.isArray(st.payload) ? { data: made.map(project) } : { data: project(made[0]) };
      }
      if (st.op === "update" || st.op === "delete") {
        const hits = t[table].filter((r) => st.filters.every((f) => f(r)));
        for (const r of hits) {
          const g = guard(table, st.op === "delete" ? "DELETE" : "UPDATE", r, st.op === "update" ? { ...r, ...st.payload } : null);
          if (g) return { error: err(g) };
        }
        if (st.op === "update") { for (const r of hits) Object.assign(r, st.payload); } else { t[table] = t[table].filter((r) => !hits.includes(r)); }
        return { data: null };
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
      insert(payload) { checkCols(table, Object.keys(Array.isArray(payload) ? payload[0] || {} : payload)); st.op = "insert"; st.payload = payload; return api; },
      update(payload) { checkCols(table, Object.keys(payload)); st.op = "update"; st.payload = payload; return api; },
      delete() { st.op = "delete"; return api; },
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
  const issueCert = (e, actor, email) => {
    const valid = t.academy_certificates.find((c) => c.enrollment_id === e.id && !c.revoked_at);
    if (valid) return { certificate_id: valid.id, code: valid.code, issued_at: valid.issued_at, created: false };
    const user = t.admin_users.find((u) => u.id === e.user_id);
    const lessons = t.academy_lessons.filter((l) => t.academy_modules.find((m) => m.id === l.module_id)?.track_version_id === e.track_version_id).length;
    const best = t.academy_exam_attempts.filter((a) => a.enrollment_id === e.id && a.passed && t.academy_exams.find((x) => x.id === a.exam_id)?.kind === "final").reduce((m, a) => Math.max(m, Number(a.score ?? 0)), 0) || null;
    const track = t.academy_tracks.find((x) => x.id === e.track_id);
    const hex = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
    const c = { id: randomUUID(), enrollment_id: e.id, user_id: e.user_id, track_version_id: e.track_version_id, code: `MM-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`, issued_at: now(), issued_by: actor, issued_by_email: email,
      snapshot: { holder_name: user?.name || user?.email || "Aluno", track_title: track?.title, track_slug: track?.slug, lessons_total: lessons, final_score: best, completed_at: e.completed_at }, revoked_at: null, revoked_reason: null };
    t.academy_certificates.push(c);
    t.academy_events.push({ id: randomUUID(), actor_user_id: actor, real_actor_email: email, user_id: e.user_id, action: "certificate_issued", ref: c.id, meta: { automatic: !actor && !email } });
    return { certificate_id: c.id, code: c.code, issued_at: c.issued_at, created: true };
  };
  const refresh = (enrollment) => {
    const lessons = t.academy_lessons.filter((l) => t.academy_modules.find((m) => m.id === l.module_id)?.track_version_id === enrollment.track_version_id);
    const done = t.academy_lesson_progress.filter((p) => p.enrollment_id === enrollment.id && p.status === "completed").length;
    const pending = t.academy_exams.filter((x) => x.track_version_id === enrollment.track_version_id && ["module", "final"].includes(x.kind)
      && !t.academy_exam_attempts.some((a) => a.enrollment_id === enrollment.id && a.exam_id === x.id && a.passed === true));
    if (lessons.length && done >= lessons.length && !pending.length) {
      const was = enrollment.status;
      enrollment.status = "completed"; enrollment.completed_at ??= now();
      if (was !== "completed") issueCert(enrollment, null, null);
    }
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
      const allowed = x.max_attempts == null ? null : x.max_attempts + (t.academy_attempt_grants.some((g) => g.enrollment_id === e.id && g.exam_id === x.id) ? 1 : 0);
      if (allowed != null && mine.length >= allowed) return { error: err("attempts_exhausted") };
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
      return { data: { attempt_id: a.id, completed_at: at, attempt_number: n, max_attempts: allowed, passed: p.p_passed, lesson_completed: inserted, enrollment_status: refresh(e) } };
    },
    academy_grant_extra_attempt(p) {
      const e = t.academy_enrollments.find((x) => x.id === p.p_enrollment_id);
      if (!e) return { error: err("enrollment_not_found") };
      if (!ACTIVE.has(e.status)) return { error: err("enrollment_not_active") };
      const x = t.academy_exams.find((q) => q.id === p.p_exam_id);
      if (!x || x.track_version_id !== e.track_version_id) return { error: err("exam_not_in_enrollment") };
      if (x.max_attempts == null) return { error: err("exam_without_limit") };
      const mine = t.academy_exam_attempts.filter((a) => a.enrollment_id === e.id && a.exam_id === x.id);
      if (mine.some((a) => a.passed === true)) return { error: err("already_passed") };
      if (t.academy_attempt_grants.some((g) => g.enrollment_id === e.id && g.exam_id === x.id)) return { error: err("grant_already_given") };
      if (mine.length < x.max_attempts) return { error: err("attempts_not_exhausted") };
      const g = { id: randomUUID(), enrollment_id: e.id, exam_id: x.id, granted_by: p.p_actor, granted_by_email: p.p_actor_email, reason: p.p_reason, granted_at: now() };
      t.academy_attempt_grants.push(g);
      t.academy_events.push({ id: randomUUID(), actor_user_id: p.p_actor, real_actor_email: p.p_actor_email, user_id: e.user_id, action: "attempt_granted", ref: g.id, meta: { exam_id: x.id } });
      return { data: { grant_id: g.id, granted_at: g.granted_at, max_attempts: x.max_attempts + 1 } };
    },
    academy_create_draft(p) {
      const track = t.academy_tracks.find((x) => x.id === p.p_track_id);
      if (!track) return { error: err("track_not_found") };
      const mine = t.academy_track_versions.filter((v) => v.track_id === track.id);
      if (mine.some((v) => v.status === "draft")) return { error: err("draft_exists") };
      let src = p.p_from_version_id || mine.find((v) => v.status === "published")?.id || null;
      if (src && !mine.some((v) => v.id === src)) return { error: err("version_not_in_track") };
      const number = mine.reduce((m, v) => Math.max(m, v.version_number), 0) + 1;
      const settings = mine.find((v) => v.id === src)?.settings ?? { unlock_mode: "sequential", pass_score: 70, max_attempts: 3 };
      const v = insertRow("academy_track_versions", { track_id: track.id, version_number: number, status: "draft", change_note: p.p_note, settings }, true).data;
      if (src) {
        const nid = (old) => md5uuid(old + v.id);
        const mods = t.academy_modules.filter((m) => m.track_version_id === src);
        for (const m of mods) t.academy_modules.push({ ...m, id: nid(m.id), track_version_id: v.id, created_at: now() });
        const les = t.academy_lessons.filter((l) => mods.some((m) => m.id === l.module_id));
        for (const l of les) t.academy_lessons.push({ ...structuredClone(l), id: nid(l.id), module_id: nid(l.module_id), created_at: now() });
        for (const a of t.academy_activities.filter((a) => les.some((l) => l.id === a.lesson_id))) t.academy_activities.push({ ...structuredClone(a), id: nid(a.id), lesson_id: nid(a.lesson_id), created_at: now() });
        const exs = t.academy_exams.filter((x) => x.track_version_id === src);
        for (const x of exs) t.academy_exams.push({ ...x, id: nid(x.id), track_version_id: v.id, module_id: x.module_id ? nid(x.module_id) : null, lesson_id: x.lesson_id ? nid(x.lesson_id) : null, created_at: now() });
        for (const q of t.academy_exam_questions.filter((q) => exs.some((x) => x.id === q.exam_id))) t.academy_exam_questions.push({ ...q, exam_id: nid(q.exam_id) });
      }
      t.academy_events.push({ id: randomUUID(), actor_user_id: p.p_actor, real_actor_email: p.p_actor_email, action: "draft_created", ref: v.id, meta: { track_id: track.id, version_number: number }, created_at: now() });
      return { data: v.id };
    },
    academy_publish_version(p) {
      const v = t.academy_track_versions.find((x) => x.id === p.p_version_id);
      if (!v) return { error: err("version_not_found") };
      if (v.status !== "draft") return { error: err("not_a_draft") };
      const mods = t.academy_modules.filter((m) => m.track_version_id === v.id);
      if (!mods.length) return { error: err("publish_invalid_empty") };
      const lessonsOf = (m) => t.academy_lessons.filter((l) => l.module_id === m.id);
      if (mods.some((m) => !lessonsOf(m).length)) return { error: err("publish_invalid_module_without_lessons") };
      const exams = t.academy_exams.filter((x) => x.track_version_id === v.id);
      if (mods.some((m) => lessonsOf(m).some((l) => l.kind === "final_exam" && !exams.some((x) => x.lesson_id === l.id)))) return { error: err("publish_invalid_final_without_exam") };
      if (exams.some((x) => !t.academy_exam_questions.some((q) => q.exam_id === x.id))) return { error: err("publish_invalid_exam_without_question") };
      if (mods.some((m) => m.requires_exam && !exams.some((x) => x.module_id === m.id && x.kind === "module"))) return { error: err("publish_invalid_module_exam_missing") };
      const prev = t.academy_track_versions.find((x) => x.track_id === v.track_id && x.status === "published");
      if (prev) prev.status = "retired";
      v.status = "published"; v.published_at = now(); v.published_by = p.p_actor; if (p.p_note) v.change_note = p.p_note;
      const trk = t.academy_tracks.find((x) => x.id === v.track_id); if (trk && trk.status !== "archived") trk.status = "active";
      t.academy_events.push({ id: randomUUID(), actor_user_id: p.p_actor, real_actor_email: p.p_actor_email, action: "version_published", ref: v.id, meta: { track_id: v.track_id, version_number: v.version_number }, created_at: now() });
      return { data: { version_id: v.id, version_number: v.version_number, previous_version_id: prev?.id || null } };
    },
    academy_issue_certificate(p) {
      const e = t.academy_enrollments.find((x) => x.id === p.p_enrollment_id);
      if (!e) return { error: err("enrollment_not_found") };
      if (e.status !== "completed") return { error: err("enrollment_not_completed") };
      return { data: issueCert(e, p.p_actor, p.p_actor_email) };
    },
    academy_revoke_certificate(p) {
      const c = t.academy_certificates.find((x) => x.id === p.p_certificate_id);
      if (!c) return { error: err("certificate_not_found") };
      if (c.revoked_at) return { error: err("already_revoked") };
      if (!String(p.p_reason || "").trim()) return { error: err("reason_required") };
      c.revoked_at = now(); c.revoked_reason = p.p_reason.trim(); c.revoked_by = p.p_actor; c.revoked_by_email = p.p_actor_email;
      t.academy_events.push({ id: randomUUID(), actor_user_id: p.p_actor, real_actor_email: p.p_actor_email, user_id: c.user_id, action: "certificate_revoked", ref: c.id, meta: { code: c.code } });
      return { data: { certificate_id: c.id, code: c.code } };
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
    insertRow: (table, obj) => insertRow(table, obj, true)
  };
}
