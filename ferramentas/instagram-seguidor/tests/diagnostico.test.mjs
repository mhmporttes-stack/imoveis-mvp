// 1.1.12 — teste real do dono com a 1.1.11: "SEGUIR suspenso … botão 'Seguir' não apareceu no perfil" (o botão estava
// lá) e a DM não saiu. "Estamos nesse vai e vem há muitos dias; encontre uma maneira de fazer e ir testando até dar certo."
// → diagnóstico remoto (rastro + esqueleto anonimizado) no CRM, testes a seco, localizador do Seguir robusto, botão
// "Enviar a próxima boas-vindas agora". Tudo com página/Instagram/CRM FALSOS: nenhuma DM, follow ou envio real.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { anonimizar, montarDiagnostico, enviarDiagnosticoCrm, normalizarUrlCrm, CRM_URL_PADRAO } from '../lib/diagnostico.js';
import { esqueletoNaPagina, seguirNaPagina, lerEstadoNaPagina, TEXTOS_ESQUELETO, TEXTOS_LEITURA } from '../instagram-api.js';
import { MENSAGEM_PADRAO, proximaBoasVindasPendente } from '../lib/regras.js';
import { el, instalarDom, desinstalarDom } from './ajuda/dom-falso.mjs';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';
import { DIA, HORA, MINUTO } from '../lib/tempo.js';

// ------------------------------------------------------------- lib/diagnostico.js

test('anonimizar: o @ da pessoa some de textos, chaves e listas; textos longos são cortados', () => {
  const r = anonimizar({ msg: 'botão em @Fulano.Silva e fulano.silva', lista: ['https://www.instagram.com/fulano.silva/'], 'fulano.silva': 1, longo: 'x'.repeat(900) }, ['fulano.silva']);
  assert.equal(r.msg, 'botão em @perfil e perfil');
  assert.deepEqual(r.lista, ['https://www.instagram.com/perfil/']);
  assert.ok('perfil' in r && !('fulano.silva' in r));
  assert.ok(r.longo.length <= 401);
  assert.doesNotMatch(JSON.stringify(r), /fulano/i);
});

test('montarDiagnostico e envio ao CRM: rota, chave Bearer, corpo { kind, payload }; 401 = chave recusada', async () => {
  const pedidos = [];
  const fetchFalso = async (url, op) => { pedidos.push({ url, op }); return { ok: true, json: async () => ({ ok: true, id: 'abc' }) }; };
  const payload = montarDiagnostico({ versao: '1.1.12', acao: 'seguir', resultado: 'falhou em @ana_b', rastro: [{ passo: 'x', erro: '@ana_b' }], usuarios: ['ana_b'], em: 0 });
  assert.doesNotMatch(JSON.stringify(payload), /ana_b/);
  const r = await enviarDiagnosticoCrm({ url: 'www.matheusmachadoimoveis.com.br/', chave: 'mkp_123456789', versao: '1.1.12' }, 'ig_follow', payload, fetchFalso);
  assert.deepEqual(r, { ok: true, id: 'abc' });
  assert.equal(pedidos[0].url, 'https://www.matheusmachadoimoveis.com.br/api/marketplace/diagnostic');
  assert.equal(pedidos[0].op.headers.Authorization, 'Bearer mkp_123456789');
  assert.deepEqual(JSON.parse(pedidos[0].op.body).kind, 'ig_follow');
  await assert.rejects(enviarDiagnosticoCrm({ chave: 'mkp_x' }, 'ig_dm', {}, async () => ({ ok: false, status: 401, json: async () => ({ error: 'Não autorizado.' }) })), /chave do CRM recusada/);
  await assert.rejects(enviarDiagnosticoCrm({ chave: '' }, 'ig_dm', {}, fetchFalso), /sem chave/);
  await assert.rejects(enviarDiagnosticoCrm({ chave: 'mkp_x' }, 'outro', {}, fetchFalso), /desconhecido/);
  assert.equal(normalizarUrlCrm(''), CRM_URL_PADRAO);
  assert.throws(() => normalizarUrlCrm('http://exemplo.com'), /https/);
});

test('CRM aceita os tipos ig_* na rota de diagnóstico (lib/marketplace-chat.js)', async () => {
  const { readFileSync } = await import('node:fs');
  const lib = readFileSync(new URL('../../../lib/marketplace-chat.js', import.meta.url), 'utf8');
  for (const k of ['ig_follow', 'ig_dm', 'ig_dryrun', 'ig_ping']) assert.match(lib, new RegExp(`DIAGNOSTIC_KINDS = new Set\\([^)]*"${k}"`));
});

// ------------------------------------------------------------- esqueleto (na página)

test('esqueleto: botões da interface com texto; resto vira «N caracteres»; @ vira "perfil"; caixa da DM só com o tamanho', async () => {
  const caixa = el('div', { texto: 'Que bom ter você por aqui', attrs: { contenteditable: 'true', role: 'textbox', 'aria-label': 'Mensagem', 'aria-placeholder': 'Mensagem...', 'data-lexical-editor': 'true' } });
  const body = el('body', {
    filhos: [
      el('main', {
        filhos: [
          el('h2', { texto: 'fulano_x' }),
          el('div', { attrs: { role: 'button', 'aria-label': 'Foto do perfil de fulano_x' }, texto: 'Viagens 2024' }),
          el('div', { attrs: { role: 'button' }, filhos: [el('div', { filhos: [el('span', { texto: 'Seguir' })] })] }),
          el('div', { attrs: { role: 'button' }, texto: 'Enviar mensagem' }),
          caixa,
          el('div', { attrs: { role: 'button' }, filhos: [el('svg', { attrs: { 'aria-label': 'Enviar' } })] }),
          el('div', { attrs: { role: 'alert' }, texto: 'Ocorreu um erro. Tente novamente.' }),
        ],
      }),
    ],
  });
  instalarDom(body);
  globalThis.location.pathname = '/fulano_x/';
  try {
    const sk = await esqueletoNaPagina('fulano_x', TEXTOS_ESQUELETO);
    const json = JSON.stringify(sk);
    assert.doesNotMatch(json, /fulano/i, 'nenhum @');
    assert.doesNotMatch(json, /Viagens|Que bom/i, 'nenhum texto da pessoa');
    assert.equal(sk.url, '/:perfil/');
    assert.ok(sk.botoesNoTopo.some((b) => b.texto === '«12 caracteres»' && b.aria === 'foto do perfil de perfil'));
    assert.ok(sk.candidatosSeguir.some((c) => c.tag === 'span' && c.texto === 'seguir' && c.clicavel && c.clicavel.role === 'button'));
    assert.deepEqual(sk.caixas.map((c) => [c.tamanhoTexto, c.lexical, c.placeholder, c.texto]), [[25, true, 'mensagem...', undefined]]);
    assert.ok(sk.candidatosEnviar.some((c) => c.tag === 'svg' && c.aria === 'enviar'));
    assert.deepEqual(sk.errosVisiveis, ['ocorreu um erro', 'tente novamente']);
    assert.ok(sk.avisos.some((a) => a.role === 'alert' && /ocorreu um erro/.test(a.texto)));
  } finally { desinstalarDom(); }
});

// ------------------------------------------------------------- localizador do Seguir (o caso do dono)

function paginaPerfil({ comHeaderDoSite = true, botaoPerfil = 'Seguir', semVoce = false } = {}) {
  // Layout novo: <header> do site no topo SEM os botões do perfil; o botão do perfil é um div[role=button] com o texto
  // num span aninhado (e um invólucro sem role); sugestões "Seguir" mais abaixo; um "Seguir" num diálogo.
  const botao = el('div', { attrs: { role: 'button', tabindex: '0' }, rect: { top: 150 }, filhos: [el('div', { filhos: [el('span', { texto: botaoPerfil })] })] });
  const invólucro = el('div', { rect: { top: 150 }, filhos: [botao] });
  const blocoPerfil = el('section', { filhos: [el('div', { filhos: [el('div', { filhos: [invólucro, el('div', { attrs: { role: 'button' }, texto: 'Enviar mensagem', rect: { top: 150 } }), ...(semVoce ? [el('span', { texto: 'Segue você' })] : [])] })] })] });
  const sugestao = el('button', { texto: 'Seguir', rect: { top: 600 } });
  const sugestoes = el('div', { filhos: [el('span', { texto: 'Sugestões para você' }), sugestao] });
  const noDialogo = el('div', { attrs: { role: 'dialog' }, filhos: [el('button', { texto: 'Seguir', rect: { top: 10 } })] });
  const main = el('main', { filhos: [blocoPerfil, sugestoes] });
  const body = el('body', { filhos: [...(comHeaderDoSite ? [el('header', { rect: { top: 0 }, filhos: [el('a', { texto: 'Instagram' })] })] : []), noDialogo, main] });
  return { body, botao, sugestao, noDialogo };
}

test('Seguir: acha o botão do perfil com o texto em span aninhado, sem depender do <header>; nunca a sugestão nem o diálogo', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const comHeaderDoSite of [true, false]) {
      const p = paginaPerfil({ comHeaderDoSite });
      const d = instalarDom(p.body);
      d.noPonto = p.botao;
      const so = await seguirNaPagina(TEXTOS_LEITURA, false);
      assert.equal(so.ok, true, JSON.stringify(so));
      assert.deepEqual([so.x, so.y, so.livre, so.clicou], [120, 160, true, false]);
      assert.equal(p.botao.cliques, 0, 'sem clicar não clica');
      const r = await (async () => { const pr = seguirNaPagina(TEXTOS_LEITURA, true); mock.timers.tick(2000); return pr; })();
      assert.equal(r.clicou, true);
      assert.equal(p.botao.cliques, 1, 'clicou no botão do perfil');
      assert.equal(p.sugestao.cliques, 0);
      assert.equal(p.noDialogo.filhos[0].cliques, 0);
      const st = await lerEstadoNaPagina(TEXTOS_LEITURA);
      assert.equal(st.botao, 'seguir');
      desinstalarDom();
    }
  } finally { desinstalarDom(); mock.timers.reset(); }
});

test('Seguir: "Seguindo", "Seguir de volta" e "Segue você" no perfil → não clica (mesmo com sugestões "Seguir" abaixo)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const [botaoPerfil, semVoce, esperado] of [['Seguindo', false, 'seguindo'], ['Seguir de volta', false, 'seguir_de_volta'], ['Seguir', true, 'seguir']]) {
      const p = paginaPerfil({ botaoPerfil, semVoce });
      instalarDom(p.body);
      const r = await seguirNaPagina(TEXTOS_LEITURA, true);
      assert.equal(r.recusado, true, botaoPerfil);
      assert.equal(r.botao, esperado);
      assert.equal(p.botao.cliques + p.sugestao.cliques, 0);
      desinstalarDom();
    }
  } finally { desinstalarDom(); mock.timers.reset(); }
});

// ------------------------------------------------------------- simulação: diagnóstico, testes a seco, "enviar agora"

const INICIO = Date.parse('2026-10-20T07:30:00Z'); // 04:30 SP

async function extensaoComCrm(configurar = () => {}) {
  const ig = criarInstagramFalso({ totalSeguidores: 20, voltaSe: () => false });
  ig.novosSeguidoresDeFora(10, 1);
  configurar(ig);
  const cf = criarChromeFalso(ig);
  const enviados = [];
  globalThis.fetch = async (url, op) => { enviados.push({ url, ...JSON.parse(op.body), auth: op.headers.Authorization }); return { ok: true, json: async () => ({ ok: true, id: String(enviados.length) }) }; };
  cf.dados.crm = { url: 'https://www.matheusmachadoimoveis.com.br', chave: 'mkp_teste_123456' };
  const ext = await iniciarExtensao(cf, INICIO);
  await ext.avancarAte(INICIO + HORA); // linha de base gravada, dentro da janela
  return { ig, cf, ext, enviados };
}

async function ateTerPendente(ext) {
  for (let i = 0; i < 60; i += 1) {
    if (proximaBoasVindasPendente(ext.estado())) return;
    await ext.avancarAte(Date.now() + 10 * 1000);
  }
  throw new Error('nenhuma pendente apareceu');
}

test('"Enviar a próxima boas-vindas agora": sai na hora (antes do horário agendado), uma vez; diagnóstico ig_dm sem @ nem mensagem', { timeout: 240_000 }, async () => {
  const { ig, ext, enviados } = await extensaoComCrm((x) => { x.dmHtml = true; });
  ig.novosSeguidoresDeFora(1, Date.now());
  await ateTerPendente(ext);
  const pend = proximaBoasVindasPendente(ext.estado());
  assert.ok(pend.dmAgendadaPara > Date.now(), 'ainda não era a hora agendada');
  const r = await ext.mensagem({ tipo: 'enviarProximaDm' });
  assert.equal(r.situacao, 'enviada', JSON.stringify(r));
  assert.match(r.texto, /ENVIADA/);
  assert.equal(ig.dms.length, 1);
  assert.equal(ig.dms[0].texto, MENSAGEM_PADRAO);
  const r2 = await ext.mensagem({ tipo: 'enviarProximaDm' });
  assert.equal(r2.ok, false);
  assert.match(r2.erro, /Espere|Nenhuma boas-vindas pendente/);
  await ext.avancarAte(Date.now() + 2 * HORA);
  assert.equal(ig.dms.length, 1, 'nunca uma 2ª DM para a mesma pessoa');
  await ext.ocioso();
  const dm = enviados.filter((x) => x.kind === 'ig_dm');
  assert.ok(dm.length >= 1);
  assert.equal(dm[0].auth, 'Bearer mkp_teste_123456');
  assert.match(dm[0].payload.resultado, /enviada/);
  assert.ok(dm[0].payload.rastro.some((p) => p.passo === 'abrir conversa'), 'rastro da tela');
  assert.ok(dm[0].payload.esqueleto, 'esqueleto da conversa');
  const json = JSON.stringify(dm[0].payload);
  assert.doesNotMatch(json, new RegExp(ig.dms[0].id), 'sem o id da pessoa');
  assert.doesNotMatch(json, /Que bom ter você/, 'sem o texto da mensagem');
  mock.timers.reset();
});

test('"Enviar agora" fora da janela ou sem pendente: não envia e explica', { timeout: 240_000 }, async () => {
  const { ig, ext } = await extensaoComCrm();
  const r = await ext.mensagem({ tipo: 'enviarProximaDm' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /Nenhuma boas-vindas pendente/);
  ig.novosSeguidoresDeFora(1, Date.now());
  await ateTerPendente(ext);
  await ext.mensagem({ tipo: 'pausar' }); // a pendente fica parada (o ciclo não a envia)
  const r2 = await ext.mensagem({ tipo: 'enviarProximaDm' });
  assert.match(r2.erro, /pausada/);
  await ext.avancarAte(Date.parse('2026-10-21T01:30:00Z')); // 22:30 SP — fora da janela
  assert.ok(proximaBoasVindasPendente(ext.estado()), 'continua pendente');
  const r3 = await ext.mensagem({ tipo: 'enviarProximaDm' });
  assert.match(r3.erro, /Fora da janela/);
  assert.equal(ig.dms.length, 0);
  mock.timers.reset();
});

test('teste a seco da DM: abre, cola, confere, acha o Enviar e PARA — nada enviado, caixa apagada, ig_dryrun no CRM', { timeout: 240_000 }, async () => {
  const { ig, ext, enviados } = await extensaoComCrm();
  const r = await ext.mensagem({ tipo: 'testarDm', username: '@pessoa3' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.texto, /nada enviado/);
  assert.match(r.texto, /inteira na caixa \(colada\)/);
  assert.match(r.texto, /botão Enviar encontrado \(não clicado\)/);
  assert.match(r.texto, /caixa apagada/);
  assert.equal(ig.dms.length, 0, 'nenhuma DM');
  assert.equal(ig.tela.caixa, '', 'caixa vazia');
  assert.ok(!ig.cliquesEnviar, 'nunca clicou em Enviar');
  assert.ok(!ig.chamadas.some((c) => c.caminho === 'apertarEnterNaPagina'), 'nenhum Enter');
  await ext.ocioso();
  const d = enviados.find((x) => x.kind === 'ig_dryrun');
  assert.ok(d && d.payload.rastro.some((p) => p.passo === 'localizar botão Enviar (sem clicar)'));
  assert.doesNotMatch(JSON.stringify(d.payload), /pessoa3/);
  mock.timers.reset();
});

test('teste a seco do Seguir: só lê o botão (nunca segue); diagnóstico ig_dryrun', { timeout: 240_000 }, async () => {
  const { ig, ext, enviados } = await extensaoComCrm();
  const r = await ext.mensagem({ tipo: 'testarSeguir', username: 'pessoa5' });
  assert.match(r.texto, /botão "Seguir" encontrado — a extensão clicaria nele/);
  assert.equal(ig.sigo.size + ig.pendentes.size, 0, 'ninguém seguido');
  assert.ok(!ig.chamadas.some((c) => c.caminho === 'clicou-seguir:pessoa5'));
  await ext.ocioso();
  assert.ok(enviados.some((x) => x.kind === 'ig_dryrun' && /Seguir/.test(x.payload.resultado)));
  mock.timers.reset();
});

test('cada tentativa de seguir manda ig_follow com rastro da tela, sem @', { timeout: 240_000 }, async () => {
  const { ig, ext, enviados } = await extensaoComCrm((x) => { x.createHtml = true; });
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(INICIO + 6 * HORA);
  await ext.ocioso();
  const f = enviados.filter((x) => x.kind === 'ig_follow');
  assert.ok(f.length >= 2, `diagnósticos de seguir: ${f.length}`);
  assert.ok(f.some((x) => /seguido — confirmado/.test(x.payload.resultado) && x.payload.rastro.some((p) => p.passo === 'localizar botão Seguir')));
  assert.doesNotMatch(JSON.stringify(f), /pessoa\d/, 'sem @');
  assert.ok(ig.sigo.size >= 2);
  mock.timers.reset();
});

test('salvarCrm: chave precisa começar com mkp_; campo vazio mantém a chave salva', { timeout: 60_000 }, async () => {
  const { cf, ext } = await extensaoComCrm();
  const ruim = await ext.mensagem({ tipo: 'salvarCrm', url: '', chave: 'abc' });
  assert.equal(ruim.ok, false);
  const ok = await ext.mensagem({ tipo: 'salvarCrm', url: 'www.matheusmachadoimoveis.com.br', chave: '' });
  assert.equal(ok.temChave, true);
  assert.equal(cf.dados.crm.chave, 'mkp_teste_123456');
  const t = await ext.mensagem({ tipo: 'testarCrm' });
  assert.equal(t.ok, true);
  mock.timers.reset();
});

void DIA; void MINUTO;
