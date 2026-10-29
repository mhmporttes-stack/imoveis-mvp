import { lerTudo, enviar, statusAtual, textoProxima, contadoresHoje, textoAlerta, estaParada, retomarAgora, ligarBotaoConferir, renderAvisoCrm } from './painel-comum.js';
import { formatarSP, diaSP } from './lib/tempo.js';
import { gerarCsv, resumoBusca, resumoBoasVindas, resumoCargaTresDias } from './lib/estado.js';
import { MENSAGEM_PADRAO, STATUS, idsParaVerificarFollowBack } from './lib/regras.js';

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
  $('janelaHoras').textContent = `${String(e.config.inicioHora).padStart(2, '0')}:00–${String(e.config.fimHora).padStart(2, '0')}:00`;
  $('origemAtual').textContent = e.origemAtual || '—';
  const aguardando = idsParaVerificarFollowBack(e.seguidos).length;
  const solicitados = Object.values(e.seguidos).filter((r) => r.status === STATUS.SOLICITADO).length;
  $('aguardando').textContent = solicitados ? `${aguardando} (${solicitados} Solicitado${solicitados > 1 ? 's' : ''} — privados, pedido pendente)` : aguardando;
  $('boasVindas').textContent = resumoBoasVindas(e).texto;
  $('carga3Dias').textContent = resumoCargaTresDias(e);
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
    $('meuUsuario').value = e.config.meuUsuario ? `@${e.config.meuUsuario}` : '';
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
  const config = { mensagem: $('mensagem').value, meuUsuario: $('meuUsuario').value };
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

// 1.2.0: chave do CRM (tela Extensões). Endereço diferente do padrão pede a permissão do Chrome para ele.
$('btnSalvarCrm').addEventListener('click', async () => {
  const baseUrl = $('crmUrl').value.trim();
  $('btnSalvarCrm').disabled = true;
  try {
    if (baseUrl && !/^https:\/\/www\.matheusmachadoimoveis\.com\.br\/?$/i.test(baseUrl)) {
      const origem = new URL(/^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`).origin;
      if (!(await chrome.permissions.request({ origins: [`${origem}/*`] }))) throw new Error('Sem permissão para acessar esse endereço.');
    }
    const r = await enviar('salvarCrm', { baseUrl, key: $('crmChave').value });
    $('crmChave').value = '';
    $('crmMsg').textContent = r.ok ? (r.origem === 'crm' ? `Ligada ao CRM${r.parado ? ' — está PARADA pelo CRM' : ''}.` : r.origem === 'chave_invalida' ? 'O CRM recusou a chave.' : r.origem === 'sem_chave' ? 'Salvo (sem chave).' : 'Salvo, mas o CRM não respondeu agora.') : `Erro: ${r.erro}`;
  } catch (err) {
    $('crmMsg').textContent = `Erro: ${err.message}`;
  } finally {
    $('btnSalvarCrm').disabled = false;
    renderAvisoCrm($('avisoCrm'));
  }
});

async function carregarCrm() {
  const r = await enviar('situacaoCrm').catch((err) => ({ ok: false, erro: err.message }));
  if (r && r.ok) {
    $('crmUrl').value = r.baseUrl;
    $('crmChave').placeholder = r.temChave ? 'chave salva — cole outra só se gerar nova' : 'cole a chave igs_… aqui';
  }
}

chrome.storage.onChanged.addListener(render);
render();
carregarCrm();
renderAvisoCrm($('avisoCrm'));
