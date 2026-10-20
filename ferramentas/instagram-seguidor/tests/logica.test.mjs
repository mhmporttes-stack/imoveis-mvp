// Testes da lógica pura (sem Chrome e sem Instagram).
import test from 'node:test';
import assert from 'node:assert/strict';

import { MINUTO, HORA, DIA, tsHoraSP, diaSP, janelaDoDia, dentroDaJanela, proximaAbertura, formatarSP, partesSP } from '../lib/tempo.js';
import { planejarHorarios, decidirHorario, atrasoDmMs, atrasoHumanoMs } from '../lib/agenda.js';
import {
  MENSAGEM_PADRAO, STATUS, filtrarCandidatos, semFoto, elegivelParaUnfollow, escolherParaUnfollow,
  registrarFollowBack, ajustarParaJanela, dmPronta, classificarErro, aplicarPausaPorErro, estaAtiva, PAUSA_POR_LIMITE_MS,
} from '../lib/regras.js';
import { decidirPausa, trechoSeguro } from '../lib/regras.js';
import { estadoInicial, normalizarEstado, virarDiaSeNecessario, gerarCsv, registrarHistorico } from '../lib/estado.js';

const CFG = { inicioHora: 5, fimHora: 22 };
const T0 = Date.parse('2026-10-20T12:00:00Z'); // 09:00 em São Paulo

function semente(s = 42) {
  // Gerador determinístico (mulberry32) para os testes.
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ tempo
test('janela 05:00–22:00 no fuso de São Paulo (UTC-3)', () => {
  const { inicio, fim } = janelaDoDia(T0, CFG);
  assert.equal(new Date(inicio).toISOString(), '2026-10-20T08:00:00.000Z');
  assert.equal(new Date(fim).toISOString(), '2026-10-21T01:00:00.000Z');
  assert.equal(diaSP(Date.parse('2026-10-21T02:30:00Z')), '2026-10-20'); // 23:30 SP ainda é dia 20
  assert.equal(dentroDaJanela(Date.parse('2026-10-20T07:59:59Z'), CFG), false); // 04:59:59
  assert.equal(dentroDaJanela(Date.parse('2026-10-20T08:00:00Z'), CFG), true); // 05:00
  assert.equal(dentroDaJanela(Date.parse('2026-10-21T01:00:00Z'), CFG), false); // 22:00
  assert.equal(formatarSP(Date.parse('2026-10-20T08:03:09Z')), '20/10/2026 05:03:09');
});

test('próxima abertura: antes, durante e depois da janela', () => {
  assert.equal(proximaAbertura(Date.parse('2026-10-20T06:00:00Z'), CFG), Date.parse('2026-10-20T08:00:00Z'));
  assert.equal(proximaAbertura(T0, CFG), T0);
  assert.equal(proximaAbertura(Date.parse('2026-10-21T01:30:00Z'), CFG), Date.parse('2026-10-21T08:00:00Z'));
  // Virada de mês/ano
  assert.equal(proximaAbertura(Date.parse('2027-01-01T02:00:00Z'), CFG), Date.parse('2027-01-01T08:00:00Z'));
});

// ------------------------------------------------------------------ agenda
test('agenda: 15 seguir por dia, todos dentro de 05–22h, intervalo ~68 min ±10%', () => {
  const { inicio, fim } = janelaDoDia(T0, CFG);
  const base = (fim - inicio) / 15;
  assert.ok(Math.abs(base - 68 * MINUTO) < MINUTO);
  for (let s = 1; s <= 300; s += 1) {
    const h = planejarHorarios({ inicio, fim, quantidade: 15, rand: semente(s) });
    assert.equal(h.length, 15);
    assert.ok(h[0] >= inicio && h[0] <= inicio + 2 * MINUTO, 'primeiro às 05:00 (até 2 min de oscilação)');
    assert.ok(h[14] < fim, 'último antes das 22:00');
    for (let i = 1; i < h.length; i += 1) {
      const gap = h[i] - h[i - 1];
      assert.ok(gap <= base * 1.1 + 1000, `intervalo ${gap / MINUTO} min acima de +10%`);
      assert.ok(gap >= base * 0.85, `intervalo ${gap / MINUTO} min abaixo do esperado`);
    }
  }
});

test('agenda: oscilação realmente varia os intervalos', () => {
  const { inicio, fim } = janelaDoDia(T0, CFG);
  const h = planejarHorarios({ inicio, fim, quantidade: 15, rand: semente(7) });
  const gaps = new Set(h.slice(1).map((t, i) => Math.round((t - h[i]) / 1000)));
  assert.ok(gaps.size > 10);
});

test('agenda: limite configurável e "deixar de seguir" intercalado', () => {
  const { inicio, fim } = janelaDoDia(T0, CFG);
  assert.equal(planejarHorarios({ inicio, fim, quantidade: 10, rand: semente(3) }).length, 10);
  assert.deepEqual(planejarHorarios({ inicio, fim, quantidade: 0 }), []);
  const u = planejarHorarios({ inicio, fim, quantidade: 15, deslocamento: 0.5, rand: semente(3) });
  assert.ok(u[0] >= inicio + 30 * MINUTO && u[0] < inicio + 40 * MINUTO);
  assert.ok(u.every((t) => t < fim));
});

test('agenda: replanejar no fim do dia nunca vira rajada (intervalo mínimo 20 min)', () => {
  const fim = janelaDoDia(T0, CFG).fim;
  const agora = fim - 90 * MINUTO; // 20:30, faltando 12 ações
  const h = planejarHorarios({ inicio: agora, fim, quantidade: 12, intervaloMinimoMs: 20 * MINUTO, rand: semente(9) });
  assert.equal(h.length, 4); // 90 min / 20 min
  for (let i = 1; i < h.length; i += 1) assert.ok(h[i] - h[i - 1] >= 20 * MINUTO * 0.85);
  assert.ok(h.every((t) => t >= agora && t < fim));
});

test('decidirHorario: aguardar / executar / replanejar', () => {
  assert.equal(decidirHorario([], T0), 'nada');
  assert.equal(decidirHorario([T0 + 1000], T0), 'aguardar');
  assert.equal(decidirHorario([T0 - 3 * MINUTO], T0), 'executar');
  assert.equal(decidirHorario([T0 - 2 * HORA], T0), 'replanejar');
});

test('atrasos: humano 1–4 s e DM 1–3 min', () => {
  for (let i = 0; i < 2000; i += 1) {
    const h = atrasoHumanoMs();
    assert.ok(h >= 1000 && h <= 4000);
    const d = atrasoDmMs();
    assert.ok(d >= 60_000 && d <= 180_000);
  }
  assert.equal(atrasoDmMs(() => 0), 60_000);
  assert.equal(atrasoDmMs(() => 1), 180_000);
});

// ------------------------------------------------------------------ fila / dedupe
test('filtrarCandidatos: dedupe, privados, sem foto, eu mesmo, já seguidos', () => {
  const usuarios = [
    { pk: 1, username: 'a', profile_pic_url: 'https://x/foto.jpg' },
    { pk: 1, username: 'a', profile_pic_url: 'https://x/foto.jpg' }, // repetido na página
    { pk: 2, username: 'b', is_private: true, profile_pic_url: 'https://x/f.jpg' },
    { pk: 3, username: 'c', has_anonymous_profile_picture: true, profile_pic_url: 'https://x/f.jpg' },
    { pk: 4, username: 'd', profile_pic_url: 'https://x/f.jpg' }, // já na fila
    { pk: 5, username: 'e', profile_pic_url: 'https://x/f.jpg' }, // já seguido antes
    { pk: 6, username: 'f', profile_pic_url: 'https://x/f.jpg' }, // já avaliado (pulado antes)
    { pk: 99, username: 'eu', profile_pic_url: 'https://x/f.jpg' },
    { pk: 7, username: 'g', profile_pic_url: 'https://x/f.jpg', friendship_status: { followed_by: true } },
  ];
  const r = filtrarCandidatos(usuarios, {
    meuId: '99',
    fila: [{ id: '4' }],
    seguidos: { 5: { id: '5' } },
    vistos: { 6: 'privado' },
    pularPrivados: true,
    pularSemFoto: true,
    origem: '@ref',
    agora: T0,
  });
  assert.deepEqual(r.aceitos.map((x) => x.id), ['1']);
  assert.equal(r.aceitos[0].origem, '@ref');
  assert.deepEqual(r.pulados, { ja_na_fila: 2, privado: 1, sem_foto: 1, ja_seguido_antes: 1, ja_avaliado: 1, eu_mesmo: 1, ja_relacionado: 1 });

  const r2 = filtrarCandidatos(usuarios, { meuId: '99', pularPrivados: false, pularSemFoto: false });
  assert.ok(r2.aceitos.some((x) => x.id === '2'));
  assert.ok(r2.aceitos.some((x) => x.id === '3'));
});

test('semFoto reconhece o avatar padrão do Instagram', () => {
  assert.equal(semFoto({ profile_pic_url: 'https://cdn/44884218_345707102882519_2446069589734326272_n.jpg' }), true);
  assert.equal(semFoto({ profile_pic_url: 'https://cdn/real.jpg' }), false);
  assert.equal(semFoto({}), true);
});

// ------------------------------------------------------------------ regra dos 3 dias
test('regra dos 3 dias: só quem a extensão seguiu, sem follow-back, após 3 dias', () => {
  const seguidoEm = T0;
  const r = { id: '1', seguidoEm, status: STATUS.SEGUINDO };
  assert.equal(elegivelParaUnfollow(r, seguidoEm + 3 * DIA - 1, 3), false);
  assert.equal(elegivelParaUnfollow(r, seguidoEm + 3 * DIA, 3), true);
  assert.equal(elegivelParaUnfollow({ ...r, status: STATUS.SOLICITADO }, seguidoEm + 3 * DIA, 3), true);
  assert.equal(elegivelParaUnfollow({ ...r, followBackEm: seguidoEm + DIA }, seguidoEm + 4 * DIA, 3), false);
  assert.equal(elegivelParaUnfollow({ ...r, status: STATUS.SEGUIU_DE_VOLTA }, seguidoEm + 4 * DIA, 3), false);
  assert.equal(elegivelParaUnfollow({ ...r, status: STATUS.DEIXADO }, seguidoEm + 4 * DIA, 3), false);
  assert.equal(elegivelParaUnfollow({ id: '9', status: STATUS.SEGUINDO }, seguidoEm + 9 * DIA, 3), false); // sem seguidoEm
  assert.equal(elegivelParaUnfollow(undefined, T0, 3), false);
});

test('escolherParaUnfollow pega o mais antigo e respeita exclusões', () => {
  const seguidos = {
    a: { id: 'a', seguidoEm: T0 - 5 * DIA, status: STATUS.SEGUINDO },
    b: { id: 'b', seguidoEm: T0 - 6 * DIA, status: STATUS.SEGUIU_DE_VOLTA, followBackEm: T0 - 5 * DIA },
    c: { id: 'c', seguidoEm: T0 - 4 * DIA, status: STATUS.SEGUINDO },
    d: { id: 'd', seguidoEm: T0 - DIA, status: STATUS.SEGUINDO },
  };
  assert.equal(escolherParaUnfollow(seguidos, T0, 3).id, 'a');
  assert.equal(escolherParaUnfollow(seguidos, T0, 3, new Set(['a'])).id, 'c');
  assert.equal(escolherParaUnfollow(seguidos, T0, 3, new Set(['a', 'c'])), null);
  assert.equal(escolherParaUnfollow({}, T0, 3), null);
});

// ------------------------------------------------------------------ DM
test('mensagem padrão exata (quebras de linha e emojis)', () => {
  assert.ok(MENSAGEM_PADRAO.startsWith('Que bom ter você por aqui! 🙌🏼\n\nPode ficar em paz'));
  assert.ok(MENSAGEM_PADRAO.endsWith('dor de cabeça.\n\nConte comigo! 😊'));
  assert.equal(MENSAGEM_PADRAO.split('\n').length, 11);
});

test('follow-back dentro da janela: DM agendada 1–3 min depois, uma única vez', () => {
  for (let s = 1; s <= 200; s += 1) {
    const r = { id: '1', status: STATUS.SEGUINDO, seguidoEm: T0 - HORA };
    assert.equal(registrarFollowBack(r, T0, CFG, semente(s)), true);
    assert.equal(r.status, STATUS.SEGUIU_DE_VOLTA);
    const atraso = r.dmAgendadaPara - T0;
    assert.ok(atraso >= MINUTO && atraso <= 3 * MINUTO, `atraso ${atraso}`);
    const antes = r.dmAgendadaPara;
    assert.equal(registrarFollowBack(r, T0 + 10 * MINUTO, CFG, semente(s + 1)), false); // idempotente
    assert.equal(r.dmAgendadaPara, antes);
  }
});

test('follow-back perto das 22h: DM vai para a próxima abertura (05:00 + 1–3 min)', () => {
  const fim = janelaDoDia(T0, CFG).fim;
  const r = { id: '1', status: STATUS.SEGUINDO, seguidoEm: T0 };
  registrarFollowBack(r, fim - 30 * 1000, CFG, () => 0.5); // 21:59:30 + 2 min = 22:01:30 → fora
  const amanha = Date.parse('2026-10-21T08:00:00Z');
  assert.ok(r.dmAgendadaPara >= amanha + MINUTO && r.dmAgendadaPara <= amanha + 3 * MINUTO);
  assert.equal(ajustarParaJanela(T0, T0, CFG), T0);
});

test('dmPronta: nunca duas vezes, nunca fora da janela', () => {
  const r = { id: '1', dmAgendadaPara: T0 };
  assert.equal(dmPronta(r, T0 - 1, CFG), false);
  assert.equal(dmPronta(r, T0, CFG), true);
  assert.equal(dmPronta({ ...r, dmEnviadaEm: T0 }, T0 + MINUTO, CFG), false);
  assert.equal(dmPronta({ ...r, dmTentativaEm: T0 }, T0 + MINUTO, CFG), false);
  assert.equal(dmPronta({ ...r, dmDesistiu: true }, T0 + MINUTO, CFG), false);
  const noite = Date.parse('2026-10-21T02:00:00Z'); // 23:00 SP
  assert.equal(dmPronta({ id: '1', dmAgendadaPara: noite - HORA }, noite, CFG), false);
});

// ------------------------------------------------------------------ erros / pausa
test('classificarErro reconhece limite, bloqueio, sessão e mudança de API', () => {
  assert.equal(classificarErro({ status: 200, corpo: '{"status":"ok"}' }), null);
  assert.equal(classificarErro({ status: 429, corpo: '' }), 'limite');
  assert.equal(classificarErro({ status: 400, corpo: '{"message":"feedback_required","spam":true}' }), 'limite');
  assert.equal(classificarErro({ status: 400, corpo: '{"message":"challenge_required"}' }), 'limite');
  assert.equal(classificarErro({ status: 400, corpo: '{"message":"checkpoint_required"}' }), 'limite');
  // Caso real do 1º uso: "Please wait" JUNTO com require_login é SESSÃO, não bloqueio.
  assert.equal(classificarErro({ status: 400, corpo: '{"message":"Please wait a few minutes before you try again.","require_login":true,"status":"fail"}' }), 'sessao');
  assert.equal(classificarErro({ status: 400, corpo: '{"message":"Please wait a few minutes before you try again.","status":"fail"}' }), 'aguarde');
  assert.equal(classificarErro({ status: 400, corpo: '{"message": "x", "spam": true}' }), 'limite');
  assert.equal(classificarErro({ status: 200, corpo: '{"status":"ok","spam":false}' }), null);
  assert.equal(classificarErro({ status: 401, corpo: '{"message":"login_required"}' }), 'sessao');
  assert.equal(classificarErro({ status: 400, corpo: '{"message":"login_required","spam":true}' }), 'sessao');
  assert.equal(classificarErro({ status: 404, corpo: '<html>' }), 'mudanca_api');
  assert.equal(classificarErro({ status: 200, corpo: '<!DOCTYPE html>' }), 'mudanca_api');
  assert.equal(classificarErro({ status: 404, corpo: '{"message":"User not found"}' }), 'nao_encontrado');
  assert.equal(classificarErro({ status: 500, corpo: '' }), 'outro');
});

test('pausa automática de 24 h por limite e pausa sem sessão', () => {
  const e = estadoInicial();
  aplicarPausaPorErro(e, 'limite', T0, 'feedback_required');
  assert.equal(e.pausaAte, T0 + PAUSA_POR_LIMITE_MS);
  assert.equal(PAUSA_POR_LIMITE_MS, 24 * HORA);
  assert.match(e.alerta.texto, /24 h/);
  assert.equal(estaAtiva(e, { pausado: false }, T0 + HORA), false);
  assert.equal(estaAtiva(e, { pausado: false }, T0 + 24 * HORA), true);
  // Nova pausa nunca encurta a anterior
  aplicarPausaPorErro(e, 'limite', T0 - HORA);
  assert.equal(e.pausaAte, T0 + PAUSA_POR_LIMITE_MS);

  const e2 = estadoInicial();
  aplicarPausaPorErro(e2, 'sessao', T0);
  assert.equal(e2.semSessao, true);
  assert.equal(estaAtiva(e2, { pausado: false }, T0), false);
  assert.equal(estaAtiva(estadoInicial(), { pausado: true }, T0), false);
  assert.equal(estaAtiva(estadoInicial(), { pausado: false }, T0), true);
});

// ------------------------------------------------------------------ estado / CSV
test('contadores zeram na virada do dia (SP) e estado antigo é normalizado', () => {
  const e = normalizarEstado({ contadores: { dia: '2026-10-19', seguidos: 15 } });
  assert.equal(e.config.limiteDiario, 15);
  assert.equal(e.config.pularPrivados, true);
  assert.equal(virarDiaSeNecessario(e, T0), true);
  assert.equal(e.contadores.seguidos, 0);
  assert.equal(virarDiaSeNecessario(e, T0 + HORA), false);
});

test('CSV com BOM, ";" e aspas escapadas', () => {
  const e = estadoInicial();
  registrarHistorico(e, { em: Date.parse('2026-10-20T08:03:09Z'), username: 'fulano', acao: 'seguir', resultado: 'ok; "teste"', origem: '@ref' });
  const csv = gerarCsv(e.historico);
  assert.ok(csv.startsWith('﻿data_hora_sp;perfil;acao;resultado;origem\r\n'));
  assert.ok(csv.includes('20/10/2026 05:03:09;@fulano;seguir;"ok; ""teste""";@ref'));
  assert.equal(partesSP(T0).hora, 9);
});

test('decidirPausa: erro isolado em leitura não pausa 24 h; ação com limite pausa; repetição pausa', () => {
  assert.equal(decidirPausa({ tipo: 'limite', manual: true }), 'nenhuma');
  assert.equal(decidirPausa({ tipo: 'aguarde', manual: true }), 'nenhuma');
  assert.equal(decidirPausa({ tipo: 'sessao', manual: true }), 'nenhuma');
  assert.equal(decidirPausa({ tipo: 'aguarde', agora: T0 }), 'esfriar');
  assert.equal(decidirPausa({ tipo: 'limite', agora: T0 }), 'esfriar');
  assert.equal(decidirPausa({ tipo: 'aguarde', recentes: [T0 - 10 * MINUTO], agora: T0 }), 'esfriar');
  assert.equal(decidirPausa({ tipo: 'aguarde', recentes: [T0 - 30 * MINUTO, T0 - 10 * MINUTO], agora: T0 }), 'pausa24h');
  assert.equal(decidirPausa({ tipo: 'aguarde', recentes: [T0 - 3 * HORA, T0 - 2 * HORA], agora: T0 }), 'esfriar');
  assert.equal(decidirPausa({ tipo: 'limite', ehAcao: true, agora: T0 }), 'pausa24h');
  assert.equal(decidirPausa({ tipo: 'aguarde', ehAcao: true, agora: T0 }), 'esfriar');
  assert.equal(decidirPausa({ tipo: 'sessao' }), 'sessao');
  assert.equal(decidirPausa({ tipo: 'outro' }), 'nenhuma');
});

test('esfriar dura 15 min; trechoSeguro esconde tokens', () => {
  const e = estadoInicial();
  aplicarPausaPorErro(e, 'esfriar', T0, 'aguarde');
  assert.equal(e.esfriarAte, T0 + 15 * MINUTO);
  assert.equal(e.pausaAte, null);
  assert.equal(estaAtiva(e, { pausado: false }, T0 + 5 * MINUTO), false);
  assert.equal(estaAtiva(e, { pausado: false }, T0 + 15 * MINUTO), true);
  const t = trechoSeguro('{"message":"Please wait","csrf_token":"abc123","claim":"hmac.AR3xyz","x":"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"}');
  assert.match(t, /Please wait/);
  assert.ok(!t.includes('abc123') && !t.includes('AR3xyz') && !t.includes('AbCdEfGhIjKlMnOpQrStUvWxYz'));
  assert.equal(trechoSeguro('<!DOCTYPE html><html><head><title>Instagram</title></head>'), 'HTML (título: Instagram)');
  assert.ok(trechoSeguro('y '.repeat(300)).length <= 221);
});
