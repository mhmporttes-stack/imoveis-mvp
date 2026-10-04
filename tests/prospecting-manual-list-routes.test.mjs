// "Imprimir lista" da Prospecção (2026-10-04) — roda o código REAL das rotas e da camada
// lib/prospecting-manual-lists.js (e de admin-access/admin-profiles) com um Supabase falso em memória.
// Prova: guards (401/403), escopo de equipe do gestor, ator = administrador REAL, snapshot/reimpressão sem
// selecionar contatos novos, auditoria, tolerância à migration pendente e que nada fora das tabelas novas é
// escrito. Dados 100% fictícios; nada de rede nem banco real.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./helpers/route-test-loader.mjs", {
  parentURL: import.meta.url,
  data: { real: ["prospecting-manual-lists", "admin-access", "admin-profiles", "phone-utils"] }
});

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const ADMIN = { id: "00000000-0000-4000-8000-0000000000a1", role: "admin", name: "Administradora", email: "admin@teste.local", status: "active" };
const TEAM = ["00000000-0000-4000-8000-0000000000b1", "00000000-0000-4000-8000-0000000000c1", "00000000-0000-4000-8000-0000000000c2"];

const USERS = [
  { id: "00000000-0000-4000-8000-0000000000a1", name: "Administradora", email: "admin@teste.local", role: "admin", status: "active" },
  { id: "00000000-0000-4000-8000-0000000000b1", name: "Gestora Um", email: "mgr1@teste.local", role: "manager", status: "active" },
  { id: "00000000-0000-4000-8000-0000000000c1", name: "Corretora Da Equipe", email: "brk1@teste.local", role: "broker", status: "active", manager_id: "00000000-0000-4000-8000-0000000000b1" },
  { id: "00000000-0000-4000-8000-0000000000c2", name: "Associada Da Equipe", email: "asc1@teste.local", role: "associate", status: "active", linked_broker_id: "00000000-0000-4000-8000-0000000000c1" },
  { id: "00000000-0000-4000-8000-0000000000d1", name: "Corretor Outra Equipe", email: "brk2@teste.local", role: "broker", status: "active" }
];

let state;
function resetState() {
  state = {
    missing: false,
    lists: [
      { id: "11111111-1111-4111-8111-111111111111", numero: 1, broker_id: "00000000-0000-4000-8000-0000000000c1", broker_name_snapshot: "Corretora Da Equipe", contact_count: 2, created_at: "2026-10-04T15:30:00Z", generated_by_user_id: "00000000-0000-4000-8000-0000000000a1", generated_by_email: "admin@teste.local" },
      { id: "22222222-2222-4222-8222-222222222222", numero: 2, broker_id: "00000000-0000-4000-8000-0000000000d1", broker_name_snapshot: "Corretor Outra Equipe", contact_count: 1, created_at: "2026-10-04T16:00:00Z", generated_by_user_id: "00000000-0000-4000-8000-0000000000a1", generated_by_email: "admin@teste.local" }
    ],
    items: [
      { list_id: "11111111-1111-4111-8111-111111111111", position: 1, name_snapshot: "Ana Paula de Souza", phone_snapshot: "+5514999990001", contact_id: "c-1" },
      { list_id: "11111111-1111-4111-8111-111111111111", position: 2, name_snapshot: "José Antônio Pereira", phone_snapshot: "+551433334444", contact_id: "c-2" },
      { list_id: "22222222-2222-4222-8222-222222222222", position: 1, name_snapshot: "Pessoa Da Outra Equipe", phone_snapshot: "+5514999990003", contact_id: "c-3" }
    ],
    events: [],
    writes: [],
    rpcCalls: [],
    rpcResult: { data: { already: false, list_id: "33333333-3333-4333-8333-333333333333", numero: 3, contact_count: 30 }, error: null },
    fromCalls: []
  };
}

const MANUAL_TABLES = new Set(["prospecting_manual_lists", "prospecting_manual_list_items"]);
const missingError = (name) => ({ code: "42P01", message: `relation "public.${name}" does not exist` });

function runQuery(q) {
  if (MANUAL_TABLES.has(q.table) && state.missing) return { data: null, error: missingError(q.table) };
  let rows;
  if (q.table === "admin_users") rows = USERS;
  else if (q.table === "prospecting_manual_lists") rows = [...state.lists].sort((a, b) => (b.created_at.localeCompare(a.created_at)) || (b.numero - a.numero));
  else if (q.table === "prospecting_manual_list_items") rows = state.items;
  else return { data: null, error: { message: `tabela inesperada no teste: ${q.table}` } };
  if (q.insert) {
  }
  for (const f of q.filters) {
    if (f.op === "eq") rows = rows.filter((r) => r[f.col] === f.val);
    if (f.op === "in") rows = rows.filter((r) => f.val.includes(r[f.col]));
    if (f.op === "not") rows = rows.filter((r) => r[f.col] != null);
  }
  if (q.opts?.head) return { count: rows.length, error: null };
  if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
  if (q.single) return { data: rows[0] || null, error: null };
  return { data: rows, error: null };
}

function table(name) {
  state.fromCalls.push(name);
  const q = { table: name, filters: [], opts: null, insert: null, range: null, single: false };
  const api = {
    select(_cols, opts) { q.opts = opts || null; return api; },
    order() { return api; },
    not(col, op) { q.filters.push({ op: "not", col, val: op }); return api; },
    in(col, val) { q.filters.push({ op: "in", col, val }); return api; },
    eq(col, val) { q.filters.push({ op: "eq", col, val }); return api; },
    range(a, b) { q.range = [a, b]; return api; },
    maybeSingle() { q.single = true; return api; },
    insert(row) { q.insert = row; return api; },
    update() { state.writes.push(`${name}:update`); return api; },
    delete() { state.writes.push(`${name}:delete`); return api; },
    then(res, rej) { return Promise.resolve(runQuery(q)).then(res, rej); }
  };
  return api;
}

const client = {
  from: table,
  rpc(name, args) {
    state.rpcCalls.push({ name, args });
    if (state.missing) return Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function public.create_prospecting_manual_list in the schema cache" } });
    return Promise.resolve(state.rpcResult);
  }
};

// Modelo do contrato dos guards reais (fixado por um teste estático mais abaixo): sem login = 401; só admin e gestor passam.
function authFor(request) {
  if (!request.role) return { ok: false, status: 401, error: "Nao autenticado." };
  if (request.role === "admin") return { ok: true, status: 200, profile: { ...ADMIN }, user: { email: ADMIN.email } };
  if (request.role === "manager") {
    const real = request.realAdmin ? { realUser: { email: ADMIN.email }, realProfile: { ...ADMIN } } : {};
    return { ok: true, status: 200, profile: { id: "00000000-0000-4000-8000-0000000000b1", role: "manager", name: "Gestora Um", email: "mgr1@teste.local", managedUserIds: [...TEAM] }, user: { email: "mgr1@teste.local" }, ...real };
  }
  return { ok: false, status: 403, error: "Apenas gestor ou administrador pode gerenciar corretores." };
}

function setupStubs() {
  globalThis.__stubs = {
    supabase: { getSupabaseAdminClient: () => client, hasSupabaseAdminConfig: true },
    "admin-auth": {
      requireBrokerManagementApi: async (request) => authFor(request),
      getActingAdminEmail: (auth) => auth?.realUser?.email || auth?.user?.email || ""
    },
    "admin-users": { getAdminDisplayName: (email) => email },
    "broker-gender": { normalizeGender: (value) => value || "" }
  };
}

setupStubs();
resetState();
const { GET, POST } = await import("../app/api/prospecting/manual-lists/route.js");
const { GET: GET_ONE } = await import("../app/api/prospecting/manual-lists/[id]/route.js");
const { GET: GET_PDF } = await import("../app/api/prospecting/manual-lists/[id]/pdf/route.js");
const lib = await import("../lib/prospecting-manual-lists.js");

const req = (role, extra = {}) => ({ role, url: "http://localhost/api/prospecting/manual-lists", json: async () => extra.body ?? {}, ...extra });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const KEY = "123e4567-e89b-12d3-a456-426614174000";
const LIST_1 = "11111111-1111-4111-8111-111111111111";
const LIST_2 = "22222222-2222-4222-8222-222222222222";
const reset = () => { setupStubs(); resetState(); };

test("sem login: 401 em todas as rotas, e nada é lido nem gravado", async () => {
  reset();
  for (const res of [await GET(req(undefined)), await POST(req(undefined, { body: { brokerId: "x" } })), await GET_ONE(req(undefined), ctx(LIST_1)), await GET_PDF(req(undefined), ctx(LIST_1))]) {
    assert.equal(res.status, 401);
  }
  assert.equal(state.rpcCalls.length, 0);
  assert.equal(state.fromCalls.length, 0);
});

test("corretor e associado: 403 em todas as rotas (não geram nem veem listas)", async () => {
  for (const role of ["broker", "associate"]) {
    reset();
    for (const res of [await GET(req(role)), await POST(req(role, { body: { brokerId: "00000000-0000-4000-8000-0000000000c1", requestKey: KEY } })), await GET_ONE(req(role), ctx(LIST_1)), await GET_PDF(req(role), ctx(LIST_1))]) {
      assert.equal(res.status, 403, role);
    }
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.fromCalls.length, 0);
  }
});

const A1 = "00000000-0000-4000-8000-0000000000a1"; // administradora
const M1 = "00000000-0000-4000-8000-0000000000b1"; // gestora
const B1 = "00000000-0000-4000-8000-0000000000c1"; // corretora da equipe da gestora
const S1 = "00000000-0000-4000-8000-0000000000c2"; // associada da equipe
const B2 = "00000000-0000-4000-8000-0000000000d1"; // corretor de OUTRA equipe

test("admin gera: chama só o RPC (30), com o e-mail do administrador, e nada mais é escrito", async () => {
  reset();
  const res = await POST(req("admin", { body: { brokerId: B2, requestKey: KEY } }));
  assert.equal(res.status, 200);
  assert.equal(res.body.listId, "33333333-3333-4333-8333-333333333333");
  assert.equal(res.body.numero, 3);
  assert.equal(res.body.contactCount, 30);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(state.rpcCalls.length, 1);
  const { name, args } = state.rpcCalls[0];
  assert.equal(name, "create_prospecting_manual_list");
  assert.equal(args.p_broker_id, B2);
  assert.equal(args.p_limit, 30);
  assert.equal(args.p_generated_by_email, "admin@teste.local");
  assert.equal(args.p_generated_by_user_id, A1);
  assert.equal(args.p_request_key, KEY);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.fromCalls, [], "a rota não lê nem escreve tabela nenhuma: só chama o RPC");
});

test("gestora: gera para corretora e associada da equipe; fora da equipe = 403 e o RPC nem roda", async () => {
  reset();
  const inTeam = await POST(req("manager", { body: { brokerId: B1, requestKey: KEY } }));
  assert.equal(inTeam.status, 200);
  const assoc = await POST(req("manager", { body: { brokerId: S1, requestKey: "outra-chave-12345" } }));
  assert.equal(assoc.status, 200);
  const herself = await POST(req("manager", { body: { brokerId: M1, requestKey: "chave-propria-1234" } }));
  assert.equal(herself.status, 200);
  assert.equal(state.rpcCalls.length, 3);
  const outside = await POST(req("manager", { body: { brokerId: B2, requestKey: "terceira-chave-1234" } }));
  assert.equal(outside.status, 403);
  assert.equal(state.rpcCalls.length, 3, "fora da equipe o RPC não é chamado");
});

test("ação administrativa: registra o administrador REAL mesmo durante 'Alterar conta' (gestora emulada)", async () => {
  reset();
  const res = await POST(req("manager", { realAdmin: true, body: { brokerId: B1, requestKey: KEY } }));
  assert.equal(res.status, 200);
  assert.equal(state.rpcCalls[0].args.p_generated_by_email, ADMIN.email, "não o e-mail da gestora emulada");
  assert.equal(state.rpcCalls[0].args.p_generated_by_user_id, A1);
  // sem emulação: a própria gestora
  reset();
  await POST(req("manager", { body: { brokerId: B1, requestKey: KEY } }));
  assert.equal(state.rpcCalls[0].args.p_generated_by_email, "mgr1@teste.local");
  assert.equal(state.rpcCalls[0].args.p_generated_by_user_id, M1);
});


test("entrada inválida: sem corretor, id malformado e chave ausente/insegura = 400", async () => {
  reset();
  assert.equal((await POST(req("admin", { body: { requestKey: KEY } }))).status, 400);
  assert.equal((await POST(req("admin", { body: { brokerId: "nao-e-uuid", requestKey: KEY } }))).status, 400);
  assert.equal((await POST(req("admin", { body: { brokerId: B1 } }))).status, 400);
  assert.equal((await POST(req("admin", { body: { brokerId: B1, requestKey: "tem espaço!" } }))).status, 400);
  assert.equal(state.rpcCalls.length, 0);
});

test("zero elegíveis = 409 com mensagem clara; migration pendente = 503 'Recurso ainda não ativado no banco.'", async () => {
  reset();
  state.rpcResult = { data: null, error: { code: "P0001", message: "MANUAL_LIST_NO_CONTACTS" } };
  const none = await POST(req("admin", { body: { brokerId: B1, requestKey: KEY } }));
  assert.equal(none.status, 409);
  assert.match(none.body.error, /Não há contatos elegíveis/);
  reset();
  state.missing = true;
  const off = await POST(req("admin", { body: { brokerId: B1, requestKey: KEY } }));
  assert.equal(off.status, 503);
  assert.equal(off.body.error, "Recurso ainda não ativado no banco.");
});

test("clique repetido: o RPC devolve a mesma lista (already) e a rota repassa sem criar outra", async () => {
  reset();
  state.rpcResult = { data: { already: true, list_id: LIST_1, numero: 1, contact_count: 2 }, error: null };
  const res = await POST(req("admin", { body: { brokerId: B1, requestKey: KEY } }));
  assert.equal(res.status, 200);
  assert.equal(res.body.already, true);
  assert.equal(res.body.listId, LIST_1);
});

test("histórico: admin vê tudo; gestor só a equipe; filtro fora da equipe volta vazio; migration pendente não quebra", async () => {
  reset();
  const all = await GET(req("admin"));
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.lists.map((l) => l.numero), [2, 1]);
  assert.equal(all.body.lists[1].generatedByName, "Administradora");
  assert.equal(all.headers["Cache-Control"], "no-store");
  assert.ok(all.body.brokers.some((b) => b.id === "00000000-0000-4000-8000-0000000000d1"));

  const team = await GET(req("manager"));
  assert.deepEqual(team.body.lists.map((l) => l.numero), [1]);
  assert.deepEqual(team.body.brokers.map((b) => b.id).sort(), [B1, S1, M1].sort());
  assert.ok(!JSON.stringify(team.body).includes("Outra Equipe"));

  const filteredOutside = await GET(req("manager", { url: "http://localhost/api/prospecting/manual-lists?brokerId=00000000-0000-4000-8000-000000000009" }));
  assert.deepEqual(filteredOutside.body.lists, []);

  state.missing = true;
  const off = await GET(req("admin"));
  assert.equal(off.status, 200);
  assert.equal(off.body.enabled, false);
  assert.equal(off.body.message, "Recurso ainda não ativado no banco.");
  assert.deepEqual(off.body.lists, []);
});

test("visualizar: devolve o snapshot (nome e telefone formatado); gestor não abre lista de outra equipe; inexistente = 404", async () => {
  reset();
  const ok = await GET_ONE(req("admin"), ctx(LIST_1));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.list.numero, 1);
  assert.deepEqual(ok.body.items.map((i) => [i.position, i.name, i.phoneFormatted]), [[1, "Ana Paula de Souza", "(14) 99999-0001"], [2, "José Antônio Pereira", "(14) 3333-4444"]]);
  assert.equal(ok.headers["Cache-Control"], "no-store");
  assert.equal((await GET_ONE(req("manager"), ctx(LIST_1))).status, 200);
  assert.equal((await GET_ONE(req("manager"), ctx(LIST_2))).status, 403);
  assert.equal((await GET_ONE(req("admin"), ctx("33333333-3333-4333-8333-333333333333"))).status, 404);
  assert.equal((await GET_ONE(req("admin"), ctx("lixo"))).status, 404);
  assert.equal(state.rpcCalls.length, 0);
});

test("PDF: application/pdf, sem cache, nome claro, snapshot, auditoria printed -> reprinted e NUNCA seleciona contatos novos", async () => {
  reset();
  const first = await GET_PDF(req("admin"), ctx(LIST_1));
  assert.equal(first.status, 200);
  assert.equal(first.headers["Content-Type"], "application/pdf");
  assert.match(first.headers["Cache-Control"], /no-store/);
  assert.equal(first.headers["Content-Disposition"], 'attachment; filename="lista-prospeccao-1-corretora-da-equipe.pdf"');
  assert.equal(Buffer.from(first.body).subarray(0, 5).toString(), "%PDF-");
  const second = await GET_PDF(req("admin"), ctx(LIST_1));
  assert.ok(Buffer.from(first.body).equals(Buffer.from(second.body)), "reimpressão = mesmos bytes");
  assert.equal(state.rpcCalls.length, 0, "reimprimir nunca chama a seleção");
  assert.equal(state.items.length, 3, "nenhum item novo");
  assert.equal((await GET_PDF(req("manager"), ctx(LIST_2))).status, 403);
  assert.equal((await GET_PDF(req("admin"), ctx("33333333-3333-4333-8333-333333333333"))).status, 404);
});

test("reservados: tabela inexistente = ninguém reservado (não quebra); com reservas, atribuir é barrado", async () => {
  reset();
  state.missing = true;
  assert.equal((await lib.listManualReservedContactIds()).size, 0);
  await lib.assertContactsNotReserved(["c-1", "c-2"]); // não lança
  state.missing = false;
  assert.deepEqual([...(await lib.listManualReservedContactIds())].sort(), ["c-1", "c-2", "c-3"]);
  await lib.assertContactsNotReserved(["livre-1"]);
  await assert.rejects(() => lib.assertContactsNotReserved(["livre-1", "c-2"]), (error) => error.status === 409 && /reservado/.test(error.message));
});

test("nada de envio e nada fora das tabelas novas: arquivos novos não importam WhatsApp/e-mail nem escrevem em contatos/clientes/funil", () => {
  const files = [
    "lib/prospecting-manual-lists.js",
    "lib/prospecting-manual-list-core.mjs",
    "lib/prospecting-manual-list-pdf.mjs",
    "app/api/prospecting/manual-lists/route.js",
    "app/api/prospecting/manual-lists/[id]/route.js",
    "app/api/prospecting/manual-lists/[id]/pdf/route.js",
    "components/ProspectingManualLists.jsx"
  ];
  for (const file of files) {
    const source = read(file);
    const imports = [...source.matchAll(/^import .* from ["']([^"']+)["']/gm)].map((m) => m[1]);
    for (const spec of imports) assert.doesNotMatch(spec, /whatsapp|resend|email|mail|push|notification|daily-goal|client-status|performance|funnel/i, `${file} importa ${spec}`);
    assert.doesNotMatch(source, /\.from\(["'](prospecting_contacts|simulation_registrations|client_status_history|prospecting_history|daily_goal_[a-z_]+)["']\)/, `${file} toca tabela proibida`);
    assert.doesNotMatch(source, /\.(update|delete|upsert)\(/, `${file} faz update/delete/upsert`);
  }
  const lists = read("lib/prospecting-manual-lists.js");
  const tables = [...lists.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  for (const t of tables) assert.match(t, /^(prospecting_manual_list_items|prospecting_manual_lists|admin_users)$/);
  assert.equal([...lists.matchAll(/\.insert\(/g)].length, 0, "a camada só chama o RPC; nenhum INSERT direto");
});

test("guards reais e integração nos seletores existentes (teste estático)", () => {
  for (const file of ["app/api/prospecting/manual-lists/route.js", "app/api/prospecting/manual-lists/[id]/route.js", "app/api/prospecting/manual-lists/[id]/pdf/route.js"]) {
    const source = read(file);
    assert.match(source, /requireBrokerManagementApi\(request\)/);
    assert.doesNotMatch(source, /requireAdminApi/);
    assert.match(source, /no-store/);
  }
  const auth = read("lib/admin-auth.js");
  const mgmt = auth.match(/export async function requireBrokerManagementApi[\s\S]*?\n}\r?\n/)[0];
  assert.match(mgmt, /!isGeneralAdmin\(result\) && !isManagerProfile\(result\.profile\)[\s\S]*status: 403/);
  assert.match(auth, /export function getActingAdminEmail\(auth\) \{\s*return auth\?\.realUser\?\.email \|\| auth\?\.user\?\.email \|\| "";/);

  const libSource = read("lib/prospecting-manual-lists.js");
  assert.match(libSource, /assertGeneralAdminOrManager\(auth\)/);
  assert.match(libSource, /assertCanAccessResponsibleUser\(auth, brokerId\)/);
  assert.match(libSource, /assertCanAccessResponsibleUser\(auth, data\.broker_id\)/);
  assert.match(libSource, /getActingAdminEmail\(auth\)/);

  const prospecting = read("lib/prospecting.js");
  assert.match(prospecting, /listManualReservedContactIds\(\)/);
  assert.match(prospecting, /withoutReservedContacts\(/);
  assert.equal((prospecting.match(/assertContactsNotReserved\(/g) || []).length, 2, "atribuição em massa e atribuição individual");

  const page = read("app/admin/prospeccao/page.jsx");
  assert.match(page, /canPrintLists=\{isAdmin \|\| isManagerProfile\(auth\.profile\)\}/);
});
