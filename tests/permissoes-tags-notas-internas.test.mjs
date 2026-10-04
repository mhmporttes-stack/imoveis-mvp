// Duas falhas de permissão corrigidas em 2026-10-04 (decisão do dono, Opção B):
//  A) T-75 — "Informações internas" (internalNotes) de empreendimento só para dono e gestor;
//  B) P-07 — etiquetas (client-tags): corretor/associado criam, mas não apagam nem recolorem.
// Dados 100% sintéticos; nada de rede nem banco.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import {
  INTERNAL_PROPERTY_FIELDS,
  redactInternalPropertyFields,
  redactInternalPropertyList,
  withoutPropertyPdf
} from "../lib/property-visibility-core.mjs";

register("./helpers/route-test-loader.mjs", import.meta.url);

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

// ---------- (a) visibilidade de campos internos ----------
const property = () => ({
  id: "p1", name: "Residencial Teste", terms: "Entrada facilitada", salesText: "Texto comercial",
  internalNotes: "Comissão extra de 1% só para a gestão", createdByUserId: "u-1",
  pdfData: "data:application/pdf;base64,AAAA", photos: [{ url: "x.jpg" }], features: ["Lazer"]
});

test("corretor e associado (canViewInternal diferente de true) não recebem notas internas nem autor do cadastro", () => {
  for (const flag of [false, undefined, null, "true", 1]) {
    const out = redactInternalPropertyFields(property(), flag);
    assert.equal(out.internalNotes, "");
    assert.equal(out.createdByUserId, "");
  }
});

test("corretor continua vendo nome, condições comerciais, diferenciais, fotos e e-book", () => {
  const out = redactInternalPropertyFields(property(), false);
  assert.equal(out.name, "Residencial Teste");
  assert.equal(out.terms, "Entrada facilitada");
  assert.equal(out.salesText, "Texto comercial");
  assert.deepEqual(out.features, ["Lazer"]);
  assert.equal(out.photos.length, 1);
  assert.equal(out.pdfData, "data:application/pdf;base64,AAAA");
});

test("dono e gestor (canViewInternal=true) recebem tudo preenchido", () => {
  const original = property();
  const out = redactInternalPropertyFields(original, true);
  assert.equal(out.internalNotes, original.internalNotes);
  assert.equal(out.createdByUserId, "u-1");
});

test("não muta o objeto nem a lista originais", () => {
  const original = property();
  const snapshot = JSON.stringify(original);
  const out = redactInternalPropertyFields(original, false);
  assert.notEqual(out, original);
  assert.equal(JSON.stringify(original), snapshot);
  const list = [property(), property()];
  const listSnapshot = JSON.stringify(list);
  const redacted = redactInternalPropertyList(list, false);
  assert.equal(JSON.stringify(list), listSnapshot);
  assert.ok(redacted.every((item) => item.internalNotes === ""));
  assert.equal(redactInternalPropertyList(null, false).length, 0);
  assert.equal(redactInternalPropertyFields(null, false), null);
});

test("a lista de campos internos cobre as notas", () => {
  assert.ok(INTERNAL_PROPERTY_FIELDS.includes("internalNotes"));
});

test("gerador de simulação: o book em base64 não vai ao navegador, o resto fica", () => {
  const [out] = withoutPropertyPdf([property()]);
  assert.equal(out.pdfData, "");
  assert.equal(out.name, "Residencial Teste");
});

// ---------- (c) checagem estática das telas ----------
test("as 4 telas filtram no servidor antes de passar props ao componente", () => {
  const consulta = read("app/admin/empreendimentos/consulta/[id]/page.jsx");
  assert.match(consulta, /const auth = await requireAdminPage\(\)/);
  assert.match(consulta, /redactPropertyForAuth\(await getProperty\(id\), auth\)/);

  const apresentacao = read("app/admin/simulacoes/[id]/empreendimentos/page.jsx");
  assert.match(apresentacao, /properties=\{redactPropertiesForAuth\(/);
  assert.doesNotMatch(apresentacao, /properties=\{properties\./);

  for (const file of ["app/admin/simulacoes/[id]/page.jsx", "app/admin/simulacoes/nova/page.jsx"]) {
    const source = read(file);
    assert.match(source, /<SimulationGenerator properties=\{withoutPropertyPdf\(redactPropertiesForAuth\(properties, auth\)\)\}/, file);
    assert.doesNotMatch(source, /<SimulationGenerator properties=\{properties\}/, file);
  }
});

test("só os consumidores conhecidos de internalNotes existem em app/ e components/", () => {
  const consumers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (!["node_modules", ".next"].includes(entry.name)) walk(rel); continue; }
      if (/\.(jsx|js)$/.test(entry.name) && /internalNotes/.test(read(rel))) consumers.push(rel);
    }
  };
  walk("app"); walk("components");
  assert.deepEqual(consumers.sort(), [
    "app/admin/empreendimentos/consulta/[id]/page.jsx",
    "app/api/analyze/route.js",
    "components/EmpreendimentoPresentation.jsx",
    "components/PropertyForm.jsx"
  ]);
  // O cadastro/edição (PropertyForm) só abre para admin e gestor.
  assert.match(read("app/admin/empreendimentos/[id]/page.jsx"), /!isGeneralAdminAuth\(auth\) && !isManagerProfile\(auth\.profile\)\) redirect/);
  // O gerador de simulação nunca leu as notas.
  assert.doesNotMatch(read("components/SimulationGenerator.jsx"), /internalNotes/);
});

// ---------- (d) site público segue sem notas ----------
test("site público continua removendo internalNotes e createdByUserId", () => {
  const source = read("lib/public-properties.js");
  assert.match(source, /const \{ internalNotes, createdByUserId, \.\.\.publicSafe \} = property;/);
  assert.match(source, /\.map\(rowToProperty\)\.map\(stripInternalFields\)/);
  assert.match(source, /stripInternalFields\(rowToProperty\(data\)\)/);
});

// ---------- (b) rotas de etiquetas ----------
function createFakeTagsDb(initial = []) {
  const state = { tags: initial.map((row) => ({ ...row })), clientTags: [], seq: 100 };
  const client = {
    from(name) {
      let filter = null;
      let op = "select";
      let row = null;
      let options = {};
      let head = false;
      const builder = {
        select(_cols, opts = {}) { head = Boolean(opts.head); return builder; },
        eq(col, value) { filter = { col, value }; return builder; },
        upsert(payload, opts = {}) { op = "upsert"; row = payload; options = opts; return builder; },
        delete() { op = "delete"; return builder; },
        order() { return builder; },
        async maybeSingle() { return run(); },
        async single() { const result = await run(); return result.data ? result : { data: null, error: new Error("sem linha") }; },
        then(resolve, reject) { return run().then(resolve, reject); }
      };
      async function run() {
        if (name === "client_tags") {
          const rows = state.clientTags.filter((item) => item[filter.col] === filter.value);
          if (op === "delete") { state.clientTags = state.clientTags.filter((item) => !rows.includes(item)); return { data: null, error: null }; }
          return { data: head ? null : rows, count: rows.length, error: null };
        }
        if (op === "upsert") {
          const found = state.tags.find((item) => item.normalized_name === row.normalized_name);
          if (found && options.ignoreDuplicates) return { data: null, error: null };
          if (found) { Object.assign(found, row); return { data: { ...found }, error: null }; }
          const created = { id: `tag-${++state.seq}`, created_at: "2026-10-04T00:00:00Z", ...row };
          state.tags.push(created);
          return { data: { ...created }, error: null };
        }
        if (op === "delete") {
          const removed = state.tags.filter((item) => item[filter.col] === filter.value);
          state.tags = state.tags.filter((item) => !removed.includes(item));
          // ON DELETE CASCADE (client_tags_tag_id_fkey)
          state.clientTags = state.clientTags.filter((item) => state.tags.some((tag) => tag.id === item.tag_id));
          return { data: null, error: null };
        }
        const rows = filter ? state.tags.filter((item) => item[filter.col] === filter.value) : state.tags;
        return { data: filter ? (rows[0] ? { ...rows[0] } : null) : rows.map((item) => ({ ...item })), error: null };
      }
      return builder;
    }
  };
  return { state, client };
}

const BLUE = "#1D4ED8";
const RED = "#B91C1C";
let db;

// Modelo do contrato dos guards reais (lib/admin-auth.js): sem login = 401;
// requireAdminApi aceita qualquer perfil ativo; requireBrokerManagementApi só admin/gestor
// (associado e corretor = 403). A implementação real é fixada pelo teste estático mais abaixo.
const authFor = (request) => (request.role
  ? { ok: true, status: 200, profile: { role: request.role }, user: { email: `${request.role}@teste` } }
  : { ok: false, status: 401, error: "Nao autenticado." });

function setupStubs() {
  globalThis.__stubs = {
    supabase: { getSupabaseAdminClient: () => db.client },
    "admin-auth": {
      requireAdminApi: async (request) => authFor(request),
      requireBrokerManagementApi: async (request) => {
        const auth = authFor(request);
        if (!auth.ok) return auth;
        if (!["admin", "manager"].includes(auth.profile.role)) return { ok: false, status: 403, error: "Apenas gestor ou administrador pode gerenciar corretores." };
        return auth;
      },
      isGeneralAdmin: (auth) => auth?.profile?.role === "admin"
    },
    "admin-profiles": { isManagerProfile: (profile) => profile?.role === "manager" }
  };
}

const reqAs = (role, body) => ({ role, json: async () => body });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
setupStubs();
const { POST, GET } = await import("../app/api/client-tags/route.js");
const { DELETE } = await import("../app/api/client-tags/[id]/route.js");

function reset() {
  setupStubs();
  db = createFakeTagsDb([{ id: "tag-1", name: "Indicação", normalized_name: "indicacao", color: BLUE, created_at: "2026-01-01T00:00:00Z" }]);
  db.state.clientTags.push({ client_id: "c1", tag_id: "tag-1" }, { client_id: "c2", tag_id: "tag-1" });
}

test("DELETE: associado e corretor recebem 403 e a etiqueta e os vínculos ficam intactos", async () => {
  for (const role of ["associate", "broker"]) {
    reset();
    const res = await DELETE(reqAs(role), ctx("tag-1"));
    assert.equal(res.status, 403, role);
    assert.match(res.body.error, /gestor ou o administrador/);
    assert.equal(db.state.tags.length, 1);
    assert.equal(db.state.clientTags.length, 2);
  }
});

test("DELETE: sem login = 401", async () => {
  reset();
  const res = await DELETE(reqAs(undefined), ctx("tag-1"));
  assert.equal(res.status, 401);
  assert.equal(db.state.tags.length, 1);
});

test("DELETE: admin e gestor continuam apagando (e os vínculos saem junto, como hoje)", async () => {
  for (const role of ["admin", "manager"]) {
    reset();
    const res = await DELETE(reqAs(role), ctx("tag-1"));
    assert.equal(res.status, 200, role);
    assert.equal(res.body.removedClientLinks, 2);
    assert.equal(db.state.tags.length, 0);
  }
});

test("POST: corretor e associado criam etiqueta NOVA (201)", async () => {
  for (const role of ["broker", "associate"]) {
    reset();
    const res = await POST(reqAs(role, { name: "Feirão de Outubro", color: RED }));
    assert.equal(res.status, 201, role);
    assert.equal(res.body.name, "Feirão de Outubro");
    assert.equal(res.body.color, RED);
    assert.equal(db.state.tags.length, 2);
  }
});

test("POST: corretor/associado com nome já existente NÃO altera a cor nem o nome (200, devolve a existente)", async () => {
  for (const role of ["broker", "associate"]) {
    reset();
    // mesma etiqueta com acento/caixa/espaços diferentes: a comparação é normalizada
    const res = await POST(reqAs(role, { name: "  INDICACAO ", color: RED }));
    assert.equal(res.status, 200, role);
    assert.equal(res.body.id, "tag-1");
    assert.equal(res.body.color, BLUE);
    assert.equal(res.body.name, "Indicação");
    assert.equal(db.state.tags.length, 1);
    assert.equal(db.state.tags[0].color, BLUE);
    assert.equal(db.state.tags[0].name, "Indicação");
  }
});

test("POST: admin e gestor mantêm o comportamento atual (repetir o nome recolore)", async () => {
  for (const role of ["admin", "manager"]) {
    reset();
    const res = await POST(reqAs(role, { name: "Indicação", color: RED }));
    assert.equal(res.status, 201, role);
    assert.equal(res.body.color, RED);
    assert.equal(db.state.tags[0].color, RED);
    assert.equal(db.state.tags.length, 1);
  }
});

test("POST/GET: sem login = 401; GET segue aberto a qualquer perfil logado", async () => {
  reset();
  assert.equal((await POST(reqAs(undefined, { name: "X" }))).status, 401);
  assert.equal((await GET(reqAs(undefined))).status, 401);
  assert.equal((await GET(reqAs("associate"))).status, 200);
});

test("guards reais: DELETE usa requireBrokerManagementApi; POST/GET seguem em requireAdminApi", () => {
  const del = read("app/api/client-tags/[id]/route.js");
  assert.match(del, /requireBrokerManagementApi\(request\)/);
  assert.doesNotMatch(del, /requireAdminApi/);
  const route = read("app/api/client-tags/route.js");
  assert.equal((route.match(/requireAdminApi\(request\)/g) || []).length, 2);

  // O guard real: bloqueia associado (via requirePerformanceApi) e quem não é admin/gestor.
  const auth = read("lib/admin-auth.js");
  const perf = auth.match(/export async function requirePerformanceApi[\s\S]*?\n}\r?\n/)[0];
  assert.match(perf, /isAssociateProfile\(result\.profile\)[\s\S]*status: 403/);
  const mgmt = auth.match(/export async function requireBrokerManagementApi[\s\S]*?\n}\r?\n/)[0];
  assert.match(mgmt, /requirePerformanceApi\(request\)/);
  assert.match(mgmt, /!isGeneralAdmin\(result\) && !isManagerProfile\(result\.profile\)[\s\S]*status: 403/);
});

test("marcar/desmarcar etiqueta em UM cliente (PUT .../tags) segue para os 4 perfis, dentro do escopo do cliente", () => {
  const source = read("app/api/simulation-registrations/[id]/tags/route.js");
  assert.match(source, /requireAdminApi\(request\)/);
  assert.match(source, /await getSimulationRegistration\(id, auth\)/);
  assert.match(source, /setClientTags\(id, tagIds, auth\)/);
});

test("tela: lixeira só para admin/gestor (canManage); criar nome existente só marca a etiqueta", () => {
  const sheet = read("components/clients/ClientSheet.jsx");
  assert.match(sheet, /canDeleteTags=\{Boolean\(canManage\)\}/);
  assert.match(sheet, /\{canDeleteTags \? \(\s*<button[\s\S]*?deleteTagFromSystem\(tag\)/);
  assert.match(sheet, /keepExisting: !canDeleteTags/);
  const hook = read("components/clients/useClientList.js");
  assert.match(hook, /response\.status === 403 \? "Só o gestor ou o administrador pode excluir etiquetas\."/);
  assert.match(hook, /if \(keepExisting\) \{/);
});
