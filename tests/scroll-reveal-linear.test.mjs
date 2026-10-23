// Entrada por rolagem (components/motion/scroll-reveal.js), etapa 2 de velocidade (2026-10-22):
// sem desfoque, linha de entrada em 90% e varredura linear — mesmo resultado da versão quadrática.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// DOM mínimo: só o que collectRevealTargets usa (seletores simples: tag, .classe, [atributo]).
class FakeElement {
  constructor(tag, { className = "", attrs = {}, height = 100 } = {}) {
    this.tagName = tag.toUpperCase();
    this.classList = new Set(className.split(/\s+/).filter(Boolean));
    this.attrs = attrs;
    this.height = height;
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
  }
  get childElementCount() { return this.children.length; }
  append(...kids) { for (const kid of kids) { kid.parentElement = this; this.children.push(kid); } return this; }
  matchesOne(sel) {
    sel = sel.trim();
    if (sel.startsWith(".")) return this.classList.has(sel.slice(1));
    if (sel.startsWith("[")) return sel.slice(1, -1).split("=")[0] in this.attrs;
    return this.tagName === sel.toUpperCase();
  }
  matches(selector) { return selector.split(",").some((sel) => this.matchesOne(sel)); }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  contains(other) {
    globalThis.__containsCalls += 1;
    for (let node = other; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => { for (const kid of node.children) { if (kid.matches(selector)) out.push(kid); walk(kid); } };
    walk(this);
    return out;
  }
  getBoundingClientRect() { return { top: 0, height: this.height }; }
}
globalThis.HTMLElement = FakeElement;
globalThis.window = { getComputedStyle: () => ({ position: "static", display: "block" }) };
globalThis.__containsCalls = 0;

const { collectRevealTargets, KEYFRAMES, REVEAL_ROOT_MARGIN, REVEAL_LINE_RATIO } = await import("../components/motion/scroll-reveal.js");

const el = (tag, opts) => new FakeElement(tag, opts);

test("sem desfoque: só opacity e transform; linha de entrada em 90%", () => {
  for (const frame of KEYFRAMES) assert.deepEqual(Object.keys(frame).sort(), ["opacity", "transform"]);
  assert.equal(REVEAL_ROOT_MARGIN, "0px 0px -10% 0px");
  assert.equal(REVEAL_LINE_RATIO, 0.9);
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../components/motion/scroll-reveal.js"), "utf8");
  assert.doesNotMatch(source, /filter:\s*"blur/);
});

test("folhas, lista promovida e exclusões continuam iguais", () => {
  const root = el("main");
  const page = el("section");                       // contém cards → não é folha
  const cardA = el("div", { className: "rounded-card" });
  const cardB = el("article");
  const inner = el("section");                       // folha dentro de cardB → cardB deixa de ser folha
  cardB.append(inner);
  page.append(cardA, cardB);
  const list = el("ul", { className: "rounded-panel" });
  const rows = Array.from({ length: 12 }, () => el("li", { attrs: { "data-reveal": "" } }));
  list.append(...rows);                              // > 8 irmãos → o bloco é a lista
  const tiny = el("section", { height: 10 });        // baixo demais
  const dialog = el("dialog").append(el("section")); // excluído
  const opted = el("div", { attrs: { "data-no-reveal": "" } }).append(el("article"));
  root.append(page, list, tiny, dialog, opted);

  const targets = collectRevealTargets(root);
  assert.deepEqual(targets, [cardA, inner, list]);
});

test("varredura linear: 300 cards não comparam cada um com todos", () => {
  const root = el("main");
  const grid = el("div");
  for (let i = 0; i < 300; i += 1) grid.append(el("article").append(el("p")));
  root.append(el("section").append(grid));
  globalThis.__containsCalls = 0;
  const targets = collectRevealTargets(root);
  assert.deepEqual(targets, [grid]);                 // 300 irmãos → a grade entra como um bloco só
  assert.ok(globalThis.__containsCalls < 1000, `contains chamado ${globalThis.__containsCalls}x (quadrático seria ~90 mil)`);
});

test("mutação: só os nós novos são varridos", () => {
  const root = el("main");
  const old = el("section");
  const fresh = el("div").append(el("article"));
  root.append(old, fresh);
  const fromScopes = collectRevealTargets(root, new Set([fresh, fresh.children[0]]));
  assert.deepEqual(fromScopes, [fresh.children[0]]);
  const detached = el("article");
  detached.isConnected = false;
  assert.deepEqual(collectRevealTargets(root, [detached]), []);
});
