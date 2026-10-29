// 1.1.0 — "Ela deve solicitar perfil fechado também": perfis privados entram na fila,
// o seguir vira "Solicitado" (pedido pendente) e, sem retorno em 3 dias, a solicitação é cancelada.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { DIA, HORA } from '../lib/tempo.js';
import {
  STATUS, filtrarCandidatos, elegivelParaUnfollow, rotuloSeguir, statusAposSeguir,
  atualizarSolicitacao, rotuloDeixar, rotuloStatus,
} from '../lib/regras.js';
import { configPadrao, normalizarEstado, VERSAO_ESTADO, gerarCsv } from '../lib/estado.js';
import { criarTelaInstagram } from '../instagram-tela.js';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';

const T0 = Date.parse('2026-10-20T12:00:00Z');

test('padrão novo: privados entram na fila; a opção "pular privados" continua funcionando', () => {
  assert.equal(configPadrao().pularPrivados, false);
  const usuarios = [{ pk: 1, username: 'a', is_private: true, profile_pic_url: 'https://x/f.jpg' }];
  const r = filtrarCandidatos(usuarios, { meuId: '9', origem: '@ref', agora: T0 });
  assert.deepEqual(r.aceitos.map((x) => [x.id, x.privado]), [['1', true]]);
  const r2 = filtrarCandidatos(usuarios, { meuId: '9', pularPrivados: true });
  assert.deepEqual(r2.pulados, { privado: 1 });
});

test('migração: quem tinha o padrão antigo (pular privados) passa para o novo; quem já está na 1.1.0 mantém a escolha', () => {
  const antigo = normalizarEstado({ versao: 1, config: { pularPrivados: true, limiteDiario: 10 }, vistos: { 5: 'privado', 6: 'seguido' } });
  assert.equal(antigo.config.pularPrivados, false);
  assert.equal(antigo.config.limiteDiario, 10, 'as outras opções ficam');
  assert.deepEqual(antigo.vistos, {}, '1.2.0: ids antigos não casam com o @ (os seguidos continuam marcados)');
  assert.equal(antigo.versao, VERSAO_ESTADO);
  const religado = normalizarEstado({ versao: 2, config: { pularPrivados: true }, vistos: { 5: 'privado' } });
  assert.equal(religado.config.pularPrivados, true, 'religado no painel depois da migração continua ligado');
  assert.equal(normalizarEstado(undefined).config.pularPrivados, false, 'instalação nova');
});

test('status e rótulos: pedido pendente = "Solicitado"; aceite vira "seguindo"; cancelamento após N dias', () => {
  const pend = { seguindo: false, pedidoPendente: true };
  assert.equal(statusAposSeguir(pend), STATUS.SOLICITADO);
  assert.equal(statusAposSeguir({ seguindo: true, pedidoPendente: false }), STATUS.SEGUINDO);
  assert.match(rotuloSeguir(pend), /^Solicitado/);
  assert.equal(rotuloSeguir({ seguindo: true }), 'seguindo');
  assert.equal(rotuloStatus(STATUS.SOLICITADO), 'Solicitado');
  assert.match(rotuloDeixar(pend, 3), /Solicitado — solicitação cancelada \(não aceitou em 3 dias\)/);
  assert.equal(rotuloDeixar({ seguindo: true }, 3), 'não seguiu de volta em 3 dias');

  const reg = { id: '1', status: STATUS.SOLICITADO, seguidoEm: T0 };
  assert.equal(atualizarSolicitacao(reg, pend, T0 + HORA), false);
  assert.equal(atualizarSolicitacao(reg, { seguindo: true }, T0 + HORA), true);
  assert.equal(reg.status, STATUS.SEGUINDO);
  assert.equal(reg.aceitoEm, T0 + HORA);
  assert.equal(atualizarSolicitacao({ status: STATUS.SEGUIU_DE_VOLTA }, { seguindo: true }, T0), false);
  // Solicitado também entra na regra dos 3 dias
  assert.equal(elegivelParaUnfollow({ id: '2', status: STATUS.SOLICITADO, seguidoEm: T0 }, T0 + 3 * DIA, 3), true);
});

// 1.2.0: pela tela — o clique em "Seguir" no perfil privado vira "Solicitado"; "Solicitado" → "Cancelar solicitação"
// só confirma quando o botão volta a "Seguir".
function telaCom(respostas) {
  const pedidos = [];
  const api = criarTelaInstagram({ executar: async (req) => { pedidos.push(req); return respostas.shift(); } });
  return { api, pedidos };
}

test('seguir privado pela tela: o botão vira "Solicitado" = pedido pendente', async () => {
  const { api, pedidos } = telaCom([{ ok: true, botaoDepois: 'solicitado', privado: true }]);
  const st = await api.seguir('privado');
  assert.equal(st.pedidoPendente, true);
  assert.equal(st.seguindo, false);
  assert.equal(st.via, 'botão Seguir');
  assert.equal(pedidos[0].caminho, '/privado/');
  assert.equal(pedidos[0].func.name, 'clicarPerfilNaPagina');
  assert.deepEqual(pedidos[0].args[2], ['seguindo', 'solicitado']);
});

test('cancelar solicitação: só confirma quando o botão volta a "Seguir"; senão para e avisa (sem insistir)', async () => {
  const ok = telaCom([{ ok: true, botaoDepois: 'seguir' }]);
  const st = await ok.api.deixarDeSeguir('privado');
  assert.equal(st.pedidoPendente, false);
  assert.deepEqual(ok.pedidos[0].args[2], ['seguir', 'seguir_de_volta']);
  const preso = telaCom([{ ok: false, erro: 'depois do clique o botão ficou "solicitado"', passo: 'confirmação do botão' }]);
  await assert.rejects(preso.api.deixarDeSeguir('privado'), (e) => e.tipo === 'mudanca_api' && /Parei sem insistir/.test(e.message) && e.seletor === 'perfil: confirmação do botão');
  assert.equal(preso.pedidos.length, 1, 'uma tentativa só');
});

test('simulação: privados viram "Solicitado", contam no limite, e sem retorno em 3 dias a solicitação é cancelada', { timeout: 240_000 }, async () => {
  const inicio = Date.parse('2026-10-20T07:30:00Z'); // 04:30 SP
  // Todos privados: 1/3 aceita sem seguir de volta, 1/3 segue de volta (sem aceitar), 1/3 ignora.
  const ig = criarInstagramFalso({ totalSeguidores: 120, voltaSe: (n) => n % 3 === 0 });
  for (const u of ig.usuarios) u.privado = true;
  ig.aceitaSe = (n) => n % 3 === 1;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.resultado.pulados.privado, undefined);

  await ext.avancarAte(inicio + 5 * DIA);
  const e = ext.estado();
  const regs = Object.values(e.seguidos);

  // Limite diário: 20 "seguir" por dia (solicitações contam) — 1.2.0; a fila tem 120
  const creates = ig.de('clique-seguir');
  assert.equal(creates.length, 100);
  assert.ok(regs.length === 100);
  const seguirHist = e.historico.filter((h) => h.acao === 'seguir');
  assert.ok(seguirHist.length === 100 && seguirHist.every((h) => /^Solicitado \(perfil privado\) — confirmado/.test(h.resultado)));

  // Cancelamentos: só quem a extensão solicitou, após 3 dias, sem follow-back; confirmados no Instagram
  const canceladas = regs.filter((x) => x.solicitacaoCancelada);
  assert.ok(canceladas.length >= 5, `canceladas ${canceladas.length}`);
  for (const x of canceladas) {
    assert.equal(x.status, STATUS.DEIXADO);
    assert.ok(x.deixadoEm - x.seguidoEm >= 3 * DIA);
    assert.ok(!x.followBackEm);
    assert.equal(ig.pendentes.has(x.id), false, 'solicitação continua pendente no Instagram');
    assert.equal(ig.sigo.has(x.id), false);
  }
  assert.ok(e.historico.some((h) => h.acao === 'cancelar solicitação' && /^Solicitado — solicitação cancelada/.test(h.resultado)));

  // Aceitou mas não seguiu de volta → deixado de seguir depois de 3 dias
  const aceitos = regs.filter((x) => x.aceitoEm && !x.followBackEm && x.status === STATUS.DEIXADO);
  assert.ok(aceitos.length >= 3, `aceitos deixados ${aceitos.length}`);
  for (const x of aceitos) { assert.ok(!x.solicitacaoCancelada); assert.equal(ig.sigo.has(x.id), false); }

  // Boas-vindas só para quem seguiu de volta; quem seguiu de volta nunca é cancelado
  const idsDm = new Set(ig.dms.map((d) => d.username));
  for (const x of regs) {
    if (idsDm.has(x.id)) assert.ok(x.followBackEm, 'DM para quem não seguiu de volta');
    if (x.followBackEm) assert.notEqual(x.status, STATUS.DEIXADO);
  }
  assert.ok(idsDm.size > 0);

  // Ainda pendentes (< 3 dias) aparecem como Solicitado; CSV traz "Solicitado"
  assert.ok(regs.some((x) => x.status === STATUS.SOLICITADO));
  assert.match(gerarCsv(e.historico), /Solicitado \(perfil privado\)/);

  // Nunca mexe em quem a extensão não seguiu/solicitou
  for (const c of ig.de('clique-deixar')) assert.ok(e.seguidos[c.alvo]);
  mock.timers.reset();
});

test('perfil de referência continua tendo de ser público (privado que não sigo é recusado)', { timeout: 60_000 }, async () => {
  const inicio = Date.parse('2026-10-20T09:00:00Z');
  const ig = criarInstagramFalso();
  ig.perfilPrivado = true;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  const r = await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /PRIVADO/);
  assert.equal(ig.de('lista').length, 0);
  mock.timers.reset();
});
