// Mundo de teste da Academia (banco falso + serviços): 1 trilha publicada v1 com 2 módulos (M1: L1, L2 | M2: L3 = prova final),
// quiz em L1/L2 (sem limite) e prova final com `finalMax` tentativas. Sem dependência de rede nem de banco.
import assert from "node:assert/strict";
import { createFakeDb } from "./academy-fake-db.mjs";
import { createAcademyRepo } from "../../lib/academy-repo.mjs";
import { createAcademyContentRepo } from "../../lib/academy-content-repo.mjs";
import { createAcademyService } from "../../lib/academy-service.mjs";
import { createAcademyContent } from "../../lib/academy-content.mjs";
import { createAcademyGrants } from "../../lib/academy-grants.mjs";
import { createAcademyCertificates } from "../../lib/academy-certificates.mjs";

export const ADMIN = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "admin@x.com", readOnly: false };
export const MANAGER = { userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "gestor@x.com", readOnly: false };
export const STUDENT_A = "11111111-1111-4111-8111-111111111111";
export const STUDENT_B = "22222222-2222-4222-8222-222222222222";
export const student = (userId, extra = {}) => ({ userId, name: userId === STUDENT_A ? "Ana" : "Bia", readOnly: false, reason: null, ...extra });

export function buildWorld({ finalMax = 3 } = {}) {
  const db = createFakeDb();
  const ins = (table, obj) => { const r = db.insertRow(table, obj); assert.ifError(r.error); return r.data; };
  const track = ins("academy_tracks", { slug: "formacao-inicial", title: "Formação Inicial", kind: "formacao_inicial", status: "active" });
  const ver = ins("academy_track_versions", { track_id: track.id, version_number: 1, status: "published", published_at: "2026-10-01T00:00:00.000Z", settings: { unlock_mode: "sequential", pass_score: 70, max_attempts: 3 } });
  const m1 = ins("academy_modules", { track_version_id: ver.id, position: 1, title: "Módulo 1" });
  const m2 = ins("academy_modules", { track_version_id: ver.id, position: 2, title: "Prova final", is_final: true });
  const mk = (m, position, title, kind = "lesson") => ins("academy_lessons", { module_id: m.id, position, title, est_minutes: 10, kind, body: { sample: true, blocks: [{ type: "paragraph", text: "texto" }] } });
  const l = [mk(m1, 1, "Aula 1"), mk(m1, 2, "Aula 2"), mk(m2, 1, "Prova final", "final_exam")];
  const opts = [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }];
  const e = l.map((lesson, i) => {
    const q = ins("academy_questions", { stable_key: `s${i}`, qversion: 1, type: "single", statement: `Pergunta ${lesson.title}`, options: opts, correct: ["b"], explanation: "EXPLICACAO-SECRETA", status: "active" });
    const x = ins("academy_exams", { track_version_id: ver.id, lesson_id: lesson.id, kind: lesson.kind === "final_exam" ? "final" : "quiz", max_attempts: lesson.kind === "final_exam" ? finalMax : null });
    ins("academy_exam_questions", { exam_id: x.id, question_id: q.id, position: 1, weight: 1 });
    return { q, x };
  });
  const repo = { ...createAcademyRepo(db), ...createAcademyContentRepo(db) };
  return {
    db, track, ver, m: [m1, m2], l, e, ins,
    svc: createAcademyService(repo, { now: () => "2026-10-04T12:00:00.000Z" }),
    content: createAcademyContent(repo),
    grants: createAcademyGrants(repo),
    certificates: createAcademyCertificates(repo)
  };
}
export const answer = (e, optionId) => ({ [e.q.id]: [optionId] });
