import { lerTudo, enviar, statusAtual, textoProxima, contadoresHoje, textoAlerta, estaParada, retomarAgora, ligarBotaoConferir } from './painel-comum.js';
import { formatarSP, diaSP } from './lib/tempo.js';
import { gerarCsv, resumoBusca, resumoBoasVindas } from './lib/estado.js';
import { MENSAGEM_PADRAO, STATUS, idsParaVerificarFollowBack } from './lib/regras.js';

const $ = (id) => document.getElementById(id);
const CAMPOS_NUM = ['limiteDiario', 'limiteUnfollowDiario', 'diasParaUnfollow', 'maxBusca'];
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
  $('btnPausar').disabled = c.pausado;

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

chrome.storage.onChanged.addListener(render);
render();
