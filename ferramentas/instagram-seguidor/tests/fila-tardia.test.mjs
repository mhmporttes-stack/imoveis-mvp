// 1.1.1 (dono, 23/10: "só fica assim", 0 seguidos com 246 na fila): se a busca da referência
// acontece depois que horários de "seguir" já passaram com a fila vazia, esses horários
// voltam para a agenda e a extensão segue normalmente no resto do dia.
import test from 'node:test';
import assert from 'node:assert/strict';

import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';
import { HORA, MINUTO, diaSP } from '../lib/tempo.js';

test('fila preenchida à tarde: horários gastos com fila vazia voltam e o dia segue', { timeout: 120_000 }, async () => {
  const inicio = Date.parse('2026-10-20T11:00:00Z'); // 08:00 em São Paulo, janela aberta, fila vazia
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);

  await ext.avancarAte(inicio + 6 * HORA); // 14:00 SP: vários horários passaram sem ninguém na fila
  let e = ext.estado();
  assert.equal(e.contadores.seguidos, 0);
  assert.ok(e.agenda.follows.length < 20, 'horários foram consumidos com a fila vazia');

  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: '@perfilref' });
  assert.equal(r.ok, true, r.erro);
  await ext.avancarAte(inicio + 6 * HORA + 10 * MINUTO);
  e = ext.estado();
  assert.equal(e.agenda.follows.length + e.contadores.seguidos, 20, 'agenda replanejada para o limite do dia (20, padrão da 1.2.0)');

  await ext.avancarAte(inicio + 13 * HORA); // 21:00 SP
  e = ext.estado();
  assert.equal(diaSP(inicio), diaSP(inicio + 13 * HORA));
  assert.ok(e.contadores.seguidos >= 10, `seguiu ${e.contadores.seguidos} no resto do dia`);
  assert.ok(e.contadores.seguidos <= 20);
});
