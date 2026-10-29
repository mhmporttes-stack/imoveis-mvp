// 1.2.0 (EXT-1, dono, 2026-10-29): números editados pelo dono na tela "Extensões" do CRM → configuração da extensão, e
// o resumo do sinal de saúde. Funções puras (testadas em tests/crm.test.mjs). Sem chave do CRM vale o painel local.

import { diaSP } from './tempo.js';

// campo do CRM → campo da extensão, com a faixa fechada (a mesma do CRM: lib/browser-extensions-core.mjs).
export const CAMPOS_CRM = [
  { crm: 'followPerDay', local: 'limiteDiario', min: 0, max: 40 },
  { crm: 'unfollowPerDay', local: 'limiteUnfollowDiario', min: 0, max: 40 },
  { crm: 'welcomePerDay', local: 'limiteDmDiario', min: 1, max: 100 },
  { crm: 'checkFollowersEveryMin', local: 'verificarACadaMin', min: 5, max: 60 },
  { crm: 'startHour', local: 'inicioHora', min: 0, max: 23 },
  { crm: 'endHour', local: 'fimHora', min: 1, max: 24 },
];

/**
 * Aplica a configuração do CRM em `e.config`. Valor ausente/inválido não mexe; horário de início ≥ fim é ignorado.
 * Retorna { mudou: [campos locais alterados], limitesMudaram, verificarMudou }.
 */
export function aplicarConfigDoCrm(e, configCrm) {
  if (!configCrm || typeof configCrm !== 'object') return { mudou: [], limitesMudaram: false, verificarMudou: false };
  const novo = { ...e.config };
  for (const c of CAMPOS_CRM) {
    const v = Number(configCrm[c.crm]);
    if (configCrm[c.crm] === null || configCrm[c.crm] === undefined || configCrm[c.crm] === '' || !Number.isFinite(v)) continue;
    novo[c.local] = Math.min(c.max, Math.max(c.min, Math.round(v)));
  }
  if (novo.inicioHora >= novo.fimHora) { novo.inicioHora = e.config.inicioHora; novo.fimHora = e.config.fimHora; }
  const mudou = CAMPOS_CRM.map((c) => c.local).filter((k) => novo[k] !== e.config[k]);
  e.config = novo;
  return {
    mudou,
    limitesMudaram: mudou.some((k) => ['limiteDiario', 'limiteUnfollowDiario', 'inicioHora', 'fimHora'].includes(k)),
    verificarMudou: mudou.includes('verificarACadaMin'),
  };
}

/** Resumo para o sinal de saúde (sem @ de ninguém: só contagens, horários e o texto do alerta, que o crm-link limpa). */
export function resumoSaude(e, controle, { paradoPeloCrm = false, agora = Date.now() } = {}) {
  const hoje = e.contadores && e.contadores.dia === diaSP(agora);
  const n = (k) => (hoje ? e.contadores[k] || 0 : 0);
  const pausado = e.pausaAte && agora < e.pausaAte;
  const alerta = e.alerta && e.alerta.texto ? e.alerta.texto : '';
  return {
    ok: !alerta && !e.semSessao,
    stage: (e.proxima && e.proxima.acao) || '',
    error: e.semSessao ? 'Sem sessão do Instagram neste Chrome' : alerta,
    today: {
      follow: { done: n('seguidos'), limit: e.config.limiteDiario },
      unfollow: { done: n('deixados'), limit: e.config.limiteUnfollowDiario },
      welcome: { done: n('dms'), limit: e.config.limiteDmDiario },
    },
    pausedUntil: pausado ? new Date(e.pausaAte).toISOString() : null,
    pauseReason: pausado ? alerta : '',
    manualPause: Boolean(controle && controle.pausado),
    stoppedByCrm: Boolean(paradoPeloCrm),
  };
}
