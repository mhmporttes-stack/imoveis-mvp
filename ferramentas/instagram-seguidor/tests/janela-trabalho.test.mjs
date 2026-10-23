// 1.1.0 — "deixar ela sem me atrapalhar igual a extensão do Marketplace": tudo numa janela
// pequena só da extensão, sem foco, com uma única aba do instagram.com reutilizada.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { HORA, DIA } from '../lib/tempo.js';
import { TAMANHO_JANELA, acharJanelaTrabalho, podeCriarJanela, descreverJanela } from '../lib/janela-trabalho.js';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';

test('acharJanelaTrabalho: guardada; recuperada após reiniciar (estreita, 1 aba no Instagram); senão null', () => {
  const dono = { id: 1, type: 'normal', width: 1400, tabs: [{ id: 11, url: 'https://www.instagram.com/' }, { id: 12, url: 'https://x.com/' }] };
  const trab = { id: 2, type: 'normal', width: 520, tabs: [{ id: 21, url: 'https://www.instagram.com/' }] };
  assert.deepEqual(acharJanelaTrabalho([dono, trab], { windowId: 2, tabId: 21 }), { windowId: 2, tabId: 21, como: 'guardada' });
  assert.deepEqual(acharJanelaTrabalho([dono, trab], { windowId: 9, tabId: 99 }), { windowId: 2, tabId: 21, como: 'recuperada' });
  assert.equal(acharJanelaTrabalho([dono], null), null, 'nunca usa a aba do Instagram da janela do dono');
  assert.equal(acharJanelaTrabalho([{ id: 3, width: 1400, tabs: [{ id: 31, url: 'https://www.instagram.com/' }] }], null), null, 'janela larga é do dono');
  assert.equal(podeCriarJanela([]), false);
  assert.equal(podeCriarJanela([dono]), true);
  assert.equal(descreverJanela({ existe: false }).ok, false);
  assert.equal(descreverJanela({ existe: true, estado: 'normal' }).ok, true);
  assert.deepEqual(TAMANHO_JANELA, { width: 520, height: 760 });
});

test('simulação: janela própria sem foco, reaproveitada; nunca aba na janela do dono; reabre se fechada', { timeout: 120_000 }, async () => {
  const inicio = Date.parse('2026-10-20T08:00:00Z'); // 05:00 SP
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(inicio + 6 * HORA);

  assert.equal(cf.registro.criadas.length, 1, 'uma única janela de trabalho');
  const opc = cf.registro.criadas[0];
  assert.equal(opc.focused, false);
  assert.equal(opc.state, 'normal');
  assert.equal(opc.type, 'normal');
  assert.equal(opc.width, 520);
  assert.equal(opc.height, 760);
  assert.equal(opc.url, 'https://www.instagram.com/');
  assert.equal(cf.registro.abasCriadas, 0, 'nunca cria aba (na janela do dono ou em outra)');
  assert.equal(cf.registro.focos.length, 0, 'nunca puxa foco sozinha');
  const trab = cf.janelas.find((w) => w.id !== 1);
  assert.equal(trab.tabs.length, 1);
  assert.equal(trab.tabs[0].autoDiscardable, false);
  assert.ok(cf.registro.atualizacoesAba.every((u) => u.active !== true), 'nunca ativa aba sozinha');
  assert.ok(ig.chamadas.filter((c) => c.caminho.includes('/create/')).length >= 4);

  // O dono fecha a janela de trabalho → reabre sem foco na próxima ação
  cf.janelas.splice(cf.janelas.indexOf(trab), 1);
  await ext.avancarAte(inicio + 9 * HORA);
  assert.equal(cf.registro.criadas.length, 2);
  assert.equal(cf.registro.criadas[1].focused, false);
  assert.equal(cf.registro.focos.length, 0);

  // Botão do popup: única vez em que a janela vem para a frente (a de trabalho, não a do dono)
  const r = await ext.mensagem({ tipo: 'abrirJanela' });
  assert.equal(r.ok, true);
  const nova = cf.janelas.find((w) => w.id !== 1);
  assert.deepEqual(cf.registro.focos, [nova.id]);
  const sit = await ext.mensagem({ tipo: 'situacaoJanela' });
  assert.match(sit.texto, /Aberta/);
  mock.timers.reset();
});

test('simulação: sem nenhuma janela do Chrome, não cria janela e espera, sem perder a fila', { timeout: 120_000 }, async () => {
  const inicio = Date.parse('2026-10-20T08:00:00Z');
  const ig = criarInstagramFalso();
  const cf = criarChromeFalso(ig, { semJanelas: true });
  const ext = await iniciarExtensao(cf, inicio);
  // Fila montada direto no estado (a busca manual sai do popup, que exige janela).
  const e0 = ext.estado();
  e0.fila = ig.usuarios.slice(0, 30).map((u) => ({ id: u.pk, username: u.username, origem: '@perfilref', adicionadoEm: inicio, privado: u.is_private }));
  cf.dados.estado = e0;
  await ext.avancarAte(inicio + 4 * HORA);
  let e = ext.estado();
  assert.equal(cf.registro.criadas.length, 0, 'criou janela sem nenhuma janela aberta');
  assert.equal(ig.chamadas.length, 0);
  assert.equal(e.fila.length, 30, 'perdeu perfis da fila');
  assert.equal(e.semJanela, true);
  assert.equal(e.historico.filter((h) => h.acao === 'janela de trabalho').length, 1, 'aviso uma vez só');
  assert.equal(e.pausaAte, null);

  // O dono abre o Chrome → a extensão cria a janela de trabalho (sem foco) e volta a agir
  cf.janelas.push({ id: 1, type: 'normal', width: 1400, state: 'normal', tabs: [{ id: 11, url: 'https://exemplo.com/', status: 'complete' }] });
  await ext.avancarAte(inicio + 8 * HORA);
  e = ext.estado();
  assert.equal(cf.registro.criadas.length, 1);
  assert.equal(cf.registro.criadas[0].focused, false);
  assert.equal(e.semJanela, false);
  assert.ok(Object.keys(e.seguidos).length >= 2);
  void DIA;
  mock.timers.reset();
});
