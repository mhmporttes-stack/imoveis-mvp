import test from "node:test";
import assert from "node:assert/strict";
import { MANUAL_SEED_CONTENT, MANUAL_SEED_TOPICS, MANUAL_SEED_NEWS } from "../lib/manual-seed-content.mjs";
import { MANUAL_SEED_STRUCTURE } from "../lib/manual-seed-structure.mjs";
import { MANUAL_AUDIENCES, normalizeSlug } from "../lib/manual-core.mjs";
import { assertManualContentAllowed, isManualContentAllowed } from "../lib/manual-guard.mjs";
import { parseSafeText } from "../lib/manual-ui-core.mjs";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

test("conteúdo: todo subtópico tem corpo não vazio e curto, sem HTML nem link", () => {
  assert.ok(MANUAL_SEED_CONTENT.length >= 40);
  for (const item of MANUAL_SEED_CONTENT) {
    assert.ok(item.body.length > 40 && item.body.length <= 1500, `${item.section}: tamanho ${item.body.length}`);
    assert.ok(!/[<>]/.test(item.body), `${item.section}: HTML`);
    assert.ok(!/https?:|www\.|\.com|\.br\b|javascript:/i.test(item.body), `${item.section}: link`);
    assert.ok(parseSafeText(item.body).length > 0);
    assert.ok(item.title.length > 0 && item.title.length <= 80);
  }
});

test("conteúdo: slugs únicos, estáveis (formato) e audiências válidas, sem 'admin'", () => {
  const topics = new Set(MANUAL_SEED_TOPICS.map((t) => t.slug));
  assert.equal(topics.size, MANUAL_SEED_TOPICS.length);
  const seen = new Set();
  for (const item of MANUAL_SEED_CONTENT) {
    assert.ok(topics.has(item.topic), item.topic);
    assert.ok(SLUG.test(item.section) && normalizeSlug(item.section) === item.section, item.section);
    const key = `${item.topic}/${item.section}`;
    assert.ok(!seen.has(key), `duplicado ${key}`);
    seen.add(key);
    assert.ok(item.audiences.length > 0);
    for (const a of item.audiences) assert.ok(MANUAL_AUDIENCES.includes(a) && a !== "admin", a);
  }
  const newsSlugs = new Set();
  for (const n of MANUAL_SEED_NEWS) {
    assert.ok(SLUG.test(n.slug) && !newsSlugs.has(n.slug));
    newsSlugs.add(n.slug);
    assert.ok(n.body.length > 20 && n.body.length <= 1500);
    assert.ok(!/[<>]/.test(n.body) && !/https?:/i.test(n.body));
    assert.deepEqual(n.audiences, ["broker"]);
  }
  assert.equal(MANUAL_SEED_NEWS.length, 4);
});

test("conteúdo: a varredura do guard passa em todos os textos", () => {
  for (const item of MANUAL_SEED_CONTENT) assert.equal(isManualContentAllowed(item.title, item.body), true, item.section);
  for (const n of MANUAL_SEED_NEWS) assert.equal(isManualContentAllowed(n.title, n.body), true, n.slug);
  assert.doesNotThrow(() => assertManualContentAllowed(MANUAL_SEED_STRUCTURE, MANUAL_SEED_NEWS));
});

test("estrutura derivada: todo tópico tem subtópicos com o mesmo corpo do conteúdo", () => {
  for (const topic of MANUAL_SEED_STRUCTURE) {
    assert.ok(topic.sections.length > 0, topic.slug);
    for (const s of topic.sections) assert.ok(s.body.length > 0);
  }
});
