import { lerTudo, enviar, statusAtual, textoProxima, contadoresHoje, textoAlerta, estaParada, retomarAgora } from './painel-comum.js';

const $ = (id) => document.getElementById(id);

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
  $('cSeguidos').textContent = k.seguidos;
  $('cLimite').textContent = e.config.limiteDiario;
  $('cDeixados').textContent = k.deixados;
  $('cFollowBacks').textContent = k.followBacks;
  $('cDms').textContent = k.dms;
  $('tamFila').textContent = e.fila.length;
  $('origemAtual').textContent = e.origemAtual || '—';
  $('btnPausar').disabled = c.pausado;
  if (e.ultimaBusca && !$('resultadoBusca').dataset.ocupado) {
    const b = e.ultimaBusca;
    $('resultadoBusca').textContent = `Última busca (${b.origem}): ${b.lidos} lidos, ${b.adicionados} adicionados à fila${b.erro ? ` — ${b.erro}` : ''}.`;
  }
}

$('btnBuscar').addEventListener('click', async () => {
  const username = $('origem').value.trim();
  if (!username) return;
  $('btnBuscar').disabled = true;
  $('resultadoBusca').dataset.ocupado = '1';
  $('resultadoBusca').textContent = 'Buscando seguidores… (pode levar alguns minutos; pode fechar esta janela)';
  try {
    const r = await enviar('buscarOrigem', { username });
    $('resultadoBusca').textContent = r.ok
      ? `${r.resultado.lidos} lidos, ${r.resultado.adicionados} adicionados à fila.${r.resultado.erro ? ` Interrompido: ${r.resultado.erro}` : ''}`
      : `Erro: ${r.erro}`;
  } catch (err) {
    $('resultadoBusca').textContent = `Erro: ${err.message}`;
  } finally {
    delete $('resultadoBusca').dataset.ocupado;
    $('btnBuscar').disabled = false;
    render();
  }
});

$('btnPausar').addEventListener('click', async () => { await enviar('pausar'); render(); });
$('btnRetomar').addEventListener('click', async () => { const { e } = await lerTudo(); if (await retomarAgora(e)) render(); });
$('btnRetomarAgora').addEventListener('click', async () => { const { e } = await lerTudo(); if (await retomarAgora(e)) render(); });
$('btnPainel').addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener(render);
render();
