// Formato do estado persistido em chrome.storage.local e utilitários puros sobre ele.

import { MENSAGEM_PADRAO } from './regras.js';
import { diaSP, formatarSP } from './tempo.js';

export const LIMITE_HISTORICO = 3000;

export function configPadrao() {
  return {
    limiteDiario: 15, // SEGUIR por dia
    limiteUnfollowDiario: 15, // DEIXAR DE SEGUIR por dia (máximo)
    diasParaUnfollow: 3,
    inicioHora: 5, // 05:00 São Paulo
    fimHora: 22, // 22:00 São Paulo
    pularPrivados: true,
    pularSemFoto: false,
    maxBusca: 200, // máximo de perfis lidos por busca de origem
    intervaloMinimoMin: 20, // nunca duas ações do mesmo tipo com menos que isto
    verificarACadaMin: 2, // checagem de follow-back
    mensagem: MENSAGEM_PADRAO,
    dmAtiva: true,
  };
}

export function estadoInicial() {
  return {
    versao: 1,
    config: configPadrao(),
    meuId: null,
    origemAtual: '',
    fila: [], // [{ id, username, origem, adicionadoEm, privado }]
    vistos: {}, // { id: motivo } — já avaliados (seguidos ou pulados), nunca voltam à fila
    seguidos: {}, // { id: registro } — SOMENTE perfis seguidos pela extensão
    agenda: { dia: null, follows: [], unfollows: [], limite: null, limiteUnfollow: null },
    contadores: { dia: null, seguidos: 0, deixados: 0, followBacks: 0, dms: 0 },
    historico: [], // [{ em, username, acao, resultado, origem }]
    pausaAte: null, // pausa automática de 24 h (limite/bloqueio)
    esfriarAte: null, // espera curta (15 min) após "aguarde" do Instagram
    errosRecentes: [], // horários de erros de limite/aguarde (janela de 1 h)
    semSessao: false,
    sessaoRecheckEm: null,
    alerta: null,
    proxima: null, // { acao, em }
    ultimaBusca: null,
    ultimaDmEm: null,
  };
}

/** Garante que um estado carregado (talvez antigo/incompleto) tenha todos os campos. */
export function normalizarEstado(bruto) {
  const base = estadoInicial();
  const e = { ...base, ...(bruto || {}) };
  e.config = { ...base.config, ...((bruto && bruto.config) || {}) };
  e.agenda = { ...base.agenda, ...((bruto && bruto.agenda) || {}) };
  e.contadores = { ...base.contadores, ...((bruto && bruto.contadores) || {}) };
  for (const k of ['fila', 'historico']) if (!Array.isArray(e[k])) e[k] = [];
  for (const k of ['vistos', 'seguidos']) if (!e[k] || typeof e[k] !== 'object') e[k] = {};
  return e;
}

/** Zera os contadores quando muda o dia (fuso SP). Retorna true se zerou. */
export function virarDiaSeNecessario(estado, agora) {
  const hoje = diaSP(agora);
  if (estado.contadores.dia === hoje) return false;
  estado.contadores = { dia: hoje, seguidos: 0, deixados: 0, followBacks: 0, dms: 0 };
  return true;
}

export function registrarHistorico(estado, { em = Date.now(), username = '', acao, resultado = '', origem = '' }) {
  estado.historico.push({ em, username, acao, resultado, origem });
  if (estado.historico.length > LIMITE_HISTORICO) {
    estado.historico.splice(0, estado.historico.length - LIMITE_HISTORICO);
  }
}

function celulaCsv(v) {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV (separador ";" e BOM, para abrir direto no Excel em português). */
export function gerarCsv(historico) {
  const linhas = [['data_hora_sp', 'perfil', 'acao', 'resultado', 'origem']];
  for (const h of historico || []) {
    linhas.push([formatarSP(h.em), h.username ? `@${h.username}` : '', h.acao, h.resultado, h.origem]);
  }
  return '﻿' + linhas.map((l) => l.map(celulaCsv).join(';')).join('\r\n') + '\r\n';
}
