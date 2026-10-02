import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Estrutura do Diretor de Design (agente + base modular + crítico independente) e integração
// com a Central. Só leitura de arquivos do repositório; nada vai ao banco.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, "frontmatter ausente");
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

const designer = frontmatter(read(".claude/agents/designer-crm.md"));
const critic = frontmatter(read(".claude/agents/design-critic.md"));
const toolsOf = (fm) => fm.tools.split(",").map((t) => t.trim());

test("Designer mantém o nome que a Central chama e a descrição cobre o novo escopo", () => {
  assert.equal(designer.name, "designer-crm");
  for (const word of ["Diretor de Design", "PDF", "imagem", "fotografia", "revisão visual", "nunca lib/"]) {
    assert.ok(designer.description.includes(word), `descrição sem "${word}"`);
  }
});

test("Designer: edita apresentação e só pode chamar o crítico; nunca banco/migration", () => {
  const tools = toolsOf(designer);
  for (const t of ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "WebFetch", "WebSearch", "Agent(design-critic)"]) assert.ok(tools.includes(t), t);
  assert.ok(!tools.some((t) => /supabase|apply_migration|execute_sql/i.test(t)));
  assert.ok(!tools.includes("Agent"), "Agent sem allowlist liberaria qualquer subagente");
  assert.match(read(".claude/agents/designer-crm.md"), /Não\*\* altera `lib\/`, `app\/api\/\*\*`, banco/);
});

test("design-critic é independente: somente leitura, sem Edit/Write/Agent", () => {
  const tools = toolsOf(critic);
  for (const t of ["Edit", "Write", "NotebookEdit", "Agent"]) assert.ok(!tools.includes(t), `crítico não pode ter ${t}`);
  assert.ok(tools.includes("Read"));
  assert.match(read(".claude/agents/design-critic.md"), /Nunca avalie lendo código/);
});

test("Central: MAPA-AGENTES lista Designer (escopo novo) e crítico com roteamento", () => {
  const mapa = read(".claude/despachante/MAPA-AGENTES.md");
  assert.match(mapa, /\| `designer-crm` \(\*\*Diretor de Design\*\*\)/);
  assert.match(mapa, /\| `design-critic` \|/);
  for (const k of ["PDF/proposta", "material de venda", "imagem/foto", "revisão visual"]) assert.ok(mapa.includes(k), `roteamento sem "${k}"`);
  assert.match(mapa, /PEDIDO À CENTRAL/);
});

test("Base modular: todo módulo está no índice, o índice não aponta para arquivo inexistente", () => {
  const dir = ".claude/design";
  const modules = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".md") && f !== "README.md");
  const index = read(`${dir}/README.md`);
  for (const f of modules) assert.ok(index.includes(`\`${f}\``), `módulo ${f} fora do índice`);
  for (const m of index.matchAll(/^\| `([A-Z-]+\.md)` \|/gm)) assert.ok(modules.includes(m[1]), `índice cita ${m[1]} inexistente`);
  assert.ok(fs.existsSync(path.join(root, dir, "tools/renderizar-pdf.mjs")));
});

test("Economia de contexto: módulos pequenos e CORE enxuto", () => {
  const dir = ".claude/design";
  const tokens = (file) => Math.round(read(`${dir}/${file}`).length / 3.5);
  assert.ok(tokens("CORE.md") <= 2600, "CORE passou do orçamento (~2,6k tokens)");
  for (const f of fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith(".md"))) assert.ok(tokens(f) <= 3200, `${f} grande demais para carga seletiva`);
});

test("Princípios inegociáveis presentes onde devem estar", () => {
  const core = read(".claude/design/CORE.md");
  for (const p of ["INTENT OVER PIXELS", "Nem toda informação precisa de card", "Forma muda, fato não", "Estados são especificação", "BRAND CONSTANTS", "LEGACY PATTERNS"]) assert.ok(core.toLowerCase().includes(p.toLowerCase()), `CORE sem "${p}"`);
  const photo = read(".claude/design/PHOTOGRAPHY.md");
  assert.match(photo, /MELHORAR NÃO É RECONSTRUIR/);
  assert.match(read(".claude/design/IMAGING.md"), /MUTÁVEL[\s\S]*PRESERVADO/);
  const review = read(".claude/design/REVIEW.md");
  assert.match(review, /Se eu removesse a logo/);
  assert.match(review, /Não aprove interface, PDF ou imagem \*\*lendo código\*\*/);
});

test("Skills: design-crm aponta para o CORE e direcao-criativa existe com roteiro", () => {
  assert.match(read(".claude/skills/design-crm/SKILL.md"), /\.claude\/design\/CORE\.md/);
  const s = read(".claude/skills/direcao-criativa/SKILL.md");
  assert.equal(frontmatter(s).name, "direcao-criativa");
  assert.match(s, /FATOS \(intocáveis\)/);
  assert.match(s, /Segura[\s\S]*Moderna[\s\S]*Ousada/);
});

test("Identidade: âncoras de marca documentadas (logo + paleta medida)", () => {
  const d = read(".claude/design/DESIGN.md");
  for (const hex of ["#3673C2", "#031D3A"]) assert.ok(d.includes(hex), `DESIGN sem ${hex}`);
  for (const f of ["matheus-machado-symbol.png", "og-matheus-machado-v2.png"]) assert.ok(fs.existsSync(path.join(root, "public/assets", f)), `asset ${f} sumiu`);
});
