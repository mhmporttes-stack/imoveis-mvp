import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintEmail } from "../.claude/skills/criar-email/tools/lint-email.mjs";

// Estrutura da frente E-MAIL (Diretor de E-mail). Nada vai ao banco nem à rede.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const fm = (t) => { const m = t.match(/^---\n([\s\S]*?)\n---/); assert.ok(m, "frontmatter ausente"); return m[1]; };
const SKILLS = ["diretor-email", "planejar-campanha-email", "criar-email", "auditar-entregabilidade", "analisar-campanha-email"];

test("agente email-specialist: frontmatter, sem banco/envio e sem ferramenta de e-mail", () => {
  const f = fm(read(".claude/agents/email-specialist.md"));
  assert.match(f, /^name: email-specialist$/m);
  assert.match(f, /^description: ".+"$/m);
  const tools = f.match(/^tools:\s*(.+)$/m)[1].split(",").map((t) => t.trim());
  for (const t of tools) assert.ok(!/^mcp__/.test(t), `ferramenta MCP inesperada: ${t}`);
  for (const t of ["Agent", "SendMessage", "NotebookEdit"]) assert.ok(!tools.includes(t), t);
});

test("skills existem, nome = pasta, e o agente e o mapa as citam", () => {
  const agent = read(".claude/agents/email-specialist.md");
  const mapa = read(".claude/despachante/MAPA-AGENTES.md");
  for (const s of SKILLS) {
    const f = fm(read(`.claude/skills/${s}/SKILL.md`));
    assert.match(f, new RegExp(`^name: ${s}$`, "m"));
    assert.match(f, /^description: /m);
    assert.ok(mapa.includes(`/${s}`), `mapa sem /${s}`);
    if (s !== "diretor-email") assert.ok(agent.includes(`/${s}`), `agente sem /${s}`);
  }
});

test("referências citadas nas skills existem", () => {
  for (const s of SKILLS) {
    const t = read(`.claude/skills/${s}/SKILL.md`);
    for (const m of t.matchAll(/`(references\/[\w.-]+)`/g)) assert.ok(fs.existsSync(path.join(root, `.claude/skills/${s}`, m[1])), `${s}: ${m[1]}`);
  }
});

test("rule email-marketing tem paths e o CLAUDE.md a aponta", () => {
  assert.match(fm(read(".claude/rules/email-marketing.md")), /^paths:\n(  - ".+"\n?)+/m);
  assert.match(read("CLAUDE.md"), /\.claude\/rules\/email-marketing\.md/);
  assert.ok(fs.existsSync(path.join(root, "docs/email/PERFIL.md")));
});

test("lint de e-mail: aprova peça mínima conforme e reprova problemas conhecidos", () => {
  const ok = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title></head><body><div style="display:none;max-height:0;overflow:hidden">pre</div><table role="presentation"><tr><td><img src="https://www.matheusmachadoimoveis.com.br/assets/a.png" alt="Logo" width="160"><a href="https://www.matheusmachadoimoveis.com.br/simulacao?utm_source=email&utm_medium=email">Simular</a><a href="{{unsubscribe_url}}">Descadastrar</a> CRECI 323106</td></tr></table></body></html>`;
  assert.deepEqual(lintEmail(ok).errors, []);
  const bad = lintEmail(`<html><body><script></script><img src="x.png"><a href="http://bit.ly/x">a</a><div style="display:flex">aprovação garantida</div></body></html>`);
  for (const frag of ["DOCTYPE", "<script>", "sem atributo alt", "https", "encurtador", "flex", "descadastro", "CRECI", "termo proibido"]) {
    assert.ok(bad.errors.some((e) => e.includes(frag)), `erro esperado: ${frag}`);
  }
});
