// 1.1.9 — pedido do dono (26/10): "Ele deve puxar os últimos 3 dias hoje; depois ele puxa apenas até a última
// conferida." Carga única dos seguidores das últimas 72 h pela atividade do Instagram (com data); sem a fonte com data,
// ninguém recebe DM por ela. Tudo com Instagram FALSO (tests/ajuda/simulador.mjs) — nenhuma DM real.
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { DIA, HORA, MINUTO, diaSP } from '../lib/tempo.js';
import { STATUS } from '../lib/regras.js';
import { estadoInicial, resumoCargaTresDias } from '../lib/estado.js';
import { interpretarAtividade, separarCarga, timestampParaMs, registroDaCarga, CARGA_JANELA_MS } from '../lib/carga-tres-dias.js';
import { criarApiInstagram, ErroInstagram } from '../instagram-api.js';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';

afterEach(() => mock.timers.reset());

const CFG = estadoInicial().config;
const INICIO = Date.parse('2026-10-20T07:30:00Z'); // 04:30 SP (fora da janela)
const INBOX = '/api/v1/news/inbox/';

/** Notificação "começou a seguir você" no formato do news/inbox (timestamp em segundos). */
const seguiu = (id, username, emMs) => ({ story_type: 101, type: 3, args: { text: `${username} começou a seguir você.`, profile_id: Number(id), profile_name: username, timestamp: emMs / 1000 } });
const curtiu = (id, emMs) => ({ story_type: 60, type: 1, args: { text: 'fulano curtiu sua foto.', profile_id: Number(id), profile_name: 'fulano', timestamp: emMs / 1000 } });

// ---------------------------------------------------------------- regras puras

test('timestamp: segundos, ms e µs viram ms; lixo vira null', () => {
  const t = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(timestampParaMs(t / 1000), t);
  assert.equal(timestampParaMs(String(t / 1000)), t);
  assert.equal(timestampParaMs(t), t);
  assert.equal(timestampParaMs(t * 1000), t);
  for (const v of [null, undefined, '', 'ontem', 0, -5, 12345, NaN]) assert.equal(timestampParaMs(v), null, String(v));
});

test('interpretarAtividade: só "começou a seguir você" com data ≥ agora − 72 h', () => {
  const agora = Date.parse('2026-10-26T14:00:00Z');
  const desde = agora - CARGA_JANELA_MS;
  const r = interpretarAtividade({
    new_stories: [seguiu('11', 'novo1', agora - HORA)],
    old_stories: [
      seguiu('12', 'limite', desde), // exatamente 72 h: entra
      seguiu('13', 'velho', desde - 1), // 72 h e 1 ms: fora
      seguiu('14', 'muito_velho', agora - 10 * DIA),
      curtiu('15', agora - HORA), // não é follow
      { story_type: 101, args: { text: 'ana, bia e mais 5 começaram a seguir você.', profile_id: 16, profile_ids: [16, 17], timestamp: (agora - HORA) / 1000 } },
      { story_type: 101, args: { text: 'carla started following you.', profile_id: 18, profile_name: 'carla' } }, // sem data
      { args: { notif_name: 'user_followed', text: '', profile_id: '19', profile_name: 'dani', timestamp: (agora - 2 * HORA) / 1000 } },
      seguiu('999', 'eu', agora - HORA), // eu mesmo
    ],
  }, { agora, desde, meuId: '999' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.eventos.map((x) => x.id).sort(), ['11', '12', '19']);
  assert.equal(r.agrupados, 1);
  assert.equal(r.semData, 1);
  assert.equal(r.eventos.find((x) => x.id === '11').username, 'novo1');
  assert.ok(r.maisAntigoEm < desde);
});

test('interpretarAtividade: resposta sem a lista de notificações = indisponível (nunca chutar)', () => {
  const o = { agora: Date.now(), desde: Date.now() - CARGA_JANELA_MS };
  for (const j of [null, 'texto', [], { status: 'ok' }, { counts: {}, stories: 'x' }]) {
    const r = interpretarAtividade(j, o);
    assert.equal(r.ok, false, JSON.stringify(j));
    assert.ok(r.motivo);
  }
});

test('separarCarga: dedupe por id, quem já tem boas-vindas fica de fora, seguido pela extensão vai para follow-back', () => {
  const e = estadoInicial();
  e.novosSeguidores = { 2: { id: '2', dmEnviadaEm: 1 } };
  e.seguidos = { 3: { id: '3', status: STATUS.SEGUINDO }, 4: { id: '4', status: STATUS.SEGUIU_DE_VOLTA, followBackEm: 1, dmEnviadaEm: 1 } };
  const r = separarCarga(e, [{ id: '1', username: 'a', em: 20 }, { id: '1', username: 'a', em: 10 }, { id: '2', em: 5 }, { id: '3', em: 6 }, { id: '4', em: 7 }, { id: '5', em: 1 }]);
  assert.deepEqual(r.encontrados.map((u) => u.id), ['5', '2', '3', '4', '1'], 'únicos, do mais antigo para o mais recente');
  assert.deepEqual(r.novos.map((u) => u.id), ['5', '1']);
  assert.deepEqual(r.followBack, ['3']);
  assert.equal(r.jaTinham, 2);
  const reg = registroDaCarga(r.novos[1], Date.parse('2026-10-26T15:00:00Z'), CFG, 1, () => 0);
  assert.equal(reg.origem, 'carga 3 dias');
  assert.equal(reg.dmAgendadaPara, Date.parse('2026-10-26T15:00:00Z') + MINUTO + 2 * MINUTO);
});

test('resumoCargaTresDias: pendente, feita e indisponível', () => {
  const e = estadoInicial();
  assert.match(resumoCargaTresDias(e), /^Carga 3 dias: ainda não feita/);
  e.carga3Dias = { feitaEm: Date.parse('2026-10-26T14:00:00Z'), encontrados: 12, agendados: 10, notas: ['2 já tinham boas-vindas'] };
  assert.match(resumoCargaTresDias(e), /^Carga 3 dias: 12 encontrados, 10 agendados em 26\/10\/2026 11:00 \(2 já tinham boas-vindas\)$/);
  e.carga3Dias = { feitaEm: 1, erro: 'respondeu a página HTML' };
  assert.equal(resumoCargaTresDias(e), 'Carga dos últimos 3 dias indisponível: respondeu a página HTML');
});

// ---------------------------------------------------------------- API

const HTML = { status: 200, texto: '<!DOCTYPE html><html><head><title>Instagram</title></head></html>' };
function apiCom(respostas) {
  const pedidos = [];
  const api = criarApiInstagram({ obterCsrf: async () => 'tok', executar: async (x) => { pedidos.push(x); return respostas.shift(); } });
  return { api, pedidos };
}

test('api.atividade: HTML no GET e no POST = indisponivel; GET em HTML e POST com JSON = dados; aguarde sobe', async () => {
  const a = apiCom([HTML, { status: 404, texto: '<html>not found</html>' }]);
  await assert.rejects(a.api.atividade(), (e) => e instanceof ErroInstagram && e.tipo === 'indisponivel' && /news\/inbox/.test(e.message));
  assert.deepEqual(a.pedidos.map((p) => p.metodo), ['GET', 'POST']);
  assert.match(a.pedidos[0].url, /mark_as_seen=false/);
  const b = apiCom([HTML, { status: 200, texto: '{"old_stories":[],"status":"ok"}' }]);
  assert.deepEqual(await b.api.atividade(), { old_stories: [], status: 'ok' });
  const c = apiCom([{ status: 400, texto: '{"message":"Please wait a few minutes before you try again.","status":"fail"}' }]);
  await assert.rejects(c.api.atividade(), (e) => e.tipo === 'aguarde');
});

// ---------------------------------------------------------------- simulações (Instagram falso)

/**
 * Como o dono: 1.1.8 instalada (linha de base gravada às ~05:00), atualiza para a 1.1.9. A 1ª conferência da 1.1.8
 * no simulador já rodaria a carga (a atividade não existe → indisponível); apagamos a marca para simular a
 * atualização e então ligamos a atividade.
 */
async function atualizadoDa118({ antigos = 20, atividade }) {
  const ig = criarInstagramFalso({ totalSeguidores: 20, voltaSe: () => false });
  ig.novosSeguidoresDeFora(antigos, 1);
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, INICIO);
  await ext.avancarAte(INICIO + HORA); // 05:30 SP
  assert.ok(ext.estado().meusSeguidores.linhaDeBaseEm, 'linha de base da 1.1.8 gravada');
  assert.equal(ig.dms.length, 0);
  delete cf.dados.estado.carga3Dias; // estado como o da 1.1.8 (sem a marca da carga)
  ig.atividade = typeof atividade === 'function' ? atividade(Date.now()) : atividade;
  return { ig, cf, ext };
}

const chamadasInbox = (ig) => ig.chamadas.filter((c) => c.caminho === INBOX).length;

test('carga 3 dias: só quem seguiu nas últimas 72 h recebe, uma vez; roda uma única vez', { timeout: 240_000 }, async () => {
  const { ig, ext } = await atualizadoDa118({
    atividade: (agora) => ({
      modo: 'ok',
      porPagina: 4, // força paginação
      historias: [
        seguiu('70001', 'r1', agora - 1 * HORA),
        curtiu('70009', agora - 2 * HORA),
        seguiu('70002', 'r2', agora - 30 * HORA),
        seguiu('70001', 'r1', agora - 31 * HORA), // mesma pessoa de novo (seguiu, saiu, voltou)
        seguiu('70003', 'r3', agora - 70 * HORA),
        seguiu('70004', 'velho1', agora - 74 * HORA),
        seguiu('70005', 'velho2', agora - 5 * DIA),
        seguiu('70006', 'velho3', agora - 9 * DIA),
        seguiu('70007', 'velho4', agora - 20 * DIA),
      ],
    }),
  });
  await ext.avancarAte(Date.now() + 2 * HORA);
  let e = ext.estado();
  assert.ok(e.carga3Dias.feitaEm, 'carga feita');
  assert.equal(e.carga3Dias.encontrados, 3);
  assert.equal(e.carga3Dias.agendados, 3);
  assert.equal(e.carga3Dias.erro, null);
  assert.equal(e.carga3Dias.tentativas, 1);
  assert.equal(e.novosSeguidores['70001'].origem, 'carga 3 dias');
  assert.deepEqual(ig.dms.map((d) => d.id).sort(), ['70001', '70002', '70003']);
  assert.equal(ig.dms.length, 3, 'uma DM por pessoa');
  assert.ok(!ig.dms.some((d) => ['70004', '70005', '70006', '70007', '70009'].includes(d.id)), 'nada para quem seguiu antes de 72 h');
  const ordenadas = ig.dms.map((d) => d.em).sort((a, b) => a - b);
  for (let i = 1; i < ordenadas.length; i += 1) assert.ok(ordenadas[i] - ordenadas[i - 1] >= 60 * 1000, 'espaçamento mínimo entre DMs');
  assert.match(resumoCargaTresDias(e), /^Carga 3 dias: 3 encontrados, 3 agendados/);
  assert.ok(e.historico.some((h) => h.acao === 'carga 3 dias' && /3 encontrados, 3 agendados/.test(h.resultado)));

  // Depois: só os novos desde a última conferida (1.1.8). A carga não roda de novo, mesmo com notificações novas.
  const lidas = chamadasInbox(ig);
  ig.atividade.historias.unshift(seguiu('70008', 'r8', Date.now()));
  await ext.avancarAte(Date.now() + 3 * DIA);
  assert.equal(chamadasInbox(ig), lidas, 'a atividade não é lida de novo');
  assert.equal(ig.dms.length, 3, 'a carga não roda de novo');
  ig.novosSeguidoresDeFora(1, Date.now());
  await ext.avancarAte(Date.now() + HORA);
  assert.equal(ig.dms.length, 4, 'seguidor novo daqui para frente continua recebendo (1.1.8)');
  e = ext.estado();
  assert.equal(e.carga3Dias.tentativas, 1);
});

test('carga 3 dias: dedupe — quem já tem (ou vai ter) boas-vindas não recebe 2ª DM', { timeout: 240_000 }, async () => {
  const { ig, cf, ext } = await atualizadoDa118({ atividade: (agora) => ({ modo: 'ok', historias: [seguiu('900001', 'x900001', agora - HORA), seguiu('71000', 'nova', agora - 2 * HORA)] }) });
  cf.dados.estado.novosSeguidores['900001'] = { id: '900001', username: 'x900001', origem: 'novo seguidor', dmEnviadaEm: Date.now() - HORA };
  await ext.avancarAte(Date.now() + DIA);
  const e = ext.estado();
  assert.equal(e.carga3Dias.encontrados, 2);
  assert.equal(e.carga3Dias.agendados, 1);
  assert.ok(e.carga3Dias.notas.some((n) => /1 já tinham boas-vindas/.test(n)));
  assert.deepEqual(ig.dms.map((d) => d.id), ['71000']);
});

for (const [nome, atividade, motivo] of [
  ['página HTML', { modo: 'html' }, /news\/inbox.*indisponível.*HTML/],
  ['sem a lista de notificações', { modo: 'sem_lista' }, /não tem a lista de notificações/],
  ['endpoint inexistente (404)', null, /indisponível/],
  ['notificações sem data', { modo: 'ok', historias: [{ story_type: 101, args: { text: 'a começou a seguir você.', profile_id: 72001, profile_name: 'a' } }] }, /sem data confirmável/],
]) {
  test(`carga 3 dias indisponível (${nome}): nenhuma DM por ela, motivo no popup, novos daqui para frente seguem`, { timeout: 240_000 }, async () => {
    const { ig, ext } = await atualizadoDa118({ atividade });
    await ext.avancarAte(Date.now() + DIA);
    let e = ext.estado();
    assert.equal(ig.dms.length, 0, 'nunca DM em lote');
    assert.ok(e.carga3Dias.feitaEm);
    assert.match(resumoCargaTresDias(e), /^Carga dos últimos 3 dias indisponível: /);
    assert.match(e.carga3Dias.erro, motivo);
    assert.equal(e.pausaAte, null, 'não pausa');
    const lidas = chamadasInbox(ig);
    ig.novosSeguidoresDeFora(1, Date.now());
    await ext.avancarAte(Date.now() + DIA);
    assert.equal(ig.dms.length, 1, 'o seguidor novo recebe pelo fluxo da 1.1.8');
    assert.equal(chamadasInbox(ig), lidas, 'não tenta a carga de novo');
    e = ext.estado();
    assert.equal(Object.values(e.novosSeguidores).filter((r) => r.origem === 'carga 3 dias').length, 0);
  });
}

test('carga 3 dias: "aguarde" do Instagram → tenta de novo depois (uma carga só), sem perder ninguém', { timeout: 240_000 }, async () => {
  const { ig, ext } = await atualizadoDa118({ atividade: (agora) => ({ modo: 'ok', falhasAguarde: 1, historias: [seguiu('73001', 'a', agora - 10 * HORA)] }) });
  await ext.avancarAte(Date.now() + 10 * MINUTO);
  let e = ext.estado();
  assert.equal(e.carga3Dias.feitaEm, undefined, 'ainda não feita');
  assert.match(resumoCargaTresDias(e), /tentativa 1 falhou/);
  await ext.avancarAte(Date.now() + 2 * HORA);
  e = ext.estado();
  assert.ok(e.carga3Dias.feitaEm);
  assert.equal(e.carga3Dias.tentativas, 2);
  assert.equal(e.carga3Dias.agendados, 1);
  assert.deepEqual(ig.dms.map((d) => d.id), ['73001']);
});

test('carga 3 dias: teto diário (30) — 40 na carga, 30 no dia e o resto no dia seguinte', { timeout: 240_000 }, async () => {
  const { ig, ext } = await atualizadoDa118({
    atividade: (agora) => ({ modo: 'ok', historias: Array.from({ length: 40 }, (_, i) => seguiu(String(74000 + i), `c${i}`, agora - (i + 1) * HORA)) }),
  });
  await ext.avancarAte(INICIO + 17 * HORA); // 21:30 SP do 1º dia
  assert.equal(ext.estado().carga3Dias.agendados, 40);
  assert.equal(ig.dms.length, 30, 'no máximo 30 no dia');
  await ext.avancarAte(INICIO + DIA + 17 * HORA);
  assert.equal(ig.dms.length, 40);
  assert.equal(new Set(ig.dms.map((d) => d.id)).size, 40, 'uma por pessoa');
  const porDia = {};
  for (const d of ig.dms) porDia[diaSP(d.em)] = (porDia[diaSP(d.em)] || 0) + 1;
  assert.ok(Object.values(porDia).every((n) => n <= 30), JSON.stringify(porDia));
});

test('carga 3 dias numa instalação nova: roda junto com a linha de base, só os das 72 h', { timeout: 240_000 }, async () => {
  const ig = criarInstagramFalso({ totalSeguidores: 20, voltaSe: () => false });
  ig.novosSeguidoresDeFora(15, 1);
  ig.atividade = { modo: 'ok', historias: [seguiu('75001', 'n', INICIO - 5 * HORA), seguiu('75002', 'v', INICIO - 4 * DIA)] };
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, INICIO);
  await ext.avancarAte(INICIO + DIA);
  assert.deepEqual(ig.dms.map((d) => d.id), ['75001']);
  assert.ok(ext.estado().meusSeguidores.linhaDeBaseEm);
});
