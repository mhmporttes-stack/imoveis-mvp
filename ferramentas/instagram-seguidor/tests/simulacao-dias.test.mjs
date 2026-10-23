// Simulação de 5 dias do background.js inteiro, com chrome e Instagram FALSOS
// e relógio falso. Verifica agenda, limites, regra dos 3 dias, DM única em 1–3 min.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';
import { MINUTO, HORA, DIA, diaSP, dentroDaJanela, partesSP } from '../lib/tempo.js';
import { MENSAGEM_PADRAO } from '../lib/regras.js';

const CFG = { inicioHora: 5, fimHora: 22 };

test('simulação de 5 dias: seguir, follow-back, DM e deixar de seguir', { timeout: 240_000 }, async () => {
  const inicio = Date.parse('2026-10-20T06:30:00Z'); // 03:30 em São Paulo
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);

  // Antes das 05:00 nada é feito; a próxima ação é o 1º "seguir" às ~05:00.
  let e = ext.estado();
  assert.equal(e.agenda.follows.length, 15);
  assert.equal(partesSP(e.agenda.follows[0]).hora, 5);
  assert.equal(e.proxima.acao, 'Seguir');

  // Busca a origem (fora da janela é permitido: é ação manual do dono).
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: '@perfilref' });
  assert.equal(r.ok, true, r.erro);
  e = ext.estado();
  assert.equal(r.resultado.lidos, 120);
  // 1.1.0: privados entram (viram "Solicitado"); sem foto não são pulados por padrão → 120
  assert.equal(e.fila.length, 120);
  assert.ok(e.fila.every((f) => f.origem === '@perfilref'));
  // Buscar de novo não duplica nada
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(ext.estado().fila.length, 120);
  const perfilErrado = await ext.mensagem({ tipo: 'buscarOrigem', username: 'naoexiste' });
  assert.equal(perfilErrado.ok, false);
  assert.match(perfilErrado.erro, /não encontrado/);

  await ext.avancarAte(inicio + 5 * DIA);
  e = ext.estado();

  // --- SEGUIR: no máximo 15 por dia, todos dentro de 05–22h, espaçados
  const seguir = ig.chamadas.filter((c) => c.caminho.startsWith('/api/v1/friendships/create/'));
  const porDia = {};
  for (const c of seguir) {
    porDia[diaSP(c.em)] = (porDia[diaSP(c.em)] || 0) + 1;
    assert.ok(dentroDaJanela(c.em, CFG), 'seguir fora da janela');
  }
  assert.deepEqual(Object.values(porDia), [15, 15, 15, 15, 15]);
  for (let i = 1; i < seguir.length; i += 1) {
    if (diaSP(seguir[i].em) !== diaSP(seguir[i - 1].em)) continue;
    const gap = seguir[i].em - seguir[i - 1].em;
    assert.ok(gap >= 55 * MINUTO && gap <= 80 * MINUTO, `intervalo entre seguir: ${gap / MINUTO} min`);
  }
  // pessoa2 já me seguia → nunca seguida
  assert.equal(ig.chamadas.some((c) => c.caminho === '/api/v1/friendships/create/1002/'), false);

  // --- DM: uma por follow-back, 1–3 min após detectar, texto exato, dentro da janela
  const comVolta = Object.values(e.seguidos).filter((s) => s.followBackEm);
  assert.ok(comVolta.length > 10);
  const idsDm = ig.dms.map((d) => d.id);
  assert.equal(new Set(idsDm).size, idsDm.length, 'DM duplicada');
  assert.ok(!idsDm.includes('1002'), 'quem já me seguia não recebe DM');
  for (const d of ig.dms) {
    assert.equal(d.texto, MENSAGEM_PADRAO);
    assert.ok(dentroDaJanela(d.em, CFG));
    const reg = e.seguidos[d.id];
    const atraso = d.em - reg.followBackEm;
    assert.ok(atraso >= MINUTO && atraso <= 3 * MINUTO + 15_000, `atraso da DM: ${atraso / 1000}s`);
    // detecção rápida: volta (simulada 40 min após seguir) detectada em poucos minutos
    const voltaReal = reg.seguidoEm + ig.atrasoVolta;
    if (dentroDaJanela(voltaReal, CFG)) assert.ok(reg.followBackEm - voltaReal <= 3 * MINUTO, 'follow-back demorou a ser detectado');
  }
  assert.equal(ig.dms.length, comVolta.filter((s) => s.dmEnviadaEm).length);

  // --- DEIXAR DE SEGUIR: só quem a extensão seguiu, após 3 dias, sem follow-back, na janela
  const destroy = ig.chamadas.filter((c) => c.caminho.startsWith('/api/v1/friendships/destroy/'));
  assert.ok(destroy.length >= 15, `deixou de seguir ${destroy.length}`);
  const destroyPorDia = {};
  for (const c of destroy) {
    const id = c.caminho.split('/')[5];
    const reg = e.seguidos[id];
    assert.ok(reg, 'deixou de seguir alguém que a extensão não seguiu');
    assert.ok(c.em - reg.seguidoEm >= 3 * DIA, 'deixou de seguir antes de 3 dias');
    assert.ok(!reg.followBackEm, 'deixou de seguir quem seguiu de volta');
    assert.ok(dentroDaJanela(c.em, CFG));
    destroyPorDia[diaSP(c.em)] = (destroyPorDia[diaSP(c.em)] || 0) + 1;
  }
  assert.ok(Object.values(destroyPorDia).every((n) => n <= 15));
  for (let i = 1; i < destroy.length; i += 1) assert.ok(destroy[i].em - destroy[i - 1].em >= 15 * MINUTO, 'deixar de seguir em rajada');

  // Nenhuma chamada de escrita fora da janela; contadores e histórico coerentes
  const escrita = ig.chamadas.filter((c) => c.metodo === 'POST' && !c.caminho.endsWith('show_many/'));
  assert.ok(escrita.every((c) => dentroDaJanela(c.em, CFG)));
  assert.ok(e.historico.some((h) => h.acao === 'DM'));
  assert.equal(e.alerta, null);
  assert.equal(cf.notificacoes.length, 0);

  mock.timers.reset();
});

test('simulação: pausa manual não age; retomar volta a agir', { timeout: 60_000 }, async () => {
  const inicio = Date.parse('2026-10-20T08:00:00Z'); // 05:00 SP
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.mensagem({ tipo: 'pausar' });
  await ext.avancarAte(inicio + 6 * HORA);
  assert.equal(ig.chamadas.filter((c) => c.caminho.includes('/create/')).length, 0);
  assert.equal(ext.estado().proxima.acao, 'Pausada manualmente');
  await ext.mensagem({ tipo: 'retomar' });
  await ext.avancarAte(inicio + 9 * HORA);
  const n = ig.chamadas.filter((c) => c.caminho.includes('/create/')).length;
  assert.ok(n >= 2 && n <= 15, `seguiu ${n}`);
  mock.timers.reset();
});
