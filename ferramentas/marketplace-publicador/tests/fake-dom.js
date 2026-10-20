// DOM mínimo para testar os leitores de selectors.js sem navegador: h(tag, atributos, ...filhos) monta a árvore;
// suporta seletores com tag, [attr], [attr="v"], [attr*="v"], [attr^="v"], vírgula e descendente (espaço).

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text);
    this.parentElement = null;
  }
}

function splitTop(selector, separator) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of selector) {
    if (quote) {
      if (char === quote) quote = "";
      current += char;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[") depth += 1;
    else if (char === "]") depth -= 1;
    if (depth === 0 && (separator === " " ? /\s/.test(char) : char === separator)) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function matchCompound(element, compound) {
  const tag = compound.match(/^[a-zA-Z][\w-]*/);
  if (tag && element.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
  for (const [, name, op, raw] of compound.matchAll(/\[([\w:-]+)(?:([*^]?=)("[^"]*"|'[^']*'|[^\]]*))?\]/g)) {
    if (!element.hasAttribute(name)) return false;
    if (!op) continue;
    const value = raw.replace(/^["']|["']$/g, "");
    const actual = element.getAttribute(name);
    if (op === "=" && actual !== value) return false;
    if (op === "*=" && !actual.includes(value)) return false;
    if (op === "^=" && !actual.startsWith(value)) return false;
  }
  return true;
}

function matchComplex(element, parts) {
  if (!matchCompound(element, parts[parts.length - 1])) return false;
  let index = parts.length - 2;
  for (let node = element.parentElement; node && index >= 0; node = node.parentElement) {
    if (matchCompound(node, parts[index])) index -= 1;
  }
  return index < 0;
}

export class FakeElement {
  constructor(tag, attrs = {}, children = []) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.childNodes = [];
    this.parentElement = null;
    this.ownerDocument = null;
    for (const child of children.flat()) this.append(child);
  }

  append(child) {
    const node = typeof child === "string" ? new FakeText(child) : child;
    node.parentElement = this;
    this.childNodes.push(node);
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }

  get attributes() {
    return Object.entries(this.attrs).map(([name, value]) => ({ name, value }));
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  get innerText() {
    return this.textContent;
  }

  get innerHTML() {
    return "";
  }

  getBoundingClientRect() {
    return { left: 0, right: 300, top: 0, bottom: 40, width: 300, height: 40 };
  }

  scrollIntoView() {}

  click() {
    this.onClick?.();
  }

  remove() {
    const parent = this.parentElement;
    if (parent) parent.childNodes = parent.childNodes.filter((node) => node !== this);
    this.parentElement = null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name);
  }

  getAttribute(name) {
    return this.hasAttribute(name) ? String(this.attrs[name]) : null;
  }

  matches(selector) {
    return splitTop(selector, ",").some((complex) => matchComplex(this, splitTop(complex, " ")));
  }

  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }

  contains(other) {
    for (let node = other; node; node = node.parentElement) if (node === this) return true;
    return false;
  }

  *descendants() {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }

  querySelectorAll(selector) {
    return [...this.descendants()].filter((node) => node.matches(selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

export const h = (tag, attrs = {}, ...children) => new FakeElement(tag, attrs, children);

// "document" falso em volta de um <body> FakeElement.
export function fakeDocument(body) {
  return { body, querySelectorAll: (sel) => body.querySelectorAll(sel), querySelector: (sel) => body.querySelector(sel), scrollingElement: null };
}
