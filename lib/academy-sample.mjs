// DADO DE EXEMPLO EM MEMÓRIA (F1) — NÃO é conteúdo real nem banco. Espelha as
// tabelas do plano §2 (nomes de campo idênticos) para a interface funcionar sem
// Supabase. A F2 substitui este módulo por leitura do banco (academy_*).
// Títulos neutros do protótipo aprovado; corpo das aulas e questões são texto de exemplo.
//
// CONTRATO: exporta
//   SAMPLE_TABLES = { academy_tracks, academy_track_versions, academy_modules, academy_lessons,
//                     academy_enrollments, academy_lesson_progress, academy_events }  (todas congeladas)
//   SAMPLE_USER {id,name}, SAMPLE_QUESTIONS {[lessonId]: questão com gabarito (uso só do servidor/core)}
//   buildInitialCoreState() -> estado normalizado de lib/academy-core.mjs (9 de 18 aulas concluídas)
const hex = { track: "0001", ver: "0002", mod: "0003", les: "0004", enr: "0005", prg: "0006", evt: "0007", usr: "0008" };
const id = (k, n) => `a0000000-0000-4000-8000-${hex[k]}${String(n).padStart(8, "0")}`;

const TRACK_ID = id("track", 1);
const VERSION_ID = id("ver", 1);
export const SAMPLE_USER = Object.freeze({ id: id("usr", 1), name: "Aluno de exemplo" });

const MODS = [
  [1, "Integração e mercado"], [2, "Financiamento e poder de compra"], [3, "Renda, documentos e benefícios"],
  [4, "Jornada e CRM"], [5, "Atendimento e venda"], [6, "Prova final"]
];
const LESSONS = [
  [1, "Integração à operação", 9], [1, "Mercado imobiliário e papel do corretor", 12],
  [2, "Fundamentos do financiamento habitacional", 14], [2, "Minha Casa Minha Vida", 11], [2, "Simulação e poder de compra", 15],
  [3, "Tipos de renda", 10], [3, "Comprovação de renda", 13], [3, "Documentação", 12], [3, "FGTS", 8], [3, "Subsídios e benefícios", 12],
  [4, "Jornada do cliente", 11], [4, "Etapas do CRM", 10],
  [5, "Atendimento", 9], [5, "Guia de Atendimento", 12], [5, "Prospecção", 14], [5, "Reunião", 10], [5, "Venda", 13],
  [6, "Prova final", 30]
];

const academy_tracks = [{
  id: TRACK_ID, slug: "formacao-inicial", title: "Formação Inicial", kind: "formacao_inicial", status: "active",
  is_mandatory_default: false, created_at: "2026-08-01T12:00:00.000Z", updated_at: "2026-08-01T12:00:00.000Z"
}];

const academy_track_versions = [{
  id: VERSION_ID, track_id: TRACK_ID, version_number: 1, status: "published",
  published_at: "2026-08-01T12:00:00.000Z", published_by: null, change_note: "Estrutura de exemplo",
  settings: { unlock_mode: "sequential", pass_score: 70, max_attempts: null, certificate_rule: "all_lessons_and_final_exam" }
}];

const academy_modules = MODS.map(([n, title]) => ({
  id: id("mod", n), track_version_id: VERSION_ID, stable_key: id("mod", 100 + n), position: n, title,
  summary: null, unlock_rule: null, is_final: n === 6
}));

const posInModule = {};
const academy_lessons = LESSONS.map(([m, title, est_minutes], i) => {
  posInModule[m] = (posInModule[m] || 0) + 1;
  return {
    id: id("les", i + 1), module_id: id("mod", m), stable_key: id("les", 100 + i + 1), position: posInModule[m],
    title, est_minutes, kind: m === 6 ? "final_exam" : "lesson",
    body: { sample: true, blocks: [{ type: "paragraph", text: "Texto de exemplo — o conteúdo real desta aula entra depois, vindo de regras aprovadas." }] }
  };
});

const academy_enrollments = [{
  id: id("enr", 1), user_id: SAMPLE_USER.id, track_id: TRACK_ID, track_version_id: VERSION_ID, source: "manual",
  required: false, due_at: null, status: "in_progress", assigned_by: null,
  started_at: "2026-08-03T12:00:00.000Z", completed_at: null
}];

// 9 aulas concluídas, distribuídas em 5 semanas (2,2,1,2,2) a partir de 2026-08-03.
const DONE_AT = [
  "2026-08-04", "2026-08-06", "2026-08-11", "2026-08-13", "2026-08-19", "2026-08-25", "2026-08-27", "2026-09-02", "2026-09-04"
].map((d) => `${d}T15:00:00.000Z`);
const academy_lesson_progress = DONE_AT.map((at, i) => ({
  id: id("prg", i + 1), enrollment_id: id("enr", 1), lesson_id: id("les", i + 1), status: "completed",
  completed_at: at, seconds_spent: LESSONS[i][2] * 60
}));

const academy_events = [
  { id: id("evt", 1), actor_user_id: null, real_actor_email: null, user_id: SAMPLE_USER.id, action: "enrollment_assigned", ref: id("enr", 1), meta: { sample: true }, created_at: "2026-08-03T12:00:00.000Z" },
  { id: id("evt", 2), actor_user_id: SAMPLE_USER.id, real_actor_email: null, user_id: SAMPLE_USER.id, action: "module_completed", ref: id("mod", 2), meta: { sample: true }, created_at: DONE_AT[4] }
];

const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && !Object.isFrozen(v) && deepFreeze(v)); return Object.freeze(o); };

export const SAMPLE_TABLES = deepFreeze({
  academy_tracks, academy_track_versions, academy_modules, academy_lessons,
  academy_enrollments, academy_lesson_progress, academy_events
});

// Questão de exemplo por aula (a "B" é a correta — só no servidor/core, nunca no snapshot antes de responder).
export const SAMPLE_QUESTIONS = deepFreeze(Object.fromEntries(academy_lessons.map((l, i) => [l.id, {
  id: id("evt", 500 + i), stable_key: id("evt", 600 + i), qversion: 1, type: "single",
  statement: `Pergunta de exemplo sobre "${l.title}".`,
  stem: `Pergunta de exemplo sobre "${l.title}".`,
  options: [
    { id: "a", text: "Alternativa A de exemplo" },
    { id: "b", text: "Alternativa B de exemplo (correta)" },
    { id: "c", text: "Alternativa C de exemplo" }
  ],
  correct: ["b"],
  explanation: "Resposta correta (exemplo)."
}])));

export function buildInitialCoreState(tables = SAMPLE_TABLES) {
  const version = tables.academy_track_versions[0];
  const enrollment = tables.academy_enrollments[0];
  const completed = {};
  for (const p of tables.academy_lesson_progress) {
    if (p.enrollment_id === enrollment.id && p.status === "completed") completed[p.lesson_id] = p.completed_at;
  }
  return {
    track: { id: tables.academy_tracks[0].id, title: tables.academy_tracks[0].title },
    startedAt: enrollment.started_at,
    settings: { ...version.settings },
    modules: tables.academy_modules.map((m) => ({ id: m.id, position: m.position, title: m.title, is_final: m.is_final, requires_exam: false })),
    lessons: tables.academy_lessons.map((l) => ({ id: l.id, module_id: l.module_id, position: l.position, title: l.title, est_minutes: l.est_minutes, kind: l.kind, body: l.body })),
    completed,
    passedModuleExams: [],
    finalExamPassed: false
  };
}
