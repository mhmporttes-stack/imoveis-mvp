import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Estrutura do Despachante + invariantes de segurança. Nada vai ao banco.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const agentFiles = fs.readdirSync(path.join(root, ".claude/agents")).filter((f) => f.endsWith(".md"));

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, "frontmatter ausente");
  return m[1];
}

test("mapa cobre todos os agentes de .claude/agents (exceto o próprio Despachante)", () => {
  const mapa = read(".claude/despachante/MAPA-AGENTES.md");
  for (const f of agentFiles) {
    const name = f.replace(/\.md$/, "");
    if (name === "despachante") continue;
    assert.ok(mapa.includes(`\`${name}\``), `agente ${name} fora do mapa`);
  }
});

test("Despachante: delega (Agent/SendMessage), não executa (sem Bash/PowerShell/WebFetch)", () => {
  const fm = frontmatter(read(".claude/agents/despachante.md"));
  const tools = fm.match(/^tools:\s*(.+)$/m)[1].split(",").map((t) => t.trim());
  for (const t of ["Agent", "SendMessage", "ListAgents", "AskUserQuestion", "Read"]) assert.ok(tools.includes(t), t);
  for (const t of ["Bash", "PowerShell", "WebFetch", "WebSearch"]) assert.ok(!tools.includes(t), t);
  assert.match(read(".claude/agents/despachante.md"), /run_in_background: true/);
});

test("REGISTRO só usa os 5 estados permitidos", () => {
  const ok = new Set(["AGUARDANDO", "EM EXECUÇÃO", "AGUARDANDO DECISÃO DO MATHEUS", "CONCLUÍDA", "ERRO"]);
  const linhas = read(".claude/despachante/REGISTRO.md").split("\n").filter((l) => /^\| T-\d{8}-\d{2} /.test(l));
  for (const l of linhas) {
    const cols = l.split("|").map((c) => c.trim());
    assert.ok(ok.has(cols[7]), `estado inválido: ${cols[7]}`);
    assert.ok(["LEITURA", "ESCRITA"].includes(cols[6]), `modo inválido: ${cols[6]}`);
  }
});

test("segurança: proteções do banco e do deploy continuam no settings.json", () => {
  const s = JSON.parse(read(".claude/settings.json"));
  const ask = s.permissions.ask;
  for (const r of ["mcp__Supabase__apply_migration", "Bash(rm *)", "Bash(git push --force*)", "Bash(git reset --hard*)", "Bash(supabase *)", "Bash(pnpm dlx vercel env *)"]) {
    assert.ok(ask.includes(r), `ask perdeu: ${r}`);
  }
  assert.ok(!["bypassPermissions", "dontAsk"].includes(s.permissions.defaultMode), "defaultMode perigoso");
  const hook = JSON.stringify(s.hooks?.PreToolUse ?? []);
  assert.match(hook, /guard-destructive-sql\.mjs/);
  assert.match(hook, /execute_sql\|mcp__\.\*__apply_migration/);
  assert.ok(!s.permissions.allow.some((r) => /apply_migration/.test(r) && !r.startsWith("mcp__")), "migration liberada");
});

test("segurança: MCP Supabase estável é somente leitura", () => {
  const mcp = JSON.parse(read(".mcp.json"));
  assert.match(mcp.mcpServers.Supabase.url, /read_only=true/);
});

