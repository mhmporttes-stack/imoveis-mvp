// 1.1.8 — decisões do dono (26/10): (1) boas-vindas para TODO seguidor novo, não só follow-back — com linha de base
// na 1ª leitura (nunca DM em lote para seguidores antigos), dedupe por id e teto diário (padrão 30); (2) se a API de DM
// responder HTML, a mensagem é digitada na tela da conversa; sem confirmação na tela = incerto (nunca reenvia).
// Tudo com Instagram FALSO (tests/ajuda/simulador.mjs) — nenhuma DM real.
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { DIA, HORA, MINUTO, diaSP } from '../lib/tempo.js';
import {
  STATUS,
  detectarNovosSeguidores,
  tetoDmAtingido,
  jaTemBoasVindas,
  registrarFollowBack,
  reabilitarDesistidasPorHtml,
  desistiuPorHtml,
} from '../lib/regras.js';
import { estadoInicial, normalizarEstado, resumoBoasVindas } from '../lib/estado.js';
import { criarApiInstagram, ErroInstagram, trechoDaMensagem, partesDaDigitacao } from '../instagram-api.js';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';

afterEach(() => mock.timers.reset());

const CFG = estadoInicial().config;
const INICIO = Date.parse('2026-10-20T07:30:00Z'); // 04:30 SP (fora da janela)
const BROADCAST = '/api/v1/direct_v2/threads/broadcast/text/';

// ---------------------------------------------------------------- regras puras

test('detectarNovosSeguidores: 1ª leitura = linha de base (todos conhecidos, nenhum novo)', () => {
  const r = detectarNovosSeguidores([{ pk: '1' }, { pk: '2' }, { pk: '999' }], { conhecidos: {}, linhaDeBaseEm: null, meuId: '999' });
  assert.equal(r.linhaDeBase, true);
  assert.deepEqual(r.novos, []);
  assert.deepEqual(r.conhecer, ['1', '2']);
});

test('detectarNovosSeguidores: novos = acima do 1º conhecido; os de baixo viram conhecidos sem DM', () => {
  const r = detectarNovosSeguidores([{ pk: '5', username: 'e' }, { pk: '4' }, { pk: '4' }, { pk: '1' }, { pk: '3' }], { conhecidos: { 1: 1 }, linhaDeBaseEm: 1 });
  assert.deepEqual(r.novos.map((u) => u.id), ['5', '4']);
  assert.equal(r.novos[0].username, 'e');
  assert.deepEqual(r.conhecer, ['5', '4', '1', '3'], '3 (antigo, abaixo do conhecido) vira conhecido');
  assert.equal(r.anomalia, false);
});

test('detectarNovosSeguidores: nenhum conhecido na leitura → anomalia, ninguém recebe DM', () => {
  const r = detectarNovosSeguidores([{ pk: '7' }, { pk: '8' }], { conhecidos: { 1: 1 }, linhaDeBaseEm: 1 });
  assert.equal(r.anomalia, true);
  assert.deepEqual(r.novos, []);
  assert.deepEqual(r.conhecer, ['7', '8']);
});

test('teto diário: enviadas + incertas; padrão 30', () => {
  assert.equal(CFG.limiteDmDiario, 30);
  assert.equal(tetoDmAtingido({ dms: 29, dmsIncertas: 0 }, CFG), false);
  assert.equal(tetoDmAtingido({ dms: 29, dmsIncertas: 1 }, CFG), true);
  assert.equal(tetoDmAtingido({ dms: 4 }, { limiteDmDiario: 5 }), false);
  assert.equal(tetoDmAtingido({ dms: 5 }, { limiteDmDiario: 5 }), true);
});

test('dedupe por id: novo seguidor e follow-back nunca geram 2 DMs', () => {
  const e = estadoInicial();
  e.novosSeguidores = { 10: { id: '10', dmEnviadaEm: 1 } };
  e.seguidos = { 11: { id: '11', dmEnviadaEm: 1 }, 12: { id: '12', status: STATUS.DEIXADO } };
  assert.equal(jaTemBoasVindas(e, '10'), true);
  assert.equal(jaTemBoasVindas(e, '11'), true, 'já recebeu como follow-back');
  assert.equal(jaTemBoasVindas(e, '12'), false, 'seguido sem DM (deixado) pode receber como novo seguidor');
  const reg = { id: '10', status: STATUS.SEGUINDO, dmCoberta: true };
  registrarFollowBack(reg, Date.parse('2026-10-20T15:00:00Z'), CFG, () => 0);
  assert.ok(reg.followBackEm);
  assert.equal(reg.dmAgendadaPara, undefined, 'dmCoberta: follow-back não agenda 2ª DM');
});

test('reabilitação: desistidas por HTML (antes da 1.1.8) ganham UMA nova tentativa; DM desligada e já digitadas não', () => {
  const agora = Date.parse('2026-10-26T15:00:00Z'); // 12:00 SP
  const hist = [{ acao: 'DM', username: 'a', resultado: 'não enviada após 3 tentativas (resposta HTML) — desistindo, alerta no popup' }];
  const regs = [
    { id: '1', username: 'a', dmDesistiu: true, dmFalhas: 3 }, // legado: só o histórico diz que foi HTML
    { id: '2', username: 'b', dmDesistiu: true }, // DM desligada
    { id: '3', username: 'c', dmDesistiu: true, dmFalhas: 3, dmDesistiuPor: 'html', dmDigitacaoTentadaEm: agora - DIA }, // já passou pela digitação
    { id: '4', username: 'd', dmDesistiu: true, dmFalhas: 3 }, // falhas 4xx (sem "resposta HTML" no histórico)
  ];
  assert.equal(desistiuPorHtml(regs[0], hist), true);
  assert.equal(desistiuPorHtml(regs[3], hist), false);
  const feitos = reabilitarDesistidasPorHtml(regs, hist, agora, CFG, 3, () => 0);
  assert.deepEqual(feitos.map((r) => r.id), ['1']);
  assert.equal(regs[0].dmDesistiu, false);
  assert.equal(regs[0].dmFalhas, 2, 'só mais uma tentativa');
  assert.ok(regs[0].dmAgendadaPara >= agora + MINUTO);
  assert.equal(reabilitarDesistidasPorHtml(regs, hist, agora, CFG).length, 0, 'nunca reabilita duas vezes');
});

test('estado antigo (1.1.7) ganha os campos novos sem linha de base', () => {
  const e = normalizarEstado({ versao: 2, config: { limiteDiario: 10 }, seguidos: {} });
  assert.equal(e.config.limiteDmDiario, 30);
  assert.deepEqual(e.meusSeguidores, { linhaDeBaseEm: null, conhecidos: {} });
  assert.deepEqual(e.novosSeguidores, {});
  assert.match(resumoBoasVindas(e).texto, /linha de base dos seguidores ainda não lida/);
});

// ---------------------------------------------------------------- API: plano B por digitação

const HTML = { status: 200, texto: '<!DOCTYPE html><html><head><title>Instagram</title></head></html>' };

function apiDm(respostas, digitar) {
  const chamadas = [];
  const api = criarApiInstagram({
    obterCsrf: async () => 'tok',
    executar: async () => respostas.shift(),
    digitarDm: digitar && (async (x) => { chamadas.push(x); return digitar(x); }),
  });
  return { api, chamadas };
}

test('enviarDm: API em HTML → digitação confirmada na tela = enviada', async () => {
  const { api, chamadas } = apiDm([HTML], () => ({ ok: true, confirmado: true, apertouEnter: true }));
  const r = await api.enviarDm('77', 'Oi', { username: 'fulano' });
  assert.equal(r.digitacao, true);
  assert.match(r.modo, /digitação/);
  assert.deepEqual(chamadas, [{ username: 'fulano', texto: 'Oi' }]);
});

test('enviarDm: API JSON ok nunca digita; sem @ não digita', async () => {
  const a = apiDm([{ status: 200, texto: '{"status":"ok"}' }], () => assert.fail('não deveria digitar'));
  assert.deepEqual(await a.api.enviarDm('77', 'Oi', { username: 'fulano' }), { modo: 'recipient_users' });
  const b = apiDm([HTML], () => assert.fail('não deveria digitar'));
  await assert.rejects(b.api.enviarDm('77', 'Oi'), (e) => e.tipo === 'nao_enviada' && !e.digitacao);
});

test('enviarDm: digitação sem Enter = nao_enviada; Enter sem confirmação = incerto; já na conversa = enviada', async () => {
  const a = apiDm([HTML], () => ({ ok: false, apertouEnter: false, erro: 'botão "Enviar mensagem" não apareceu no perfil' }));
  await assert.rejects(a.api.enviarDm('77', 'Oi', { username: 'f' }), (e) => e instanceof ErroInstagram && e.tipo === 'nao_enviada' && e.digitacao === true && /Enviar mensagem/.test(e.message));
  const b = apiDm([HTML], () => ({ ok: false, apertouEnter: true, erro: 'a mensagem não apareceu na conversa em 12 s' }));
  await assert.rejects(b.api.enviarDm('77', 'Oi', { username: 'f' }), (e) => e.tipo === 'incerto' && e.digitacao === true);
  const c = apiDm([HTML], () => { throw new Error('aba fechou'); });
  await assert.rejects(c.api.enviarDm('77', 'Oi', { username: 'f' }), (e) => e.tipo === 'incerto', 'erro inesperado no meio = incerto');
  const d = apiDm([HTML], () => ({ ok: true, jaEstava: true }));
  assert.equal((await d.api.enviarDm('77', 'Oi', { username: 'f' })).digitacao, true);
});

test('digitação: trecho de conferência e partes (quebra de linha nunca é Enter)', () => {
  assert.equal(trechoDaMensagem('Oi\n\nPode me chamar   quando quiser.\nAbraço'), 'Pode me chamar quando quiser.');
  const partes = partesDaDigitacao('Oi tudo\n\nbem');
  assert.deepEqual(partes, [{ texto: 'Oi ' }, { texto: 'tudo' }, { quebra: true }, { quebra: true }, { texto: 'bem' }]);
  assert.equal(partes.map((p) => (p.quebra ? '\n' : p.texto)).join(''), 'Oi tudo\n\nbem');
});

// ---------------------------------------------------------------- simulações (Instagram falso)

/** Extensão com `antigos` seguidores já existentes (fora da extensão), linha de base gravada às ~05:00. */
async function comLinhaDeBase({ antigos = 30, configurar = () => {} } = {}) {
  const ig = criarInstagramFalso({ totalSeguidores: 20, voltaSe: () => false });
  ig.novosSeguidoresDeFora(antigos, 1); // seguidores antigos
  configurar(ig);
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, INICIO);
  await ext.avancarAte(INICIO + HORA); // 05:30 SP
  return { ig, cf, ext };
}

const dmsPara = (ig, id) => ig.dms.filter((d) => d.id === String(id)).length;

test('linha de base: seguidores antigos NUNCA recebem DM; cada novo seguidor recebe uma única vez', { timeout: 240_000 }, async () => {
  const { ig, ext } = await comLinhaDeBase({ antigos: 30 });
  let e = ext.estado();
  assert.ok(e.meusSeguidores.linhaDeBaseEm, 'linha de base gravada');
  assert.ok(e.historico.some((h) => /linha de base gravada/.test(h.resultado)));
  await ext.avancarAte(INICIO + 4 * HORA); // várias conferências (sem follow-back pendente: só a 1ª página)
  assert.equal(ig.dms.length, 0, 'nenhuma DM para os 30 antigos (nem pessoa2, que já me seguia)');
  e = ext.estado();
  assert.ok(Object.keys(e.meusSeguidores.conhecidos).length >= 12);

  ig.novosSeguidoresDeFora(2, Date.now());
  await ext.avancarAte(Date.now() + 30 * MINUTO);
  assert.equal(ig.dms.length, 2);
  assert.equal(dmsPara(ig, '900031'), 1);
  assert.equal(dmsPara(ig, '900032'), 1);
  e = ext.estado();
  assert.equal(e.novosSeguidores['900031'].origem, 'novo seguidor');
  assert.ok(e.novosSeguidores['900031'].dmEnviadaEm);
  assert.equal(e.contadores.novosSeguidores, 2);

  await ext.avancarAte(Date.now() + 2 * DIA);
  assert.equal(ig.dms.length, 2, 'dedupe persistente: nunca uma 2ª DM');
});

test('teto diário configurável: excedente fica para o dia seguinte; cada pessoa uma vez', { timeout: 240_000 }, async () => {
  const { ig, ext } = await comLinhaDeBase({ antigos: 10 });
  assert.equal((await ext.mensagem({ tipo: 'salvarConfig', config: { limiteDmDiario: 5 } })).ok, true);
  ig.novosSeguidoresDeFora(8, Date.now());
  await ext.avancarAte(INICIO + 17 * HORA); // 21:30 SP do 1º dia
  assert.equal(ig.dms.length, 5, 'no máximo 5 no dia');
  assert.ok(ext.estado().historico.some((h) => /teto diário de 5 boas-vindas atingido/.test(h.resultado)));
  await ext.avancarAte(INICIO + DIA + 17 * HORA);
  assert.equal(ig.dms.length, 8, 'as 3 restantes saem no dia seguinte');
  assert.equal(new Set(ig.dms.map((d) => d.id)).size, 8, 'uma por pessoa');
  const porDia = {};
  for (const d of ig.dms) porDia[diaSP(d.em)] = (porDia[diaSP(d.em)] || 0) + 1;
  assert.ok(Object.values(porDia).every((n) => n <= 5), JSON.stringify(porDia));
  const ordenadas = ig.dms.map((d) => d.em).sort((a, b) => a - b);
  for (let i = 1; i < ordenadas.length; i += 1) assert.ok(ordenadas[i] - ordenadas[i - 1] >= 60 * 1000, 'espaçamento mínimo entre DMs');
});

test('teto padrão 30/dia com 40 seguidores novos', { timeout: 240_000 }, async () => {
  const { ig, ext } = await comLinhaDeBase({ antigos: 10 });
  ig.novosSeguidoresDeFora(40, Date.now());
  await ext.avancarAte(INICIO + 17 * HORA);
  assert.equal(ig.dms.length, 30);
  assert.match(resumoBoasVindas(ext.estado()).texto, /30 enviadas hoje \(teto 30\/dia\), 10 pendentes/);
  await ext.avancarAte(INICIO + DIA + 17 * HORA);
  assert.equal(ig.dms.length, 40);
});

test('API de DM em HTML → enviada por digitação na tela da conversa, uma vez', { timeout: 240_000 }, async () => {
  const { ig, ext } = await comLinhaDeBase({ antigos: 10, configurar: (x) => { x.dmHtml = true; } });
  ig.novosSeguidoresDeFora(1, Date.now());
  await ext.avancarAte(Date.now() + DIA);
  assert.equal(ig.dms.length, 1);
  assert.equal(ig.dms[0].via, 'digitacao');
  assert.equal(ig.chamadas.filter((c) => c.caminho === BROADCAST).length, 1, 'tentou a API primeiro');
  const reg = ext.estado().novosSeguidores[ig.dms[0].id];
  assert.equal(reg.dmVia, 'digitacao');
  assert.ok(ext.estado().historico.some((h) => /boas-vindas enviada \(digitação na tela da DM\)/.test(h.resultado)));
});

test('digitação com Enter mas sem confirmação na tela = incerto, nunca reenvia', { timeout: 240_000 }, async () => {
  const { ig, ext } = await comLinhaDeBase({ antigos: 10, configurar: (x) => { x.dmHtml = true; x.dmTela.aparece = false; } });
  ig.novosSeguidoresDeFora(1, Date.now());
  await ext.avancarAte(Date.now() + 2 * DIA);
  assert.equal(ig.chamadas.filter((c) => c.caminho === 'apertarEnterNaPagina').length, 1, 'um único Enter');
  const e = ext.estado();
  const reg = Object.values(e.novosSeguidores)[0];
  assert.equal(reg.dmIncerta, true);
  assert.ok(!reg.dmEnviadaEm);
  assert.match(e.boasVindas.ultimoErro.texto, /incerto|não será repetida/);
});

test('follow-back de quem a extensão seguiu: uma única DM (não duplica como novo seguidor)', { timeout: 240_000 }, async () => {
  const ig = criarInstagramFalso({ totalSeguidores: 60, voltaSe: (n) => n === 1 });
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, INICIO);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(INICIO + 2 * DIA);
  const e = ext.estado();
  assert.equal(dmsPara(ig, '1001'), 1);
  assert.ok(e.seguidos['1001'].dmEnviadaEm);
  assert.equal(e.novosSeguidores['1001'], undefined);
  assert.equal(ig.dms.length, 1, 'pessoa2 (já me seguia) nunca recebe');
});

test('reabilitação na atualização: desistida por HTML (1.1.7) sai por digitação, uma vez; DM desligada não', { timeout: 240_000 }, async () => {
  const { ig, cf, ext } = await comLinhaDeBase({ antigos: 5, configurar: (x) => { x.dmHtml = true; } });
  const est = cf.dados.estado;
  const antes = Date.now() - DIA;
  est.seguidos['1005'] = { id: '1005', username: 'pessoa5', status: STATUS.SEGUIU_DE_VOLTA, seguidoEm: antes - DIA, followBackEm: antes, dmDesistiu: true, dmFalhas: 3 };
  est.seguidos['1006'] = { id: '1006', username: 'pessoa6', status: STATUS.SEGUIU_DE_VOLTA, seguidoEm: antes - DIA, followBackEm: antes, dmDesistiu: true };
  est.historico.push({ em: antes, username: 'pessoa5', acao: 'DM', resultado: 'não enviada após 3 tentativas (resposta HTML) — desistindo, alerta no popup' });
  delete est.reabilitacaoDmHtml; // como na 1ª execução da 1.1.8
  await ext.mensagem({ tipo: 'cicloAgora' });
  await ext.avancarAte(Date.now() + 2 * DIA);
  assert.equal(dmsPara(ig, '1005'), 1);
  assert.equal(ig.dms.find((d) => d.id === '1005').via, 'digitacao');
  assert.equal(dmsPara(ig, '1006'), 0, 'DM desligada não é reabilitada');
  const e = ext.estado();
  assert.ok(e.seguidos['1005'].dmReabilitadaEm);
});

test('1.1.10: broadcast recusado (404) + get_by_participants 404 em HTML → digitação (não "mudança de API")', async () => {
  const H404 = { status: 404, texto: '<!DOCTYPE html><html><head><title>Page Not Found &bull; Instagram</title></head></html>' };
  const { api, chamadas } = apiDm([H404, H404], () => ({ ok: true, confirmado: true, apertouEnter: true }));
  const r = await api.enviarDm('77', 'Oi', { username: 'fulano' });
  assert.equal(r.digitacao, true);
  assert.deepEqual(chamadas, [{ username: 'fulano', texto: 'Oi' }]);
});

test('1.1.10: broadcast recusado (400) e sem conversa existente → digitação', async () => {
  const { api } = apiDm([{ status: 400, texto: '{"status":"fail"}' }, { status: 200, texto: '{"status":"ok"}' }], () => ({ ok: true, confirmado: true, apertouEnter: true }));
  const r = await api.enviarDm('77', 'Oi', { username: 'fulano' });
  assert.equal(r.digitacao, true);
});
