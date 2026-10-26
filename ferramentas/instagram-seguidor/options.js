import { lerTudo, enviar, statusAtual, textoProxima, contadoresHoje, textoAlerta, estaParada, retomarAgora, ligarBotaoConferir, ligarBotaoEnviarAgora, atualizarBotaoEnviarAgora } from './painel-comum.js';
import { CHAVE_CRM, CHAVE_ULTIMO_ENVIO, CRM_URL_PADRAO, descreverUltimoEnvio } from './lib/diagnostico.js';
import { formatarSP, diaSP } from './lib/tempo.js';
import { gerarCsv, resumoBusca, resumoBoasVindas, resumoCargaTresDias } from './lib/estado.js';
import { MENSAGEM_PADRAO, STATUS, idsParaVerificarFollowBack, proximaBoasVindasPendente } from './lib/regras.js';

const $ = (id) => document.getElementById(id);
const CAMPOS_NUM = ['limiteDiario', 'limiteUnfollowDiario', 'diasParaUnfollow', 'maxBusca', 'limiteDmDiario'];
const CAMPOS_BOOL = ['pularPrivados', 'pularSemFoto', 'dmAtiva'];
let configCarregada = false;

async function render() {
  const { e, c } = await lerTudo();
  const st = statusAtual(e, c);
  $('status').textContent = st.rotulo;
  $('status').className = `pilula ${st.classe}`;
  const alerta = textoAlerta(e);
  $('caixaAlerta').hidden = !alerta;
  $('textoAlerta').textContent = alerta;
  const parada = estaParada(e, c);
  $('btnRetomarAgora').hidden = !parada;
  if (parada && !alerta) {
    $('caixaAlerta').hidden = false;
    $('textoAlerta').textContent = c.pausado ? 'Extensão pausada.' : 'Extensão parada.';
  }
  $('proxima').textContent = textoProxima(e);
  const k = contadoresHoje(e);
  $('cSeguidos').textContent = `${k.seguidos}/${e.config.limiteDiario}`;
  $('cDeixados').textContent = k.deixados;
  $('cFollowBacks').textContent = k.followBacks;
  $('cDms').textContent = k.dms;
  $('tamFila').textContent = e.fila.length;
  $('origemAtual').textContent = e.origemAtual || '—';
  const aguardando = idsParaVerificarFollowBack(e.seguidos).length;
  const solicitados = Object.values(e.seguidos).filter((r) => r.status === STATUS.SOLICITADO).length;
  $('aguardando').textContent = solicitados ? `${aguardando} (${solicitados} Solicitado${solicitados > 1 ? 's' : ''} — privados, pedido pendente)` : aguardando;
  $('boasVindas').textContent = resumoBoasVindas(e).texto;
  $('carga3Dias').textContent = resumoCargaTresDias(e);
  $('btnPausar').disabled = c.pausado;
  atualizarBotaoEnviarAgora($('btnEnviarAgora'), e, proximaBoasVindasPendente(e));
  const crmDados = await chrome.storage.local.get([CHAVE_CRM, CHAVE_ULTIMO_ENVIO]);
  const crm = crmDados[CHAVE_CRM] || {};
  if (!$('crmUrl').dataset.carregado) { $('crmUrl').value = crm.url || CRM_URL_PADRAO; $('crmUrl').dataset.carregado = '1'; }
  $('crmChave').placeholder = crm.chave ? 'mkp_… (chave salva — deixe vazio para manter)' : 'mkp_…';
  $('ultimoEnvioCrm').textContent = descreverUltimoEnvio(crmDados[CHAVE_ULTIMO_ENVIO]);

  const cur = e.cursorOrigem;
  if (cur) {
    const situacao = cur.esgotado ? 'lista deste perfil acabou — escolha outro perfil' : 'reabastece a fila sozinho quando ficar curta';
    $('infoOrigem').textContent = `Total desde a busca — ${resumoBusca({ origem: cur.origem, ...cur.totais })}\nSituação: ${situacao}.`;
  }
  $('infoUltimaBusca').textContent = e.ultimaBusca ? `Última busca manual (${formatarSP(e.ultimaBusca.em)}): ${resumoBusca(e.ultimaBusca)}` : '';

  if (!configCarregada) {
    for (const k2 of CAMPOS_NUM) $(k2).value = e.config[k2];
    for (const k2 of CAMPOS_BOOL) $(k2).checked = Boolean(e.config[k2]);
    $('mensagem').value = e.config.mensagem;
    configCarregada = true;
  }

  const filtro = $('filtro').value.trim().toLowerCase().replace(/^@/, '');
  const linhas = e.historico
    .slice()
    .reverse()
    .filter((h) => !filtro || `${h.username} ${h.acao} ${h.resultado}`.toLowerCase().includes(filtro))
    .slice(0, 300);
  const tbody = $('historico');
  tbody.textContent = '';
  for (const h of linhas) {
    const tr = document.createElement('tr');
    for (const v of [formatarSP(h.em), h.username ? `@${h.username}` : '', h.acao, h.resultado, h.origem || '']) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

$('btnSalvar').addEventListener('click', async () => {
  const config = { mensagem: $('mensagem').value };
  for (const k of CAMPOS_NUM) config[k] = Number($(k).value);
  for (const k of CAMPOS_BOOL) config[k] = $(k).checked;
  $('btnSalvar').disabled = true;
  const r = await enviar('salvarConfig', { config });
  $('btnSalvar').disabled = false;
  $('salvoMsg').textContent = r.ok ? `Salvo às ${formatarSP(Date.now()).slice(11)}` : `Erro: ${r.erro}`;
  configCarregada = false;
  render();
});

$('btnRestaurarMsg').addEventListener('click', () => {
  $('mensagem').value = MENSAGEM_PADRAO;
  $('salvoMsg').textContent = 'Texto original restaurado — clique em Salvar.';
});

$('btnCsv').addEventListener('click', async () => {
  const { e } = await lerTudo();
  const blob = new Blob([gerarCsv(e.historico)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seguidor-instagram-historico-${diaSP(Date.now())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

$('btnLimparFila').addEventListener('click', async () => {
  if (!confirm('Remover todos os perfis da fila? (o histórico e os seguidos continuam)')) return;
  await enviar('limparFila');
  render();
});
$('btnPausar').addEventListener('click', async () => { await enviar('pausar'); render(); });
$('btnRetomar').addEventListener('click', async () => { const { e } = await lerTudo(); if (await retomarAgora(e)) render(); });
$('btnRetomarAgora').addEventListener('click', async () => { const { e } = await lerTudo(); if (await retomarAgora(e)) render(); });
$('btnLimparAlerta').addEventListener('click', async () => { await enviar('limparAlerta'); render(); });
$('filtro').addEventListener('input', render);
ligarBotaoConferir($('btnConferir'), $('resultadoConferir'));
ligarBotaoEnviarAgora($('btnEnviarAgora'), $('resultadoEnviarAgora'));

// 1.1.12: diagnóstico no CRM e testes a seco.
$('btnSalvarCrm').addEventListener('click', async () => {
  const r = await enviar('salvarCrm', { url: $('crmUrl').value, chave: $('crmChave').value });
  $('crmChave').value = '';
  $('resultadoCrm').textContent = r.ok ? `Salvo (${r.url}${r.temChave ? ', chave configurada' : ', SEM chave'}).` : `Erro: ${r.erro}`;
  render();
});
$('btnTestarCrm').addEventListener('click', async () => {
  $('resultadoCrm').textContent = 'Testando…';
  const r = await enviar('testarCrm');
  $('resultadoCrm').textContent = r.ok ? r.texto : `Erro: ${r.erro}`;
  render();
});
async function testar(tipo, botao) {
  const username = $('testeUsuario').value.trim();
  if (!username) { $('resultadoTeste').textContent = 'Digite o @ do perfil.'; return; }
  botao.disabled = true;
  $('resultadoTeste').textContent = 'Testando na janela de trabalho… (até 1 min)';
  try {
    const r = await enviar(tipo, { username });
    $('resultadoTeste').textContent = r.texto || `Erro: ${r.erro || 'sem resposta da extensão'}`;
  } catch (err) {
    $('resultadoTeste').textContent = `Erro: ${err.message}`;
  } finally {
    botao.disabled = false;
  }
}
$('btnTestarDm').addEventListener('click', () => testar('testarDm', $('btnTestarDm')));
$('btnTestarSeguir').addEventListener('click', () => testar('testarSeguir', $('btnTestarSeguir')));

chrome.storage.onChanged.addListener(render);
render();
