import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Fase 4: proveniência dos originais vendorizados, licenças, inventário e proteção contra CRLF.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const atend = path.join(root, "docs/atendimento");
const esp = path.join(atend, "especialistas");
const lic = path.join(esp, "licencas");
const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const equipe = read(path.join(atend, "EQUIPE.md"));
const inventario = read(path.join(atend, "INVENTARIO.md"));
const auditoria = read(path.join(atend, "AUDITORIA-ORIGINAIS.md"));
const rows = equipe.split("\n").filter((l) => /^\| `/.test(l)).map((l) => {
  const c = l.split("|").map((x) => x.trim()).slice(1, -1);
  return { id: c[0].replace(/`/g, ""), origem: c[5], estado: c[6] };
});
const originais = [
  ...fs.readdirSync(esp).filter((f) => f.includes(".original.") && f.endsWith(".md")).map((f) => path.join(esp, f)),
  ...fs.readdirSync(path.join(atend, "metodologia")).map((f) => path.join(atend, "metodologia", f)),
];

test("Proveniência: todo original tem cabeçalho, licença existente e SHA256 do corpo conferido", () => {
  assert.equal(originais.length, 15);
  for (const f of originais) {
    const raw = fs.readFileSync(f);
    assert.ok(!raw.includes(13), `${f}: contém CR (bytes do original alterados)`);
    const txt = raw.toString("utf8");
    const cab = txt.match(/^<!--\n([\s\S]*?)\n-->\n/);
    assert.ok(cab, `${f}: sem cabeçalho de proveniência`);
    assert.match(cab[1], /Origem: https:\/\/github\.com\/\S+\/blob\/[0-9a-f]{40}\//);
    assert.match(cab[1], /Licença: (MIT|Apache-2\.0)/);
    const licFile = cab[1].match(/licencas\/([\w.-]+LICENSE\.txt)/);
    assert.ok(licFile && fs.existsSync(path.join(lic, licFile[1])), `${f}: licença ausente`);
    const sha = cab[1].match(/SHA256 do corpo: ([0-9a-f]{64})/);
    assert.ok(sha, `${f}: sem SHA256`);
    assert.equal(crypto.createHash("sha256").update(txt.slice(cab[0].length)).digest("hex"), sha[1], `${f}: corpo diferente do registrado`);
    assert.ok(auditoria.includes(sha[1]), `${f}: SHA fora da AUDITORIA-ORIGINAIS.md`);
  }
});

test("Varredura de perigo só no texto de perfil/extensão (originais são auditados à parte)", () => {
  const perigo = /(curl\s+[^\n]*\|\s*(ba)?sh|wget\s+http|npx\s+-y|npm\s+(i|install)\s|pnpm\s+(add|dlx)|pip\s+install|rm\s+-rf|chmod\s+\+x|Invoke-WebRequest|ignore (all )?previous instructions)/i;
  const proprios = fs.readdirSync(esp).filter((f) => f.endsWith(".md") && !f.includes(".original.")).map((f) => path.join(esp, f));
  assert.ok(proprios.length >= 24);
  for (const f of proprios) assert.doesNotMatch(read(f), perigo, `${f}: padrão perigoso`);
});

test("Nenhum script/hook/MCP/instalador em docs/atendimento (só .md/.txt)", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(atend)) assert.match(f, /\.(md|txt)$/, `arquivo não textual: ${f}`);
});

test("Extensão local cita em UMA linha o arquivo de licença correspondente", () => {
  const locais = fs.readdirSync(esp).filter((x) => x.endsWith(".local.md"));
  assert.equal(locais.length, 7);
  for (const f of locais) {
    const linhas = read(path.join(esp, f)).split("\n").filter((l) => l.startsWith("Licença dos originais:"));
    assert.equal(linhas.length, 1, f);
    const m = [...linhas[0].matchAll(/licencas\/([\w.-]+\.txt)/g)];
    assert.ok(m.length >= 1, f);
    for (const x of m) assert.ok(fs.existsSync(path.join(lic, x[1])), `${f}: ${x[1]} ausente`);
  }
});

test("INVENTARIO bate com EQUIPE: 7 original+extensão, 10 próprios, todos os arquivos inventariados", () => {
  const proprios = rows.filter((r) => r.origem === "AGENTE PRÓPRIO" && r.estado === "montado").map((r) => r.id);
  const compostos = rows.filter((r) => r.origem === "ORIGINAL + EXTENSÃO LOCAL").map((r) => r.id);
  assert.equal(proprios.length, 10);
  assert.equal(compostos.length, 7);
  for (const id of proprios) assert.ok(new RegExp(`^\| ${id} \|.*próprio — sem original adequado`, "m").test(inventario), `INVENTARIO sem linha própria: ${id}`);
  for (const id of compostos) assert.ok(inventario.includes(`| ${id} |`) || inventario.includes(`${id}, `) || inventario.includes(`, ${id}`), `INVENTARIO sem ${id}`);
  for (const f of originais) assert.ok(inventario.includes(path.basename(f)), `INVENTARIO sem ${path.basename(f)}`);
  assert.match(inventario, /## REJEITADOS/);
  assert.match(inventario, /## SÓ REFERÊNCIA/);
});

test(".gitattributes protege os vendorizados com -text", () => {
  const ga = read(path.join(root, ".gitattributes"));
  for (const g of ["docs/atendimento/especialistas/*.original.*.md -text", "docs/atendimento/metodologia/*.md -text", "docs/atendimento/especialistas/licencas/* -text"]) assert.ok(ga.includes(g), g);
});
