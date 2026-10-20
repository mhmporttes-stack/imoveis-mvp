// Funções compartilhadas pelo popup e pela página de opções.
import { formatarSP, diaSP } from './lib/tempo.js';
import { normalizarEstado } from './lib/estado.js';

export async function lerTudo() {
  const { estado, controle } = await chrome.storage.local.get(['estado', 'controle']);
  return { e: normalizarEstado(estado), c: { pausado: false, ...(controle || {}) } };
}

export function enviar(tipo, dados = {}) {
  return chrome.runtime.sendMessage({ tipo, ...dados });
}

/** { rotulo, classe } do status atual. */
export function statusAtual(e, c, agora = Date.now()) {
  if (e.pausaAte && agora < e.pausaAte) return { rotulo: 'Pausada (limite IG)', classe: 'bloqueada' };
  if (e.semSessao) return { rotulo: 'Sem sessão', classe: 'bloqueada' };
  if (c.pausado) return { rotulo: 'Pausada', classe: 'pausada' };
  return { rotulo: 'Ligada', classe: 'ligada' };
}

export function textoProxima(e) {
  if (!e.proxima) return '—';
  return e.proxima.em ? `${e.proxima.acao} — ${formatarSP(e.proxima.em)}` : e.proxima.acao;
}

export function contadoresHoje(e) {
  const hoje = diaSP(Date.now());
  return e.contadores.dia === hoje ? e.contadores : { seguidos: 0, deixados: 0, followBacks: 0, dms: 0 };
}

export function textoAlerta(e) {
  if (!e.alerta) return '';
  let t = e.alerta.texto || '';
  if (e.pausaAte && Date.now() < e.pausaAte) t += ` Volta sozinha em ${formatarSP(e.pausaAte)}.`;
  return t;
}
