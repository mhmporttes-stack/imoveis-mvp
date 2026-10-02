import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVisibleManual, canSeeContent, canTransition, isNewItem, manualHref, normalizeAudiences, normalizeSlug,
  requiresApprover, rolesForAudiences, searchVisibleManual
} from "../lib/manual-core.mjs";
import { isManualContentAllowed } from "../lib/manual-guard.mjs";

test("audiência por perfil efetivo", () => {
  const see = (role, aud) => canSeeContent({ role }, aud);
  assert.equal(see("broker", ["all"]), true);
  assert.equal(see("broker", ["manager"]), false);
  assert.equal(see("broker", ["admin"]), false);
  assert.equal(see("associate", ["broker"]), true);
  assert.equal(see("associate", ["manager"]), false);
  assert.equal(see("manager", ["manager"]), true);
  assert.equal(see("manager", ["admin"]), false);
  assert.equal(see("admin", ["admin"]), true);
  assert.equal(see("admin", ["manager"]), true);
  assert.equal(see("broker", []), false);
  assert.equal(canSeeContent(null, ["all"]), false);
  assert.deepEqual(rolesForAudiences(["manager"]), ["admin", "manager"]);
  assert.equal(rolesForAudiences(["all"]).length, 4);
});

test("normalizações e transições", () => {
  assert.throws(() => normalizeAudiences(["root"]));
  assert.throws(() => normalizeAudiences([]));
  assert.equal(normalizeSlug("Ação rápida!"), "acao-rapida");
  assert.equal(manualHref("clientes", "funil"), "/admin/manual#clientes/funil");
  assert.equal(manualHref("clientes"), "/admin/manual#clientes");
  assert.equal(canTransition("topic", "draft", "published"), false);
  assert.equal(canTransition("topic", "pending", "published"), true);
  assert.equal(canTransition("news", "published", "draft"), false);
  assert.equal(requiresApprover("news", "published"), true);
  assert.equal(requiresApprover("news", "pending"), false);
});

test("'Novo' é derivado e expira sem apagar", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const days = (n) => new Date(now - n * 86400000).toISOString();
  assert.equal(isNewItem({ last_updated_at: days(2) }, now), true);
  assert.equal(isNewItem({ last_updated_at: days(9) }, now), false);
  assert.equal(isNewItem({ last_updated_at: days(30), badge_until: new Date(now + 1000).toISOString() }, now), true);
  assert.equal(isNewItem({ last_updated_at: days(30), badge_until: new Date(now - 1000).toISOString() }, now), false);
  const section = { id: "s", topic_id: "t", slug: "a", title: "A", body: "texto", status: "published", audiences: ["all"], last_updated_at: days(40) };
  const tree = buildVisibleManual({ topics: [{ id: "t", slug: "t", title: "T", status: "published", audiences: ["all"] }], sections: [section] }, { role: "broker" }, now);
  assert.equal(tree[0].sections[0].isNew, false);
  assert.equal(tree[0].sections[0].body, "texto");
});

test("árvore visível não vaza rascunho, pendente, outro nível nem o campo audiences", () => {
  const topics = [
    { id: "t1", slug: "a", title: "A", status: "published", audiences: ["all"] },
    { id: "t2", slug: "b", title: "B-restrito", status: "published", audiences: ["admin"] },
    { id: "t3", slug: "c", title: "C-rascunho", status: "draft", audiences: ["all"] }
  ];
  const mk = (id, topic_id, status, audiences) => ({ id, topic_id, slug: id, title: `S-${id}`, body: id, status, audiences });
  const sections = [mk("s1", "t1", "published", ["all"]), mk("s2", "t1", "pending", ["all"]), mk("s3", "t1", "published", ["manager"]), mk("s4", "t2", "published", ["all"]), mk("s5", "t3", "published", ["all"])];
  const tree = buildVisibleManual({ topics, sections }, { role: "broker" });
  assert.deepEqual(tree.map((t) => [t.slug, t.sections.map((s) => s.slug)]), [["a", ["s1"]]]);
  const text = JSON.stringify(tree);
  assert.ok(!text.includes("audiences") && !text.includes("restrito") && !text.includes("rascunho") && !text.includes("pending"));
  assert.deepEqual(searchVisibleManual(tree, "s3"), []);
  assert.equal(searchVisibleManual(tree, "S-s1").length, 1);
});

test("guard: bloqueia casos sintéticos e deixa texto comum passar", () => {
  const bad = [
    "O administrador consegue ver as conversas dos corretores.",
    "Use Alterar conta para entrar como outro usuário.",
    "Só você vê suas conversas.",
    "Cliente arquivado aparece no histórico do chat para quem tem acesso especial.",
    "Tudo aqui é privacidade total."
  ];
  for (const text of bad) assert.equal(isManualContentAllowed(text), false, text);
  assert.equal(isManualContentAllowed("Como responder clientes no Chat e acompanhar a Meta Diária."), true);
  assert.equal(isManualContentAllowed("Passo 1: abra o cliente.", ["Etapas do funil"], { title: "Agenda" }), true);
});
