import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Estrutura, segurança e roteamento do Agent Scout. Nada vai ao banco nem à rede.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const fm = (t) => {
  const m = t.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, "frontmatter ausente");
  return m[1];
};
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const scout = read(".claude/agents/agent-scout.md");
const skill = read(".claude/skills/scout/SKILL.md");
const mapa = read(".claude/despachante/MAPA-AGENTES.md");

test("Scout: frontmatter válido, name = arquivo, descrição dentro do limite", () => {
  const f = fm(scout);
  assert.match(f, /^name:\s*agent-scout\s*$/m);
  const d = JSON.parse(f.match(/^description:\s*(".*")\s*$/m)[1]);
  assert.ok(d.length <= 380, `descrição com ${d.length}`);
  for (const k of ["encontra", "avalia", "agentes", "skills", "plugins", "MCPs", "NÃO instala nem executa"]) assert.ok(d.includes(k), `descrição sem "${k}"`);
});

test("Scout: tools mínimas — pesquisa e escrita, sem Bash/PowerShell/Agent/MCP", () => {
  const tools = fm(scout).match(/^tools:\s*(.+)$/m)[1].split(",").map((s) => s.trim());
  for (const t of ["Read", "Grep", "Glob", "WebFetch", "WebSearch"]) assert.ok(tools.includes(t), `falta ${t}`);
  for (const t of tools) assert.ok(["Read", "Grep", "Glob", "WebFetch", "WebSearch", "Write", "Edit"].includes(t), `tool não permitida: ${t}`);
  assert.doesNotMatch(fm(scout), /^memory:/m, "sem memória persistente (custo de contexto)");
  assert.ok(scout.split("\n").length <= 120);
});

test("Scout: escrita limitada a docs/scout e dado externo tratado como não confiável", () => {
  assert.match(scout, /Escrita só em `docs\/scout\/\*\*`/);
  assert.match(scout, /não confiável/);
  assert.match(scout, /injeção/);
  assert.match(scout, /Não instala nem executa|não instala nem executa|Você não instala nem executa/);
  assert.match(scout, /Sem dados do CRM/);
});

test("Nenhum arquivo do Scout instrui instalar/executar código externo (só pode proibir)", () => {
  const files = [".claude/agents/agent-scout.md", ".claude/skills/scout/SKILL.md", ...fs.readdirSync(path.join(root, "docs/scout")).filter((f) => f.endsWith(".md")).map((f) => `docs/scout/${f}`)];
  const bad = /npm (i|install)\b|pnpm (add|install)|pip install|npx |curl[^\n]*\|\s*(sh|bash)|claude mcp add|claude plugin install|--dangerously|\/plugin install|git clone/i;
  for (const f of files) {
    for (const line of read(f).split("\n")) {
      if (!bad.test(line)) continue;
      // admitido apenas em contexto de proibição/risco/descrição de terceiros
      assert.match(line, /nunca|não|NÃO|risco|Risco|proib|sem |EXECUTA|executa|Adoção|instala via|roda/i, `${f}: instrução suspeita: ${line.slice(0, 120)}`);
    }
  }
});

test("Skill /scout: descrição ≤180 e aponta para o agente", () => {
  const d = fm(skill).match(/^description:\s*(.+)$/m)[1];
  assert.ok(d.length <= 180 && d.length > 20, `descrição com ${d.length}`);
  assert.match(skill, /agent-scout/);
  assert.match(skill, /claude --agent agent-scout/);
});

test("Docs do Scout existem e a rubrica cobre segurança, licença e contexto", () => {
  for (const f of ["FONTES", "RUBRICA", "TEMPLATE-RELATORIO", "ESTUDO"]) assert.ok(fs.existsSync(path.join(root, `docs/scout/${f}.md`)), f);
  const r = read("docs/scout/RUBRICA.md");
  for (const k of ["Licença", "Segurança", "Custo de contexto", "ADOTAR", "DESCARTAR"]) assert.ok(r.includes(k), k);
  const fo = read("docs/scout/FONTES.md");
  for (const k of ["registry.modelcontextprotocol.io", "registry.npmjs.org", "pypi.org/pypi", "api.github.com", "code.claude.com"]) assert.ok(fo.includes(k), k);
});

test("Central: MAPA lista o Scout, a regra 'antes de criar especialista' e o Despachante a replica", () => {
  assert.ok(mapa.includes("`agent-scout`"));
  assert.match(mapa, /Antes de criar um especialista SIGNIFICATIVO do zero/);
  assert.match(mapa, /Não vale/);
  const d = read(".claude/agents/despachante.md");
  assert.match(d, /Agent Scout/);
  assert.match(d, /nada instalado/);
  assert.match(d, /significativo/);
});

// Proxy lexical do roteamento: a linha "palavra-chave → agente" do MAPA; a palavra mais longa vence.
function route(query) {
  const line = mapa.split("\n").find((l) => l.includes("→ designer-crm") && l.includes("→ crm-editor"));
  let best = { len: 0, agent: null };
  for (const seg of line.split(" · ")) {
    const [kws, rest] = seg.split("→");
    if (!rest) continue;
    const agent = rest.trim().match(/[a-z][a-z-]+/)[0];
    for (const k of kws.split("/").map((x) => norm(x.trim())).filter(Boolean)) {
      if (norm(query).includes(k) && k.length > best.len) best = { len: k.length, agent };
    }
  }
  return best.agent;
}

test("Roteamento: pedidos de descoberta vão ao Scout", () => {
  for (const q of ["preciso turbinar o Auditor", "existe agente pronto para analisar contratos?", "existe skill pronta para PDF de laudo", "existe MCP pronto para Google Calendar", "quero criar um especialista novo de jurídico"]) {
    assert.equal(route(q), "agent-scout", q);
  }
});

test("Roteamento: pedidos do CRM continuam nos agentes atuais", () => {
  const casos = [["bug no botão de salvar do cliente", "crm-editor"], ["como está o funil esta semana", "analista-dados"], ["melhorar o PDF da proposta", "designer-crm"], ["como está o caixa do mês", "gestor-financeiro"], ["a IA errou na documentação", "analista-documental"], ["audite as permissões", "auditor-crm"]];
  for (const [q, a] of casos) assert.equal(route(q), a, q);
});
