import test from "node:test";
import assert from "node:assert/strict";
import { createManualService, loadManualSeeds } from "../lib/manual-service.mjs";
import { resolveAudienceRecipients } from "../lib/crm-alerts-core.mjs";
import { isManualContentAllowed } from "../lib/manual-guard.mjs";
import { createFakeDb } from "./_helpers/manual-fake-db.mjs";

const U = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USERS = [
  { id: U(1), role: "admin", status: "active", name: "Dono" },
  { id: U(2), role: "manager", status: "active", name: "Gestora" },
  { id: U(3), role: "broker", status: "active", name: "Corretor", manager_id: U(2) },
  { id: U(4), role: "associate", status: "active", name: "Associado", linked_broker_id: U(3) },
  { id: U(5), role: "admin", status: "active", name: "Outro Admin" },
  { id: U(6), role: "broker", status: "inactive", name: "Inativo" }
];
const asAuth = (id, extra = {}) => ({ ok: true, profile: USERS.find((u) => u.id === id), user: { email: `${id}@x` }, ...extra });
const OWNER = asAuth(U(1), { owner: true });
const OTHER_ADMIN = asAuth(U(5));
const MANAGER = asAuth(U(2));
const BROKER = asAuth(U(3));
const ASSOCIATE = asAuth(U(4));

function world({ failAlerts = false, now = "2026-10-10T12:00:00Z" } = {}) {
  const db = createFakeDb({ admin_users: USERS });
  const alerts = [];
  const service = createManualService({
    db,
    now: () => new Date(now),
    isOwner: (auth) => auth.owner === true,
    createAlerts: async (definition, buildRow) => {
      if (failAlerts) throw new Error("falha simulada");
      const ids = resolveAudienceRecipients(definition.audience, USERS);
      alerts.push({ definition, rows: ids.map((id) => buildRow(id)) });
    }
  });
  return { db, alerts, service, clock: now };
}

async function expectStatus(promise, status) {
  await assert.rejects(promise, (error) => error.status === status);
}

// Conteúdo publicado direto no banco simulado (visão da equipe).
function seedPublished(db) {
  const topic = (slug, title, audiences, status = "published") => db.tables.manual_topics.push({ id: tid(slug), slug, title, description: "", icon: "", sort_order: 0, audiences, status });
  const section = (slug, topic_id, audiences, status, body = "texto") => db.tables.manual_sections.push({ id: sid(slug), topic_id, slug, title: `Sec ${slug}`, body, sort_order: 0, audiences, status, last_updated_at: "2026-08-01T00:00:00Z" });
  topic("geral", "Geral", ["all"]);
  topic("gestao", "Gestao", ["manager"]);
  topic("restrito", "Restrito", ["admin"]);
  topic("rasc", "Rascunho", ["all"], "draft");
  section("a", tid("geral"), ["all"], "published", "como cadastrar clientes");
  section("b", tid("geral"), ["broker"], "published", "dica do corretor");
  section("c", tid("geral"), ["manager"], "published", "conteudo da gestora");
  section("d", tid("geral"), ["all"], "pending", "ainda pendente");
  section("e", tid("geral"), ["all"], "draft", "rascunho");
  section("f", tid("gestao"), ["manager"], "published", "meta da equipe");
  section("g", tid("restrito"), ["admin"], "published", "so admin");
  section("h", tid("rasc"), ["all"], "published", "topico rascunho");
}

const hex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16)).join("").slice(0, 12).padStart(12, "0");
const sid = (s) => `30000000-0000-4000-8000-${hex(s)}`;
const tid = (s) => `40000000-0000-4000-8000-${hex(s)}`;
const NBAD = "50000000-0000-4000-8000-000000000001";
const SBAD = "50000000-0000-4000-8000-000000000002";
const slugs = (tree) => tree.topics.flatMap((t) => t.sections.map((s) => s.slug)).sort();

test("audiência por perfil: corretor, gestora, associado e admin", async () => {
  const { db, service } = world();
  seedPublished(db);
  assert.deepEqual(slugs(await service.getVisibleManual(BROKER)), ["a", "b"]);
  assert.deepEqual(slugs(await service.getVisibleManual(ASSOCIATE)), ["a", "b"]);
  assert.deepEqual(slugs(await service.getVisibleManual(MANAGER)), ["a", "b", "c", "f"]);
  assert.deepEqual(slugs(await service.getVisibleManual(OTHER_ADMIN)), ["a", "b", "c", "f", "g"]);
  const text = JSON.stringify(await service.getVisibleManual(BROKER));
  for (const hidden of ["audiences", "gestora", "so admin", "pendente", "rascunho", "Restrito", "Gestao"]) assert.ok(!text.includes(hidden), hidden);
});

test("busca respeita audiência e só vê publicado", async () => {
  const { db, service } = world();
  seedPublished(db);
  assert.equal((await service.searchManual(BROKER, "gestora")).results.length, 0);
  assert.equal((await service.searchManual(BROKER, "pendente")).results.length, 0);
  assert.equal((await service.searchManual(BROKER, "rascunho")).results.length, 0);
  assert.equal((await service.searchManual(MANAGER, "gestora")).results.length, 1);
  assert.equal((await service.searchManual(BROKER, "cadastrar")).results[0].href, "/admin/manual#geral/a");
  assert.equal((await service.searchManual(BROKER, "x")).results.length, 0);
});

test("API direta sem autorização: não-admin recebe 403 em tudo da administração", async () => {
  const { db, service } = world();
  seedPublished(db);
  const calls = (auth) => [
    () => service.adminOverview(auth), () => service.createTopic(auth, { title: "X" }), () => service.updateTopic(auth, tid("geral"), { title: "Y" }),
    () => service.createSection(auth, { topic_id: tid("geral"), title: "Y" }), () => service.updateSection(auth, sid("a"), { title: "Y" }),
    () => service.createNews(auth, { title: "Y" }), () => service.updateNews(auth, U(9), {}), () => service.listVersions(auth, sid("a")),
    () => service.listNewsReads(auth, U(9)), () => service.reorder(auth, "topic", []), () => service.setStatus(auth, "topic", tid("geral"), "pending"),
    () => service.approveVersion(auth, U(9)), () => service.seedStructure(auth)
  ];
  for (const auth of [BROKER, ASSOCIATE, MANAGER]) {
    for (const call of calls(auth)) await expectStatus(call(), 403);
  }
  assert.equal(db.writes.length, 0);
});

test("fluxo: rascunho -> aguardando -> publicado, só o dono publica", async () => {
  const { db, service } = world();
  const topic = await service.createTopic(OTHER_ADMIN, { title: "Financeiro Básico", audiences: ["all"] });
  assert.equal(topic.status, "draft");
  const section = await service.createSection(OTHER_ADMIN, { topic_id: topic.id, title: "Passo a passo", body: "Escreva aqui." });
  await service.setStatus(OTHER_ADMIN, "topic", topic.id, "pending");
  await service.setStatus(OTHER_ADMIN, "section", section.id, "pending");
  await expectStatus(service.setStatus(OTHER_ADMIN, "topic", topic.id, "published"), 403);
  await expectStatus(service.setStatus(OTHER_ADMIN, "section", section.id, "published"), 403);
  await expectStatus(service.setStatus(OWNER, "topic", topic.id, "draft").then(() => service.setStatus(OWNER, "topic", topic.id, "published")), 409);
  await service.setStatus(OWNER, "topic", topic.id, "pending");
  assert.deepEqual(slugs(await service.getVisibleManual(BROKER)), []); // pendente nunca aparece
  await service.setStatus(OWNER, "topic", topic.id, "published");
  assert.deepEqual(slugs(await service.getVisibleManual(BROKER)), []); // seção ainda pendente
  const pub = await service.setStatus(OWNER, "section", section.id, "published");
  assert.equal(pub.section.status, "published");
  assert.deepEqual(slugs(await service.getVisibleManual(BROKER)), ["passo-a-passo"]);
  assert.equal(db.tables.manual_section_versions.length, 1);
  assert.equal(db.tables.manual_section_versions[0].approved_by, U(1));
});

test("seção vazia não publica; cascata publica só as com texto", async () => {
  const { service, db } = world();
  const topic = await service.createTopic(OWNER, { title: "Topico" });
  const full = await service.createSection(OWNER, { topic_id: topic.id, title: "Cheia", body: "texto" });
  const empty = await service.createSection(OWNER, { topic_id: topic.id, title: "Vazia" });
  for (const s of [full, empty]) await service.setStatus(OWNER, "section", s.id, "pending");
  await expectStatus(service.setStatus(OWNER, "section", empty.id, "published"), 422);
  await service.setStatus(OWNER, "topic", topic.id, "pending");
  const result = await service.setStatus(OWNER, "topic", topic.id, "published", { cascade: true });
  assert.equal(result.cascaded, 1);
  assert.equal(db.tables.manual_sections.find((s) => s.id === empty.id).status, "pending");
});

test("editar seção publicada vira versão proposta; dono aprova com anterior/novo/responsável", async () => {
  const { db, service } = world();
  seedPublished(db);
  const res = await service.updateSection(OTHER_ADMIN, sid("a"), { body: "texto novo" });
  assert.ok(res.proposedVersion);
  assert.equal(res.section.body, "como cadastrar clientes");
  assert.equal((await service.searchManual(BROKER, "novo")).results.length, 0);
  await expectStatus(service.approveVersion(OTHER_ADMIN, res.proposedVersion.id), 403);
  await service.approveVersion(OWNER, res.proposedVersion.id);
  await expectStatus(service.approveVersion(OWNER, res.proposedVersion.id), 409);
  const v = db.tables.manual_section_versions.find((x) => x.id === res.proposedVersion.id);
  assert.equal(v.body_before, "como cadastrar clientes");
  assert.equal(v.body_after, "texto novo");
  assert.equal(v.created_by, U(5));
  assert.equal(v.approved_by, U(1));
  assert.ok(v.approved_at);
  assert.equal(db.tables.manual_sections.find((s) => s.id === sid("a")).body, "texto novo");
  const versions = await service.listVersions(OWNER, sid("a"));
  assert.equal(versions.versions.length, 1);
});

test("novidade: nada de alerta antes da aprovação; depois, audiência explícita e dedupe", async () => {
  const { service, alerts, db } = world();
  const news = await service.createNews(OTHER_ADMIN, { title: "Agenda ganhou lembretes", slug: "agenda-lembretes", body: "Veja a Agenda.", audiences: ["manager"] });
  await service.setStatus(OTHER_ADMIN, "news", news.id, "pending");
  assert.equal(alerts.length, 0);
  assert.equal((await service.listVisibleNews(MANAGER)).news.length, 0);
  await expectStatus(service.setStatus(OTHER_ADMIN, "news", news.id, "published"), 403);
  assert.equal(alerts.length, 0);
  const out = await service.setStatus(OWNER, "news", news.id, "published");
  assert.equal(alerts.length, 1);
  const [{ definition, rows }] = alerts;
  assert.deepEqual(definition.audience, { type: "role", roles: ["admin", "manager"] }); // sem hierarquia/online
  assert.deepEqual(rows.map((r) => r.recipient_id).sort(), [U(1), U(2), U(5)].sort());
  assert.equal(rows[0].kind, "informative");
  assert.equal(rows[0].dedupe_key, `manual_news:${news.id}:v1`);
  assert.equal(rows[0].context.link, "/admin/manual?novidade=agenda-lembretes");
  assert.equal(out.news.status, "published");
  assert.ok(db.tables.manual_news[0].badge_until);
  await expectStatus(service.setStatus(OWNER, "news", news.id, "published"), 409); // não republica
  assert.equal(alerts.length, 1);
});

test("novidade que exige ciência é Importante e vai a todos; rascunho nunca alerta", async () => {
  const { service, alerts } = world();
  const draft = await service.createNews(OWNER, { title: "Rascunho", body: "x" });
  assert.equal(alerts.length, 0);
  const news = await service.createNews(OWNER, { title: "Regra nova", body: "Leia", audiences: ["all"], requires_ack: true });
  await service.setStatus(OWNER, "news", news.id, "pending");
  await service.setStatus(OWNER, "news", news.id, "published");
  assert.deepEqual(alerts[0].definition.audience, { type: "all" });
  assert.equal(alerts[0].rows[0].kind, "important");
  assert.equal(alerts[0].rows.length, 5); // 5 ativos, inativo fora
  assert.equal(draft.status, "draft");
});

test("sugestão da novidade gera versão (anterior/novo/responsável) ao aprovar", async () => {
  const { service, alerts, db } = world();
  seedPublished(db);
  const news = await service.createNews(OTHER_ADMIN, { title: "Mudou o cadastro", body: "Atualizado", suggested_section_id: sid("a"), suggested_body: "cadastro novo" });
  await service.setStatus(OTHER_ADMIN, "news", news.id, "pending");
  assert.equal(db.tables.manual_sections.find((s) => s.id === sid("a")).body, "como cadastrar clientes");
  await service.setStatus(OWNER, "news", news.id, "published");
  const v = db.tables.manual_section_versions[0];
  assert.deepEqual([v.body_before, v.body_after, v.created_by, v.approved_by, v.news_id], ["como cadastrar clientes", "cadastro novo", U(1), U(1), news.id]);
  assert.equal(db.tables.manual_sections.find((s) => s.id === sid("a")).body, "cadastro novo");
  assert.equal(alerts[0].rows[0].dedupe_key, `manual_news:${news.id}:v1`);
});

test("falha ao criar alertas devolve a novidade para 'Aguardando'", async () => {
  const { service, db } = world({ failAlerts: true });
  const news = await service.createNews(OWNER, { title: "Falha", body: "x" });
  await service.setStatus(OWNER, "news", news.id, "pending");
  await assert.rejects(service.setStatus(OWNER, "news", news.id, "published"), /falha simulada/);
  assert.equal(db.tables.manual_news[0].status, "pending");
});

test("'Li e entendi': idempotente, só para novidade visível, ledger só admin", async () => {
  const { service, db } = world();
  const mk = async (audiences) => {
    const n = await service.createNews(OWNER, { title: `N ${audiences}`, slug: `n-${audiences}`, body: "x", audiences });
    await service.setStatus(OWNER, "news", n.id, "pending");
    return n;
  };
  const visible = await mk(["broker"]);
  const managerOnly = await mk(["manager"]);
  const unpublished = visible;
  await expectStatus(service.markNewsRead(BROKER, unpublished.id), 404); // ainda pendente
  await service.setStatus(OWNER, "news", visible.id, "published");
  await service.setStatus(OWNER, "news", managerOnly.id, "published");
  await service.markNewsRead(BROKER, visible.id);
  await service.markNewsRead(BROKER, visible.id);
  assert.equal(db.tables.manual_news_reads.length, 1);
  await expectStatus(service.markNewsRead(BROKER, managerOnly.id), 404); // mesma resposta de inexistente
  await expectStatus(service.markNewsRead(BROKER, U(99)), 404);
  assert.equal((await service.listVisibleNews(BROKER)).news.find((n) => n.id === visible.id).read, true);
  assert.ok(!(await service.listVisibleNews(BROKER)).news.some((n) => n.id === managerOnly.id));
  await expectStatus(service.listNewsReads(BROKER, visible.id), 403);
  const reads = await service.listNewsReads(OWNER, visible.id);
  assert.deepEqual(reads.reads.map((r) => [r.name, r.role]), [["Corretor", "broker"]]);
});

test("'Novo' é derivado: expira sem apagar o conteúdo", async () => {
  const { db, service } = world({ now: "2026-10-10T12:00:00Z" });
  seedPublished(db);
  db.tables.manual_sections.find((s) => s.id === sid("a")).last_updated_at = "2026-10-09T00:00:00Z";
  const tree = await service.getVisibleManual(BROKER);
  const secs = tree.topics[0].sections;
  assert.equal(secs.find((s) => s.slug === "a").isNew, true);
  assert.equal(secs.find((s) => s.slug === "b").isNew, false);
  assert.equal(secs.find((s) => s.slug === "b").body, "dica do corretor");
});

test("guard em create/update/publish/alerta (casos sintéticos)", async () => {
  const { service, db, alerts } = world();
  const bad = "O administrador consegue ver as conversas dos corretores.";
  await assert.rejects(service.createTopic(OWNER, { title: bad }), /Conteúdo não permitido/);
  await assert.rejects(service.createTopic(OWNER, { title: "ok", slug: "so-voce-ve-suas-conversas" }), /Conteúdo não permitido/);
  const topic = await service.createTopic(OWNER, { title: "Topico" });
  await assert.rejects(service.createSection(OWNER, { topic_id: topic.id, title: "S", body: bad }), /Conteúdo não permitido/);
  const section = await service.createSection(OWNER, { topic_id: topic.id, title: "S", body: "texto ok" });
  await assert.rejects(service.updateSection(OWNER, section.id, { body: bad }), /Conteúdo não permitido/);
  await assert.rejects(service.createNews(OWNER, { title: "ok", body: bad }), /Conteúdo não permitido/);
  await assert.rejects(service.createNews(OWNER, { title: "ok", suggested_body: bad }), /Conteúdo não permitido/);
  // Conteúdo que entrou por fora (pendente) é barrado na publicação, sem alerta.
  db.tables.manual_news.push({ id: NBAD, slug: NBAD, title: "Aviso", body: bad, audiences: ["all"], status: "pending", requires_ack: false });
  await assert.rejects(service.setStatus(OWNER, "news", NBAD, "published"), /Conteúdo não permitido/);
  assert.equal(alerts.length, 0);
  assert.equal(db.tables.manual_news.find((n) => n.id === NBAD).status, "pending");
  db.tables.manual_sections.push({ id: SBAD, topic_id: topic.id, slug: "sb", title: "SB", body: bad, audiences: ["all"], status: "pending" });
  await assert.rejects(service.setStatus(OWNER, "section", SBAD, "published"), /Conteúdo não permitido/);
});

test("seeds: carga idempotente, tudo 'pending', nada visível, não sobrescreve texto editado", async () => {
  const { service, db } = world();
  const first = await service.seedStructure(OWNER);
  assert.ok(first.topicsCreated >= 8 && first.sectionsCreated > 40 && first.newsCreated === 4);
  const second = await loadManualSeeds(db);
  assert.deepEqual(second, { topicsCreated: 0, sectionsCreated: 0, sectionsFilled: 0, newsCreated: 0 });
  assert.ok(db.tables.manual_topics.every((t) => t.status === "pending"));
  assert.ok(db.tables.manual_sections.every((s) => s.status === "pending" && s.body.length > 0));
  assert.ok(db.tables.manual_news.every((n) => n.status === "draft" && n.important === false && n.requires_ack === false));
  assert.deepEqual((await service.getVisibleManual(OWNER)).topics, []);
  // texto editado pelo dono é preservado; corpo vazio é preenchido
  const [a, b] = db.tables.manual_sections;
  a.body = "Texto editado pelo dono";
  b.body = "";
  const third = await loadManualSeeds(db);
  assert.equal(third.sectionsFilled, 1);
  assert.equal(a.body, "Texto editado pelo dono");
  assert.ok(b.body.length > 40);
  await expectStatus(service.seedStructure(OTHER_ADMIN), 403);
});

test("respostas das funções de leitura não casam com o guard nem trazem audiences", async () => {
  const { service, db } = world();
  seedPublished(db);
  const outputs = [];
  for (const auth of [BROKER, ASSOCIATE, MANAGER, OTHER_ADMIN]) {
    outputs.push(await service.getVisibleManual(auth), await service.searchManual(auth, "texto"), await service.listVisibleNews(auth));
  }
  for (const out of outputs) {
    assert.equal(isManualContentAllowed(out), true);
    assert.ok(!JSON.stringify(out).includes("audiences"));
  }
});
