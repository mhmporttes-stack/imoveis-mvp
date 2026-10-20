// Testes do módulo instagram-api.js com um executor FALSO (sem rede).
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarApiInstagram, ErroInstagram, IG_APP_ID_WEB, extrairIdDoHtml } from '../instagram-api.js';

function apiCom(respostas) {
  const pedidos = [];
  const api = criarApiInstagram({
    obterCsrf: async () => 'tok',
    executar: async (req) => {
      pedidos.push(req);
      const r = respostas.shift();
      return typeof r === 'function' ? r(req) : r;
    },
  });
  return { api, pedidos };
}

test('cabeçalhos da API web e leitura do perfil', async () => {
  const { api, pedidos } = apiCom([{ status: 200, texto: '{"data":{"user":{"id":"123","username":"ref","is_private":false}},"status":"ok"}' }]);
  const p = await api.buscarPerfil('@Ref');
  assert.deepEqual(p, { id: '123', username: 'ref', privado: false, sigoEsse: undefined, seguidores: null, via: 'web_profile_info' });
  const h = pedidos[0].cabecalhos;
  assert.equal(h['x-instagram-ajax'], undefined, 'cabeçalho que o site não manda');
  assert.ok(h['x-asbd-id']);
  assert.equal(pedidos[0].referer, 'https://www.instagram.com/ref/');
  assert.equal(h['x-csrftoken'], 'tok');
  assert.equal(h['x-ig-app-id'], IG_APP_ID_WEB);
  assert.equal(h['x-requested-with'], 'XMLHttpRequest');
  assert.match(pedidos[0].url, /^https:\/\/www\.instagram\.com\/api\/v1\/users\/web_profile_info\/\?username=ref$/);
});

test('429 e feedback_required viram erro do tipo "limite"', async () => {
  const { api } = apiCom([{ status: 429, texto: '' }, { status: 400, texto: '{"message":"feedback_required"}' }]);
  await assert.rejects(api.seguir('1'), (e) => e instanceof ErroInstagram && e.tipo === 'limite');
  await assert.rejects(api.deixarDeSeguir('1'), (e) => e.tipo === 'limite');
});

test('HTML no lugar de JSON avisa mudança de API com o nome do endpoint', async () => {
  const { api } = apiCom([{ status: 200, texto: '<!DOCTYPE html><html>' }]);
  await assert.rejects(api.paginaSeguidores('1'), (e) => e.tipo === 'mudanca_api' && /friendships\/followers/.test(e.message));
});

test('seguir envia POST form-urlencoded e entende pedido pendente (privado)', async () => {
  const { api, pedidos } = apiCom([{ status: 200, texto: '{"friendship_status":{"following":false,"outgoing_request":true},"status":"ok"}' }]);
  const st = await api.seguir('77');
  assert.equal(st.pedidoPendente, true);
  assert.equal(pedidos[0].metodo, 'POST');
  assert.match(pedidos[0].url, /friendships\/create\/77\/$/);
  assert.match(pedidos[0].corpo, /user_id=77/);
  assert.equal(pedidos[0].cabecalhos['content-type'], 'application/x-www-form-urlencoded');
});

test('DM: texto exato no corpo; alternativa por thread só quando recusado (400/404)', async () => {
  const texto = 'Olá! 🙌🏼\n\nLinha 2 😊';
  const { api, pedidos } = apiCom([{ status: 200, texto: '{"status":"ok"}' }]);
  assert.deepEqual(await api.enviarDm('5', texto), { modo: 'recipient_users' });
  const corpo = new URLSearchParams(pedidos[0].corpo);
  assert.equal(corpo.get('text'), texto);
  assert.equal(corpo.get('recipient_users'), '[["5"]]');

  const b = apiCom([
    { status: 404, texto: '{"message":"not found"}' },
    { status: 200, texto: '{"thread":{"thread_id":"T1"},"status":"ok"}' },
    { status: 200, texto: '{"status":"ok"}' },
  ]);
  assert.deepEqual(await b.api.enviarDm('5', texto), { modo: 'thread_ids' });
  assert.equal(new URLSearchParams(b.pedidos[2].corpo).get('thread_ids'), '["T1"]');

  // Erro 500 / resposta incerta: NÃO tenta de novo (evita DM duplicada)
  const c = apiCom([{ status: 500, texto: '' }]);
  await assert.rejects(c.api.enviarDm('5', texto), (e) => e.status === 500);
  assert.equal(c.pedidos.length, 1);
  const d = apiCom([{ status: 200, texto: '{"status":"weird"}' }]);
  await assert.rejects(d.api.enviarDm('5', texto), (e) => e.tipo === 'incerto');
  assert.equal(d.pedidos.length, 1);
});

test('nome de usuário inválido é recusado sem chamar o Instagram', async () => {
  const { api, pedidos } = apiCom([]);
  await assert.rejects(api.buscarPerfil('nome com espaço'));
  assert.equal(pedidos.length, 0);
});

test('perfil: se web_profile_info falhar, usa a pesquisa; depois a página do perfil', async () => {
  const falha = { status: 400, texto: '{"message":"Please wait a few minutes before you try again.","require_login":true,"status":"fail"}' };
  const a = apiCom([falha, { status: 200, texto: '{"users":[{"user":{"pk":"9","username":"outra"}},{"user":{"pk":"42","username":"giovana_fernanda_mendes","is_private":false}}],"status":"ok"}' }]);
  const p = await a.api.buscarPerfil('https://www.instagram.com/Giovana_Fernanda_Mendes/?hl=pt');
  assert.equal(p.id, '42');
  assert.equal(p.via, 'topsearch');
  assert.match(a.pedidos[1].url, /web\/search\/topsearch\/\?context=blended&query=giovana_fernanda_mendes/);

  const b = apiCom([falha, { status: 200, texto: '{"users":[],"status":"ok"}' }, { status: 200, texto: '<html>..."profilePage_777"...</html>' }]);
  const p2 = await b.api.buscarPerfil('fulano.x');
  assert.equal(p2.id, '777');
  assert.equal(p2.via, 'pagina');
  assert.deepEqual(b.pedidos[2].cabecalhos, {}, 'página HTML vai sem cabeçalhos de API');
});

test('perfil: se tudo falhar, o erro diz o tipo certo e mostra trecho da resposta', async () => {
  const falha = { status: 400, texto: '{"message":"Please wait a few minutes before you try again.","require_login":true,"status":"fail"}' };
  const { api } = apiCom([falha, falha, { status: 302, texto: '' }]);
  await assert.rejects(api.buscarPerfil('fulano'), (e) => {
    assert.equal(e.tipo, 'sessao');
    assert.match(e.message, /3 tentativas/);
    assert.match(e.message, /Resposta: \{"message":"Please wait a few minutes/);
    return true;
  });
});

test('extrairIdDoHtml', () => {
  assert.equal(extrairIdDoHtml('{"profilePage_123"}', 'a'), '123');
  assert.equal(extrairIdDoHtml('{"id":"55","username":"jo.ao"}', 'jo.ao'), '55');
  assert.equal(extrairIdDoHtml('{"id":"55","username":"joXao"}', 'jo.ao'), null);
  assert.equal(extrairIdDoHtml('nada', 'a'), null);
});
