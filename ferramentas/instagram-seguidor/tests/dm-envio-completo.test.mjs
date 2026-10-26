// 1.1.11 — pente fino da DM digitada e do seguir (dono, 26/10/2026, olhando a tela):
//  1) "escreve, apaga, escreve outro pedaço e apaga; no final só fica 'Conte comigo! 😊'" → mensagem inteira na caixa;
//  2) "escreve a mensagem, deixa ali e procura outra pessoa" → envio pelo CLIQUE no botão Enviar (Enter só plano B);
//  3) "clicou em enviar mensagem, ocorreu um erro, tente novamente, mas ele não clica de novo" → clica de novo;
//  4) "Não deve seguir quem já me segue" → pula pelo dado que já tem e confere o botão na hora do clique.
// Tudo com página/Instagram FALSOS: nenhuma DM nem follow real.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  abrirConversaNaPagina, acharEnviarNaPagina, colarNaPagina, escreverNaPagina, seguirNaPagina, digitarDmNaAba,
  TEXTOS_DM, TEXTOS_LEITURA, SHIFT_ENTER, criarApiInstagram, ErroInstagram,
} from '../instagram-api.js';
import { MENSAGEM_PADRAO, filtrarCandidatos, relacaoConhecida } from '../lib/regras.js';
import { el, instalarDom, desinstalarDom } from './ajuda/dom-falso.mjs';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';
import { DIA } from '../lib/tempo.js';

const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();

/** Espera uma promise avançando o relógio falso aos poucos. */
async function aguardar(promessa, passo = 50) {
  let pronto = false;
  let valor;
  let erro;
  promessa.then((v) => { pronto = true; valor = v; }, (e) => { pronto = true; erro = e; });
  for (let i = 0; i < 200000 && !pronto; i += 1) {
    await new Promise((r) => setImmediate(r));
    if (!pronto) mock.timers.tick(passo);
  }
  if (!pronto) throw new Error('não terminou');
  if (erro) throw erro;
  return valor;
}

// ------------------------------------------------------------- 3) "Ocorreu um erro" ao clicar em Mensagem

function perfilComMensagem({ errosAntesDeAbrir }) {
  const header = el('header');
  const main = el('main');
  const body = el('body', { filhos: [header, main] });
  let cliques = 0;
  const botao = el('div', {
    texto: 'Enviar mensagem',
    attrs: { role: 'button' },
    aoClicar: () => {
      cliques += 1;
      // O aviso some antes do próximo clique (como o toast do Instagram).
      for (const f of [...body.filhos]) if (f.attrs.toast) body.remover(f);
      if (cliques <= errosAntesDeAbrir) {
        setTimeout(() => body.adicionar(el('div', { texto: 'Ocorreu um erro. Tente novamente.', attrs: { toast: '1' } })), 500);
        setTimeout(() => { for (const f of [...body.filhos]) if (f.attrs.toast) body.remover(f); }, 1500);
      } else {
        setTimeout(() => main.adicionar(el('div', { attrs: { contenteditable: 'true', role: 'textbox', 'aria-label': 'Mensagem' } })), 800);
      }
    },
  });
  header.adicionar(botao);
  return { body, cliques: () => cliques };
}

test('abrir conversa: "Ocorreu um erro" no 1º e 2º clique → clica de novo (pausa 1–3 s) e abre no 3º', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const p = perfilComMensagem({ errosAntesDeAbrir: 2 });
  instalarDom(p.body);
  try {
    const r = await aguardar(abrirConversaNaPagina(TEXTOS_DM));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(p.cliques(), 3);
    assert.equal(r.errosVistos, 2);
  } finally { desinstalarDom(); mock.timers.reset(); }
});

test('abrir conversa: erro em todos os cliques → desiste após 4 cliques (nao_enviada, nada digitado)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const p = perfilComMensagem({ errosAntesDeAbrir: 99 });
  instalarDom(p.body);
  try {
    const r = await aguardar(abrirConversaNaPagina(TEXTOS_DM));
    assert.equal(r.ok, false);
    assert.equal(p.cliques(), 4, 'no máximo 4 cliques');
    assert.match(r.erro, /Ocorreu um erro/);
  } finally { desinstalarDom(); mock.timers.reset(); }
});

// ------------------------------------------------------------- 1) e 2) na página: colar, escrever, botão Enviar

function conversa() {
  const caixa = el('div', { attrs: { contenteditable: 'true', role: 'textbox', 'aria-label': 'Mensagem' } });
  const aviao = el('svg', { attrs: { 'aria-label': 'Enviar' } });
  const botaoEnviar = el('div', { attrs: { role: 'button' }, filhos: [aviao] });
  const composer = el('div', { filhos: [el('div', { filhos: [caixa] }), botaoEnviar] });
  // "Enviar" de um post na página (fora do bloco da caixa): nunca deve ser o escolhido.
  const enviarDoPost = el('div', { attrs: { role: 'button' }, filhos: [el('svg', { attrs: { 'aria-label': 'Enviar' } })] });
  const body = el('body', { filhos: [el('main', { filhos: [enviarDoPost] }), el('section', { filhos: [composer] })] });
  return { body, caixa, botaoEnviar, enviarDoPost };
}

test('colar: a mensagem INTEIRA (com as linhas em branco) vai num único evento "colar"; nenhuma tecla, nenhum insertLineBreak', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const c = conversa();
  const d = instalarDom(c.body);
  try {
    const r = await aguardar(colarNaPagina(MENSAGEM_PADRAO));
    assert.equal(r.ok, true);
    const colados = c.caixa.eventos.filter((e) => e.type === 'paste');
    assert.equal(colados.length, 1);
    assert.equal(colados[0].clipboardData.getData('text/plain'), MENSAGEM_PADRAO);
    assert.ok(!c.caixa.eventos.some((e) => /key/.test(e.type)), 'nenhuma tecla');
    assert.ok(!d.comandos.some(([n]) => n === 'insertLineBreak'));
  } finally { desinstalarDom(); mock.timers.reset(); }
});

test('escrever sem depurador: quebra de linha = texto "\\n", nunca insertLineBreak (era o que apagava a mensagem)', async () => {
  const c = conversa();
  const d = instalarDom(c.body);
  try {
    await escreverNaPagina([{ texto: 'Oi ' }, { texto: 'tudo' }, { quebra: true }, { quebra: true }, { texto: 'bem' }]);
    assert.ok(!d.comandos.some(([n]) => n === 'insertLineBreak'));
    assert.deepEqual(d.comandos, [['insertText', 'Oi '], ['insertText', 'tudo'], ['insertText', '\n'], ['insertText', '\n'], ['insertText', 'bem']]);
  } finally { desinstalarDom(); }
});

test('botão Enviar: acha o avião ao lado da caixa (nunca o "Enviar" de um post) e devolve o centro dele', async () => {
  const c = conversa();
  const d = instalarDom(c.body);
  d.noPonto = c.botaoEnviar;
  try {
    const r = await acharEnviarNaPagina(TEXTOS_DM);
    assert.equal(r.ok, true);
    assert.deepEqual([r.x, r.y, r.livre, r.clicou], [120, 210, true, false]);
    assert.equal(c.botaoEnviar.cliques, 0, 'só acha (o clique de verdade é pelo depurador)');
    const s = await acharEnviarNaPagina(TEXTOS_DM, true);
    assert.equal(s.clicou, true);
    assert.equal(c.botaoEnviar.cliques, 1);
    assert.equal(c.enviarDoPost.cliques, 0);
  } finally { desinstalarDom(); }
});

// ------------------------------------------------------------- 1) e 2) digitarDmNaAba com depurador (CDP falso)

/**
 * Aba falsa com depurador. `editor`: como a caixa reage — cola (o colar põe o texto), shiftEnter ('quebra' | 'apaga' |
 * 'envia'), cliqueEnvia, enterEnvia. Registra cada comando CDP.
 */
function abaFalsa(editor) {
  const estado = { caixa: '', conversa: [], cdp: [], funcs: [] };
  const enviar = (como) => { if (estado.caixa) { estado.conversa.push({ texto: estado.caixa, como }); estado.caixa = ''; } };
  const conta = (alvo) => estado.conversa.filter((m) => norm(m.texto).toLowerCase().includes(norm(alvo).toLowerCase())).length;
  const pagina = {
    abrirConversaNaPagina: () => ({ ok: true }),
    prepararCaixaNaPagina: ([t]) => { estado.caixa = ''; return { ok: true, contagem: conta(t) }; },
    colarNaPagina: ([t]) => { if (editor.cola) estado.caixa += t; return { ok: true, texto: estado.caixa }; },
    conferirCaixaNaPagina: ([t]) => { if (norm(estado.caixa) === norm(t)) return { ok: true }; estado.caixa = ''; return { ok: false, erro: 'o texto digitado não conferiu' }; },
    lerCaixaNaPagina: ([t]) => ({ ok: true, texto: norm(estado.caixa), conversa: conta(t) }),
    escreverNaPagina: ([partes]) => { for (const p of partes) estado.caixa += p.quebra ? '\n' : p.texto; return { ok: true }; },
    acharEnviarNaPagina: ([, clicar]) => { if (clicar && editor.cliqueEnvia) enviar('clique-pagina'); return editor.semBotao ? { ok: false, erro: 'botão Enviar não apareceu' } : { ok: true, x: 480, y: 700, livre: true, clicou: Boolean(clicar) }; },
    apertarEnterNaPagina: () => { if (editor.enterEnvia) enviar('enter'); return { ok: true }; },
    confirmarDmNaPagina: ([t, antes]) => (conta(t) > antes ? { ok: true, confirmado: true, naCaixa: false } : { ok: false, confirmado: false, naCaixa: norm(estado.caixa).includes(norm(t)), erro: 'a mensagem não apareceu na conversa' }),
  };
  const cdp = (metodo, p) => {
    estado.cdp.push([metodo, p]);
    if (metodo === 'Input.insertText') estado.caixa += p.text;
    if (metodo === 'Input.dispatchKeyEvent' && p.type === 'keyDown' && p.key === 'Enter') {
      if (p.modifiers & 8) {
        if (editor.shiftEnter === 'quebra') estado.caixa += '\n';
        else if (editor.shiftEnter === 'apaga') estado.caixa = '';
        else if (editor.shiftEnter === 'envia') enviar('shift-enter');
      } else if (editor.enterEnvia) enviar('enter-cdp');
    }
    if (metodo === 'Input.dispatchMouseEvent' && p.type === 'mouseReleased' && p.x === 480 && p.y === 700 && editor.cliqueEnvia) enviar('clique');
  };
  globalThis.chrome = {
    storage: { local: { get: async () => ({ janelaTrabalho: { windowId: 5, tabId: 50 } }), set: async () => {}, remove: async () => {} } },
    windows: { getAll: async () => [{ id: 5, type: 'normal', width: 520, tabs: [{ id: 50, url: 'https://www.instagram.com/', status: 'complete' }] }] },
    tabs: {
      get: async (id) => ({ id, windowId: 5, url: 'https://www.instagram.com/fulano/', status: 'complete' }),
      update: async () => ({}),
      onUpdated: { addListener() {}, removeListener() {} },
    },
    scripting: {
      executeScript: async ({ func, args }) => {
        estado.funcs.push(func.name);
        const f = pagina[func.name];
        if (!f) throw new Error(`função inesperada na aba: ${func.name}`);
        return [{ result: f(args) }];
      },
    },
    debugger: { attach: async () => {}, detach: async () => {}, sendCommand: async (_alvo, metodo, p) => { cdp(metodo, p); return {}; } },
  };
  return estado;
}

const dm = (texto = MENSAGEM_PADRAO) => aguardar(digitarDmNaAba({ username: 'fulano', texto }), 100);
const teclas = (estado) => estado.cdp.filter(([m]) => m === 'Input.dispatchKeyEvent').map(([, p]) => p);

test('com depurador: cola a mensagem inteira, confere e envia pelo CLIQUE de mouse no botão Enviar (sem Enter)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const aba = abaFalsa({ cola: true, cliqueEnvia: true });
  try {
    const r = await dm();
    assert.equal(r.confirmado, true, JSON.stringify(r));
    assert.equal(r.como, 'colada');
    assert.equal(r.envio, 'clique no botão Enviar');
    assert.equal(aba.conversa.length, 1);
    assert.equal(aba.conversa[0].texto, MENSAGEM_PADRAO, 'a mensagem inteira, com as linhas');
    assert.equal(aba.conversa[0].como, 'clique');
    assert.deepEqual(teclas(aba), [], 'nenhuma tecla (nem Enter)');
    const mouse = aba.cdp.filter(([m]) => m === 'Input.dispatchMouseEvent').map(([, p]) => p.type);
    assert.deepEqual(mouse, ['mouseMoved', 'mousePressed', 'mouseReleased']);
    assert.ok(aba.funcs.indexOf('conferirCaixaNaPagina') < aba.funcs.indexOf('acharEnviarNaPagina'), 'confere o texto antes de enviar');
  } finally { mock.timers.reset(); }
});

test('com depurador, colar ignorado: digita linha por linha com Shift+Enter real (modifiers 8, sem text) e só então clica', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const aba = abaFalsa({ cola: false, shiftEnter: 'quebra', cliqueEnvia: true });
  try {
    const r = await dm();
    assert.equal(r.confirmado, true, JSON.stringify(r));
    assert.equal(r.como, 'digitada (Shift+Enter)');
    assert.equal(aba.conversa.length, 1);
    assert.equal(aba.conversa[0].texto, MENSAGEM_PADRAO, 'nada se perdeu entre as linhas');
    const ks = teclas(aba);
    assert.equal(ks.length, (MENSAGEM_PADRAO.split('\n').length - 1) * 2, 'um Shift+Enter (keyDown+keyUp) por quebra');
    assert.ok(ks.every((k) => k.modifiers === 8 && k.key === 'Enter' && !('text' in k)), 'só Shift+Enter, nunca Enter puro');
    assert.deepEqual(SHIFT_ENTER.map((k) => k.type), ['keyDown', 'keyUp']);
  } finally { mock.timers.reset(); }
});

test('com depurador: Shift+Enter que APAGA o texto (o bug do dono) → para, esvazia a caixa e NÃO envia (nao_enviada)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const aba = abaFalsa({ cola: false, shiftEnter: 'apaga', cliqueEnvia: true });
  try {
    const r = await dm();
    assert.equal(r.ok, false);
    assert.equal(r.apertouEnter, false, 'nada saiu: pode tentar de novo depois');
    assert.match(r.erro, /apagou o texto/);
    assert.equal(aba.conversa.length, 0);
    assert.equal(aba.caixa, '');
    assert.ok(!aba.funcs.includes('acharEnviarNaPagina'), 'nem procurou o botão Enviar');
  } finally { mock.timers.reset(); }
});

test('com depurador: Shift+Enter que mandou parte da mensagem → incerto (nunca reenviar)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const aba = abaFalsa({ cola: false, shiftEnter: 'envia', cliqueEnvia: true });
  try {
    const r = await dm();
    assert.equal(r.ok, false);
    assert.equal(r.apertouEnter, true);
    assert.match(r.erro, /enviou parte/);
    assert.equal(aba.conversa.length, 1, 'só o pedaço que já tinha saído');
  } finally { mock.timers.reset(); }
});

test('com depurador: clique não enviou (mensagem inteira continua na caixa) → Enter UMA vez como plano B', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const aba = abaFalsa({ cola: true, cliqueEnvia: false, enterEnvia: true });
  try {
    const r = await dm();
    assert.equal(r.confirmado, true, JSON.stringify(r));
    assert.match(r.envio, /\+ Enter \(plano B\)/);
    assert.equal(teclas(aba).filter((k) => k.type === 'keyDown' && !k.modifiers).length, 1);
    assert.equal(aba.conversa.length, 1);
  } finally { mock.timers.reset(); }
});

test('com depurador: clique feito, caixa esvaziou, mas a mensagem não apareceu → incerto, sem Enter nem 2º clique', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const aba = abaFalsa({ cola: true, cliqueEnvia: true });
  // A conversa "não mostra" a mensagem enviada.
  const original = globalThis.chrome.scripting.executeScript;
  globalThis.chrome.scripting.executeScript = async (o) => (o.func.name === 'confirmarDmNaPagina' ? [{ result: { ok: false, confirmado: false, naCaixa: false, erro: 'não apareceu' } }] : original(o));
  try {
    const r = await dm();
    assert.equal(r.confirmado, false);
    assert.equal(r.apertouEnter, true, '→ incerto em enviarDm');
    assert.deepEqual(teclas(aba), []);
    assert.equal(aba.cdp.filter(([m, p]) => m === 'Input.dispatchMouseEvent' && p.type === 'mouseReleased').length, 1);
  } finally { mock.timers.reset(); }
});

test('sem botão Enviar na tela → Enter (plano B)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const aba = abaFalsa({ cola: true, semBotao: true, enterEnvia: true });
  try {
    const r = await dm();
    assert.equal(r.confirmado, true);
    assert.match(r.envio, /^Enter/);
    assert.equal(aba.conversa[0].como, 'enter-cdp');
  } finally { mock.timers.reset(); }
});

test('enviarDm: o histórico diz como a mensagem foi escrita e enviada', async () => {
  const api = criarApiInstagram({
    obterCsrf: async () => 'tok',
    executar: async () => ({ status: 200, texto: '<!DOCTYPE html><html></html>', tipoResposta: 'text/html' }),
    digitarDm: async () => ({ ok: true, confirmado: true, apertouEnter: true, como: 'colada', envio: 'clique no botão Enviar' }),
  });
  const r = await api.enviarDm('77', 'Oi', { username: 'f' });
  assert.equal(r.modo, 'digitação na tela da DM — mensagem colada, clique no botão Enviar');
});

// ------------------------------------------------------------- simulação: "Ocorreu um erro" ao abrir → DM sai uma vez

test('simulação: "Ocorreu um erro" 2× ao abrir a conversa → clica de novo e a DM inteira sai uma única vez', { timeout: 240_000 }, async () => {
  const inicio = Date.parse('2026-10-20T07:30:00Z');
  const ig = criarInstagramFalso({ totalSeguidores: 20, voltaSe: () => false });
  ig.novosSeguidoresDeFora(10, 1);
  ig.dmHtml = true;
  ig.dmTela.errosAoAbrir = 2;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.avancarAte(inicio + 60 * 60 * 1000);
  ig.novosSeguidoresDeFora(1, Date.now());
  await ext.avancarAte(Date.now() + DIA);
  assert.equal(ig.dms.length, 1);
  assert.equal(ig.dms[0].texto, MENSAGEM_PADRAO);
  assert.equal(ig.cliquesMensagem, 3);
  mock.timers.reset();
});

// ------------------------------------------------------------- 4) não seguir quem já me segue / quem já sigo

test('relacaoConhecida/filtrarCandidatos: já me segue ou já sigo pelo dado da lista (e pela lista dos meus seguidores)', () => {
  assert.equal(relacaoConhecida({ pk: 1, friendship_status: { followed_by: true } }), 'ja_me_segue');
  assert.equal(relacaoConhecida({ pk: 1, follows_viewer: true }), 'ja_me_segue');
  assert.equal(relacaoConhecida({ pk: 1, friendship_status: { following: true } }), 'ja_sigo');
  assert.equal(relacaoConhecida({ pk: 1, friendship_status: { outgoing_request: true } }), 'ja_sigo');
  assert.equal(relacaoConhecida({ pk: 1, followed_by_viewer: true }), 'ja_sigo');
  assert.equal(relacaoConhecida({ pk: 1, followed_by: { count: 10 } }), null, 'contagem de seguidores não é relação');
  assert.equal(relacaoConhecida({ pk: 7 }, { 7: 123 }), 'ja_me_segue');
  assert.equal(relacaoConhecida({ pk: 8, friendship_status: { following: false, followed_by: false } }), null);
  const usuarios = [
    { pk: 1, username: 'a', profile_pic_url: 'https://x/a.jpg' },
    { pk: 2, username: 'b', profile_pic_url: 'https://x/b.jpg', friendship_status: { following: true } },
    { pk: 3, username: 'c', profile_pic_url: 'https://x/c.jpg' },
  ];
  const r = filtrarCandidatos(usuarios, { meuId: '99', meSeguem: { 3: 1 } });
  assert.deepEqual(r.aceitos.map((x) => x.id), ['1']);
  assert.deepEqual(r.pulados, { ja_sigo: 1, ja_me_segue: 1 });
});

test('seguir na página: só clica se o botão do perfil for "Seguir"; "Seguindo", "Solicitado", "Seguir de volta" e "Segue você" = não clica', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const montar = (botaoTexto, extra = '') => {
    const botao = el('button', { texto: botaoTexto });
    const sugestao = el('button', { texto: 'Seguir' }); // sugestão fora do <header>
    const header = el('header', { filhos: [botao, ...(extra ? [el('span', { texto: extra })] : [])] });
    instalarDom(el('body', { filhos: [header, el('section', { filhos: [sugestao] })] }));
    return { botao, sugestao };
  };
  try {
    for (const [texto, esperado] of [['Seguindo', 'seguindo'], ['Solicitado', 'solicitado'], ['Seguir de volta', 'seguir_de_volta']]) {
      const p = montar(texto);
      const r = await aguardar(seguirNaPagina(TEXTOS_LEITURA));
      assert.equal(r.recusado, true, texto);
      assert.equal(r.botao, esperado);
      assert.equal(p.botao.cliques + p.sugestao.cliques, 0, `${texto}: nada clicado`);
      desinstalarDom();
    }
    const v = montar('Seguir', 'Segue você');
    const rv = await aguardar(seguirNaPagina(TEXTOS_LEITURA));
    assert.equal(rv.recusado, true);
    assert.equal(rv.segueVoce, true);
    assert.equal(v.botao.cliques, 0);
    desinstalarDom();
    const s = montar('Seguir');
    const rs = await aguardar(seguirNaPagina(TEXTOS_LEITURA));
    assert.equal(rs.ok, true);
    assert.equal(s.botao.cliques, 1);
    assert.equal(s.sugestao.cliques, 0, 'nunca a sugestão');
  } finally { desinstalarDom(); mock.timers.reset(); }
});

test('acaoEscrita: botão "Seguir de volta" na hora do clique → erro ja_relacionado (não segue); "Seguindo" → confere sem clicar', async () => {
  const html = { status: 200, texto: '<!DOCTYPE html><html></html>', tipoResposta: 'text/html' };
  const mk = (resposta, leitura) => criarApiInstagram({
    obterCsrf: async () => 'tok',
    executar: async () => html,
    clicar: async (x) => { assert.equal(x.seguir, true); return resposta; },
    lerPerfil: async () => leitura,
  });
  const a = mk({ ok: false, recusado: true, botao: 'seguir_de_volta' }, { ok: true, botao: 'seguir_de_volta' });
  await assert.rejects(a.seguir('77', 'fulano'), (e) => e instanceof ErroInstagram && e.tipo === 'ja_relacionado' && /já me segue/.test(e.message));
  const b = mk({ ok: false, recusado: true, botao: 'seguindo' }, { ok: true, botao: 'seguindo' });
  const rb = await b.seguir('77', 'fulano');
  assert.equal(rb.seguindo, true);
});

test('simulação: quem já me segue (na lista dos meus seguidores) é pulado SEM abrir o perfil e sem gastar cota', { timeout: 240_000 }, async () => {
  const inicio = Date.parse('2026-10-20T07:30:00Z');
  const ig = criarInstagramFalso({ totalSeguidores: 40, voltaSe: () => false });
  // pessoa3..pessoa6 já me seguem (fora da extensão) e entram na linha de base das boas-vindas.
  for (const n of [3, 4, 5, 6]) ig.meSeguem.set(String(1000 + n), 1);
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.avancarAte(inicio + 60 * 60 * 1000); // linha de base gravada
  assert.ok(ext.estado().meusSeguidores.linhaDeBaseEm, 'linha de base gravada');
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(inicio + DIA);
  const e = ext.estado();
  for (const n of [2, 3, 4, 5, 6]) {
    const id = String(1000 + n);
    assert.ok(!ig.sigo.has(id) && !ig.pendentes.has(id), `pessoa${n} não foi seguida`);
    assert.ok(!e.seguidos[id], `pessoa${n} fora dos seguidos`);
    assert.ok(!ig.chamadas.some((c) => c.caminho === `/api/v1/friendships/show/${id}/` || c.caminho === `leitura:pessoa${n}` || c.caminho === `clique:pessoa${n}`), `pessoa${n}: perfil nem aberto/checado`);
  }
  assert.ok(e.ultimaBusca.pulados.ja_me_segue >= 5, JSON.stringify(e.ultimaBusca.pulados));
  mock.timers.reset();
});

test('simulação: na hora do clique o perfil mostra "Seguir de volta" → não segue, histórico registra, cota intacta', { timeout: 240_000 }, async () => {
  const inicio = Date.parse('2026-10-20T07:30:00Z');
  const ig = criarInstagramFalso({ totalSeguidores: 30, voltaSe: () => false });
  ig.createHtml = true; // API de seguir em HTML → caminho do clique no botão do perfil
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  // pessoa1 passa a me seguir depois da checagem e antes do clique: simulado marcando-a quando o friendships/create é chamado.
  const responder = ig.responder;
  ig.responder = (req) => {
    if (/friendships\/create\/1001\//.test(req.url)) ig.meSeguem.set('1001', Date.now());
    return responder(req);
  };
  await ext.avancarAte(inicio + DIA);
  const e = ext.estado();
  assert.ok(!ig.sigo.has('1001') && !e.seguidos['1001'], 'pessoa1 não foi seguida');
  assert.ok(ig.chamadas.some((c) => c.caminho === 'recusado:pessoa1:seguir_de_volta'), 'o botão foi conferido na hora e não clicado');
  assert.equal(e.vistos['1001'], 'ja_relacionado');
  assert.ok(e.historico.some((h) => h.username === 'pessoa1' && h.acao === 'pulado' && /já me segue \(visto no botão do perfil na hora de seguir\)/.test(h.resultado)));
  assert.ok(Object.keys(e.seguidos).length > 0 && !e.suspensoSeguir, 'pulo não é erro: o seguir continua com os próximos da fila');
  assert.ok(!e.historico.some((h) => h.username === 'pessoa1' && h.acao === 'seguir'), 'pessoa1 não entrou como seguida (nem na cota)');
  mock.timers.reset();
});

// ------------------------------------------------------------- 1.1.12: clique de Seguir com depurador

test('1.1.12 seguir com depurador: clique de mouse no centro do botão e releitura "Seguindo"; clique perdido → 1 clique pela página', async () => {
  const { clicarNaAba } = await import('../instagram-api.js');
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const mouseFunciona of [true, false]) {
      const estado = { botao: 'seguir', cdp: [], cliquesPagina: 0 };
      abaFalsa({});
      globalThis.chrome.scripting.executeScript = async ({ func, args }) => {
        if (func.name === 'seguirNaPagina') {
          if (estado.botao !== 'seguir') return [{ result: { ok: false, recusado: true, botao: estado.botao } }];
          if (args[1]) { estado.cliquesPagina += 1; estado.botao = 'seguindo'; }
          return [{ result: { ok: true, botao: 'seguir', x: 300, y: 120, livre: true, clicou: Boolean(args[1]) } }];
        }
        if (func.name === 'lerEstadoNaPagina') return [{ result: { ok: true, botao: estado.botao } }];
        if (func.name === 'esqueletoNaPagina') return [{ result: { url: '/:perfil/' } }];
        throw new Error(`inesperada: ${func.name}`);
      };
      globalThis.chrome.debugger.sendCommand = async (_a, metodo, p) => {
        estado.cdp.push([metodo, p]);
        if (metodo === 'Input.dispatchMouseEvent' && p.type === 'mouseReleased' && p.x === 300 && p.y === 120 && mouseFunciona) estado.botao = 'seguindo';
        return {};
      };
      const r = await aguardar(clicarNaAba({ username: 'fulano', seguir: true }), 100);
      assert.equal(r.botaoDepois, 'seguindo', JSON.stringify(r));
      assert.equal(estado.cdp.filter(([m, p]) => m === 'Input.dispatchMouseEvent' && p.type === 'mousePressed').length, 1, 'um clique de mouse');
      assert.equal(estado.cliquesPagina, mouseFunciona ? 0 : 1);
    }
  } finally { mock.timers.reset(); }
});
