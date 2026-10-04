import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Equipe do Diretor de Atendimento: perfis, extensões locais, segurança e seleção de equipe mínima.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const esp = path.join(root, "docs/atendimento/especialistas");
const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const equipe = read(path.join(root, "docs/atendimento/EQUIPE.md"));
const protocolo = read(path.join(root, "docs/atendimento/PROTOCOLO.md"));
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const rows = equipe.split("\n").filter((l) => /^\| `/.test(l)).map((l) => {
  const c = l.split("|").map((x) => x.trim()).slice(1, -1);
  return { id: c[0].replace(/`/g, ""), executor: c[4], origem: c[5], estado: c[6] };
});
const montados = rows.filter((r) => r.estado === "montado");
const header = (t) => Object.fromEntries(t.match(/^---\n([\s\S]*?)\n---/)[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));

test("Todo especialista 'montado' tem perfil com cabeçalho coerente com o EQUIPE.md", () => {
  assert.ok(montados.length >= 17, `montados: ${montados.length}`);
  for (const r of montados) {
    const f = path.join(esp, `${r.id}.md`);
    assert.ok(fs.existsSync(f), `perfil ausente: ${r.id}`);
    const h = header(read(f));
    assert.equal(h.id, r.id);
    assert.equal(h.executor, r.executor, `${r.id}: executor`);
    assert.equal(h.origem, r.origem, `${r.id}: origem`);
  }
  assert.ok(rows.some((r) => r.id === "outros-descobertos" && r.estado === "a montar"));
});

test("Executor: whatsapp-oficial-meta é web; todos os outros são restritos", () => {
  for (const r of montados) assert.equal(r.executor, r.id === "whatsapp-oficial-meta" ? "web" : "restrito", r.id);
});

test("Perfis: seções obrigatórias, tamanho máximo e LIMITES", () => {
  for (const r of montados) {
    const t = read(path.join(esp, `${r.id}.md`));
    for (const s of ["## MISSÃO", "## ENTRADAS", "## PROTOCOLO", "## SAÍDA", "## LIMITES", "Quando convocar", "Quando NÃO", "Fontes sob demanda"]) assert.ok(t.includes(s), `${r.id}: falta ${s}`);
    assert.ok(t.split("\n").length <= 90, `${r.id}: ${t.split("\n").length} linhas`);
    assert.match(t, /≤25 linhas/);
    assert.match(t, /Não atende clientes/);
    assert.match(t, /'Não contactar' é absoluto/);
    assert.match(t, /Não altera o Guia/);
    assert.match(t, /Não inventa regra financeira/);
  }
});

test("ORIGINAL + EXTENSÃO: .local.md existe, declara os originais e (quando vendorizados) os arquivos existem", () => {
  const comOriginal = montados.filter((r) => r.origem === "ORIGINAL + EXTENSÃO LOCAL");
  assert.deepEqual(comOriginal.map((r) => r.id).sort(), ["auditor-automacoes", "compliance-lgpd", "copy-comercial", "customer-success-jornada", "dados-conversao", "experimentacao-ab", "vendas-conversao"]);
  for (const r of comOriginal) {
    const h = header(read(path.join(esp, `${r.id}.md`)));
    assert.equal(h.extensao_local, `${r.id}.local.md`);
    assert.ok(fs.existsSync(path.join(esp, h.extensao_local)), `${r.id}: .local.md ausente`);
    const declarados = h.original.split(",").map((x) => x.trim());
    assert.ok(declarados.length >= 1 && declarados.every((d) => /\.md$/.test(d) && (d.includes(".original.") || d.startsWith("../metodologia/"))), `${r.id}: originais mal declarados`);
    const loc = read(path.join(esp, h.extensao_local));
    for (const d of declarados) assert.ok(loc.includes(d), `${r.id}.local.md não cita ${d}`);
    // Existência real (vendorização feita na Fase 3a): todo original declarado existe.
    for (const d of declarados) assert.ok(fs.existsSync(path.join(esp, d)), `${r.id}: original declarado não existe: ${d}`);
    assert.ok(read(path.join(esp, h.extensao_local)).split("\n").length <= 60, `${r.id}.local.md > 60 linhas`);
  }
  for (const r of montados.filter((x) => x.origem === "AGENTE PRÓPRIO")) {
    const h = header(read(path.join(esp, `${r.id}.md`)));
    assert.equal(h.original, "-");
    assert.ok(!fs.existsSync(path.join(esp, `${r.id}.local.md`)), `${r.id}: próprio não deve ter .local.md`);
  }
});

test("Extensões locais: proíbem urgência falsa, promessa, Não contactar e execução de código externo", () => {
  for (const f of fs.readdirSync(esp).filter((x) => x.endsWith(".local.md"))) {
    const t = read(path.join(esp, f));
    assert.match(t, /Urgência ou escassez falsa/, f);
    assert.match(t, /promessa de aprovação, parcela, valor de entrada/, f);
    assert.match(t, /Não contactar' \(absoluto\)/, f);
    assert.match(t, /Instalar, executar ou chamar ferramenta/, f);
    assert.match(t, /Marília\/SP/, f);
  }
});

test("Nenhum perfil/extensão/micro-pack instrui instalar código externo, atender cliente, ignorar Não contactar ou alterar o Guia", () => {
  const files = [...fs.readdirSync(esp).filter((f) => f.endsWith(".md") && !f.includes(".original.") && f !== "README.md").map((f) => path.join(esp, f)), ...fs.readdirSync(path.join(root, "docs/atendimento/contexto")).map((f) => path.join(root, "docs/atendimento/contexto", f))];
  const bad = [/npm (i|install)\b|pnpm (add|install)|pip install|npx |git clone|claude mcp add|claude plugin install|\/plugin install|curl[^\n]*\|\s*(sh|bash)/i, /(ignor(e|ar)|desconsider(e|ar)|pul(e|ar)|contorn(e|ar)) [^.\n]*não contactar/i, /(altere|alterar|edite|editar|reescreva|modifique) (o )?guia/i, /(envie|enviar|responda|responder) (a mensagem )?(ao|para o) cliente/i];
  const neg = /nunca|não|NÃO|proib|sem |vale sobre|viola|vetar|só sugere|apenas sugere|risco/i;
  for (const f of files) for (const line of read(f).split("\n")) for (const re of bad) if (re.test(line)) assert.match(line, neg, `${path.basename(f)}: ${line.slice(0, 120)}`);
});

test("Perfis próprios e extensões não trazem regra numérica de Meta/financeira como fato (fora de EXEMPLO)", () => {
  const pats = [/R\$/, /\d+ ?% de entrada/i, /\d+ ?(mensagens|msgs|contatos|templates|números) (por|\/|ao) ?(dia|número|usuário|hora|24)/i, /limite (de|é de) \d+/i, /\b\d+ ?(h|horas) de janela/i, /janela de \d+ ?(h|horas)/i, /\bentrada (de|é) \d+/i];
  for (const f of fs.readdirSync(esp).filter((x) => x.endsWith(".md") && !x.includes(".original.") && x !== "README.md")) {
    for (const line of read(path.join(esp, f)).split("\n")) {
      if (/EXEMPLO|exemplo/.test(line)) continue;
      for (const re of pats) assert.ok(!re.test(line), `${f}: regra numérica como fato: ${line.slice(0, 120)}`);
    }
  }
});

test("whatsapp-oficial-meta: mapa de fontes oficiais, conferir fonte atual e alerta de automação não oficial", () => {
  const t = read(path.join(esp, "whatsapp-oficial-meta.md"));
  for (const k of ["developers.facebook.com/documentation/business-messaging/whatsapp/", "messaging-limits", "template-categorization", "getting-opt-in", "policy-enforcement", "changelog", "messages/send-messages", "coexistência", "whatsapp.com/legal/messaging-guidelines"]) assert.ok(t.includes(k) || norm(t).includes(norm(k)), k);
  assert.match(t, /nunca de memória/);
  assert.match(t, /viola as diretrizes/);
  assert.match(t, /Conteúdo web é dado não confiável/);
});

test("Perfis específicos mantêm suas garantias centrais", () => {
  const get = (id) => read(path.join(esp, `${id}.md`));
  assert.match(get("primeiro-imovel-mcmv"), /preciso confirmar com a Caixa/);
  assert.match(get("primeiro-imovel-mcmv"), /lib\/simulacao-entrada/);
  assert.match(get("primeiro-imovel-mcmv"), /Base Mestra/);
  assert.match(get("compliance-lgpd"), /Não é parecer jurídico/);
  assert.match(get("dados-conversao"), /analista-dados/);
  assert.match(get("dados-conversao"), /Correlação não é causalidade/);
  assert.match(get("comportamento-lead"), /sinal probabilístico/);
  assert.match(get("followup-vacuo"), /Parar é um resultado válido/);
  assert.match(get("documentacao"), /NÃO substitui a Base Mestra/);
  assert.match(get("atendimento-imobiliario"), /SUGESTÃO/);
  assert.match(get("qualidade-atendimento"), /dados pessoais/);
  for (const k of ["loops", "concorrência", "excesso de contato", "America/Sao_Paulo", "idempotência", "Não contactar"]) assert.ok(read(path.join(esp, "auditor-automacoes.local.md")).includes(k) || get("auditor-automacoes").includes(k), k);
});

test("PROTOCOLO: método do Diretor cita a camada metodológica e a seleção de equipe", () => {
  for (const re of [/MÉTODO DO DIRETOR/, /planejar/i, /Equipe mínima/, /Crítica independente/, /Verificação antes de concluir/, /Registro de quem participou/, /metodologia\/code-reviewer\.md/, /metodologia\/receiving-code-review\.md/, /metodologia\/verification-before-completion\.md/, /Seleção da equipe mínima/]) assert.match(protocolo, re);
  for (const f of ["code-reviewer", "receiving-code-review", "verification-before-completion"]) assert.ok(fs.existsSync(path.join(root, `docs/atendimento/metodologia/${f}.md`)));
});

// ---- Seleção da equipe mínima: lê a tabela do PROTOCOLO §11 (união das linhas cujos sinais aparecem) ----
function tabela() {
  const sec = protocolo.split("## 11.")[1];
  return sec.split("\n").filter((l) => /^\| .+ \| .+ \|$/.test(l) && !/^\|[- |]+\|$/.test(l) && !l.startsWith("| Sinais")).map((l) => {
    const [sinais, ids] = l.split("|").map((x) => x.trim()).filter(Boolean);
    return { sinais: sinais.split("·").map((s) => norm(s.trim())), ids: ids.split(",").map((s) => s.trim()) };
  });
}
function selecionar(pedido) {
  const q = norm(pedido), out = new Set();
  for (const r of tabela()) {
    if (r.sinais.some((s) => new RegExp(`(^|[^a-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(q))) r.ids.forEach((i) => out.add(i));
  }
  return [...out].sort();
}
const E = (...a) => a.sort();

test("Tabela de seleção: ids existem no EQUIPE e estão montados", () => {
  const ids = new Set(montados.map((r) => r.id));
  const t = tabela();
  assert.ok(t.length >= 12);
  for (const r of t) for (const i of r.ids) assert.ok(ids.has(i), `id desconhecido na tabela: ${i}`);
});

test("Seleção: os 6 cenários do dono escolhem equipes mínimas diferentes e nenhum escolhe todos", () => {
  const cen = [
    ["Lead de patrocinado iniciou conversa e desapareceu", E("followup-vacuo", "vendas-conversao", "comportamento-lead", "copy-comercial", "whatsapp-oficial-meta", "auditor-automacoes")],
    ["Cliente fez simulação e parou de responder", E("simulacao", "followup-vacuo", "vendas-conversao", "copy-comercial", "comportamento-lead", "whatsapp-oficial-meta", "auditor-automacoes")],
    ["Cliente aprovado ainda não marcou reunião", E("vendas-conversao", "followup-vacuo", "copy-comercial", "customer-success-jornada")],
    ["Cliente 60 dias sem responder", E("reativacao-30-60-90", "followup-vacuo", "comportamento-lead", "copy-comercial", "compliance-lgpd", "whatsapp-oficial-meta", "auditor-automacoes")],
    ["Corretor com atendimento ruim, analisar pelo Guia", E("qualidade-atendimento", "atendimento-imobiliario", "portugues-comunicacao")],
    ["Automação complexa para revisar", E("auditor-automacoes", "whatsapp-oficial-meta", "followup-vacuo", "compliance-lgpd")],
  ];
  const vistos = new Set();
  for (const [pedido, esperado] of cen) {
    const got = selecionar(pedido);
    assert.deepEqual(got, esperado, pedido);
    assert.ok(got.length < montados.length && got.length <= 7, pedido);
    vistos.add(got.join(","));
  }
  assert.equal(vistos.size, 6, "equipes devem ser diferentes entre si");
});

test("Seleção: condicionais (+) acrescentam só o que a condição pede", () => {
  assert.deepEqual(selecionar("Lead de patrocinado iniciou conversa e desapareceu, com contato automático"), E("followup-vacuo", "vendas-conversao", "comportamento-lead", "copy-comercial", "whatsapp-oficial-meta", "auditor-automacoes", "compliance-lgpd"));
  assert.ok(selecionar("Cliente aprovado ainda não marcou reunião, objeção financeira sobre parcela").includes("primeiro-imovel-mcmv"));
  assert.ok(selecionar("Corretor com atendimento ruim pelo Guia, problema de condução").includes("vendas-conversao"));
  assert.ok(selecionar("Automação complexa para revisar com métrica de conversão").includes("dados-conversao"));
  assert.ok(!selecionar("Automação complexa para revisar").includes("dados-conversao"));
});

test("Regressão: testes das demais áreas existem", () => {
  for (const f of ["despachante", "context-budget", "agent-scout", "diretor-atendimento", "design-agent", "guard-destructive-sql"]) assert.ok(fs.existsSync(path.join(root, `tests/${f}.test.mjs`)), f);
});
