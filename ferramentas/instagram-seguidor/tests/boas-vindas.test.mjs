// 1.1.7 — dono, 26/10: "não foi enviada nenhuma" DM de boas-vindas (follow-back não visto além da 1ª página).
// 1.2.0 — só pela tela: a conferência lê a janela "Seguidores" do MEU perfil (12 mais recentes; 48 na conferência
// completa de 30 min) e, para quem a extensão seguiu e não apareceu, abre o perfil e pesquisa o @ na minha lista
// (como o dono faria). O popup mostra a situação.
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { HORA, MINUTO } from '../lib/tempo.js';
import { STATUS } from '../lib/regras.js';
import { resumoBoasVindas, estadoInicial } from '../lib/estado.js';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';

afterEach(() => mock.timers.reset());

const INICIO = Date.parse('2026-10-20T07:30:00Z'); // 04:30 SP

/** Segue o dia até ~19:00 SP sem ninguém seguir de volta e devolve o simulador pronto. */
async function preparar({ configurar = () => {} } = {}) {
  const ig = criarInstagramFalso({ totalSeguidores: 60, voltaSe: () => false });
  configurar(ig);
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, INICIO);
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, true, r.erro);
  await ext.avancarAte(INICIO + 14 * HORA + 30 * MINUTO); // 19:00 SP
  const seguidos = Object.values(ext.estado().seguidos).filter((x) => x.status === STATUS.SEGUINDO);
  assert.ok(seguidos.length >= 5, `seguiu ${seguidos.length}`);
  return { ig, cf, ext, alvo: seguidos[0] };
}

/** O alvo segue de volta e, logo depois, `outros` perfis de fora também me seguem (ele sai do topo da lista). */
async function seguirDeVoltaEnterrado(ctx, outros) {
  await ctx.ext.mensagem({ tipo: 'pausar' }); // nada é conferido enquanto isso (como à noite ou com o PC desligado)
  ctx.ig.meSeguem.set(ctx.alvo.username, Date.now());
  ctx.ig.novosSeguidoresDeFora(outros, Date.now() + 1000);
  mock.timers.tick(10 * MINUTO);
  await ctx.ext.mensagem({ tipo: 'retomar' });
}

test('caso do dono: follow-back abaixo dos 12 mais recentes é detectado pela conferência completa e a DM sai uma vez', { timeout: 240_000 }, async () => {
  const ctx = await preparar();
  await seguirDeVoltaEnterrado(ctx, 15);
  await ctx.ext.avancarAte(Date.now() + HORA);
  const e = ctx.ext.estado();
  const reg = e.seguidos[ctx.alvo.username];
  assert.ok(reg.followBackEm, 'follow-back detectado pela conferência completa');
  assert.equal(ctx.ig.dms.filter((d) => d.username === ctx.alvo.username).length, 1, 'DM de boas-vindas enviada uma única vez');
  assert.ok(e.boasVindas.ultimaChecagemEm, 'última checagem registrada');
  assert.equal(e.boasVindas.via, 'tela');
  assert.ok(ctx.ig.de('lista-minha').length > 0, 'leu a janela "Seguidores" do meu perfil');
});

test('muitos seguidores novos de uma vez (sem nenhum conhecido) → nenhuma DM em lote; o alvo é achado pela pesquisa na minha lista', { timeout: 240_000 }, async () => {
  const ctx = await preparar();
  // 1.1.8: mais gente nova do que a leitura alcança (96): sem nenhum já conhecido, ninguém recebe DM em lote.
  await seguirDeVoltaEnterrado(ctx, 120);
  await ctx.ext.avancarAte(Date.now() + 4 * HORA);
  const e = ctx.ext.estado();
  assert.ok(e.seguidos[ctx.alvo.username].followBackEm, 'detectado pelo perfil + pesquisa na minha lista');
  assert.equal(ctx.ig.dms.length, 1);
  assert.ok(e.historico.some((h) => /nenhuma DM \(nunca DM em lote\)/.test(h.resultado)), 'anomalia registrada');
  assert.ok(ctx.ig.de('pesquisa').length > 0);
});

test('a janela "Seguidores" do meu perfil não abre → erro visível no resumo, sem pausa', { timeout: 240_000 }, async () => {
  const ctx = await preparar({ configurar: (ig) => { ig.minhaListaNaoAbre = true; } });
  ctx.ig.meSeguem.set(ctx.alvo.username, Date.now());
  await ctx.ext.avancarAte(Date.now() + 20 * MINUTO);
  const e = ctx.ext.estado();
  assert.equal(e.pausaAte, null);
  assert.equal(e.semSessao, false);
  assert.ok(e.boasVindas.ultimoErro && /seguidores/.test(e.boasVindas.ultimoErro.texto), JSON.stringify(e.boasVindas));
  assert.match(resumoBoasVindas(e).texto, /último erro/);
});

test('deixar de seguir: o botão "Seguindo" não diz se a pessoa me segue → pesquisa na minha lista; sem resposta = adia', { timeout: 240_000 }, async () => {
  const ctx = await preparar({ configurar: (ig) => { ig.pesquisaFalha = true; } });
  await ctx.ext.avancarAte(INICIO + 4 * 24 * HORA);
  const e = ctx.ext.estado();
  assert.equal(ctx.ig.de('clique-deixar').length, 0, 'sem confirmar, nunca deixa de seguir');
  assert.ok(e.historico.some((h) => h.acao === 'deixar de seguir' && /adiado: não deu para confirmar/.test(h.resultado)));
});

test('botão "Conferir seguidores agora": confere na hora e devolve o resumo', { timeout: 240_000 }, async () => {
  const ctx = await preparar();
  ctx.ig.meSeguem.set(ctx.alvo.username, Date.now());
  const r = await ctx.ext.mensagem({ tipo: 'conferirSeguidores' });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.novos, 1);
  assert.match(r.texto, /1 novo follow-back/);
  const e = ctx.ext.estado();
  assert.ok(e.seguidos[ctx.alvo.username].dmAgendadaPara, 'DM agendada (sai 1–3 min depois)');
  assert.ok(Date.now() - e.boasVindas.ultimaChecagemEm < 5 * MINUTO, 'checagem registrada agora');
  await ctx.ext.avancarAte(Date.now() + 10 * MINUTO);
  assert.equal(ctx.ig.dms.length, 1);
});

test('"Conferir seguidores agora" fora da janela não faz nada e explica', { timeout: 240_000 }, async () => {
  const ctx = await preparar();
  await ctx.ext.avancarAte(INICIO + 18 * HORA); // 23:00 SP
  const antes = ctx.ig.chamadas.length;
  const r = await ctx.ext.mensagem({ tipo: 'conferirSeguidores' });
  assert.equal(r.ok, true);
  assert.equal(r.feito, false);
  assert.match(r.texto, /fora da janela/i);
  assert.equal(ctx.ig.chamadas.length, antes, 'nada na tela do Instagram');
});

test('DM: a tela da conversa não abre → o erro aparece no resumo de boas-vindas e fica pendente (nova tentativa)', { timeout: 240_000 }, async () => {
  const ctx = await preparar({ configurar: (ig) => { ig.dmTela.abre = false; } });
  ctx.ig.meSeguem.set(ctx.alvo.username, Date.now());
  await ctx.ext.avancarAte(Date.now() + 20 * MINUTO);
  const e = ctx.ext.estado();
  assert.ok(e.boasVindas.ultimoErro && /DM/.test(e.boasVindas.ultimoErro.texto));
  const res = resumoBoasVindas(e);
  assert.equal(res.pendentes, 1, 'continua pendente (nova tentativa em 30 min)');
});

test('resumoBoasVindas: enviadas hoje, pendentes, sem envio, última checagem e último erro', () => {
  const agora = Date.parse('2026-10-26T15:00:00Z'); // 12:00 SP
  const e = estadoInicial();
  e.contadores = { dia: '2026-10-26', seguidos: 3, deixados: 0, followBacks: 3, dms: 2 };
  e.seguidos = {
    1: { id: '1', status: STATUS.SEGUIU_DE_VOLTA, followBackEm: agora, dmEnviadaEm: agora },
    2: { id: '2', status: STATUS.SEGUIU_DE_VOLTA, followBackEm: agora, dmAgendadaPara: agora + MINUTO },
    3: { id: '3', status: STATUS.SEGUIU_DE_VOLTA, followBackEm: agora, dmDesistiu: true },
    4: { id: '4', status: STATUS.SEGUINDO },
  };
  e.boasVindas = { ultimaChecagemEm: Date.parse('2026-10-26T14:58:00Z'), via: 'v1', ultimoErro: { em: agora, texto: 'DM não enviada: HTML' } };
  const r = resumoBoasVindas(e, agora);
  assert.equal(r.enviadasHoje, 2);
  assert.equal(r.pendentes, 1);
  assert.equal(r.semEnvio, 1);
  assert.match(r.texto, /^Boas-vindas: 2 enviadas hoje \(teto 30\/dia\), 1 pendente, última checagem de seguidores às 11:58, último erro \(12:00\): DM não enviada: HTML/);
  assert.match(r.texto, /1 não pôde ser enviada/);

  const vazio = resumoBoasVindas(estadoInicial(), agora);
  assert.match(vazio.texto, /linha de base dos seguidores ainda não lida/);
  assert.match(vazio.texto, /0 enviadas hoje \(teto 30\/dia\), 0 pendentes, última checagem de seguidores: ainda não, último erro: nenhum/);
  const desligada = estadoInicial();
  desligada.config.dmAtiva = false;
  assert.match(resumoBoasVindas(desligada, agora).texto, /DM desligada no painel/);
});
