import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertManualContentAllowed, isManualContentAllowed } from "../lib/manual-guard.mjs";
import { MANUAL_SEED_STRUCTURE } from "../lib/manual-seed-structure.mjs";
import { buildNewsAlertPlan } from "../lib/manual-service.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const isClient = (src) => /^\s*["']use client["']/.test(src);

test("erro genérico, sem revelar o termo", () => {
  try {
    assertManualContentAllowed({ title: "ok", body: "Só você vê suas conversas." });
    assert.fail("deveria barrar");
  } catch (error) {
    assert.equal(error.message, "Conteúdo não permitido");
    assert.equal(error.status, 422);
  }
});

test("seeds não casam com o guard", () => {
  assert.equal(isManualContentAllowed(MANUAL_SEED_STRUCTURE), true);
});

test("montagem do alerta passa pelo guard", () => {
  const base = { id: "n1", slug: "x", audiences: ["all"], requires_ack: false };
  assert.throws(() => buildNewsAlertPlan({ ...base, title: "Novidade", body: "Use Alterar conta agora." }), /Conteúdo não permitido/);
  assert.throws(() => buildNewsAlertPlan({ ...base, title: "O dono lê tudo", body: "x" }), /Conteúdo não permitido/);
  assert.ok(buildNewsAlertPlan({ ...base, title: "Agenda nova", body: "Veja a Agenda." }));
});

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("guard nunca é importado por componente client nem por rota/página", () => {
  const offenders = [];
  const allowed = ["lib/manual-service.mjs", "lib/manual-guard.mjs", "lib/manual.js"];
  for (const file of [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "lib"))]) {
    const rel = path.relative(ROOT, file).replaceAll("\\", "/");
    const src = fs.readFileSync(file, "utf8");
    if (!/manual-guard|manual-service/.test(src)) continue;
    if (isClient(src) || !allowed.includes(rel)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
  const lib = fs.readFileSync(path.join(ROOT, "lib/manual.js"), "utf8");
  assert.match(lib, /import "server-only"/);
  assert.doesNotMatch(lib, /export[^;]*assertManualContentAllowed/);
  const clientData = walk(path.join(ROOT, "components")).filter((f) => {
    const src = fs.readFileSync(f, "utf8");
    return isClient(src) && /@\/lib\/manual(\.js)?["']/.test(src);
  });
  assert.deepEqual(clientData, []);
});

test("rotas do Manual chamam guard e nunca expõem audiences", () => {
  const files = walk(path.join(ROOT, "app/api/admin/manual")).filter((f) => f.endsWith("route.js"));
  assert.ok(files.length >= 14);
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    assert.match(src, /require(Admin|GeneralAdmin)Api/, file);
    if (file.replaceAll("\\", "/").includes("/manual/admin/")) assert.match(src, /requireGeneralAdminApi\)/, file);
    assert.doesNotMatch(src, /audiences/, file);
  }
});

import { MANUAL_SEED_CONTENT, MANUAL_SEED_NEWS } from "../lib/manual-seed-content.mjs";

test("guard reforçado: paráfrases genéricas de 'quem vê' são barradas (frases separadas, outros cargos e verbos)", () => {
  const blocked = [
    "A coordenadora acompanha as conversas dos corretores.",
    "O gerente tem acesso ao histórico das mensagens.",
    "O líder do time consegue ver o chat de cada um.",
    "A diretoria audita o atendimento. Tudo fica registrado.",
    "O administrador abre o sistema. Depois olha a conversa do cliente.",
    "As conversas ficam visíveis ao gestor.",
    "Clientes que foram arquivados mantêm a conversa.",
    "Ao arquivar o cliente, a conversa permanece disponível.",
    "O histórico do atendimento fica guardado.",
    "O dono acessa tudo do sistema."
  ];
  for (const text of blocked) assert.equal(isManualContentAllowed(text), false, text);
});

test("guard reforçado: sem falso positivo por trecho dentro de palavra e textos legítimos", () => {
  const allowed = [
    "O imóvel aparece na lista. O sistema envia o aviso e devolve o contato à fila.",
    "O corretor cadastra o imóvel e o CRM envia a mensagem pronta.",
    "A equipe comemora quando a meta chega a 100%.",
    "Você ve o progresso do dia na tela da Meta Diária.",
    "Arquivar tira o cliente do seu dia a dia sem apagá-lo."
  ];
  for (const text of allowed) assert.equal(isManualContentAllowed(text), true, text);
  for (const item of MANUAL_SEED_CONTENT) assert.equal(isManualContentAllowed(item.title, item.body), true, item.section);
  for (const n of MANUAL_SEED_NEWS) assert.equal(isManualContentAllowed(n.title, n.body), true, n.slug);
});
