// 1.1.4 — caso real 24/10: POST /api/v1/friendships/show_many/ respondeu HTTP 200 com a página HTML do
// Instagram. HTML numa resposta da API vira "checagem indisponível" (nunca "sem sessão", nunca pausa, nunca
// gasta perfil da fila nem o limite do dia) e a checagem segue pela leitura do botão do perfil.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { DIA, HORA } from '../lib/tempo.js';
import { STATUS } from '../lib/regras.js';
import {
  criarApiInstagram, ErroInstagram, amizadeDoBotao, requisicaoNaPagina, diagnostico, IG_APP_ID_WEB,
} from '../instagram-api.js';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';

// Fixtures: resposta HTML do caso real e respostas JSON normais.
const HTML_SHOW_MANY = {
  status: 200,
  texto: '<!DOCTYPE html><html class="_9dls" lang="pt"><head><title>Instagram</title></head><body></body></html>',
  tipoResposta: 'text/html; charset="utf-8"',
  metodoUsado: 'POST',
  urlPedida: 'https://www.instagram.com/api/v1/friendships/show_many/',
  urlFinal: 'https://www.instagram.com/api/v1/friendships/show_many/',
  cabecalhosDaPagina: [],
};
const JSON_SHOW_MANY = { status: 200, texto: '{"friendship_statuses":{"11":{"following":true,"outgoing_request":false,"followed_by":true},"22":{"following":false,"outgoing_request":true}},"status":"ok"}' };
const HTML_SHOW = { status: 200, texto: '<!DOCTYPE html><html><head><title>Instagram</title></head></html>' };

function apiCom(respostas, { leituras = [] } = {}) {
  const pedidos = [];
  const lidos = [];
  const api = criarApiInstagram({
    obterCsrf: async () => 'tok',
    executar: async (req) => { pedidos.push(req); return respostas.shift(); },
    clicar: async () => ({ ok: false, erro: 'não usado' }),
    lerPerfil: async ({ username }) => { lidos.push(username); const r = leituras.shift(); if (r instanceof Error) throw r; return r; },
  });
  return { api, pedidos, lidos };
}

test('show_many com HTML (caso real) → "indisponivel", nunca "sessao" nem "mudanca_api"', async () => {
  const { api } = apiCom([HTML_SHOW_MANY]);
  await assert.rejects(api.amizadeVarios(['11', '22']), (e) => {
    assert.ok(e instanceof ErroInstagram);
    assert.equal(e.tipo, 'indisponivel');
    assert.equal(e.endpoint, 'friendships/show_many');
    assert.match(e.message, /HTML \(título: Instagram\)/);
    assert.match(e.message, /cabeçalhos da página: nenhum/);
    return true;
  });
});

test('show_many com JSON continua normalizado', async () => {
  const { api } = apiCom([JSON_SHOW_MANY]);
  const r = await api.amizadeVarios(['11', '22']);
  assert.equal(r['11'].seguindo, true);
  assert.equal(r['11'].meSegue, true);
  assert.equal(r['22'].pedidoPendente, true);
  assert.equal(r['22'].meSegue, undefined);
});

test('show_many: erros que não são HTML seguem como antes (limite e sessão)', async () => {
  const a = apiCom([{ status: 429, texto: '' }]);
  await assert.rejects(a.api.amizadeVarios(['1']), (e) => e.tipo === 'limite');
  const b = apiCom([{ status: 401, texto: '{"message":"login_required"}' }]);
  await assert.rejects(b.api.amizadeVarios(['1']), (e) => e.tipo === 'sessao');
});

test('friendships/show com HTML → lê o botão do perfil (sem clicar)', async () => {
  const { api, lidos } = apiCom([HTML_SHOW], { leituras: [{ ok: true, botao: 'seguindo', segueVoce: false, privado: false }] });
  const st = await api.amizade('11', 'fulano');
  assert.deepEqual(lidos, ['fulano']);
  assert.equal(st.seguindo, true);
  assert.equal(st.meSegue, undefined, '"Seguindo" não diz se a pessoa me segue');
  assert.equal(st.via, 'perfil (botão)');
});

test('friendships/show com HTML e leitura do botão falhando → "indisponivel"', async () => {
  const a = apiCom([HTML_SHOW], { leituras: [{ ok: false, erro: 'botão Seguir/Seguindo não apareceu' }] });
  await assert.rejects(a.api.amizade('11', 'fulano'), (e) => e.tipo === 'indisponivel' && /não apareceu/.test(e.message));
  const b = apiCom([HTML_SHOW]);
  await assert.rejects(b.api.amizade('11'), (e) => e.tipo === 'indisponivel', 'sem @ não dá para ler o perfil');
});

test('friendships/show com JSON não abre o perfil', async () => {
  const { api, lidos } = apiCom([{ status: 200, texto: '{"following":false,"followed_by":true,"outgoing_request":false,"status":"ok"}' }]);
  const st = await api.amizade('11', 'fulano');
  assert.equal(st.meSegue, true);
  assert.deepEqual(lidos, []);
});

test('amizadeDoBotao: Seguir / Seguir de volta / Seguindo / Solicitado', () => {
  assert.equal(amizadeDoBotao({ ok: false }), null);
  assert.equal(amizadeDoBotao({ ok: true, botao: 'xyz' }), null);
  assert.deepEqual(amizadeDoBotao({ ok: true, botao: 'seguir' }), { seguindo: false, meSegue: false, pedidoPendente: false, privado: false, via: 'perfil (botão)' });
  assert.equal(amizadeDoBotao({ ok: true, botao: 'seguir_de_volta' }).meSegue, true);
  assert.equal(amizadeDoBotao({ ok: true, botao: 'seguindo', segueVoce: true }).meSegue, true);
  const sol = amizadeDoBotao({ ok: true, botao: 'solicitado' });
  assert.equal(sol.pedidoPendente, true);
  assert.equal(sol.meSegue, undefined);
});

test('requisicaoNaPagina: usa os cabeçalhos da própria página (app-id, ajax, asbd, csrf, claim) e só devolve os nomes', async () => {
  const antes = { document: globalThis.document, sessionStorage: globalThis.sessionStorage, location: globalThis.location, fetch: globalThis.fetch };
  let enviado = null;
  globalThis.document = {
    cookie: 'mid=x; csrftoken=COOKIE_TOKEN; ds_user_id=9',
    querySelectorAll: () => [
      { textContent: 'requireLazy(["X"],function(){ {"X-IG-App-ID":"1217981644879628","ASBD_ID":"129477"} })' },
      { textContent: '{"rollout_hash":"1a2b3c4d5e6f","csrf_token":"HTML_TOKEN_123"}' },
    ],
  };
  globalThis.sessionStorage = { getItem: (k) => (k === 'www-claim-v2' ? 'hmac.CLAIM' : null) };
  globalThis.location = { origin: 'https://www.instagram.com' };
  globalThis.fetch = async (url, opc) => {
    enviado = { url, opc };
    return { status: 200, url, redirected: false, text: async () => '{"status":"ok"}', headers: { get: () => 'application/json' } };
  };
  try {
    const r = await requisicaoNaPagina('https://www.instagram.com/api/v1/friendships/show_many/', 'POST', 'user_ids=1', { 'x-ig-app-id': IG_APP_ID_WEB, 'x-requested-with': 'XMLHttpRequest' }, 'https://www.instagram.com/');
    const h = enviado.opc.headers;
    assert.equal(h['x-ig-app-id'], '1217981644879628', 'o da página vence o fixo');
    assert.equal(h['x-asbd-id'], '129477');
    assert.equal(h['x-instagram-ajax'], '1a2b3c4d5e6f');
    assert.equal(h['x-csrftoken'], 'COOKIE_TOKEN', 'cookie vence o embutido no HTML');
    assert.equal(h['x-ig-www-claim'], 'hmac.CLAIM');
    assert.equal(h['x-requested-with'], 'XMLHttpRequest');
    assert.equal(enviado.opc.credentials, 'include');
    assert.equal(enviado.opc.mode, 'same-origin');
    assert.deepEqual(r.cabecalhosDaPagina.sort(), ['x-asbd-id', 'x-csrftoken', 'x-ig-app-id', 'x-ig-www-claim', 'x-instagram-ajax']);
    assert.ok(!JSON.stringify(r.cabecalhosDaPagina).includes('TOKEN'), 'nunca devolve valores');
    const d = diagnostico({ metodo: 'POST', url: r.urlPedida, cabecalhos: {}, corpo: 'user_ids=1', resp: r });
    assert.match(d, /cabeçalhos da página: /);
    assert.ok(!d.includes('COOKIE_TOKEN') && !d.includes('CLAIM'));

    // Página HTML (sem cabeçalhos de API): nada é acrescentado.
    await requisicaoNaPagina('https://www.instagram.com/fulano/', 'GET', null, {}, 'https://www.instagram.com/');
    assert.deepEqual(enviado.opc.headers, {});
  } finally {
    Object.assign(globalThis, antes);
  }
});

test('simulação: show_many e show em HTML → sem "sem sessão", sem pausa, sem alerta; checagem pelo botão com limite', { timeout: 240_000 }, async () => {
  const inicio = Date.parse('2026-10-20T07:30:00Z'); // 04:30 SP
  const ig = criarInstagramFalso({ totalSeguidores: 120, voltaSe: (n) => n % 3 === 0 });
  for (const u of ig.usuarios) u.is_private = true; // follow-back de privado só aparece pela varredura
  ig.aceitaSe = (n) => n % 3 === 1;
  ig.showManyHtml = true;
  ig.showHtml = true;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, true, r.erro);

  await ext.avancarAte(inicio + 2 * DIA);
  const e = ext.estado();
  assert.equal(e.semSessao, false, 'HTML nunca vira "sessão perdida"');
  assert.equal(e.pausaAte, null, 'HTML não é bloqueio');
  assert.ok(!e.alerta || !/show_many/.test(e.alerta.texto || ''), 'sem alerta de mudança de API por show_many');
  assert.ok(!e.historico.some((h) => /Sessão não reconhecida/.test(h.resultado || '')));
  assert.ok(e.historico.some((h) => /checagem em lote indisponível/.test(h.resultado || '')));

  // Seguir continua funcionando (confirmação pelo botão) e dentro do limite do dia — nada de ritmo maior.
  const regs = Object.values(e.seguidos);
  assert.equal(regs.length, 30, `seguidos ${regs.length}`);
  assert.ok(e.historico.filter((h) => h.acao === 'seguir').every((h) => /confirmado/.test(h.resultado)));
  assert.ok(!Object.values(e.vistos).some((v) => String(v).startsWith('erro:')), 'nenhum perfil da fila gasto com erro');

  // Aceite de solicitação detectado pela leitura do botão.
  assert.ok(regs.some((x) => x.aceitoEm), 'aceite detectado pelo botão "Seguindo"');

  // Limite de visitas: por varredura (30 min) no máximo 5 leituras de perfil além das do seguir.
  // Leituras de perfil = 2 por seguir (antes e confirmação) + no máximo 5 por varredura de show_many.
  const leituras = ig.chamadas.filter((c) => c.metodo === 'READ');
  const showMany = ig.chamadas.filter((c) => c.caminho === '/api/v1/friendships/show_many/').length;
  assert.ok(leituras.length <= 30 * 2 + showMany * 5, `leituras ${leituras.length}`);
  const porHora = new Map();
  for (const c of leituras) { const h = Math.floor(c.em / HORA); porHora.set(h, (porHora.get(h) || 0) + 1); }
  assert.ok(Math.max(...porHora.values()) <= 2 * 5 + 2 * 3, `pico de ${Math.max(...porHora.values())} leituras numa hora`);

  // Na dúvida (botão "Seguindo" não diz se me segue) nunca deixa de seguir.
  await ext.avancarAte(inicio + 4 * DIA);
  const e2 = ext.estado();
  assert.equal(ig.chamadas.filter((c) => c.caminho.startsWith('/api/v1/friendships/destroy/')).length, 0);
  assert.ok(e2.historico.some((h) => /adiado: não deu para confirmar se segue de volta/.test(h.resultado || '')));
  assert.ok(!Object.values(e2.seguidos).some((x) => x.status === STATUS.DEIXADO));
  mock.timers.reset();
});

test('simulação: show_many e leitura do botão indisponíveis → perfil volta para a fila e o limite não é gasto', { timeout: 240_000 }, async () => {
  const inicio = Date.parse('2026-10-20T07:30:00Z');
  const ig = criarInstagramFalso({ totalSeguidores: 60 });
  ig.showManyHtml = true;
  ig.showHtml = true;
  ig.leituraFalha = true;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  const filaAntes = ext.estado().fila.length;
  await ext.avancarAte(inicio + 12 * HORA);
  const e = ext.estado();
  assert.equal(e.semSessao, false);
  assert.equal(e.pausaAte, null);
  assert.equal(e.contadores.seguidos, 0);
  assert.equal(Object.keys(e.seguidos).length, 0);
  assert.equal(e.fila.length, filaAntes, 'nenhum perfil gasto');
  assert.ok(!Object.values(e.vistos).some((v) => String(v).startsWith('erro:')));
  assert.ok(e.historico.some((h) => /checagem indisponível/.test(h.resultado || '')));
  assert.equal(ig.chamadas.filter((c) => c.caminho.includes('/create/')).length, 0, 'sem checagem, não segue ninguém');
  mock.timers.reset();
});
