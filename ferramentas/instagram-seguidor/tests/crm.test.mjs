// 1.2.0 (EXT-1, dono, 2026-10-29): tela "Extensões" do CRM — configuração lida a cada rodada (seguir por dia = 20 por
// padrão), "Parar tudo" conferido antes de cada ação, aviso de versão nova e sinal de saúde sem dado de terceiros.
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { HORA, MINUTO, DIA, diaSP } from '../lib/tempo.js';
import { aplicarConfigDoCrm, resumoSaude } from '../lib/crm-config.js';
import { estadoInicial, normalizarEstado, configPadrao } from '../lib/estado.js';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';

afterEach(() => mock.timers.reset());

test('padrão novo: seguir 20 por dia; quem estava no padrão antigo (15) passa a 20; escolha diferente fica', () => {
  assert.equal(configPadrao().limiteDiario, 20);
  assert.equal(normalizarEstado({ versao: 2, config: { limiteDiario: 15 } }).config.limiteDiario, 20);
  assert.equal(normalizarEstado({ versao: 2, config: { limiteDiario: 8 } }).config.limiteDiario, 8);
  assert.equal(normalizarEstado({ versao: 3, config: { limiteDiario: 15 } }).config.limiteDiario, 15, 'já na 1.2.0: não mexe');
});

test('migração 1.2.0: registros passam a ser guardados pelo @; linha de base é lida de novo (sem DM em lote)', () => {
  const e = normalizarEstado({
    versao: 2,
    meuId: '999',
    seguidos: { 1001: { id: '1001', username: 'Pessoa1', status: 'seguindo', seguidoEm: 1 } },
    novosSeguidores: { 9001: { id: '9001', username: 'fora1', dmEnviadaEm: 2 } },
    fila: [{ id: '1002', username: 'pessoa2' }, { id: '1003', username: '' }, { id: '1004', username: 'pessoa2' }],
    vistos: { 1001: 'seguido', 1005: 'privado' },
    meusSeguidores: { linhaDeBaseEm: 5, conhecidos: { 9001: 5 } },
    cursorOrigem: { id: '555', username: 'perfilref', origem: '@perfilref', modo: 'v1', proximo: '36', esgotado: false, totais: { lidos: 36, adicionados: 30, pulados: {} } },
  });
  assert.deepEqual(Object.keys(e.seguidos), ['pessoa1']);
  assert.equal(e.seguidos.pessoa1.idAntigo, '1001');
  assert.equal(e.novosSeguidores.fora1.dmEnviadaEm, 2, 'quem já recebeu continua marcado (nunca 2ª DM)');
  assert.deepEqual(e.fila.map((f) => f.id), ['pessoa2']);
  assert.deepEqual(e.vistos, { pessoa1: 'seguido' });
  assert.deepEqual(e.meusSeguidores, { linhaDeBaseEm: null, conhecidos: {} });
  assert.equal(e.cursorOrigem.lidos, 36);
  assert.equal(e.meuId, undefined);
});

test('aplicarConfigDoCrm: faixas fechadas; horário inválido ignorado; diz o que mudou', () => {
  const e = estadoInicial();
  const r = aplicarConfigDoCrm(e, { followPerDay: 25, unfollowPerDay: 99, welcomePerDay: 0, checkFollowersEveryMin: 15, startHour: 6, endHour: 21 });
  assert.equal(e.config.limiteDiario, 25);
  assert.equal(e.config.limiteUnfollowDiario, 40);
  assert.equal(e.config.limiteDmDiario, 1);
  assert.equal(e.config.verificarACadaMin, 15);
  assert.deepEqual([e.config.inicioHora, e.config.fimHora], [6, 21]);
  assert.ok(r.limitesMudaram && r.verificarMudou);
  const r2 = aplicarConfigDoCrm(e, { startHour: 22, endHour: 5 });
  assert.deepEqual([e.config.inicioHora, e.config.fimHora], [6, 21]);
  assert.equal(r2.mudou.length, 0);
  assert.equal(aplicarConfigDoCrm(e, null).mudou.length, 0);
});

test('resumoSaude: só contagens e horários (sem @ de ninguém)', () => {
  const agora = Date.parse('2026-10-29T15:00:00Z');
  const e = estadoInicial();
  e.contadores = { dia: diaSP(agora), seguidos: 7, deixados: 2, dms: 3 };
  e.pausaAte = agora + HORA;
  e.alerta = { tipo: 'limite', texto: 'O Instagram sinalizou limite' };
  const r = resumoSaude(e, { pausado: false }, { agora });
  assert.deepEqual(r.today, { follow: { done: 7, limit: 20 }, unfollow: { done: 2, limit: 15 }, welcome: { done: 3, limit: 30 } });
  assert.equal(r.ok, false);
  assert.ok(r.pausedUntil);
  assert.doesNotMatch(JSON.stringify(r), /pessoa|@/);
});

const INICIO = Date.parse('2026-10-20T08:00:00Z'); // 05:00 SP

test('configuração do CRM vale na rodada seguinte: seguir 25/dia', { timeout: 240_000 }, async () => {
  const ig = criarInstagramFalso({ totalSeguidores: 200 });
  const cf = criarChromeFalso(ig);
  const crm = { stopped: false, config: { followPerDay: 25 } };
  const ext = await iniciarExtensao(cf, INICIO, { crm });
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(INICIO + DIA - 2 * HORA);
  assert.equal(ig.de('clique-seguir').length, 25);
  assert.ok(ext.estado().historico.some((h) => h.acao === 'configuração do CRM' && /seguir 25\/dia/.test(h.resultado)));
});

test('Parar tudo no CRM: nenhuma ação (seguir, deixar, DM, conferência) até Retomar; volta sozinha', { timeout: 240_000 }, async () => {
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const crm = { stopped: false, config: {} };
  const ext = await iniciarExtensao(cf, INICIO, { crm });
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(INICIO + 3 * HORA);
  const antes = ig.chamadas.filter((c) => c.tipo !== 'sessao').length;
  assert.ok(antes > 0);

  crm.stopped = true;
  await ext.avancarAte(INICIO + 8 * HORA);
  assert.equal(ig.chamadas.filter((c) => c.tipo !== 'sessao').length, antes, 'mexeu no Instagram com o CRM parado');
  const e = ext.estado();
  assert.match(e.proxima.acao, /Parada pelo CRM/);
  assert.ok(e.historico.some((h) => /Parar tudo no CRM/.test(h.resultado)));
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /Parada pelo CRM/);
  const sinal = ext.saude.at(-1);
  assert.equal(sinal.stoppedByCrm, true);

  crm.stopped = false;
  await ext.avancarAte(INICIO + 11 * HORA);
  assert.ok(ig.de('clique-seguir').length > 0 && ig.chamadas.filter((c) => c.tipo !== 'sessao').length > antes, 'voltou depois de Retomar');
});

test('sinal de saúde vai ao CRM sem @ de ninguém; versão nova avisa uma vez', { timeout: 240_000 }, async () => {
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const crm = { stopped: false, config: {}, latestVersion: '1.2.1' };
  const ext = await iniciarExtensao(cf, INICIO, { crm });
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  ig.cliqueNaoMuda = true; // erro com @ no texto
  await ext.avancarAte(INICIO + 4 * HORA);
  assert.ok(ext.saude.length >= 2);
  const ultimo = ext.saude.at(-1);
  assert.equal(ultimo.today.follow.limit, 20);
  assert.ok(ultimo.errors.length >= 1);
  assert.ok(ultimo.selectorFailures.length >= 1);
  assert.doesNotMatch(JSON.stringify(ext.saude), /pessoa\d+/, 'nenhum @ de terceiro no sinal');
  const avisos = cf.notificacoes.filter((n) => /versão nova/.test(n.title));
  assert.equal(avisos.length, 1);
  const sit = await ext.mensagem({ tipo: 'situacaoCrm' });
  assert.equal(sit.desatualizada, true);
  assert.equal(sit.versaoNova, '1.2.1');
  assert.equal(sit.linkZip, 'https://crm/download');
  void MINUTO;
});

test('salvarCrm: só aceita chave igs_ e nunca devolve a chave', { timeout: 60_000 }, async () => {
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, INICIO);
  const ruim = await ext.mensagem({ tipo: 'salvarCrm', key: 'mkp_errada', baseUrl: '' });
  assert.equal(ruim.ok, false);
  assert.match(ruim.erro, /igs_/);
  const sit = await ext.mensagem({ tipo: 'situacaoCrm' });
  assert.equal(sit.temChave, false);
  assert.equal(JSON.stringify(sit).includes('igs_'), false);
});
