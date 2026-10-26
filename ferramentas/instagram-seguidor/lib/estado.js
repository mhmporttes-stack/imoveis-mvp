// Formato do estado persistido em chrome.storage.local e utilitários puros sobre ele.

import { MENSAGEM_PADRAO, LIMITE_DM_DIARIO_PADRAO } from './regras.js';
import { diaSP, formatarSP } from './tempo.js';

export const LIMITE_HISTORICO = 3000;

// 2 = versão 1.1.0 (perfis privados passam a ser seguidos por padrão).
export const VERSAO_ESTADO = 2;

export function configPadrao() {
  return {
    limiteDiario: 15, // SEGUIR por dia
    limiteUnfollowDiario: 15, // DEIXAR DE SEGUIR por dia (máximo)
    diasParaUnfollow: 3,
    inicioHora: 5, // 05:00 São Paulo
    fimHora: 22, // 22:00 São Paulo
    pularPrivados: false, // 1.1.0: perfis privados entram na fila (o seguir vira "Solicitado")
    pularSemFoto: false,
    maxBusca: 200, // máximo de perfis lidos por busca de origem
    intervaloMinimoMin: 20, // nunca duas ações do mesmo tipo com menos que isto
    verificarACadaMin: 2, // checagem de follow-back
    mensagem: MENSAGEM_PADRAO,
    dmAtiva: true,
    limiteDmDiario: LIMITE_DM_DIARIO_PADRAO, // 1.1.8: teto de DMs de boas-vindas por dia (excedente: dia seguinte)
  };
}

export function estadoInicial() {
  return {
    versao: VERSAO_ESTADO,
    config: configPadrao(),
    meuId: null,
    origemAtual: '',
    fila: [], // [{ id, username, origem, adicionadoEm, privado }]
    vistos: {}, // { id: motivo } — já avaliados (seguidos ou pulados), nunca voltam à fila
    seguidos: {}, // { id: registro } — SOMENTE perfis seguidos pela extensão
    agenda: { dia: null, follows: [], unfollows: [], limite: null, limiteUnfollow: null },
    contadores: { dia: null, seguidos: 0, deixados: 0, followBacks: 0, dms: 0, dmsIncertas: 0, novosSeguidores: 0 },
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
    // 1.1.7: visibilidade das boas-vindas no popup (última leitura dos meus seguidores e último erro de checagem/DM).
    boasVindas: { ultimaChecagemEm: null, via: null, ultimoErro: null },
    // 1.1.8: boas-vindas para TODO seguidor novo. `conhecidos` = ids já vistos na lista dos meus seguidores (a 1ª
    // leitura grava a linha de base, sem DM); `novosSeguidores` = registros de DM de quem não foi seguido pela extensão.
    meusSeguidores: { linhaDeBaseEm: null, conhecidos: {} },
    novosSeguidores: {}, // { id: { id, username, origem, detectadoEm, dmAgendadaPara, dmEnviadaEm, ... } }
  };
}

/** Garante que um estado carregado (talvez antigo/incompleto) tenha todos os campos. */
export function normalizarEstado(bruto) {
  const base = estadoInicial();
  const e = { ...base, ...(bruto || {}) };
  e.config = { ...base.config, ...((bruto && bruto.config) || {}) };
  e.agenda = { ...base.agenda, ...((bruto && bruto.agenda) || {}) };
  e.contadores = { ...base.contadores, ...((bruto && bruto.contadores) || {}) };
  e.boasVindas = { ...base.boasVindas, ...((bruto && bruto.boasVindas) || {}) };
  e.meusSeguidores = { ...base.meusSeguidores, ...((bruto && bruto.meusSeguidores) || {}) };
  if (!e.meusSeguidores.conhecidos || typeof e.meusSeguidores.conhecidos !== 'object') e.meusSeguidores.conhecidos = {};
  for (const k of ['fila', 'historico']) if (!Array.isArray(e[k])) e[k] = [];
  for (const k of ['vistos', 'seguidos', 'novosSeguidores']) if (!e[k] || typeof e[k] !== 'object') e[k] = {};
  migrarEstado(e, bruto);
  return e;
}

/**
 * Migrações de versões antigas do estado salvo.
 * 1 → 2 (extensão 1.1.0, pedido do dono "ela deve solicitar perfil fechado também"):
 * o padrão antigo "pular privados" (ligado) passa para o novo (desligado) e os privados
 * descartados só por serem privados voltam a poder entrar na fila. A opção continua no
 * painel para quem quiser religar.
 */
export function migrarEstado(e, bruto) {
  if (!bruto) return e;
  const versao = Number(bruto.versao) || 1;
  if (versao < 2) {
    if (e.config.pularPrivados === true) e.config.pularPrivados = false;
    for (const [id, motivo] of Object.entries(e.vistos)) if (motivo === 'privado') delete e.vistos[id];
  }
  e.versao = VERSAO_ESTADO;
  return e;
}

/** Zera os contadores quando muda o dia (fuso SP). Retorna true se zerou. */
export function virarDiaSeNecessario(estado, agora) {
  const hoje = diaSP(agora);
  if (estado.contadores.dia === hoje) return false;
  estado.contadores = { dia: hoje, seguidos: 0, deixados: 0, followBacks: 0, dms: 0, dmsIncertas: 0, novosSeguidores: 0 };
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

const ROTULOS_PULADOS = {
  privado: 'privados',
  sem_foto: 'sem foto',
  ja_seguido_antes: 'já seguidos antes',
  ja_avaliado: 'já avaliados antes',
  ja_na_fila: 'já na fila/repetidos',
  ja_relacionado: 'já me seguem ou já sigo',
  eu_mesmo: 'eu mesmo',
  sem_id: 'sem id',
};

/** Texto do resultado da busca: "lidos X, adicionados Y; descartados — privados 3, ...". */
export function resumoBusca(b) {
  if (!b) return '';
  const descartes = Object.entries(b.pulados || {})
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${ROTULOS_PULADOS[k] || k} ${v}`)
    .join(', ');
  let t = `${b.origem || ''}: ${b.lidos} lidos, ${b.adicionados} adicionados à fila`;
  if (descartes) t += `; descartados — ${descartes}`;
  if (b.via === 'graphql') t += ' (lista obtida pelo plano B/GraphQL)';
  if (b.erro) t += `.\n⚠ ${b.erro}`;
  return t;
}

/** Hora "HH:MM" (São Paulo) de um instante. */
function horaSP(ts) {
  return formatarSP(ts).slice(11, 16);
}

/**
 * 1.1.7: linha de situação das boas-vindas para o popup/painel:
 * "Boas-vindas: X enviadas hoje (teto N/dia), Y pendentes, última checagem de seguidores às HH:MM, último erro: …".
 * Pendente = a DM ainda vai sair (agendada ou em nova tentativa) — follow-back (`seguidos`) ou, desde a 1.1.8,
 * qualquer seguidor novo (`novosSeguidores`).
 * Sem envio = a extensão desistiu (3 falhas, DM desligada) ou o envio ficou incerto.
 */
export function resumoBoasVindas(e, agora = Date.now()) {
  const hoje = e.contadores && e.contadores.dia === diaSP(agora);
  const enviadasHoje = hoje ? e.contadores.dms || 0 : 0;
  const novosHoje = hoje ? e.contadores.novosSeguidores || 0 : 0;
  const teto = (e.config && e.config.limiteDmDiario) || LIMITE_DM_DIARIO_PADRAO;
  let pendentes = 0;
  let semEnvio = 0;
  const regs = [
    ...Object.values(e.seguidos || {}).filter((r) => r.followBackEm && !r.dmCoberta),
    ...Object.values(e.novosSeguidores || {}),
  ];
  for (const r of regs) {
    if (r.dmEnviadaEm) continue;
    if (r.dmDesistiu || r.dmIncerta) semEnvio += 1;
    else if (r.dmAgendadaPara || r.dmTentativaEm) pendentes += 1;
  }
  const bv = e.boasVindas || {};
  const checagem = bv.ultimaChecagemEm ? ` às ${horaSP(bv.ultimaChecagemEm)}` : ': ainda não';
  const erro = bv.ultimoErro && bv.ultimoErro.texto
    ? ` (${horaSP(bv.ultimoErro.em)}): ${String(bv.ultimoErro.texto).slice(0, 180)}`
    : ': nenhum';
  let texto = `Boas-vindas: ${enviadasHoje} enviada${enviadasHoje === 1 ? '' : 's'} hoje (teto ${teto}/dia), ${pendentes} pendente${pendentes === 1 ? '' : 's'}, última checagem de seguidores${checagem}, último erro${erro}`;
  if (semEnvio) texto += ` · ${semEnvio} ${semEnvio === 1 ? 'não pôde ser enviada' : 'não puderam ser enviadas'} (veja o histórico)`;
  if (novosHoje) texto += ` · ${novosHoje} seguidor${novosHoje === 1 ? '' : 'es'} novo${novosHoje === 1 ? '' : 's'} hoje`;
  const ms = e.meusSeguidores || {};
  if (!ms.linhaDeBaseEm) texto += ' · linha de base dos seguidores ainda não lida (a 1ª leitura não manda DM)';
  if (e.config && e.config.dmAtiva === false) texto = `DM desligada no painel — ${texto}`;
  return { enviadasHoje, pendentes, semEnvio, teto, novosHoje, ultimaChecagemEm: bv.ultimaChecagemEm || null, ultimoErro: bv.ultimoErro || null, texto };
}
