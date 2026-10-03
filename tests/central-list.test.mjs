import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHandlers, sha256Hex, LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT } from "../lib/central/core.mjs";

const CHATGPT = "c".repeat(40) + "-chatgpt-secret-aaaaaaaa";
const EXECUTOR = "e".repeat(40) + "-executor-secret-bbbbbbb";
const APPROVER = "a".repeat(40) + "-approver-secret-ccccccc";
const cred = (role, s) => ({ role, secret_sha256: sha256Hex(s), active: true });
const CREDS = [cred("chatgpt", CHATGPT), cred("executor", EXECUTOR), cred("approver", APPROVER)];
const hdr = (token) => ({ get: (k) => (k.toLowerCase() === "authorization" && token ? `Bearer ${token}` : null) });

const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-10-03T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
let seq = 0;
const mk = (over = {}) => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  status: "CONCLUIDA", tipo: "eco", origem: "chatgpt",
  payload: { schema: 1, trust: "untrusted", source: "chatgpt", tipo: "eco", instruction_text: "pedido normal" },
  resultado: "RESULTADO COMPLETO SECRETO-DE-TESTE", erro: null,
  locked_by: null, idempotency_key: "idem-chave-interna", attempts: 2, max_attempts: 3,
  lease_expires_at: iso(NOW), approved_at: iso(NOW), decided_by: "approver-x",
  created_at: iso(NOW - HOUR), updated_at: iso(NOW - HOUR), completed_at: iso(NOW - HOUR),
  ...over
});

// Store de leitura com a mesma semantica do store Supabase (filtro, janela, ordem desc, limite).
function listStore(rows) {
  const calls = [];
  const counters = new Map();
  return {
    calls,
    async getCredentials() { return CREDS; },
    async rateLimit(key, _w, max) { const n = (counters.get(key) || 0) + 1; counters.set(key, n); return n <= max; },
    async get(id) { return rows.find((r) => r.id === id) || null; },
    async list({ status, tipo, limit, hours, orderBy }) {
      calls.push("list");
      return rows
        .filter((r) => (!status || r.status === status) && (!tipo || r.tipo === tipo))
        .filter((r) => !hours || Date.parse(r[orderBy]) >= NOW - hours * HOUR)
        .sort((a, b) => Date.parse(b[orderBy]) - Date.parse(a[orderBy]))
        .slice(0, limit);
    }
  };
}
const list = (h, query = {}, token = CHATGPT) => h.listTasks({ headers: hdr(token), query, ip: "9.9.9.9" });

test("1. lista recentes em ordem decrescente (created_at por padrao)", async () => {
  const rows = [1, 5, 3].map((n) => mk({ created_at: iso(NOW - n * HOUR), instruction: n }));
  const h = createHandlers({ store: listStore(rows) });
  const r = await list(h);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.tasks.map((t) => t.created_at), [1, 3, 5].map((n) => iso(NOW - n * HOUR)));
  assert.equal(r.body.limit, LIST_DEFAULT_LIMIT);
  assert.equal(r.body.order, "created_at desc");
});

test("2 e 3. acha tarefa pelo resumo/filtro, obtem task_id e ele funciona em verResultado", async () => {
  const alvo = mk({ status: "AGUARDANDO_DECISAO", tipo: "escrita", resultado: null, payload: { instruction_text: "atualizar planilha de metas" } });
  const outras = [mk(), mk({ tipo: "consulta" })];
  const store = listStore([...outras, alvo]);
  const h = createHandlers({ store });
  const r = await list(h, { status: "AGUARDANDO_DECISAO", tipo: "escrita" });
  assert.equal(r.body.tasks.length, 1);
  const found = r.body.tasks.find((t) => t.instruction_summary.includes("planilha de metas"));
  assert.ok(found);
  assert.equal(found.awaiting_decision, true);
  assert.equal(found.has_result, false);
  const v = await h.getTask({ headers: hdr(CHATGPT), id: found.task_id, ip: "1.1.1.1" });
  assert.equal(v.status, 200);
  assert.equal(v.body.task_id, found.task_id);
});

test("4. tarefas antigas aparecem quando janela/limite permitem", async () => {
  const velha = mk({ created_at: iso(NOW - 200 * HOUR) });
  const nova = mk({ created_at: iso(NOW - HOUR) });
  const h = createHandlers({ store: listStore([velha, nova]) });
  assert.equal((await list(h, { horas: "24" })).body.tasks.length, 1);
  const todas = await list(h, { horas: "720", limite: "10" });
  assert.deepEqual(todas.body.tasks.map((t) => t.task_id), [nova.id, velha.id]);
  assert.equal((await list(h, { limite: "1" })).body.tasks.length, 1);
});

test("5. filtros status/tipo/limite e limite maximo imposto; invalidos = 400 sem detalhe de valor", async () => {
  const rows = Array.from({ length: 60 }, (_, i) => mk({ status: i % 2 ? "ERRO" : "CONCLUIDA", tipo: i % 3 ? "eco" : "consulta", created_at: iso(NOW - i * 1000) }));
  const h = createHandlers({ store: listStore(rows) });
  assert.ok((await list(h, { status: "ERRO" })).body.tasks.every((t) => t.status === "ERRO"));
  assert.ok((await list(h, { tipo: "consulta" })).body.tasks.every((t) => t.tipo === "consulta"));
  assert.equal((await list(h, { limite: String(LIST_MAX_LIMIT) })).body.tasks.length, LIST_MAX_LIMIT);
  for (const bad of [{ limite: "51" }, { limite: "0" }, { limite: "-1" }, { limite: "abc" }, { limite: "1e2" }, { status: "x'; drop table" }, { tipo: "outro" }, { horas: "0" }, { horas: "99999999" }, { ordenar_por: "payload" }, { extra: "1" }, { limite: ["1", "2"] }]) {
    const r = await list(h, bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error.code, "parametros_invalidos");
    assert.doesNotMatch(JSON.stringify(r.body), /drop table|abc|99999999/);
  }
});

test("6. autenticacao: sem credencial/invalida = 401; credencial de outro papel = 403", async () => {
  const store = listStore([mk()]);
  const h = createHandlers({ store });
  assert.equal((await list(h, {}, null)).status, 401);
  assert.equal((await list(h, {}, "x".repeat(40))).status, 401);
  assert.equal((await list(h, {}, EXECUTOR)).status, 403);
  assert.equal((await list(h, {}, APPROVER)).status, 403);
  assert.equal(store.calls.length, 0, "nao consulta dados sem autenticar");
});

test("7. somente leitura: store.list so faz select; rota exporta so GET/POST; core nao usa escrita na listagem", async () => {
  const storeSrc = readFileSync(new URL("../lib/central/store-supabase.js", import.meta.url), "utf8");
  const body = storeSrc.slice(storeSrc.indexOf("async list("), storeSrc.indexOf("async claim("));
  assert.match(body, /\.select\(/);
  assert.doesNotMatch(body, /\.(insert|update|upsert|delete|rpc)\(/);
  const route = readFileSync(new URL("../app/api/central/tasks/route.js", import.meta.url), "utf8");
  const exported = [...route.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["GET", "POST"]); // PUT/PATCH/DELETE ausentes => 405 no Next
  assert.match(route, /GET[\s\S]*"listTasks"/);
  // POST em /tasks continua sendo criarTarefa (contrato existente), nunca a listagem
  assert.match(route, /POST[\s\S]*"createTask"/);
  const core = readFileSync(new URL("../lib/central/core.mjs", import.meta.url), "utf8");
  const listHandler = core.slice(core.indexOf("listTasks: run"), core.indexOf("claim: run"));
  assert.doesNotMatch(listHandler, /store\.(create|claim|complete|renew|requeueOwn|decide)\(/);
  const idRoute = readFileSync(new URL("../app/api/central/tasks/[id]/route.js", import.meta.url), "utf8");
  assert.deepEqual([...idRoute.matchAll(/export async function (\w+)/g)].map((m) => m[1]), ["GET"]);
});

test("8. allowlist: nenhum segredo/campo interno nem resultado completo; instruction e erro truncados", async () => {
  const longo = "A".repeat(500);
  const rows = [
    mk({ payload: { instruction_text: longo, token: "TOKEN-SECRETO", outro: { x: 1 } }, erro: "E".repeat(900) + "\n at stack.js:1", secret_sha256: "h".repeat(64), service_role: "SRK-SECRETO", locked_by: "pc-teste-1" }),
    mk({ payload: { instruction_text: { objeto: "nao-string" } }, resultado: null })
  ];
  const h = createHandlers({ store: listStore(rows) });
  const r = await list(h);
  const out = JSON.stringify(r.body);
  for (const proibido of ["RESULTADO COMPLETO", "SECRETO", "idem-chave-interna", "approver-x", "secret_sha256", "service_role", "attempts", "lease_expires_at", "payload", "resultado", "stack.js"]) {
    assert.ok(!out.includes(proibido), `vazou: ${proibido}`);
  }
  const ALLOWED = ["task_id", "status", "tipo", "origem", "executor", "instruction_summary", "instruction_truncated", "created_at", "updated_at", "completed_at", "has_result", "awaiting_decision", "error_summary", "error_truncated"].sort();
  for (const t of r.body.tasks) assert.deepEqual(Object.keys(t).sort(), ALLOWED);
  const [a, b] = r.body.tasks;
  assert.equal(a.instruction_truncated, true);
  assert.equal(a.instruction_summary.length, 203);
  assert.equal(a.error_truncated, true);
  assert.ok(a.error_summary.length <= 203);
  assert.equal(a.has_result, true);
  assert.equal(a.executor, "pc-teste-1");
  assert.equal(b.instruction_summary, "");
  assert.equal(b.has_result, false);
});

test("9. rate limit e falha de banco: 429 e 500 genericos", async () => {
  const store = listStore([mk()]);
  const h = createHandlers({ store });
  let last;
  for (let i = 0; i < 61; i++) last = await list(h);
  assert.equal(last.status, 429);
  const quebrado = { ...listStore([]), async list() { throw new Error("detalhe interno do banco"); } };
  const r = await list(createHandlers({ store: quebrado }));
  assert.equal(r.status, 500);
  assert.doesNotMatch(JSON.stringify(r.body), /detalhe interno/);
});
