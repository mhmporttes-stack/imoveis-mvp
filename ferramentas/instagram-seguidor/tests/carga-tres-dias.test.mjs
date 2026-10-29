// 1.1.9 — pedido do dono (26/10): "Ele deve puxar os últimos 3 dias hoje; depois ele puxa apenas até a última
// conferida." Carga única dos seguidores das últimas 72 h pela atividade do Instagram (com data); sem a fonte com data,
// ninguém recebe DM por ela. Tudo com Instagram FALSO (tests/ajuda/simulador.mjs) — nenhuma DM real.
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { DIA, HORA, MINUTO, diaSP } from '../lib/tempo.js';
import { STATUS } from '../lib/regras.js';
import { estadoInicial, resumoCargaTresDias } from '../lib/estado.js';
import { interpretarAtividade, separarCarga, timestampParaMs, registroDaCarga, CARGA_JANELA_MS } from '../lib/carga-tres-dias.js';
import { ErroInstagram } from '../instagram-tela.js';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';

afterEach(() => mock.timers.reset());

const CFG = estadoInicial().config;
const INICIO = Date.parse('2026-10-20T07:30:00Z'); // 04:30 SP (fora da janela)

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

// ---------------------------------------------------------------- 1.2.0: só pela tela

// A carga lia a atividade pela API interna do Instagram (news/inbox), que a extensão não usa mais (decisão do dono,
// 29/10/2026). As regras puras acima ficam (lib/carga-tres-dias.js), sem uso pela extensão. Instalação que ainda não
// fez a carga: marcada como indisponível, ninguém recebe DM por ela; os seguidores novos seguem normalmente.
test('1.2.0: carga ainda não feita vira "indisponível" na 1ª conferência — nenhuma DM por ela, nenhuma API', { timeout: 240_000 }, async () => {
  const ig = criarInstagramFalso({ totalSeguidores: 10, voltaSe: () => false });
  ig.novosSeguidoresDeFora(5, 1);
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, INICIO);
  await ext.avancarAte(INICIO + 2 * HORA); // 06:30 SP: conferências dentro da janela
  const e = ext.estado();
  assert.ok(e.carga3Dias && e.carga3Dias.feitaEm);
  assert.match(resumoCargaTresDias(e), /^Carga dos últimos 3 dias indisponível: desde a versão 1\.2\.0/);
  assert.equal(ig.dms.length, 0);
  assert.ok(cf.registro.funcoes.every((n) => /NaPagina$/.test(n)));
  void DIA; void MINUTO; void diaSP; void STATUS; void ErroInstagram;
});
