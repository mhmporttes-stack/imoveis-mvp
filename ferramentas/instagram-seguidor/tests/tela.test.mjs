// 1.2.0 (EXT-1, dono, 2026-10-29): "a extensão só faz o que eu faria clicando". Nada de API interna do Instagram,
// cabeçalhos copiados da página, endpoints GraphQL/legados nem cookies: só leitura e cliques na tela. Quando a tela não
// permite, para e avisa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { criarTelaInstagram, ErroInstagram, amizadeDoBotao, usuarioDaLista, limparUsuario, TEXTOS } from '../instagram-tela.js';

const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

test('nenhum vestígio da API interna: sem fetch ao Instagram, cabeçalhos copiados, GraphQL, endpoints legados ou cookies', () => {
  const codigo = ['../background.js', '../instagram-tela.js', '../options.js', '../popup.js', '../painel-comum.js']
    .concat(readdirSync(new URL('../lib/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `../lib/${f}`))
    .map((f) => [f, ler(f)]);
  for (const [arquivo, texto] of codigo) {
    assert.doesNotMatch(texto, /x-ig-app-id|x-csrftoken|x-ig-www-claim|x-asbd-id|x-instagram-ajax/i, `${arquivo}: cabeçalho copiado`);
    assert.doesNotMatch(texto, /\/api\/v1\/|\/graphql\/|query_hash|\/web\/friendships\//, `${arquivo}: endpoint interno`);
    assert.doesNotMatch(texto, /chrome\.cookies|document\.cookie|sessionStorage/, `${arquivo}: cookies/sessão lidos`);
  }
  // O único fetch é o do CRM (lib/crm-link.js).
  for (const [arquivo, texto] of codigo) {
    if (arquivo.endsWith('crm-link.js')) continue;
    assert.doesNotMatch(texto, /\bfetch\(/, `${arquivo}: fetch fora do crm-link`);
  }
  const manifest = JSON.parse(ler('../manifest.json'));
  assert.ok(!manifest.permissions.includes('cookies'), 'permissão cookies removida');
  assert.deepEqual(manifest.host_permissions, ['https://www.instagram.com/*', 'https://www.matheusmachadoimoveis.com.br/*']);
});

test('limparUsuario e leitura da lista (pk = @; relação pelo botão da linha)', () => {
  assert.equal(limparUsuario('@Fulano.Silva'), 'fulano.silva');
  assert.equal(limparUsuario('https://www.instagram.com/fulano/?hl=pt'), 'fulano');
  assert.equal(limparUsuario('nome inválido!'), null);
  assert.deepEqual(usuarioDaLista({ username: 'Ana', foto: 'x.jpg', relacao: 'seguir_de_volta' }), { pk: 'ana', username: 'ana', profile_pic_url: 'x.jpg', friendship_status: { following: false, followed_by: true } });
  assert.equal(usuarioDaLista({ username: 'não é @' }), null);
  assert.deepEqual(amizadeDoBotao({ ok: true, botao: 'seguindo' }).meSegue, undefined, '"Seguindo" não diz se a pessoa me segue');
  assert.equal(amizadeDoBotao({ ok: true, botao: 'seguir_de_volta' }).meSegue, true);
  assert.ok(TEXTOS.bloqueio.length && TEXTOS.aguarde.length);
});

function telaCom(respostas, extra = {}) {
  const pedidos = [];
  const api = criarTelaInstagram({ executar: async (req) => { pedidos.push(req); return respostas.shift(); }, ...extra });
  return { api, pedidos };
}

test('aviso do Instagram na tela vira o tipo certo (limite / aguarde / sessão) — quem chama decide a pausa', async () => {
  for (const [bloqueio, tipo] of [['limite', 'limite'], ['aguarde', 'aguarde'], ['sessao', 'sessao']]) {
    const { api } = telaCom([{ ok: false, bloqueio, aviso: 'x' }]);
    await assert.rejects(api.seguir('fulano'), (e) => e instanceof ErroInstagram && e.tipo === tipo);
  }
});

test('perfil: página "não disponível" = não encontrado; botão não reconhecido = indisponível (com a parte da tela)', async () => {
  const a = telaCom([{ ok: false, naoExiste: true }]);
  await assert.rejects(a.api.buscarPerfil('@sumiu'), (e) => e.tipo === 'nao_encontrado');
  const b = telaCom([{ ok: false, erro: 'botão Seguir/Seguindo não apareceu' }]);
  await assert.rejects(b.api.amizade('fulano'), (e) => e.tipo === 'indisponivel' && e.seletor === 'perfil: botão Seguir/Seguindo');
  const c = telaCom([]);
  await assert.rejects(c.api.buscarPerfil('nome inválido!'), (e) => e.tipo === 'outro');
  assert.equal(c.pedidos.length, 0, 'nem abre a página');
});

test('amizade: "Seguindo" + pesquisa do @ na minha lista diz se a pessoa me segue; pesquisa sem resposta = indefinido', async () => {
  const procuras = [];
  const sim = telaCom([{ ok: true, botao: 'seguindo' }], { procurar: async (x) => { procuras.push(x); return { ok: true, encontrado: true }; } });
  const st = await sim.api.amizade('fulano', { meuUsuario: 'eu' });
  assert.equal(st.meSegue, true);
  assert.deepEqual(procuras, [{ meuUsuario: 'eu', username: 'fulano' }]);
  const nao = telaCom([{ ok: true, botao: 'seguindo' }], { procurar: async () => ({ ok: true, encontrado: false }) });
  assert.equal((await nao.api.amizade('fulano', { meuUsuario: 'eu' })).meSegue, false);
  const talvez = telaCom([{ ok: true, botao: 'seguindo' }], { procurar: async () => ({ ok: false, erro: 'a pesquisa não mostrou resultado' }) });
  assert.equal((await talvez.api.amizade('fulano', { meuUsuario: 'eu' })).meSegue, undefined);
  // "Seguir de volta" já diz: nem pesquisa
  const direto = telaCom([{ ok: true, botao: 'seguir_de_volta' }], { procurar: async () => assert.fail('não precisava pesquisar') });
  assert.equal((await direto.api.amizade('fulano', { meuUsuario: 'eu' })).meSegue, true);
});

test('lista de seguidores: abre /@/followers/ e lê até N; janela não abre = indisponível (sem insistir)', async () => {
  const { api, pedidos } = telaCom([{ ok: true, usuarios: [{ username: 'a', foto: '', relacao: 'seguir' }, { username: 'b', foto: '', relacao: 'seguindo' }], fim: true }]);
  const r = await api.listaSeguidores('perfilref', { quantos: 50 });
  assert.equal(pedidos[0].caminho, '/perfilref/followers/');
  assert.equal(pedidos[0].func.name, 'lerListaNaPagina');
  assert.equal(pedidos[0].args[0].quantos, 50);
  assert.deepEqual(r.usuarios.map((u) => [u.pk, u.friendship_status.following]), [['a', false], ['b', true]]);
  assert.equal(r.fim, true);
  const falha = telaCom([{ ok: false, erro: 'a janela "Seguidores" não abriu' }]);
  await assert.rejects(falha.api.listaSeguidores('perfilref'), (e) => e.tipo === 'indisponivel' && e.seletor === 'lista: janela Seguidores');
  assert.equal(falha.pedidos.length, 1);
});

test('sessão vista na tela (sem navegar e sem acordar a página): logado e meu @', async () => {
  const { api, pedidos } = telaCom([{ ok: true, logado: true, meuUsuario: 'Matheus.Machado' }]);
  assert.deepEqual(await api.lerSessao(), { logado: true, meuUsuario: 'matheus.machado' });
  assert.equal(pedidos[0].caminho, null);
  assert.equal(pedidos[0].acordar, false);
});
