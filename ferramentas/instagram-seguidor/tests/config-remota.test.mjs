// 1.1.13 — dono testou a 1.1.12: "nenhuma mensagem foi enviada, mas ali constam 13 DMs enviadas" e "é muito cansativo
// toda vez baixar, extrair o zip, atualizar no Chrome e rodar de novo". → confirmação só por bolha enviada na conversa,
// reset das falsas enviadas, configuração e comandos remotos (só dados, lista fechada). Tudo FALSO: nada real sai.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { validarConfigRemota, comandosPendentes, marcarExecutado, descreverConfigRemota } from '../lib/config-remota.js';
import { resetarDmsDigitacao, proximaBoasVindasPendente, MENSAGEM_PADRAO } from '../lib/regras.js';
import { confirmarDmNaPagina, prepararCaixaNaPagina, lerCaixaNaPagina, trechoDaMensagem, textosDm, aplicarConfigRemota } from '../instagram-api.js';
import { el, instalarDom, desinstalarDom } from './ajuda/dom-falso.mjs';
import { criarInstagramFalso, criarChromeFalso, iniciarExtensao } from './ajuda/simulador.mjs';
import { HORA } from '../lib/tempo.js';
import { diaSP } from '../lib/tempo.js';
import { configPadrao } from '../lib/estado.js';

const TRECHO = trechoDaMensagem(MENSAGEM_PADRAO);

async function aguardar(promessa, passo = 250) {
  let pronto = false;
  let valor;
  let erro;
  promessa.then((v) => { pronto = true; valor = v; }, (e) => { pronto = true; erro = e; });
  for (let i = 0; i < 100000 && !pronto; i += 1) {
    await new Promise((r) => setImmediate(r));
    if (!pronto) mock.timers.tick(passo);
  }
  if (erro) throw erro;
  return valor;
}

// ------------------------------------------------------------- causa raiz das 13 "enviadas"

/**
 * Popup de conversa com: a caixa atual (composer), OUTRA caixa de texto aberta com o mesmo texto (painel de mensagens
 * flutuante), a prévia na lista de conversas (link /direct/t/) e, conforme o caso, uma bolha enviada ou com falha.
 */
function conversa({ bolha = null, textoNaCaixa = '' } = {}) {
  const caixa = el('div', { texto: textoNaCaixa, attrs: { contenteditable: 'true', role: 'textbox', 'aria-label': 'Mensagem' } });
  const outraCaixa = el('div', { texto: MENSAGEM_PADRAO, attrs: { contenteditable: 'true', role: 'textbox', 'aria-label': 'Mensagem' }, visivel: false });
  const previa = el('a', { attrs: { href: '/direct/t/123/' }, filhos: [el('span', { texto: `Você: ${MENSAGEM_PADRAO}` })] });
  const thread = el('div', { attrs: { role: 'grid' } });
  if (bolha === 'enviada') thread.adicionar(el('div', { filhos: [el('div', { attrs: { dir: 'auto' }, texto: MENSAGEM_PADRAO })] }));
  if (bolha === 'falha') thread.adicionar(el('div', { filhos: [el('div', { attrs: { dir: 'auto' }, texto: MENSAGEM_PADRAO }), el('span', { texto: 'Não enviada. Toque para tentar novamente.' })] }));
  const body = el('body', { filhos: [el('nav', { filhos: [previa] }), outraCaixa, el('section', { attrs: { role: 'dialog' }, filhos: [thread, el('div', { filhos: [caixa] })] })] });
  return { body, caixa };
}

test('confirmação: o texto em OUTRA caixa e na prévia da lista de conversas NÃO conta como enviada (era o bug das 13)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  instalarDom(conversa().body);
  try {
    const r = await aguardar(confirmarDmNaPagina(TRECHO, 0, 3000));
    assert.equal(r.confirmado, false, JSON.stringify(r));
    assert.match(r.erro, /nenhuma bolha/);
    const p = await prepararCaixaNaPagina(TRECHO);
    assert.equal(p.contagem, 0, 'não é "já estava na conversa"');
  } finally { desinstalarDom(); mock.timers.reset(); }
});

test('confirmação: bolha enviada na conversa (fora da caixa) e caixa vazia = confirmada; bolha "Não enviada" = falhou', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    instalarDom(conversa({ bolha: 'enviada' }).body);
    const ok = await aguardar(confirmarDmNaPagina(TRECHO, 0, 3000));
    assert.equal(ok.confirmado, true, JSON.stringify(ok));
    desinstalarDom();
    instalarDom(conversa({ bolha: 'falha' }).body);
    const falha = await aguardar(confirmarDmNaPagina(TRECHO, 0, 3000));
    assert.equal(falha.confirmado, false);
    assert.equal(falha.falhou, true);
    const p = await prepararCaixaNaPagina(TRECHO);
    assert.deepEqual([p.contagem, p.falhasAntes], [0, 1], 'bolha com falha não vira "já estava"');
    desinstalarDom();
    instalarDom(conversa({ bolha: 'enviada', textoNaCaixa: MENSAGEM_PADRAO }).body);
    const naCaixa = await aguardar(confirmarDmNaPagina(TRECHO, 1, 2000));
    assert.equal(naCaixa.confirmado, false, 'a mesma bolha de antes não conta de novo');
    assert.equal(naCaixa.naCaixa, true);
    const l = await lerCaixaNaPagina(TRECHO);
    assert.equal(l.conversa, 1);
  } finally { desinstalarDom(); mock.timers.reset(); }
});

// ------------------------------------------------------------- reset das falsas enviadas

test('resetarDmsDigitacao: só as da digitação (enviada/incerta/tentativa) voltam a pendentes, espaçadas; desconta hoje', () => {
  const agora = Date.parse('2026-10-26T15:00:00Z');
  const cfg = configPadrao();
  const regs = [
    { id: '1', dmVia: 'digitacao', dmEnviadaEm: agora - HORA, dmDigitacaoTentadaEm: agora - HORA, dmTentativaEm: agora - HORA },
    { id: '2', dmDigitacaoTentadaEm: agora - 2 * HORA, dmIncerta: true, dmTentativaEm: agora - 2 * HORA },
    { id: '3', dmEnviadaEm: agora - HORA, dmTentativaEm: agora - HORA }, // pela API: fica
    { id: '4', dmVia: 'digitacao', dmEnviadaEm: agora - 30 * HORA, dmTentativaEm: agora - 30 * HORA }, // ontem
    { id: '5', dmAgendadaPara: agora + HORA }, // pendente: fica
  ];
  const r = resetarDmsDigitacao(regs, { agora, cfg, dia: diaSP(agora), diaDe: diaSP, rand: () => 0.5 });
  assert.deepEqual(r.resetados.map((x) => x.id).sort(), ['1', '2', '4']);
  assert.equal(r.enviadasHoje, 1);
  assert.equal(r.incertasHoje, 1);
  for (const x of r.resetados) assert.ok(!x.dmEnviadaEm && !x.dmIncerta && !x.dmTentativaEm && x.dmAgendadaPara > agora && x.dmResetEm === agora);
  const horarios = r.resetados.map((x) => x.dmAgendadaPara).sort();
  assert.ok(horarios[1] - horarios[0] >= 60 * 1000 && horarios[2] - horarios[1] >= 60 * 1000, 'espaçadas');
  assert.ok(regs[2].dmEnviadaEm && regs[4].dmAgendadaPara === agora + HORA);
  const s = resetarDmsDigitacao([{ id: '9', dmVia: 'digitacao', dmEnviadaEm: agora }], { agora, cfg, dia: diaSP(agora), diaDe: diaSP, ids: ['8'] });
  assert.equal(s.resetados.length, 0, 'filtro por ids');
});

// ------------------------------------------------------------- configuração e comandos (validação pura)

test('validarConfigRemota: só dados no formato; seletor com { } ou url() descartado; tempos fora do limite ignorados', () => {
  const c = validarConfigRemota({
    versao: '2026-10-26a',
    textos: { enviar: ['Enviar', 'Send', 42, 'x'], falhaEnvio: ['Não enviada'], desconhecido: ['a'] },
    seletores: { caixa: 'div[role="textbox"]', excluirDaConversa: 'nav { color: red }' },
    tempos: { confirmarMs: 15000, maxCliquesMensagem: 99 },
    digitacao: { ativa: true, colar: 'sim', shiftEnter: false },
    codigo: 'alert(1)',
  });
  assert.deepEqual(c, {
    versao: '2026-10-26a',
    textos: { enviar: ['enviar', 'send'], falhaEnvio: ['não enviada'] },
    seletores: { caixa: 'div[role="textbox"]' },
    tempos: { confirmarMs: 15000 },
    digitacao: { ativa: true, shiftEnter: false },
  });
  assert.deepEqual(validarConfigRemota(null), {});
  assert.deepEqual(validarConfigRemota([1, 2]), {});
});

test('comandosPendentes: lista fechada, cada id uma vez, dryrun exige @; marcarExecutado guarda os recentes', () => {
  const l = comandosPendentes([
    { id: 'a', tipo: 'ping' },
    { id: 'a', tipo: 'ping' },
    { id: 'b', tipo: 'eval', args: { code: 'x' } },
    { id: 'c', tipo: 'dryrun_dm' },
    { id: 'd', tipo: 'dryrun_dm', args: { username: '@fulano' } },
    { id: 'e', tipo: 'reset_dms', args: { desde: '2026-10-26T00:00:00Z', ids: [1, 2] } },
    { id: 'f', tipo: 'send_next_now' },
  ], ['f']);
  assert.deepEqual(l.map((x) => x.id), ['a', 'd', 'e']);
  assert.deepEqual(l[2].args, { ids: ['1', '2'], desde: Date.parse('2026-10-26T00:00:00Z') });
  assert.deepEqual(marcarExecutado(['x', 'y'], 'x'), ['y', 'x']);
  assert.match(descreverConfigRemota({ config: { versao: 'v7' }, recebidaEm: 1 }, { ultimo: { tipo: 'ping', em: 1, resultado: 'ok' } }, () => '10:00'), /versão v7, atualizada 10:00\.\nÚltimo comando: ping \(10:00\) — ok/);
});

// ------------------------------------------------------------- simulação: CRM falso com configuração e comandos

const INICIO = Date.parse('2026-10-20T07:30:00Z');
test.afterEach(() => { mock.timers.reset(); aplicarConfigRemota({}); });

async function extensaoComCrm({ configurar = () => {}, respostaCrm = () => ({ config: {}, commands: [] }) } = {}) {
  const ig = criarInstagramFalso({ totalSeguidores: 20, voltaSe: () => false });
  ig.novosSeguidoresDeFora(10, 1);
  configurar(ig);
  const cf = criarChromeFalso(ig);
  const crm = { diagnosticos: [], buscas: 0 };
  globalThis.fetch = async (url, op) => {
    if (op.method === 'GET') { crm.buscas += 1; return { ok: true, json: async () => ({ ok: true, ...respostaCrm(crm) }) }; }
    crm.diagnosticos.push(JSON.parse(op.body));
    return { ok: true, json: async () => ({ ok: true, id: String(crm.diagnosticos.length) }) };
  };
  cf.dados.crm = { url: 'https://www.matheusmachadoimoveis.com.br', chave: 'mkp_teste_123456' };
  const ext = await iniciarExtensao(cf, INICIO);
  await ext.avancarAte(INICIO + HORA);
  return { ig, cf, ext, crm };
}

test('comandos do CRM: cada id roda uma vez e responde ig_ack; dryrun não envia nada; config aplicada e guardada', { timeout: 240_000 }, async () => {
  const comandos = [
    { id: 'c1', tipo: 'ping' },
    { id: 'c2', tipo: 'dryrun_dm', args: { username: 'pessoa3' } },
    { id: 'c3', tipo: 'apagar_tudo' },
  ];
  const { ig, cf, ext, crm } = await extensaoComCrm({ respostaCrm: () => ({ config: { versao: 'v2', textos: { enviar: ['enviar', 'send', 'mandar'] } }, commands: comandos }) });
  const r = await ext.mensagem({ tipo: 'sincronizarCrm' });
  assert.equal(r.ok, true, JSON.stringify(r));
  await ext.ocioso();
  const acks = crm.diagnosticos.filter((d) => d.kind === 'ig_ack');
  assert.deepEqual(acks.map((a) => a.payload.extra.id).sort(), ['c1', 'c2']);
  assert.ok(acks.every((a) => !/pessoa3/.test(JSON.stringify(a))), 'sem @');
  assert.equal(ig.dms.length, 0, 'teste a seco não envia');
  assert.equal(cf.dados.crmConfig.config.versao, 'v2');
  assert.deepEqual(textosDm().enviar, ['enviar', 'send', 'mandar'], 'configuração aplicada');
  assert.equal(cf.dados.crmComandos.ultimo.id, 'c2');
  await ext.mensagem({ tipo: 'sincronizarCrm' });
  await ext.avancarAte(Date.now() + 15 * 60 * 1000); // alarme de 5 min também busca
  await ext.ocioso();
  assert.equal(crm.diagnosticos.filter((d) => d.kind === 'ig_ack').length, 2, 'nunca roda de novo');
  assert.ok(crm.buscas >= 3);
  aplicarConfigRemota({});
  mock.timers.reset();
});

test('send_next_now remoto: a próxima boas-vindas sai uma vez; config com digitação desligada → não digita', { timeout: 240_000 }, async () => {
  let comandos = [];
  let config = {};
  const { ig, ext, crm } = await extensaoComCrm({ configurar: (x) => { x.dmHtml = true; }, respostaCrm: () => ({ config, commands: comandos }) });
  ig.novosSeguidoresDeFora(1, Date.now());
  for (let i = 0; i < 60 && !proximaBoasVindasPendente(ext.estado()); i += 1) await ext.avancarAte(Date.now() + 10 * 1000);
  comandos = [{ id: 's1', tipo: 'send_next_now' }];
  await ext.mensagem({ tipo: 'sincronizarCrm' });
  await ext.ocioso();
  assert.equal(ig.dms.length, 1);
  const ack = crm.diagnosticos.find((d) => d.kind === 'ig_ack' && d.payload.extra.id === 's1');
  assert.match(ack.payload.resultado, /ENVIADA/);
  // Digitação desligada pela configuração: a próxima (HTML na API) fica "não enviada" sem abrir a conversa.
  config = { versao: 'v3', digitacao: { ativa: false } };
  await ext.mensagem({ tipo: 'sincronizarCrm' });
  const abertasAntes = ig.chamadas.filter((c) => c.caminho === 'abrirConversaNaPagina').length;
  ig.novosSeguidoresDeFora(1, Date.now());
  await ext.avancarAte(Date.now() + 30 * 60 * 1000);
  assert.equal(ig.dms.length, 1);
  assert.equal(ig.chamadas.filter((c) => c.caminho === 'abrirConversaNaPagina').length, abertasAntes, 'não abriu a conversa');
  aplicarConfigRemota({});
  mock.timers.reset();
});

test('bolha "Não enviada" depois do clique = incerta (nunca enviada, nunca reenviada); reset_dms remoto a devolve a pendente', { timeout: 240_000 }, async () => {
  let comandos = [];
  const { ig, ext, crm } = await extensaoComCrm({ configurar: (x) => { x.dmHtml = true; x.dmTela.falha = true; }, respostaCrm: () => ({ config: {}, commands: comandos }) });
  ig.novosSeguidoresDeFora(1, Date.now());
  await ext.avancarAte(Date.now() + HORA);
  let e = ext.estado();
  const reg = Object.values(e.novosSeguidores).find((r) => r.dmTentativaEm);
  assert.ok(reg && reg.dmIncerta && !reg.dmEnviadaEm, JSON.stringify(reg));
  assert.equal(e.contadores.dms, 0, 'não conta como enviada');
  ig.dmTela.falha = false;
  comandos = [{ id: 'r1', tipo: 'reset_dms', args: { desde: INICIO } }];
  await ext.mensagem({ tipo: 'sincronizarCrm' });
  await ext.ocioso();
  e = ext.estado();
  const depois = e.novosSeguidores[reg.id];
  assert.ok(!depois.dmIncerta && depois.dmAgendadaPara && !depois.dmTentativaEm, 'pendente de novo');
  assert.match(crm.diagnosticos.find((d) => d.kind === 'ig_ack').payload.resultado, /1 boas-vindas voltaram a pendentes/);
  mock.timers.reset();
});

test('atualização 1.1.13: as "enviadas" da digitação voltam a pendentes uma vez e o contador de hoje desconta', { timeout: 240_000 }, async () => {
  const { ig, cf, ext } = await extensaoComCrm({ configurar: (x) => { x.dmHtml = true; } });
  ig.novosSeguidoresDeFora(2, Date.now());
  await ext.avancarAte(Date.now() + HORA);
  let e = ext.estado();
  assert.equal(e.contadores.dms, 2, 'duas "enviadas" pela digitação');
  // Simula o estado de quem vinha da 1.1.12 (ainda sem o reset) e roda o ciclo.
  cf.dados.estado.resetDm1113 = null;
  await ext.ocioso();
  await globalThis.seguidorIG.ciclo();
  e = ext.estado();
  assert.equal(e.contadores.dms, 0);
  assert.ok(e.historico.some((h) => /versão 1\.1\.13: 2 boas-vindas marcadas como enviadas/.test(h.resultado)));
  assert.equal(Object.values(e.novosSeguidores).filter((r) => r.dmResetEm && !r.dmEnviadaEm).length, 2);
  const flag = e.resetDm1113;
  await globalThis.seguidorIG.ciclo();
  assert.equal(ext.estado().resetDm1113, flag, 'só uma vez');
  mock.timers.reset();
});
