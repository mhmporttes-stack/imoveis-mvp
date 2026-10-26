// 1.1.7 — dono, 26/10: "não foi enviada nenhuma" DM de boas-vindas.
// Causa: com o friendships/show e o show_many respondendo a página HTML (caso real 24/10), o follow-back só era
// visto pela 1ª página (12) dos MEUS seguidores, lida a cada 2 min. Quem seguiu de volta à noite (fora da janela),
// com o PC desligado ou antes de outras 12 pessoas novas, nunca era detectado: a "conferência completa" caía na
// leitura do botão do perfil, e o botão "Seguindo" não diz se a pessoa me segue. Sem follow-back, sem DM.
// Agora a conferência completa (30 min) lê várias páginas dos meus seguidores (v1 e, se a v1 não der dados, o
// GraphQL), e o plano B por perfil tenta o friendships/show antes do botão. E o popup mostra a situação.
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { HORA, MINUTO } from '../lib/tempo.js';
import { STATUS } from '../lib/regras.js';
import { resumoBoasVindas, estadoInicial } from '../lib/estado.js';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';

afterEach(() => mock.timers.reset());

const INICIO = Date.parse('2026-10-20T07:30:00Z'); // 04:30 SP

/** Segue o dia até ~19:00 SP sem ninguém seguir de volta, pausa e devolve o simulador pronto. */
async function preparar({ configurar = () => {} } = {}) {
  const ig = criarInstagramFalso({ totalSeguidores: 60, voltaSe: () => false });
  ig.showManyHtml = true; // caso real 24/10
  ig.showHtml = true;
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

/** O alvo segue de volta e, logo depois, `outros` perfis de fora também me seguem (ele sai da 1ª página). */
async function seguirDeVoltaEnterrado(ctx, outros) {
  await ctx.ext.mensagem({ tipo: 'pausar' }); // nada é conferido enquanto isso (como à noite ou com o PC desligado)
  ctx.ig.meSeguem.set(String(ctx.alvo.id), Date.now());
  ctx.ig.novosSeguidoresDeFora(outros, Date.now() + 1000);
  mock.timers.tick(10 * MINUTO);
  await ctx.ext.mensagem({ tipo: 'retomar' });
}

test('caso do dono: follow-back fora da 1ª página dos meus seguidores é detectado e a DM sai uma vez', { timeout: 240_000 }, async () => {
  const ctx = await preparar();
  await seguirDeVoltaEnterrado(ctx, 15);
  await ctx.ext.avancarAte(Date.now() + HORA);
  const e = ctx.ext.estado();
  const reg = e.seguidos[ctx.alvo.id];
  assert.ok(reg.followBackEm, 'follow-back detectado pela conferência completa');
  assert.equal(ctx.ig.dms.filter((d) => d.id === String(ctx.alvo.id)).length, 1, 'DM de boas-vindas enviada uma única vez');
  assert.ok(e.boasVindas.ultimaChecagemEm, 'última checagem registrada');
  // Nunca abre perfil por perfil para isso: é a lista dos meus seguidores (várias páginas).
  const paginasMinhas = ctx.ig.chamadas.filter((c) => c.caminho === `/api/v1/friendships/${ctx.ig.meuId}/followers/`);
  assert.ok(paginasMinhas.length > 0);
});

test('lista v1 dos meus seguidores em HTML → plano B GraphQL detecta o follow-back', { timeout: 240_000 }, async () => {
  const ctx = await preparar({ configurar: (ig) => { ig.meusSeguidoresHtml = true; } });
  ctx.ig.meSeguem.set(String(ctx.alvo.id), Date.now());
  await ctx.ext.avancarAte(Date.now() + 30 * MINUTO);
  const e = ctx.ext.estado();
  assert.ok(e.seguidos[ctx.alvo.id].followBackEm, 'detectado pelo GraphQL');
  assert.equal(ctx.ig.dms.length, 1);
  assert.equal(e.boasVindas.via, 'graphql');
});

test('lista dos meus seguidores fora do ar (v1 e GraphQL) → erro visível no resumo, sem pausa', { timeout: 240_000 }, async () => {
  const ctx = await preparar({ configurar: (ig) => { ig.meusSeguidoresHtml = true; ig.meusSeguidoresGraphqlFalha = true; } });
  ctx.ig.meSeguem.set(String(ctx.alvo.id), Date.now());
  await ctx.ext.avancarAte(Date.now() + 20 * MINUTO);
  const e = ctx.ext.estado();
  assert.equal(e.pausaAte, null);
  assert.equal(e.semSessao, false);
  assert.ok(e.boasVindas.ultimoErro && /seguidores/.test(e.boasVindas.ultimoErro.texto), JSON.stringify(e.boasVindas));
  assert.match(resumoBoasVindas(e).texto, /último erro/);
});

test('show_many em HTML mas friendships/show em JSON: o plano B por perfil usa o show (diz se segue de volta)', { timeout: 240_000 }, async () => {
  const ctx = await preparar({ configurar: (ig) => { ig.showHtml = false; } });
  await seguirDeVoltaEnterrado(ctx, 80); // além das páginas lidas na conferência completa
  await ctx.ext.avancarAte(Date.now() + 4 * HORA);
  const reg = ctx.ext.estado().seguidos[ctx.alvo.id];
  assert.ok(reg.followBackEm, 'detectado pelo friendships/show');
  assert.equal(ctx.ig.dms.length, 1);
});

test('botão "Conferir seguidores agora": confere na hora e devolve o resumo', { timeout: 240_000 }, async () => {
  const ctx = await preparar();
  ctx.ig.meSeguem.set(String(ctx.alvo.id), Date.now());
  const r = await ctx.ext.mensagem({ tipo: 'conferirSeguidores' });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.novos, 1);
  assert.match(r.texto, /1 novo follow-back/);
  const e = ctx.ext.estado();
  assert.ok(e.seguidos[ctx.alvo.id].dmAgendadaPara, 'DM agendada (sai 1–3 min depois)');
  assert.ok(Date.now() - e.boasVindas.ultimaChecagemEm < 5 * MINUTO, 'checagem registrada agora (a conferência um a um leva ~1 min)');
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
  assert.equal(ctx.ig.chamadas.length, antes, 'nenhuma chamada ao Instagram');
});

test('DM em HTML: o erro aparece no resumo de boas-vindas', { timeout: 240_000 }, async () => {
  const ctx = await preparar({ configurar: (ig) => { ig.dmHtml = true; } });
  ctx.ig.meSeguem.set(String(ctx.alvo.id), Date.now());
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
  assert.match(r.texto, /^Boas-vindas: 2 enviadas hoje, 1 pendente, última checagem de seguidores às 11:58, último erro \(12:00\): DM não enviada: HTML/);
  assert.match(r.texto, /1 não pôde ser enviada/);

  const vazio = resumoBoasVindas(estadoInicial(), agora);
  assert.match(vazio.texto, /0 enviadas hoje, 0 pendentes, última checagem de seguidores: ainda não, último erro: nenhum/);
  const desligada = estadoInicial();
  desligada.config.dmAtiva = false;
  assert.match(resumoBoasVindas(desligada, agora).texto, /DM desligada no painel/);
});
