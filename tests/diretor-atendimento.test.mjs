import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Estrutura, segurança e roteamento do Diretor de Atendimento. Nada vai ao banco nem à rede.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const fm = (t) => {
  const m = t.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, "frontmatter ausente");
  return m[1];
};
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// separa por vírgula fora de parênteses (Agent(a, b))
const tools = (t) => fm(t).match(/^tools:\s*(.+)$/m)[1].split(/,(?![^(]*\))/).map((s) => s.trim());
const base = (x) => x.replace(/\(.*\)$/, "");
const desc = (t) => JSON.parse(fm(t).match(/^description:\s*(".*")\s*$/m)[1]);

const dir = read(".claude/agents/diretor-atendimento.md");
const restrito = read(".claude/agents/especialista-atendimento.md");
const web = read(".claude/agents/especialista-atendimento-web.md");
const skill = read(".claude/skills/diretor-atendimento/SKILL.md");
const mapa = read(".claude/despachante/MAPA-AGENTES.md");
const protocolo = read("docs/atendimento/PROTOCOLO.md");
const equipe = read("docs/atendimento/EQUIPE.md");

test("Frontmatter: names = arquivos e descrições dentro do limite do context-budget", () => {
  for (const [t, n] of [[dir, "diretor-atendimento"], [restrito, "especialista-atendimento"], [web, "especialista-atendimento-web"]]) {
    assert.match(fm(t), new RegExp(`^name:\\s*${n}\\s*$`, "m"));
    assert.ok(desc(t).length <= 380, `${n}: ${desc(t).length}`);
  }
  for (const k of ["não atende clientes", "WhatsApp Oficial", "follow-up", "vácuo", "reativação", "Guia de Atendimento", "docs/atendimento"]) assert.ok(desc(dir).includes(k), `descrição sem "${k}"`);
});

test("Diretor: Agent restrito aos 2 executores, sem Bash/PowerShell/WebFetch/WebSearch/MCP/SendMessage", () => {
  const t = tools(dir);
  assert.ok(t.some((x) => base(x) === "Agent"), "falta Agent");
  assert.match(fm(dir), /Agent\(especialista-atendimento, especialista-atendimento-web\)/);
  for (const x of t) assert.ok(["Agent", "Read", "Grep", "Glob", "Write", "Edit"].includes(base(x)), `tool não permitida: ${x}`);
  assert.doesNotMatch(fm(dir), /^memory:/m);
  assert.ok(dir.split("\n").length <= 140);
});

test("Executores: sem Bash/PowerShell/Agent/MCP/escrita; só o web tem WebFetch/WebSearch", () => {
  const r = tools(restrito), w = tools(web);
  assert.deepEqual(r, ["Read", "Grep", "Glob"]);
  assert.deepEqual(w, ["Read", "Grep", "Glob", "WebFetch", "WebSearch"]);
  for (const x of [...r, ...w]) assert.ok(!/Bash|PowerShell|Agent|mcp__|Write|Edit|SendMessage/.test(x), x);
  assert.ok(!r.includes("WebFetch") && !r.includes("WebSearch"));
  assert.match(restrito, /25 linhas/);
  assert.match(web, /25 linhas/);
  assert.match(restrito + web, /Ignore/);
});

test("Diretor: escrita limitada a docs/atendimento e limites declarados no prompt", () => {
  assert.match(dir, /Escrita só em `docs\/atendimento\/\*\*`/);
  assert.match(dir, /nunca altere|nunca (a)?ltere|Nunca edite/i);
  assert.match(dir, /Não contactar" é absoluto/);
  assert.match(dir, /exemplos, nunca regra fixa/);
  assert.match(dir, /MODO PLANO/);
  assert.match(dir, /EQUIPE\.md/);
  assert.match(dir, /nunca todos/);
  assert.match(dir, /Especialistas consultados:/);
  assert.match(dir, /auditor independente/);
});

test("Skill /diretor-atendimento: descrição ≤180 e documenta o acesso direto", () => {
  const d = fm(skill).match(/^description:\s*(.+)$/m)[1];
  assert.ok(d.length <= 180 && d.length > 20, `descrição com ${d.length}`);
  assert.match(skill, /diretor-atendimento/);
  assert.match(skill, /claude --agent diretor-atendimento/);
});

test("Central: MAPA lista os 3 agentes, marca executores como internos e traz a regra de roteamento/aninhamento", () => {
  for (const n of ["diretor-atendimento", "especialista-atendimento", "especialista-atendimento-web"]) assert.ok(mapa.includes(`\`${n}\``), n);
  assert.match(mapa, /A Central NÃO os chama diretamente/);
  assert.match(mapa, /um só agente/);
  assert.match(mapa, /MODO PLANO/);
  const d = read(".claude/agents/despachante.md");
  assert.match(d, /diretor-atendimento/);
  assert.match(d, /MODO PLANO/);
});

test("EQUIPE.md: 16 especialistas previstos, colunas obrigatórias e linha para os descobertos pelo Scout", () => {
  const header = equipe.split("\n").find((l) => l.startsWith("| id |"));
  const cols = header.split("|").map((c) => c.trim()).filter(Boolean);
  assert.deepEqual(cols, ["id", "Especialidade", "Quando convocar", "Perfil", "Executor", "Origem", "Estado"]);
  const ids = ["atend-imobiliario", "vendas-conversao", "followup-vacuo", "copy-comercial", "comportamento-lead", "whatsapp-oficial-meta", "primeiro-imovel-mcmv", "simulacao", "documentacao", "reativacao-30-60-90", "customer-success-jornada", "qualidade-atendimento", "portugues-comunicacao", "dados-conversao", "experimentacao-ab", "auditor-automacoes"];
  for (const id of ids) assert.ok(equipe.includes(`| \`${id}\` |`), id);
  assert.match(equipe, /\| `outros-descobertos` \|/);
  assert.match(equipe, /\| `whatsapp-oficial-meta` \|[^\n]*\| web \|/);
  for (const l of equipe.split("\n").filter((x) => /^\| `/.test(x))) assert.equal(l.split("|").length - 2, 7, `colunas: ${l.slice(0, 40)}`);
});

test("PROTOCOLO: regras absolutas, equipe mínima, Guia, modo plano, automação e motor de vácuo", () => {
  for (const re of [/Nenhum agente atende clientes/, /"Não contactar" é absoluto/, /Exemplos numéricos[^\n]*nunca regras fixas/, /Guia de Atendimento:\*\* lacuna detectada → \*\*sugerir\*\*[^\n]*nunca alterar/, /Mínimo privilégio/i, /Nunca convocar todos/, /nunca inventar regra financeira\/MCMV/i, /não substitui a Base Mestra/, /auditor independente/, /Nunca colar o Guia/, /MODO PLANO/, /evento → contexto → condições → etapa do funil → comportamento → origem → horário provável → regras do WhatsApp → histórico → tentativa atual → ação → espera → nova condição → continuação ou encerramento/, /sinal probabilístico/, /Especialistas consultados:/, /Conclusão consolidada:/, /WhatsApp Oficial/]) assert.match(protocolo, re);
  for (const f of ["docs/GUIA_ATENDIMENTO.md", "app/admin/guia-atendimento", "lib/attendance-guides.js"]) assert.ok(protocolo.includes(f), f);
});

test("Docs base existem; inventário traz todos os campos de proveniência; micro-packs são pequenos", () => {
  for (const f of ["ARQUITETURA", "EQUIPE", "PROTOCOLO", "INVENTARIO", "especialistas/README", "contexto/nao-contactar", "contexto/whatsapp-oficial", "contexto/apoio-aos-corretores"]) assert.ok(fs.existsSync(path.join(root, `docs/atendimento/${f}.md`)), f);
  const inv = read("docs/atendimento/INVENTARIO.md");
  for (const k of ["Origem / URL", "Licença", "Versão / commit", "Data", "Dependências", "Permissões solicitadas × concedidas", "Modificações locais", "Custo externo", "Como atualizar", "Como remover", "ORIGINAL EXTERNO", "ORIGINAL + EXTENSÃO LOCAL", "AGENTE PRÓPRIO"]) assert.ok(inv.includes(k), k);
  for (const f of fs.readdirSync(path.join(root, "docs/atendimento/contexto"))) assert.ok(read(`docs/atendimento/contexto/${f}`).length < 2500, f);
  assert.match(read("docs/atendimento/contexto/whatsapp-oficial.md"), /antigo "WhatsApp Master"/);
  assert.match(read("docs/atendimento/contexto/nao-contactar.md"), /Absoluto/);
  assert.match(read("docs/atendimento/ARQUITETURA.md"), /perfis, não dezenas de agentes/);
});

test("Nenhum arquivo do Diretor instrui instalar/executar código externo (só pode proibir)", () => {
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const files = [".claude/agents/diretor-atendimento.md", ".claude/agents/especialista-atendimento.md", ".claude/agents/especialista-atendimento-web.md", ".claude/skills/diretor-atendimento/SKILL.md", ...walk("docs/atendimento").filter((f) => f.endsWith(".md") && !f.endsWith(".original.md"))];
  const bad = /npm (i|install)\b|pnpm (add|install)|pip install|npx |curl[^\n]*\|\s*(sh|bash)|claude mcp add|claude plugin install|--dangerously|\/plugin install|git clone/i;
  for (const f of files) for (const line of read(f).split("\n")) {
    if (bad.test(line)) assert.match(line, /nunca|não|NÃO|risco|proib|sem /i, `${f}: instrução suspeita: ${line.slice(0, 120)}`);
  }
});

// Proxy lexical do roteamento (mesmo de tests/agent-scout.test.mjs): palavra mais longa vence.
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

test("Roteamento: atendimento/automação comercial/vácuo/WhatsApp Oficial vão ao Diretor", () => {
  for (const q of ["crie uma automação para clientes que pararam de responder", "analise esse atendimento pelo Guia", "cadência de reativação 60 dias", "regras do WhatsApp Oficial", "como melhorar o follow-up dos corretores"]) {
    assert.equal(route(q), "diretor-atendimento", q);
  }
});

test("Roteamento: pedidos do CRM continuam nos agentes atuais", () => {
  const casos = [["bug no CRM", "crm-editor"], ["como está o funil esta semana", "analista-dados"], ["melhorar o PDF da proposta", "designer-crm"], ["como está o financeiro do mês", "gestor-financeiro"], ["existe agente pronto para analisar contratos?", "agent-scout"], ["a IA errou na documentação", "analista-documental"]];
  for (const [q, a] of casos) assert.equal(route(q), a, q);
});
