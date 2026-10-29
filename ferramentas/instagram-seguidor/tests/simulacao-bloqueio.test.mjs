// Simulação: o Instagram mostra aviso de limite/bloqueio na TELA → pausa de 24 h + notificação; sem sessão (página de
// login) → pausa até voltar o login. 1.2.0: tudo pela tela; quando a tela não deixa, para e avisa (sem insistir).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';
import { HORA, MINUTO, DIA, dentroDaJanela } from '../lib/tempo.js';

const acoes = (ig) => ig.chamadas.filter((c) => c.tipo !== 'sessao');

test('aviso de limite na tela ao clicar em Seguir: pausa 24 h sozinho e avisa', { timeout: 120_000 }, async () => {
  const inicio = Date.parse('2026-10-20T08:00:00Z'); // 05:00 SP
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(inicio + 3 * HORA);
  assert.ok(ig.de('clique-seguir').length >= 2);

  ig.bloqueioNoClique = 'limite';
  await ext.avancarAte(inicio + 5 * HORA);
  let e = ext.estado();
  assert.ok(e.pausaAte, 'deveria pausar');
  const momento = e.pausaAte - 24 * HORA;
  assert.ok(momento > inicio + 3 * HORA && momento < inicio + 5 * HORA);
  assert.equal(e.alerta.tipo, 'limite');
  assert.equal(cf.notificacoes.length, 1);
  assert.match(cf.notificacoes[0].title, /limite/);
  assert.equal(e.proxima.acao, 'Fim da pausa automática (24 h)');
  const cliquesNoErro = ig.de('clique-seguir').length;

  // Durante as 24 h: nada na tela do Instagram
  const n = ig.chamadas.length;
  await ext.avancarAte(momento + 23 * HORA);
  assert.equal(ig.chamadas.length, n, 'mexeu no Instagram durante a pausa');

  // Depois das 24 h (e dentro da janela) volta sozinho
  await ext.avancarAte(momento + 30 * HORA);
  e = ext.estado();
  assert.equal(e.pausaAte, null);
  assert.ok(ig.de('clique-seguir').length > cliquesNoErro);
  mock.timers.reset();
});

test('sem sessão (tela de login): pausa, avisa uma vez e volta sozinho com o login — sem cookies', { timeout: 60_000 }, async () => {
  const inicio = Date.parse('2026-10-20T09:00:00Z'); // 06:00 SP
  const ig = criarInstagramFalso();
  ig.logado = false;
  const cf = criarChromeFalso(ig);
  assert.equal(cf.chrome.cookies, undefined, 'a extensão não tem mais a permissão de cookies');
  const ext = await iniciarExtensao(cf, inicio);
  let e = ext.estado();
  assert.equal(e.semSessao, true);
  assert.equal(cf.notificacoes.length, 1);
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, false);
  await ext.avancarAte(inicio + 30 * MINUTO);
  assert.equal(acoes(ig).length, 0, 'só leu a sessão na tela');
  assert.equal(cf.notificacoes.length, 1, 'não deve notificar repetidamente');

  ig.logado = true;
  await ext.avancarAte(inicio + 50 * MINUTO);
  e = ext.estado();
  assert.equal(e.semSessao, false);
  assert.equal(e.meuUsuario, 'eu', 'meu @ lido na tela (link Perfil)');
  mock.timers.reset();
});

test('busca de origem: perfil inexistente → erro claro, sem pausa', { timeout: 60_000 }, async () => {
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, Date.parse('2026-10-20T11:00:00Z'));
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'naoexiste' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /não encontrado/);
  assert.match(r.erro, /Confira o @/);
  const r2 = await ext.mensagem({ tipo: 'buscarOrigem', username: 'nome inválido!' });
  assert.equal(r2.ok, false);
  const e = ext.estado();
  assert.equal(e.pausaAte, null);
  assert.equal(cf.notificacoes.length, 0);
  mock.timers.reset();
});

test('"Tente novamente mais tarde" na leitura automática: espera 15 min; 3 vezes em 1 h → pausa 24 h', { timeout: 60_000 }, async () => {
  const inicio = Date.parse('2026-10-20T11:00:00Z'); // 08:00 SP
  const ig = criarInstagramFalso({ voltaSe: () => false });
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(inicio + 5 * MINUTO);

  ig.aguardeNaLista = 1;
  await ext.avancarAte(inicio + 12 * MINUTO); // conferência dos meus seguidores (10 min)
  let e = ext.estado();
  assert.ok(e.esfriarAte, 'deveria esperar 15 min');
  assert.equal(e.pausaAte, null);
  assert.equal(cf.notificacoes.length, 0);

  ig.aguardeNaLista = 2;
  await ext.avancarAte(inicio + 58 * MINUTO);
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

test('busca: perfil privado que não sigo → motivo claro, sem abrir a lista', { timeout: 60_000 }, async () => {
  const ig = criarInstagramFalso();
  ig.perfilPrivado = true;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, Date.parse('2026-10-20T11:00:00Z'));
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /PRIVADO/);
  assert.equal(ig.de('lista').length, 0);
  assert.equal(ext.estado().pausaAte, null);
  mock.timers.reset();
});

test('busca: a janela "Seguidores" não abre ou vem vazia → erro explica, sem pausa', { timeout: 60_000 }, async () => {
  const ig = criarInstagramFalso();
  ig.listaNaoAbre = true;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, Date.parse('2026-10-20T11:00:00Z'));
  let r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /janela "Seguidores" não abriu/);
  ig.listaNaoAbre = false;
  ig.listaVazia = true;
  r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /não mostrou ninguém/);
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
  assert.equal(r.resultado.lidos, 25);
  const leiturasBusca = ig.de('lista').length;

  await ext.avancarAte(inicio + 2 * DIA);
  const e = ext.estado();
  const leituras = ig.de('lista').slice(leiturasBusca);
  assert.ok(leituras.length > 0, 'deveria reabastecer sozinha');
  assert.ok(leituras.every((c) => dentroDaJanela(c.em, { inicioHora: 5, fimHora: 22 })), 'reabasteceu fora da janela');
  const rodadas = e.historico.filter((h) => h.acao === 'reabastecer fila');
  assert.ok(rodadas.length >= 1);
  for (let i = 1; i < rodadas.length; i += 1) assert.ok(rodadas[i].em - rodadas[i - 1].em >= 20 * MINUTO, 'reabastecimento em rajada');
  // Seguiu 20/dia nos 2 dias (a fila não acabou) e nunca repetiu ninguém
  assert.equal(ig.de('clique-seguir').length, 40);
  const ids = e.fila.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => !e.seguidos[id]));
  assert.ok(e.fila.length >= 20, `fila ficou com ${e.fila.length}`);
  assert.ok(e.cursorOrigem.lidos > 25);
  assert.ok(Object.values(e.seguidos).some((s) => s.status === 'solicitado'), 'privados viram Solicitado');
  mock.timers.reset();
});

test('a tela não deixa seguir (botão não muda): para e avisa — SEGUIR suspenso só hoje, sem insistir por outro caminho', { timeout: 120_000 }, async () => {
  const inicio = Date.parse('2026-10-20T08:00:00Z'); // 05:00 SP
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(inicio + 3 * HORA);
  let e = ext.estado();
  const n0 = Object.keys(e.seguidos).length;
  assert.ok(n0 >= 2);
  assert.ok(e.historico.some((h) => h.acao === 'seguir' && /confirmado na tela \(botão Seguir\)/.test(h.resultado)));

  ig.cliqueNaoMuda = true;
  await ext.avancarAte(inicio + 6 * HORA);
  e = ext.estado();
  assert.equal(e.pausaAte, null, 'tela diferente não é bloqueio: nada de 24 h');
  assert.equal(e.suspensoSeguir, '2026-10-20');
  assert.match(e.alerta.texto, /SEGUIR suspenso até amanhã/);
  const n = Object.keys(e.seguidos).length;
  const cliques = ig.de('clique-seguir').length;
  await ext.avancarAte(inicio + 16 * HORA); // resto do dia: não tenta mais
  assert.equal(ig.de('clique-seguir').length, cliques);

  // No dia seguinte volta a tentar (e, com a tela normal, segue)
  ig.cliqueNaoMuda = false;
  await ext.avancarAte(inicio + 27 * HORA);
  assert.ok(Object.keys(ext.estado().seguidos).length > n);
  mock.timers.reset();
});
