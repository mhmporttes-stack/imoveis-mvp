import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Orçamento de contexto: descrições curtas, CLAUDE.md sem perder segurança, mapa completo.
// Nada vai ao banco nem à rede.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

const SKILL_MAX = 180; // chars da description
const AGENT_MAX = 380;
// Limite subido de 13500 para 14500 em 2026-10-05: a regra 10 (identidade visual única, do dono) somou ~540 chars e foi
// preferido não enxugar o CLAUDE.md (regras invioláveis). Mantém o teto como freio contra crescimento sem controle.
const CLAUDE_MD_MAX = 14500; // chars; CLAUDE.md é carregado em toda sessão

function description(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, "frontmatter ausente");
  const lines = m[1].split("\n");
  const i = lines.findIndex((l) => /^description:/.test(l));
  assert.ok(i >= 0, "description ausente");
  let v = lines[i].replace(/^description:\s*/, "");
  const parts = /^[>|][-+]?$/.test(v.trim()) ? [] : [v];
  for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) parts.push(lines[j].trim());
  let s = parts.join(" ").trim();
  if (/^".*"$/.test(s)) s = JSON.parse(s);
  return s;
}

test("descrições de skills respeitam o limite", () => {
  const dirs = fs.readdirSync(path.join(root, ".claude/skills"));
  assert.ok(dirs.length >= 41);
  for (const d of dirs) {
    const desc = description(read(`.claude/skills/${d}/SKILL.md`));
    assert.ok(desc.length > 20, `${d}: descrição vazia`);
    assert.ok(desc.length <= SKILL_MAX, `${d}: ${desc.length} > ${SKILL_MAX}`);
  }
});

test("descrições de agentes respeitam o limite", () => {
  for (const f of fs.readdirSync(path.join(root, ".claude/agents")).filter((x) => x.endsWith(".md"))) {
    const desc = description(read(`.claude/agents/${f}`));
    assert.ok(desc.length <= AGENT_MAX, `${f}: ${desc.length} > ${AGENT_MAX}`);
  }
});

test("agentes mantêm tools/memory/model (a economia não mexe em permissões)", () => {
  for (const f of fs.readdirSync(path.join(root, ".claude/agents")).filter((x) => x.endsWith(".md"))) {
    assert.match(read(`.claude/agents/${f}`), /^tools:\s*\S/m, `${f}: tools ausente`);
  }
  const fm = read(".claude/agents/despachante.md").match(/^tools:\s*(.+)$/m)[1];
  assert.doesNotMatch(fm, /\bBash\b|PowerShell/);
});

test("CLAUDE.md mantém as palavras-chave de segurança e o orçamento", () => {
  const t = read("CLAUDE.md");
  assert.ok(t.length <= CLAUDE_MD_MAX, `CLAUDE.md com ${t.length} chars (> ${CLAUDE_MD_MAX})`);
  for (const k of ["hooks", "service role", "do_not_contact", "produção", "migrations", "MAPA-AGENTES.md", "Economia de contexto", "NUNCA cortar por economia"]) {
    assert.ok(t.toLowerCase().includes(k.toLowerCase()), `CLAUDE.md perdeu: ${k}`);
  }
  for (const tag of ["[REGRA OFICIAL DE NEGÓCIO]", "[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO]", "[PENDENTE DE VALIDAÇÃO]"]) {
    assert.ok(t.includes(tag), `CLAUDE.md perdeu a etiqueta ${tag}`);
  }
});

test("MAPA-AGENTES cobre todos os agentes e traz cabeçalho de delegação + contexto mínimo", () => {
  const mapa = read(".claude/despachante/MAPA-AGENTES.md");
  for (const f of fs.readdirSync(path.join(root, ".claude/agents")).filter((x) => x.endsWith(".md"))) {
    const name = f.replace(/\.md$/, "");
    if (name === "despachante") continue;
    assert.ok(mapa.includes(`\`${name}\``), `agente ${name} fora do mapa`);
  }
  assert.match(mapa, /Cabeçalho de delegação/);
  assert.match(mapa, /Contexto mínimo por especialista/);
  assert.match(mapa, /PARAR E AVISAR SE/);
});

test("Despachante mantém política de autonomia e bloco DECISÃO NECESSÁRIA", () => {
  const d = read(".claude/agents/despachante.md");
  assert.match(d, /Política de autonomia/);
  assert.match(d, /DECISÃO NECESSÁRIA/);
  assert.match(d, /Cabeçalho de delegação/);
});

test("AGENTS.md não duplica o roteamento (aponta para o MAPA) e mantém segurança própria", () => {
  const a = read("AGENTS.md");
  assert.match(a, /MAPA-AGENTES\.md/);
  assert.ok(a.length <= 9000, `AGENTS.md com ${a.length} chars`);
  assert.match(a, /Nunca\*\* escreva, imprima/);
  assert.match(a, /Antes de alterar código/);
  assert.match(a, /Comandos de validação/);
});
