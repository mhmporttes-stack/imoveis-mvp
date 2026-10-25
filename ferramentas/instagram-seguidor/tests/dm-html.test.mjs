// 1.1.5 — a DM de boas-vindas usa a mesma API privada que passou a devolver HTML 200. HTML na DM = a mensagem
// certamente NÃO saiu: reagenda (no máx. 3 tentativas espaçadas) e então alerta claro no popup. Nunca "incerta"
// (que nunca é reenviada) e nunca envio por digitação na tela da DM.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { DIA, MINUTO } from '../lib/tempo.js';
import { criarApiInstagram, ErroInstagram, IG_APP_ID_WEB } from '../instagram-api.js';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';

const HTML_DM = {
  status: 200,
  texto: '<!DOCTYPE html><html lang="pt"><head><title>Instagram</title></head><body></body></html>',
  tipoResposta: 'text/html; charset="utf-8"',
  metodoUsado: 'POST',
  cabecalhosDaPagina: ['x-ig-app-id', 'x-instagram-ajax', 'x-csrftoken'],
};

function apiCom(respostas) {
  const pedidos = [];
  const api = criarApiInstagram({
    obterCsrf: async () => 'tok',
    executar: async (req) => { pedidos.push(req); return respostas.shift(); },
  });
  return { api, pedidos };
}

test('DM com HTML 200 → "nao_enviada" (não "incerto"), sem tentar a alternativa por conversa', async () => {
  const { api, pedidos } = apiCom([HTML_DM]);
  await assert.rejects(api.enviarDm('77', 'Oi'), (e) => {
    assert.ok(e instanceof ErroInstagram);
    assert.equal(e.tipo, 'nao_enviada');
    assert.match(e.message, /DM não enviada/);
    assert.match(e.message, /cabeçalhos da página: x-ig-app-id x-instagram-ajax x-csrftoken/);
    return true;
  });
  assert.equal(pedidos.length, 1);
  // A DM sai pelo mesmo executor das outras chamadas (com os cabeçalhos de API; os da página entram na aba).
  const h = pedidos[0].cabecalhos;
  assert.equal(h['x-ig-app-id'], IG_APP_ID_WEB);
  assert.equal(h['x-requested-with'], 'XMLHttpRequest');
  assert.equal(h['x-csrftoken'], 'tok');
});

test('DM: HTML na alternativa por conversa também é "nao_enviada"; JSON ok continua enviado', async () => {
  const a = apiCom([{ status: 400, texto: '{"message":"bad","status":"fail"}' }, { status: 200, texto: '{"thread":{"thread_id":"t1"},"status":"ok"}' }, HTML_DM]);
  await assert.rejects(a.api.enviarDm('77', 'Oi'), (e) => e.tipo === 'nao_enviada');
  const b = apiCom([{ status: 200, texto: '{"status":"ok"}' }]);
  assert.deepEqual(await b.api.enviarDm('77', 'Oi'), { modo: 'recipient_users' });
  const c = apiCom([{ status: 200, texto: '{"status":"weird"}' }]);
  await assert.rejects(c.api.enviarDm('77', 'Oi'), (e) => e.tipo === 'incerto', 'JSON sem confirmação continua incerto (não reenviar)');
});

test('simulação: DM com HTML → 3 tentativas espaçadas, depois alerta no popup; nunca "incerta", nunca em silêncio', { timeout: 240_000 }, async () => {
  const inicio = Date.parse('2026-10-20T07:30:00Z'); // 04:30 SP
  const ig = criarInstagramFalso({ totalSeguidores: 60, voltaSe: (n) => n === 1 });
  ig.dmHtml = true;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  await ext.avancarAte(inicio + 1 * DIA);
  const e = ext.estado();
  const reg = Object.values(e.seguidos).find((r) => r.username === 'pessoa1');
  assert.ok(reg && reg.followBackEm, 'pessoa1 seguiu de volta');
  assert.equal(ig.dms.length, 0);
  assert.ok(!reg.dmIncerta, 'HTML não é envio incerto');
  assert.equal(reg.dmFalhas, 3);
  assert.equal(reg.dmDesistiu, true);
  const tentativas = ig.chamadas.filter((c) => c.caminho === '/api/v1/direct_v2/threads/broadcast/text/');
  assert.equal(tentativas.length, 3, 'no máximo 3 tentativas');
  assert.ok(tentativas[1].em - tentativas[0].em >= 30 * MINUTO && tentativas[2].em - tentativas[1].em >= 2 * 60 * MINUTO, 'tentativas espaçadas');
  assert.match(e.alerta.texto, /DM de boas-vindas não pôde ser enviada para @pessoa1/);
  assert.ok(cf.notificacoes.some((n) => /DM não enviada/.test(n.title || '')));
  assert.equal(e.semSessao, false);
  assert.equal(e.pausaAte, null);
  assert.ok(!ig.chamadas.some((c) => c.metodo === 'CLICK' && /direct/.test(c.caminho)), 'sem digitação/clique na tela da DM');
  mock.timers.reset();
});

test('simulação: DM com HTML que volta ao normal na 2ª tentativa é enviada uma única vez', { timeout: 240_000 }, async () => {
  const inicio = Date.parse('2026-10-20T07:30:00Z');
  const ig = criarInstagramFalso({ totalSeguidores: 60, voltaSe: (n) => n === 1 });
  ig.dmHtml = true;
  const cf = criarChromeFalso(ig);
  const ext = await iniciarExtensao(cf, inicio);
  await ext.mensagem({ tipo: 'buscarOrigem', username: 'perfilref' });
  for (let t = inicio; t < inicio + DIA; t += 10 * MINUTO) {
    await ext.avancarAte(t);
    if (ig.chamadas.some((c) => c.caminho === '/api/v1/direct_v2/threads/broadcast/text/')) { ig.dmHtml = false; break; }
  }
  await ext.avancarAte(inicio + DIA);
  const reg = Object.values(ext.estado().seguidos).find((r) => r.username === 'pessoa1');
  assert.equal(ig.dms.length, 1);
  assert.ok(reg.dmEnviadaEm);
  assert.ok(!reg.dmDesistiu && !reg.dmIncerta);
  mock.timers.reset();
});
