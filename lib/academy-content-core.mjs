// Gestão de conteúdo da Academia (F3) — regras PURAS (sem I/O): validação e normalização do que Admin/Gerente enviam,
// e o que impede publicar. Quem grava é lib/academy-content.mjs; o banco repete as regras de publicação
// (academy_publish_version) e a imutabilidade da versão publicada.
import { AcademyError } from "./academy-access-core.mjs";

export const BLOCK_TYPES = ["heading", "paragraph", "list", "callout"];
export const ACTIVITY_KINDS = ["tip", "example", "checklist"];
export const LIMITS = { blocks: 60, text: 4000, heading: 160, listItems: 30, listItem: 500, title: 160, summary: 400, minutes: 600, options: 6, optionText: 300, statement: 600, explanation: 600, note: 400, activityTitle: 120 };
const OPTION_IDS = ["a", "b", "c", "d", "e", "f"];

const bad = (code, extra) => new AcademyError(code, 400, extra);
const str = (v, max, code, { required = true } = {}) => {
  const t = typeof v === "string" ? v.replace(/\s+\n/g, "\n").trim() : "";
  if (!t) { if (required) throw bad(code); return ""; }
  if (t.length > max) throw bad(code);
  return t;
};

export function cleanTitle(v, code = "invalid_title") { return str(v, LIMITS.title, code); }
export function cleanNote(v) { return str(v, LIMITS.note, "invalid_note", { required: false }) || null; }
export function cleanSummary(v) { return str(v, LIMITS.summary, "invalid_summary", { required: false }) || null; }
export function cleanMinutes(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > LIMITS.minutes) throw bad("invalid_minutes");
  return n;
}

// Corpo da aula: lista de blocos {type, text} | {type:"list", items[]}. Só texto puro (a interface escapa tudo).
export function cleanBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length > LIMITS.blocks) throw bad("invalid_content");
  return blocks.map((b) => {
    if (!b || typeof b !== "object" || !BLOCK_TYPES.includes(b.type)) throw bad("invalid_content");
    if (b.type === "list") {
      if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > LIMITS.listItems) throw bad("invalid_content");
      return { type: "list", items: b.items.map((i) => str(i, LIMITS.listItem, "invalid_content")) };
    }
    return { type: b.type, text: str(b.text, b.type === "heading" ? LIMITS.heading : LIMITS.text, "invalid_content") };
  });
}

export function cleanActivity(kind, config) {
  if (!ACTIVITY_KINDS.includes(kind)) throw bad("invalid_activity");
  const c = config && typeof config === "object" ? config : {};
  const title = str(c.title, LIMITS.activityTitle, "invalid_activity", { required: false });
  if (kind === "checklist") {
    if (!Array.isArray(c.items) || c.items.length === 0 || c.items.length > LIMITS.listItems) throw bad("invalid_activity");
    return { ...(title ? { title } : {}), items: c.items.map((i) => str(i, LIMITS.listItem, "invalid_activity")) };
  }
  return { ...(title ? { title } : {}), text: str(c.text, LIMITS.text, "invalid_activity") };
}

// Questão da aula: 2 a 6 alternativas; ids a..f atribuídos pela ordem; `correct` = posições (0-based) das corretas.
// Única escolha => exatamente 1 correta; múltipla escolha => 1 ou mais (e pelo menos 1 errada).
export function cleanQuestion(input) {
  const options = Array.isArray(input?.options) ? input.options : null;
  if (!options || options.length < 2 || options.length > LIMITS.options) throw bad("invalid_question");
  const opts = options.map((o, i) => ({ id: OPTION_IDS[i], text: str(typeof o === "string" ? o : o?.text, LIMITS.optionText, "invalid_question") }));
  if (new Set(opts.map((o) => o.text.toLowerCase())).size !== opts.length) throw bad("invalid_question");
  const idx = Array.isArray(input.correct) ? [...new Set(input.correct)] : [];
  if (!idx.length || idx.some((i) => !Number.isInteger(i) || i < 0 || i >= opts.length)) throw bad("invalid_question");
  const multiple = Boolean(input.multiple);
  if (!multiple && idx.length !== 1) throw bad("invalid_question");
  if (multiple && idx.length >= opts.length) throw bad("invalid_question");
  return {
    type: multiple ? "multi" : "single",
    statement: str(input.statement, LIMITS.statement, "invalid_question"),
    options: opts,
    correct: idx.sort((a, b) => a - b).map((i) => opts[i].id),
    explanation: str(input.explanation, LIMITS.explanation, "invalid_question", { required: false }) || null
  };
}

// Reordenação: a lista nova precisa ter exatamente os mesmos ids (sem faltar, sem sobrar, sem repetir).
export function assertSameIds(current, ordered) {
  const a = [...current].sort();
  const b = Array.isArray(ordered) ? [...ordered].map(String).sort() : [];
  if (a.length !== b.length || a.some((id, i) => id !== b[i]) || new Set(b).size !== b.length) throw bad("invalid_order");
  return ordered.map(String);
}

// Problemas de uma versão. `blocking` impedem publicar (espelham academy_publish_version); `warnings` só avisam.
// tree = { modules:[{id,title,lessons:[{id,title,kind,body,question|null}]}] }
export function validateTree(tree) {
  const blocking = [];
  const warnings = [];
  const modules = tree?.modules || [];
  if (!modules.length) blocking.push({ code: "empty", message: "A versão não tem nenhum módulo." });
  for (const m of modules) {
    if (!m.lessons.length) blocking.push({ code: "module_without_lessons", moduleId: m.id, message: `O módulo "${m.title}" não tem aulas.` });
    for (const l of m.lessons) {
      if (l.kind === "final_exam" && !l.question) blocking.push({ code: "final_without_exam", lessonId: l.id, message: `A prova final "${l.title}" não tem questão.` });
      if (!(l.body?.blocks || []).length) warnings.push({ code: "lesson_without_content", lessonId: l.id, message: `A aula "${l.title}" não tem conteúdo.` });
      if (l.kind !== "final_exam" && !l.question) warnings.push({ code: "lesson_without_question", lessonId: l.id, message: `A aula "${l.title}" não tem questão (será concluída com um botão).` });
      if (l.body?.sample === true) warnings.push({ code: "sample_content", lessonId: l.id, message: `A aula "${l.title}" ainda tem texto de exemplo.` });
    }
  }
  return { ok: blocking.length === 0, blocking, warnings };
}
