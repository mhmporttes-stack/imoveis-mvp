// 1.1.11 — DOM falso mínimo para testar as funções `...NaPagina` de instagram-api.js (rodam dentro da aba do
// Instagram). Só o que elas usam: querySelector(All) com seletores simples, innerText, getAttribute, closest,
// contains, getBoundingClientRect, click, dispatchEvent, execCommand, seleção. Nada fala com o Instagram.

function casaSimples(no, sel) {
  const m = sel.trim().match(/^([a-z]*)((?:\[[^\]]+\])*)$/i);
  if (!m) throw new Error(`seletor não suportado no DOM falso: ${sel}`);
  if (m[1] && no.tagName !== m[1].toUpperCase()) return false;
  for (const [, nome, valor] of m[2].matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]/gi)) {
    const v = no.getAttribute(nome);
    if (v == null) return false;
    if (valor !== undefined && v !== valor) return false;
  }
  return true;
}
const casa = (no, sel) => sel.split(',').some((s) => casaSimples(no, s));

export function el(tag, { texto = '', attrs = {}, filhos = [], visivel = true, aoClicar = null } = {}) {
  const no = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    textoProprio: texto,
    filhos: [],
    parentElement: null,
    visivel,
    cliques: 0,
    eventos: [],
    aoClicar,
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    get innerText() { return this.visivel ? [this.textoProprio, ...this.filhos.map((f) => f.innerText)].filter(Boolean).join('\n') : ''; },
    get textContent() { return [this.textoProprio, ...this.filhos.map((f) => f.textContent)].filter(Boolean).join(''); },
    getBoundingClientRect() { return this.visivel ? { left: 100, top: 200, width: 40, height: 20 } : { left: 0, top: 0, width: 0, height: 0 }; },
    click() { this.cliques += 1; if (this.aoClicar) this.aoClicar(this); },
    dispatchEvent(ev) { this.eventos.push(ev); if (this.aoEvento) this.aoEvento(ev); return true; },
    focus() { doc.ativo = this; },
    scrollIntoView() {},
    descendentes() { return this.filhos.flatMap((f) => [f, ...f.descendentes()]); },
    querySelectorAll(sel) { return this.descendentes().filter((d) => casa(d, sel)); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    contains(x) { return x === this || this.descendentes().includes(x); },
    closest(sel) { for (let n = this; n; n = n.parentElement) if (casa(n, sel)) return n; return null; },
    adicionar(...nos) { for (const n of nos) { n.parentElement = this; this.filhos.push(n); } return this; },
    remover(n) { this.filhos = this.filhos.filter((f) => f !== n); n.parentElement = null; },
  };
  no.adicionar(...filhos);
  return no;
}

let doc = null;

/** Instala `document`/`location`/eventos globais com `body`. Devolve o documento falso (com registro de execCommand). */
export function instalarDom(body) {
  doc = {
    body,
    ativo: null,
    comandos: [],
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    querySelector: (sel) => body.querySelector(sel),
    execCommand(nome, _ui, valor) { this.comandos.push([nome, valor]); if (this.aoComando) this.aoComando(nome, valor); return true; },
    getSelection: () => ({ removeAllRanges() {}, addRange() {}, selectAllChildren() {} }),
    createRange: () => ({ selectNodeContents() {}, collapse() {} }),
    elementFromPoint: () => doc.noPonto || null,
  };
  globalThis.document = doc;
  globalThis.location = { origin: 'https://www.instagram.com', pathname: '/fulano/' };
  globalThis.DataTransfer = class { constructor() { this.dados = {}; } setData(t, v) { this.dados[t] = v; } getData(t) { return this.dados[t] || ''; } };
  globalThis.ClipboardEvent = class { constructor(tipo, o = {}) { this.type = tipo; this.clipboardData = o.clipboardData; } };
  globalThis.MouseEvent = class { constructor(tipo, o = {}) { this.type = tipo; Object.assign(this, o); } };
  globalThis.KeyboardEvent = class { constructor(tipo, o = {}) { this.type = tipo; Object.assign(this, o); } };
  return doc;
}

export function desinstalarDom() {
  for (const k of ['document', 'location', 'DataTransfer', 'ClipboardEvent', 'MouseEvent', 'KeyboardEvent']) delete globalThis[k];
  doc = null;
}
