// Simulação: Instagram devolve "feedback_required" → pausa de 24 h + notificação;
// sem sessão → pausa até voltar o login.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';
import { HORA, MINUTO, DIA, dentroDaJanela } from '../lib/tempo.js';

test('bloqueio do Instagram pausa 24 h sozinho e avisa', { timeout: 120_000 }, async () => {
  const inicio = Date.parse('2026-10-20T08:00:00Z'); // 05:00 SP
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(inicio + 3 * HORA);
  const antes = ig.chamadas.filter((c) => c.caminho.includes('/create/')).length;
  assert.ok(antes >= 2);

  ig.falharProximoSeguir = { status: 400, texto: '{"message":"feedback_required","spam":true,"status":"fail"}' };
  await ext.avancarAte(inicio + 5 * HORA);
  let e = ext.estado();
  assert.ok(e.pausaAte, 'deveria pausar');
  const momento = e.pausaAte - 24 * HORA;
  assert.ok(momento > inicio + 3 * HORA && momento < inicio + 5 * HORA);
  assert.equal(e.alerta.tipo, 'limite');
  assert.equal(cf.notificacoes.length, 1);
  assert.match(cf.notificacoes[0].title, /limite/);
  assert.equal(e.proxima.acao, 'Fim da pausa automática (24 h)');
  // O perfil que deu erro volta para a frente da fila (não se perde)
  const criadasNoErro = ig.chamadas.filter((c) => c.caminho.includes('/create/')).length;

  // Durante as 24 h: nenhuma chamada ao Instagram
  const nChamadas = ig.chamadas.length;
  await ext.avancarAte(momento + 23 * HORA);
  assert.equal(ig.chamadas.length, nChamadas, 'chamou o Instagram durante a pausa');

  // Depois das 24 h (e dentro da janela) volta sozinho
  await ext.avancarAte(momento + 30 * HORA);
  e = ext.estado();
  assert.equal(e.pausaAte, null);
  assert.ok(ig.chamadas.filter((c) => c.caminho.includes('/create/')).length > criadasNoErro);
  mock.timers.reset();
});

test('sem sessão logada: pausa, avisa e volta sozinho com o login', { timeout: 60_000 }, async () => {
  const inicio = Date.parse('2026-10-20T09:00:00Z'); // 06:00 SP
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig, { logado: false });
  const ext = await iniciarExtensao(cf, inicio);
  let e = ext.estado();
  assert.equal(e.semSessao, true);
  assert.equal(cf.notificacoes.length, 1);
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, false);
  await ext.avancarAte(inicio + 30 * MINUTO);
  assert.equal(ig.chamadas.length, 0);
  assert.equal(cf.notificacoes.length, 1, 'não deve notificar repetidamente');

  cf.sessao.logado = true;
  await ext.avancarAte(inicio + 40 * MINUTO);
  e = ext.estado();
  assert.equal(e.semSessao, false);
  assert.equal(e.meuId, '999');
  mock.timers.reset();
});

test('busca de origem com 400 + require_login NÃO pausa; plano B (pesquisa) acha o perfil', { timeout: 60_000 }, async () => {
  const inicio = Date.parse('2026-10-20T11:00:00Z'); // 08:00 SP
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  ig.falharPerfil = { status: 400, texto: '{"message":"Please wait a few minutes before you try again.","require_login":true,"status":"fail"}' };
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: '@perfilref' });
  assert.equal(r.ok, true, r.erro);
  let e = ext.estado();
  assert.equal(e.pausaAte, null);
  assert.equal(e.esfriarAte, null);
  assert.equal(e.semSessao, false);
  assert.equal(e.fila.length, 120); // 1.1.0: privados entram na fila
  // Perfil que não existe em nenhum dos 3 métodos: erro com trecho, sem pausa
  const r2 = await ext.mensagem({ tipo: 'buscarOrigem', username: 'naoexiste' });
  assert.equal(r2.ok, false);
  assert.match(r2.erro, /Resposta:/);
  assert.match(r2.erro, /não foi pausada|tente de novo|confira/i);
  e = ext.estado();
  assert.equal(e.pausaAte, null);
  assert.equal(cf.notificacoes.length, 0);
  mock.timers.reset();
});

test('"aguarde" em leitura automática: espera 15 min; 3 vezes em 1 h → pausa 24 h', { timeout: 60_000 }, async () => {
  const inicio = Date.parse('2026-10-20T11:00:00Z'); // 08:00 SP
  const ig = criarInstagramFalso({ voltaSe: () => false });
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(inicio + 10 * MINUTO); // já seguiu alguém → passa a verificar follow-back
  assert.ok(Object.keys(ext.estado().seguidos).length >= 1);

  ig.falharSeguidoresDeMim = 1;
  await ext.avancarAte(inicio + 13 * MINUTO);
  let e = ext.estado();
  assert.ok(e.esfriarAte, 'deveria esperar 15 min');
  assert.equal(e.pausaAte, null);
  assert.equal(cf.notificacoes.length, 0);

  ig.falharSeguidoresDeMim = 2;
  await ext.avancarAte(inicio + 55 * MINUTO);
  e = ext.estado();
  assert.ok(e.pausaAte, 'na 3ª vez em 1 h deveria pausar 24 h');
  assert.equal(cf.notificacoes.length, 1);

  // "Retomar agora" tira a pausa
  await ext.mensagem({ tipo: 'retomar' });
  e = ext.estado();
  assert.equal(e.pausaAte, null);
  assert.equal(e.esfriarAte, null);
  mock.timers.reset();
});

test('busca: perfil privado que não sigo → motivo claro, sem chamar a lista', { timeout: 60_000 }, async () => {
  const ig = criarInstagramFalso();
  ig.perfilPrivado = true;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, Date.parse('2026-10-20T11:00:00Z'));
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /PRIVADO/);
  assert.equal(ig.chamadas.filter((c) => c.caminho.includes('/followers/')).length, 0);
  assert.equal(ext.estado().pausaAte, null);
  mock.timers.reset();
});

test('busca: lista v1 vazia → plano B (GraphQL) preenche a fila', { timeout: 60_000 }, async () => {
  const ig = criarInstagramFalso();
  ig.v1Vazio = true;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, Date.parse('2026-10-20T11:00:00Z'));
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.resultado.via, 'graphql');
  assert.equal(r.resultado.lidos, 120);
  assert.equal(r.resultado.adicionados, 120);
  assert.equal(r.resultado.pulados.privado, undefined, 'privados não são mais pulados por padrão');
  mock.timers.reset();
});

test('busca: as duas listas vazias → erro explica com trecho das respostas', { timeout: 60_000 }, async () => {
  const ig = criarInstagramFalso();
  ig.v1Vazio = true;
  ig.graphqlVazio = true;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, Date.parse('2026-10-20T11:00:00Z'));
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, true);
  assert.equal(r.resultado.lidos, 0);
  assert.match(r.resultado.erro, /não devolveu nenhum seguidor de @perfilref \(o perfil tem 120 seguidores\)/);
  assert.match(r.resultado.erro, /Resposta v1: \{"users":\[\]/);
  assert.match(r.resultado.erro, /GraphQL: /);
  assert.equal(ext.estado().pausaAte, null);
  mock.timers.reset();
});

test('fila curta: continua a lista do MESMO perfil sozinha, devagar e só na janela', { timeout: 120_000 }, async () => {
  const inicio = Date.parse('2026-10-20T07:30:00Z'); // 04:30 SP
  const ig = criarInstagramFalso({ totalSeguidores: 400 });
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'salvarConfig', config: { maxBusca: 25 } });
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.resultado.lidos, 36); // 3 páginas de 12
  const leiturasBusca = ig.chamadas.filter((c) => c.caminho === '/api/v1/friendships/555/followers/').length;

  await ext.avancarAte(inicio + 2 * DIA);
  const e = ext.estado();
  const leituras = ig.chamadas.filter((c) => c.caminho === '/api/v1/friendships/555/followers/').slice(leiturasBusca);
  assert.ok(leituras.length > 0, 'deveria reabastecer sozinha');
  assert.ok(leituras.every((c) => dentroDaJanela(c.em, { inicioHora: 5, fimHora: 22 })), 'reabasteceu fora da janela');
  const rodadas = e.historico.filter((h) => h.acao === 'reabastecer fila');
  assert.ok(rodadas.length >= 1);
  for (let i = 1; i < rodadas.length; i += 1) assert.ok(rodadas[i].em - rodadas[i - 1].em >= 20 * MINUTO, 'reabastecimento em rajada');
  // Seguiu 15/dia nos 2 dias (a fila não acabou) e nunca repetiu ninguém
  assert.equal(ig.chamadas.filter((c) => c.caminho.includes('/create/')).length, 30);
  const ids = e.fila.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => !e.seguidos[id]));
  assert.ok(e.fila.length >= 15, `fila ficou com ${e.fila.length}`);
  assert.ok(e.cursorOrigem.totais.lidos > 36);
  assert.equal(e.cursorOrigem.totais.pulados.privado, undefined);
  assert.ok(Object.values(e.seguidos).some((s) => s.status === 'solicitado'), 'privados viram Solicitado');
  mock.timers.reset();
});

test('create devolve HTML: legado funciona → segue; legado falha → suspende o seguir só hoje', { timeout: 120_000 }, async () => {
  const inicio = Date.parse('2026-10-20T08:00:00Z'); // 05:00 SP
  const ig = criarInstagramFalso();
  ig.createHtml = true;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(inicio + 3 * HORA);
  let e = ext.estado();
  const seguidosLegado = Object.keys(e.seguidos).length;
  assert.ok(seguidosLegado >= 2, 'deveria seguir pelo endpoint legado');
  assert.ok(e.historico.some((h) => h.acao === 'seguir' && /confirmado \(web\/friendships\/follow\)/.test(h.resultado)));

  ig.legadoFunciona = false;
  await ext.avancarAte(inicio + 6 * HORA);
  e = ext.estado();
  assert.equal(e.pausaAte, null, 'HTML não é bloqueio: nada de 24 h');
  assert.equal(e.suspensoSeguir, '2026-10-20');
  assert.match(e.alerta.texto, /SEGUIR suspenso até amanhã/);
  const n = Object.keys(e.seguidos).length;
  const tentativasCreate = ig.chamadas.filter((c) => c.caminho.includes('/create/')).length;
  await ext.avancarAte(inicio + 16 * HORA); // resto do dia: não tenta mais
  assert.equal(ig.chamadas.filter((c) => c.caminho.includes('/create/')).length, tentativasCreate);

  // No dia seguinte volta a tentar (e, com o Instagram normal, segue)
  ig.createHtml = false;
  await ext.avancarAte(inicio + 27 * HORA);
  assert.ok(Object.keys(ext.estado().seguidos).length > n);
  mock.timers.reset();
});
