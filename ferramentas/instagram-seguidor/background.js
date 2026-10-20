// Service worker da extensão: agenda, fila, seguir / deixar de seguir, follow-back e DM.
// Toda a comunicação com o Instagram passa por instagram-api.js.

import { criarApiChrome, lerSessao, ErroInstagram } from './instagram-api.js';
import { MINUTO, diaSP, janelaDoDia, dentroDaJanela, proximaAbertura, formatarSP } from './lib/tempo.js';
import { planejarHorarios, decidirHorario, atrasoHumanoMs, atrasoDmMs } from './lib/agenda.js';
import {
  STATUS,
  filtrarCandidatos,
  escolherParaUnfollow,
  idsParaVerificarFollowBack,
  registrarFollowBack,
  ajustarParaJanela,
  dmPronta,
  aplicarPausaPorErro,
  decidirPausa,
  JANELA_ERROS_MS,
  estaAtiva,
  precisaReabastecer,
  alvoFila,
} from './lib/regras.js';
import { normalizarEstado, virarDiaSeNecessario, registrarHistorico, resumoBusca } from './lib/estado.js';

const api = criarApiChrome();

const ALARME_ACAO = 'acao'; // próxima ação agendada (one-shot)
const ALARME_VERIFICAR = 'verificar'; // checagem de follow-back (a cada 2 min)
const ALARME_VIGIA = 'vigia'; // rede de segurança (a cada 5 min): virada de dia, abertura da janela etc.
const VARREDURA_COMPLETA_MS = 30 * MINUTO; // show_many em todos os seguidos, de 30 em 30 min
const INTERVALO_MIN_ENTRE_DMS = 60 * 1000;
const INTERVALO_REABASTECER_MS = 20 * MINUTO;

// ---------------------------------------------------------------- utilidades

let corrente = Promise.resolve();
/** Executa operações uma de cada vez (evita duas rotinas mexendo no estado juntas). */
function serializar(fn) {
  const p = corrente.then(fn, fn);
  corrente = p.catch(() => {});
  return p;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const pausaHumana = () => esperar(atrasoHumanoMs());

async function carregar() {
  const { estado } = await chrome.storage.local.get('estado');
  return normalizarEstado(estado);
}
async function salvar(e) {
  await chrome.storage.local.set({ estado: e });
}
async function lerControle() {
  const { controle } = await chrome.storage.local.get('controle');
  return { pausado: false, ...(controle || {}) };
}

function log(e, item) {
  registrarHistorico(e, { em: Date.now(), ...item });
  console.log(`[Seguidor IG] ${formatarSP(Date.now())} ${item.acao} @${item.username || '-'} → ${item.resultado || ''}`);
}

function notificar(titulo, mensagem) {
  try {
    chrome.notifications.create(`ig-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icones/icone-192.png',
      title: titulo,
      message: mensagem,
      priority: 2,
    });
  } catch (err) {
    console.warn('Falha ao notificar', err);
  }
}

async function atualizarSelo(e, c) {
  const agora = Date.now();
  let texto = '';
  let cor = '#2563eb';
  if (c.pausado) { texto = 'II'; cor = '#6b7280'; }
  if (e.semSessao || (e.pausaAte && agora < e.pausaAte) || (e.esfriarAte && agora < e.esfriarAte)) { texto = '!'; cor = '#dc2626'; }
  try {
    await chrome.action.setBadgeText({ text: texto });
    await chrome.action.setBadgeBackgroundColor({ color: cor });
  } catch { /* sem action em testes */ }
}

const CONTEXTOS_DE_ACAO = new Set(['seguir', 'deixar de seguir', 'DM']);

/**
 * Trata erro do Instagram numa rotina AUTOMÁTICA. Usa decidirPausa:
 * - limite explícito numa ação (seguir/deixar/DM) → pausa 24 h;
 * - "aguarde"/limite em leitura → espera 15 min; 3 erros desses em 1 h → pausa 24 h;
 * - sessão → pausa até o login voltar (sem 24 h).
 * Retorna o tipo do erro.
 */
function tratarErro(e, err, contexto, username = '') {
  const tipo = err instanceof ErroInstagram ? err.tipo : 'outro';
  const msg = err && err.message ? err.message : String(err);
  const agora = Date.now();
  const decisao = decidirPausa({ tipo, ehAcao: CONTEXTOS_DE_ACAO.has(contexto), recentes: e.errosRecentes || [], agora });
  if (tipo === 'limite' || tipo === 'aguarde') {
    e.errosRecentes = [...(e.errosRecentes || []).filter((t) => agora - t < JANELA_ERROS_MS), agora];
  }
  if (decisao === 'pausa24h') {
    aplicarPausaPorErro(e, 'pausa24h', agora, msg);
    log(e, { username, acao: contexto, resultado: `BLOQUEIO/LIMITE: ${msg} — pausado por 24 h` });
    notificar('Instagram: limite/bloqueio', `A extensão pausou sozinha por 24 h. Motivo: ${msg.slice(0, 200)}`);
  } else if (decisao === 'esfriar') {
    aplicarPausaPorErro(e, 'esfriar', agora, msg);
    log(e, { username, acao: contexto, resultado: `Instagram pediu para esperar: ${msg} — nova tentativa em 15 min` });
  } else if (decisao === 'sessao') {
    const jaEstava = e.semSessao;
    aplicarPausaPorErro(e, 'sessao', agora, msg);
    log(e, { username, acao: contexto, resultado: `Sessão não reconhecida pelo Instagram — pausado até entrar de novo (${msg})` });
    if (!jaEstava) notificar('Instagram: sem sessão', 'O Instagram não reconheceu o login deste Chrome. Abra o instagram.com e entre de novo.');
  } else {
    log(e, { username, acao: contexto, resultado: `erro (${tipo}): ${msg}` });
    if (tipo === 'mudanca_api') {
      e.alerta = { tipo, em: agora, texto: msg };
    }
  }
  return tipo;
}

const bloqueante = (tipo) => tipo === 'limite' || tipo === 'aguarde' || tipo === 'sessao';

/** Confere a sessão no navegador (cookies). Pausa/retoma sozinha. */
async function checarSessao(e) {
  const s = await lerSessao();
  if (!s.logado) {
    if (!e.semSessao) {
      aplicarPausaPorErro(e, 'sessao', Date.now());
      log(e, { acao: 'sessão', resultado: 'Sem sessão logada no instagram.com — pausado' });
      notificar('Instagram: sem sessão', 'Entre no instagram.com neste Chrome. A extensão volta sozinha.');
    }
    return false;
  }
  if (e.semSessao) {
    // O Instagram recusou a sessão há pouco: espera um pouco antes de tentar de novo.
    if (e.sessaoRecheckEm && Date.now() < e.sessaoRecheckEm) return false;
    e.semSessao = false;
    e.sessaoRecheckEm = null;
    if (e.alerta && e.alerta.tipo === 'sessao') e.alerta = null;
    log(e, { acao: 'sessão', resultado: 'Sessão do Instagram encontrada — retomando' });
  }
  e.meuId = s.meuId;
  return true;
}

// ---------------------------------------------------------------- agenda do dia

function prepararAgenda(e, agora) {
  virarDiaSeNecessario(e, agora);
  const cfg = e.config;
  const hoje = diaSP(agora);
  const { inicio, fim } = janelaDoDia(agora, cfg);
  const minimo = cfg.intervaloMinimoMin * MINUTO;
  const a = e.agenda;
  if (a.dia === hoje && a.limite === cfg.limiteDiario && a.limiteUnfollow === cfg.limiteUnfollowDiario) return;

  const de = Math.max(agora, inicio);
  const restF = Math.max(0, cfg.limiteDiario - e.contadores.seguidos);
  const restU = Math.max(0, cfg.limiteUnfollowDiario - e.contadores.deixados);
  e.agenda = {
    dia: hoje,
    limite: cfg.limiteDiario,
    limiteUnfollow: cfg.limiteUnfollowDiario,
    follows: planejarHorarios({ inicio: de, fim, quantidade: restF, intervaloMinimoMs: minimo }),
    unfollows: planejarHorarios({ inicio: de, fim, quantidade: restU, intervaloMinimoMs: minimo, deslocamento: 0.5 }),
  };
  if (e.agenda.follows.length || e.agenda.unfollows.length) {
    log(e, {
      acao: 'agenda',
      resultado: `Dia ${hoje}: ${e.agenda.follows.length} seguir (1º ${formatarSP(e.agenda.follows[0])}), ${e.agenda.unfollows.length} horários de deixar de seguir`,
    });
  }
}

/** Replaneja horários atrasados (PC dormiu/desligado) a partir de agora, sem rajada. */
function replanejarSeAtrasado(e, chave, agora) {
  const pend = e.agenda[chave];
  const decisao = decidirHorario(pend, agora);
  if (decisao !== 'replanejar') return decisao;
  const { fim } = janelaDoDia(agora, e.config);
  e.agenda[chave] = planejarHorarios({
    inicio: agora,
    fim,
    quantidade: pend.length,
    intervaloMinimoMs: e.config.intervaloMinimoMin * MINUTO,
    deslocamento: chave === 'unfollows' ? 0.5 : 0,
  });
  log(e, { acao: 'agenda', resultado: `${chave === 'follows' ? 'Seguir' : 'Deixar de seguir'}: horários atrasados, redistribuídos ${e.agenda[chave].length} até o fim da janela` });
  return decidirHorario(e.agenda[chave], agora);
}

// ---------------------------------------------------------------- ações

async function processarDm(e, agora) {
  const cfg = e.config;
  // Envio que ficou "pela metade" (service worker morreu no meio): nunca reenviar.
  for (const r of Object.values(e.seguidos)) {
    if (r.dmTentativaEm && !r.dmEnviadaEm && !r.dmIncerta && agora - r.dmTentativaEm > 5 * MINUTO) {
      r.dmIncerta = true;
      log(e, { username: r.username, acao: 'DM', resultado: 'envio interrompido — não será repetido (confira no Instagram)', origem: r.origem });
    }
  }
  if (!cfg.dmAtiva) return 'ok';
  const prontas = Object.values(e.seguidos).filter((r) => dmPronta(r, agora, cfg)).sort((a, b) => a.dmAgendadaPara - b.dmAgendadaPara);
  if (!prontas.length) return 'ok';
  if (e.ultimaDmEm && agora - e.ultimaDmEm < INTERVALO_MIN_ENTRE_DMS) {
    for (const r of prontas) r.dmAgendadaPara = e.ultimaDmEm + INTERVALO_MIN_ENTRE_DMS + atrasoHumanoMs() * 10;
    return 'ok';
  }
  const r = prontas[0];
  // Espaça as demais (nenhuma rajada de DMs).
  prontas.slice(1).forEach((o, i) => { o.dmAgendadaPara = Math.max(o.dmAgendadaPara, agora + (i + 1) * (INTERVALO_MIN_ENTRE_DMS + atrasoDmMs() / 2)); });

  r.dmTentativaEm = Date.now();
  await salvar(e); // marca ANTES de enviar: garante "uma única vez"
  await pausaHumana();
  try {
    const res = await api.enviarDm(r.id, cfg.mensagem);
    r.dmEnviadaEm = Date.now();
    e.ultimaDmEm = r.dmEnviadaEm;
    e.contadores.dms += 1;
    log(e, { username: r.username, acao: 'DM', resultado: `boas-vindas enviada (${res.modo})`, origem: r.origem });
    return 'ok';
  } catch (err) {
    const status = err && err.status;
    const tipo = err instanceof ErroInstagram ? err.tipo : 'outro';
    if (bloqueante(tipo)) {
      // O Instagram recusou: não saiu. Reagenda para depois da pausa.
      r.dmTentativaEm = null;
      tratarErro(e, err, 'DM', r.username);
      const volta = Math.max(e.pausaAte || 0, e.esfriarAte || 0, Date.now());
      r.dmAgendadaPara = ajustarParaJanela(volta + atrasoDmMs(), volta, cfg);
      return tipo;
    }
    if (tipo !== 'incerto' && status >= 400 && status < 500) {
      r.dmTentativaEm = null;
      r.dmFalhas = (r.dmFalhas || 0) + 1;
      if (r.dmFalhas >= 3) {
        r.dmDesistiu = true;
        log(e, { username: r.username, acao: 'DM', resultado: `falhou 3 vezes — desistindo (${err.message})`, origem: r.origem });
      } else {
        r.dmAgendadaPara = ajustarParaJanela(Date.now() + 15 * MINUTO, Date.now(), cfg);
        log(e, { username: r.username, acao: 'DM', resultado: `recusada (${err.message}) — nova tentativa às ${formatarSP(r.dmAgendadaPara)}`, origem: r.origem });
      }
      if (tipo === 'mudanca_api') e.alerta = { tipo, em: Date.now(), texto: err.message };
      return tipo;
    }
    // Não dá para saber se saiu: nunca reenviar.
    r.dmIncerta = true;
    log(e, { username: r.username, acao: 'DM', resultado: `resultado incerto, não será repetida: ${err.message || err}`, origem: r.origem });
    return tipo;
  }
}

async function processarSeguir(e, agora) {
  const decisao = replanejarSeAtrasado(e, 'follows', agora);
  if (decisao !== 'executar') return 'ok';
  e.agenda.follows.shift(); // consome o horário
  const cfg = e.config;
  if (e.contadores.seguidos >= cfg.limiteDiario) return 'ok';

  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const cand = e.fila.shift();
    if (!cand) {
      if (e.avisoFilaVazia !== diaSP(agora)) {
        e.avisoFilaVazia = diaSP(agora);
        log(e, { acao: 'seguir', resultado: 'fila vazia — busque seguidores de um perfil de referência' });
      }
      return 'ok';
    }
    if (e.seguidos[cand.id] || e.vistos[cand.id]) continue;

    await pausaHumana();
    let st;
    try {
      st = await api.amizade(cand.id);
    } catch (err) {
      const tipo = tratarErro(e, err, 'checar antes de seguir', cand.username);
      if (bloqueante(tipo)) { e.fila.unshift(cand); return tipo; }
      e.vistos[cand.id] = `erro:${tipo}`;
      continue;
    }
    if (st.meSegue || st.seguindo || st.pedidoPendente) {
      e.vistos[cand.id] = 'ja_relacionado';
      log(e, { username: cand.username, acao: 'pulado', resultado: st.meSegue ? 'já me segue' : 'já sigo', origem: cand.origem });
      continue;
    }
    if (cfg.pularPrivados && st.privado) {
      e.vistos[cand.id] = 'privado';
      log(e, { username: cand.username, acao: 'pulado', resultado: 'perfil privado', origem: cand.origem });
      continue;
    }

    await pausaHumana();
    try {
      const r = await api.seguir(cand.id);
      e.vistos[cand.id] = 'seguido';
      e.seguidos[cand.id] = {
        id: cand.id,
        username: cand.username,
        origem: cand.origem,
        seguidoEm: Date.now(),
        status: r.seguindo ? STATUS.SEGUINDO : STATUS.SOLICITADO,
      };
      e.contadores.seguidos += 1;
      log(e, { username: cand.username, acao: 'seguir', resultado: r.seguindo ? 'seguindo' : 'pedido enviado (privado)', origem: cand.origem });
      return 'ok';
    } catch (err) {
      const tipo = tratarErro(e, err, 'seguir', cand.username);
      if (bloqueante(tipo)) { e.fila.unshift(cand); return tipo; }
      e.vistos[cand.id] = `erro:${tipo}`;
      return tipo;
    }
  }
  return 'ok';
}

function marcarFollowBack(e, r, agora) {
  const ja = Boolean(r.followBackEm);
  registrarFollowBack(r, agora, e.config);
  if (!ja && !e.config.dmAtiva && !r.dmEnviadaEm) {
    // DM desligada no painel: esta pessoa não recebe mensagem depois, nem se religar.
    r.dmAgendadaPara = null;
    r.dmDesistiu = true;
  }
  if (!ja) {
    e.contadores.followBacks += 1;
    log(e, {
      username: r.username,
      acao: 'follow-back',
      resultado: e.config.dmAtiva ? `seguiu de volta — DM agendada para ${formatarSP(r.dmAgendadaPara)}` : 'seguiu de volta',
      origem: r.origem,
    });
  }
}

async function processarDeixarDeSeguir(e, agora) {
  const decisao = replanejarSeAtrasado(e, 'unfollows', agora);
  if (decisao !== 'executar') return 'ok';
  e.agenda.unfollows.shift();
  const cfg = e.config;
  if (e.contadores.deixados >= cfg.limiteUnfollowDiario) return 'ok';

  const excluir = new Set();
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const r = escolherParaUnfollow(e.seguidos, agora, cfg.diasParaUnfollow, excluir);
    if (!r) return 'ok';
    excluir.add(String(r.id));

    await pausaHumana();
    let st;
    try {
      st = await api.amizade(r.id);
    } catch (err) {
      const tipo = tratarErro(e, err, 'checar antes de deixar de seguir', r.username);
      if (bloqueante(tipo)) return tipo;
      continue;
    }
    if (st.meSegue) { marcarFollowBack(e, r, Date.now()); continue; }
    if (!st.seguindo && !st.pedidoPendente) {
      r.status = STATUS.NAO_SEGUE_MAIS;
      log(e, { username: r.username, acao: 'deixar de seguir', resultado: 'já não seguia (nada feito)', origem: r.origem });
      continue;
    }

    await pausaHumana();
    try {
      await api.deixarDeSeguir(r.id);
      r.status = STATUS.DEIXADO;
      r.deixadoEm = Date.now();
      e.contadores.deixados += 1;
      log(e, { username: r.username, acao: 'deixar de seguir', resultado: `não seguiu de volta em ${cfg.diasParaUnfollow} dias`, origem: r.origem });
      return 'ok';
    } catch (err) {
      return tratarErro(e, err, 'deixar de seguir', r.username);
    }
  }
  return 'ok';
}

async function verificarFollowBacks(e, agora) {
  const ids = new Set(idsParaVerificarFollowBack(e.seguidos));
  if (!ids.size || !e.meuId) return 'ok';

  // 1) Meus seguidores mais recentes (uma página): pega follow-back em poucos minutos.
  try {
    await pausaHumana();
    const { usuarios } = await api.paginaSeguidores(e.meuId);
    for (const u of usuarios) {
      const id = String(u.pk ?? u.id ?? '');
      if (ids.has(id)) { marcarFollowBack(e, e.seguidos[id], Date.now()); ids.delete(id); }
    }
  } catch (err) {
    const tipo = tratarErro(e, err, 'verificar follow-back');
    if (bloqueante(tipo)) return tipo;
  }

  // 2) Varredura completa por show_many (de 30 em 30 min).
  if (ids.size && (!e.ultimaVarreduraEm || agora - e.ultimaVarreduraEm >= VARREDURA_COMPLETA_MS)) {
    e.ultimaVarreduraEm = agora;
    const lista = [...ids];
    for (let i = 0; i < lista.length; i += 50) {
      await pausaHumana();
      try {
        const mapa = await api.amizadeVarios(lista.slice(i, i + 50));
        for (const [id, st] of Object.entries(mapa)) {
          if (st.meSegue === true && e.seguidos[id]) marcarFollowBack(e, e.seguidos[id], Date.now());
        }
      } catch (err) {
        const tipo = tratarErro(e, err, 'verificar follow-back (show_many)');
        if (bloqueante(tipo)) return tipo;
        break;
      }
    }
  }
  return 'ok';
}

// ---------------------------------------------------------------- próximo alarme

async function agendarProximo(e, c) {
  const agora = Date.now();
  const cfg = e.config;
  let proxima = null;
  if (c.pausado) {
    proxima = { acao: 'Pausada manualmente', em: null };
  } else if (e.pausaAte && agora < e.pausaAte) {
    proxima = { acao: 'Fim da pausa automática (24 h)', em: e.pausaAte };
  } else if (e.esfriarAte && agora < e.esfriarAte) {
    proxima = { acao: 'Instagram pediu para esperar — nova tentativa', em: e.esfriarAte };
  } else if (e.semSessao) {
    proxima = { acao: 'Aguardando login no instagram.com', em: e.sessaoRecheckEm && e.sessaoRecheckEm > agora ? e.sessaoRecheckEm : null };
  } else {
    const opcoes = [];
    if (e.agenda.follows[0]) opcoes.push({ acao: 'Seguir', em: e.agenda.follows[0] });
    if (e.agenda.unfollows[0]) opcoes.push({ acao: 'Deixar de seguir (se houver alguém com 3 dias)', em: e.agenda.unfollows[0] });
    if (cfg.dmAtiva) {
      for (const r of Object.values(e.seguidos)) {
        if (r.dmAgendadaPara && !r.dmEnviadaEm && !r.dmTentativaEm && !r.dmDesistiu) opcoes.push({ acao: `DM de boas-vindas para @${r.username}`, em: r.dmAgendadaPara });
      }
    }
    for (const o of opcoes) if (!dentroDaJanela(o.em, cfg)) o.em = proximaAbertura(o.em, cfg);
    opcoes.sort((a, b) => a.em - b.em);
    proxima = opcoes[0] || { acao: 'Abertura da janela (novo dia)', em: proximaAbertura(janelaDoDia(agora, cfg).fim, cfg) };
  }
  e.proxima = proxima;
  await chrome.alarms.clear(ALARME_ACAO);
  if (proxima.em) await chrome.alarms.create(ALARME_ACAO, { when: Math.max(proxima.em, agora + 1000) });
  await atualizarSelo(e, c);
}

// ---------------------------------------------------------------- ciclos

async function ciclo() {
  const e = await carregar();
  const c = await lerControle();
  const agora = Date.now();
  prepararAgenda(e, agora);

  if (e.esfriarAte && agora >= e.esfriarAte) {
    e.esfriarAte = null;
    if (e.alerta && e.alerta.tipo === 'aguarde') e.alerta = null;
  }
  if (e.pausaAte && agora >= e.pausaAte) {
    e.pausaAte = null;
    if (e.alerta && e.alerta.tipo === 'limite') e.alerta = null;
    log(e, { acao: 'pausa', resultado: 'pausa automática de 24 h encerrada — retomando' });
  }
  await checarSessao(e);

  if (estaAtiva(e, c, agora) && dentroDaJanela(agora, e.config)) {
    let r = await processarDm(e, agora);
    if (!bloqueante(r)) r = await processarSeguir(e, Date.now());
    if (!bloqueante(r)) r = await processarDeixarDeSeguir(e, Date.now());
    if (!bloqueante(r)) await reabastecerFila(e, Date.now());
  } else if (!dentroDaJanela(agora, e.config)) {
    // Fora da janela: DMs pendentes vão para a próxima abertura + 1–3 min.
    for (const r of Object.values(e.seguidos)) {
      if (r.dmAgendadaPara && !r.dmEnviadaEm && !r.dmTentativaEm && !dentroDaJanela(r.dmAgendadaPara, e.config)) {
        r.dmAgendadaPara = ajustarParaJanela(r.dmAgendadaPara, agora, e.config);
      }
    }
  }
  await agendarProximo(e, c);
  await salvar(e);
}

async function cicloVerificar() {
  const e = await carregar();
  const c = await lerControle();
  const agora = Date.now();
  if (!estaAtiva(e, c, agora) || !dentroDaJanela(agora, e.config)) return;
  if (!(await checarSessao(e))) { await agendarProximo(e, c); await salvar(e); return; }
  await verificarFollowBacks(e, agora);
  await agendarProximo(e, c);
  await salvar(e);
}

async function buscarOrigem(username) {
  const e = await carregar();
  const c = await lerControle();
  const agora = Date.now();
  if (e.pausaAte && agora < e.pausaAte) throw new Error(`Pausado por limite do Instagram até ${formatarSP(e.pausaAte)}. Use "Retomar agora" se quiser tentar mesmo assim.`);
  const sessao = await lerSessao();
  if (!sessao.logado) throw new Error('Sem sessão: entre no instagram.com neste Chrome e tente de novo.');
  e.meuId = sessao.meuId;

  const cfg = e.config;
  let perfil;
  try {
    perfil = await api.buscarPerfil(username);
  } catch (err) {
    // Busca de origem é ação MANUAL de leitura: um erro aqui nunca pausa a extensão.
    // Só registra e devolve a mensagem (com trecho da resposta) para o dono tentar de novo.
    const msg = mensagemErroBusca(err);
    log(e, { username: String(username).replace(/^@/, ''), acao: 'buscar origem', resultado: `falhou: ${msg}` });
    e.ultimaBusca = { em: Date.now(), origem: `@${String(username).replace(/^@/, '')}`, lidos: 0, adicionados: 0, pulados: {}, erro: msg };
    await agendarProximo(e, c);
    await salvar(e);
    throw new Error(msg);
  }
  const origem = `@${perfil.username}`;
  const registrarFalha = async (msg) => {
    e.ultimaBusca = { em: Date.now(), origem, lidos: 0, adicionados: 0, pulados: {}, erro: msg };
    log(e, { username: perfil.username, acao: 'buscar origem', resultado: `falhou: ${msg}`, origem });
    await agendarProximo(e, c);
    await salvar(e);
    throw new Error(msg);
  };

  // Perfil privado que eu não sigo: o Instagram não mostra os seguidores.
  if (perfil.privado && perfil.sigoEsse === false) {
    await registrarFalha(`${origem} é um perfil PRIVADO — o Instagram não mostra os seguidores dele para quem não o segue. Escolha um perfil público.`);
  }

  let modo = 'v1';
  let maxId = null;
  let lidos = 0;
  let adicionados = 0;
  let paginas = 0;
  const pulados = {};
  let erro = null;
  while (lidos < cfg.maxBusca) {
    await pausaHumana();
    let pagina;
    try {
      pagina = modo === 'v1' ? await api.paginaSeguidores(perfil.id, maxId) : await api.paginaSeguidoresGraphql(perfil.id, maxId);
    } catch (err) {
      if (paginas === 0 && modo === 'v1' && !bloqueante(err.tipo)) {
        // v1 falhou logo na 1ª página: tenta o GraphQL do site.
        log(e, { username: perfil.username, acao: 'buscar origem', resultado: `lista v1 falhou (${err.message}) — tentando GraphQL`, origem });
        modo = 'graphql';
        continue;
      }
      erro = new Error(`${perfil.privado ? `${origem} é um perfil PRIVADO — escolha um perfil público. ` : ''}${mensagemErroBusca(err)}`);
      break;
    }
    if (paginas === 0 && pagina.usuarios.length === 0) {
      if (modo === 'v1') {
        log(e, { username: perfil.username, acao: 'buscar origem', resultado: `lista v1 veio vazia (${pagina.trecho}) — tentando GraphQL`, origem });
        e.trechoV1 = pagina.trecho;
        modo = 'graphql';
        continue;
      }
      const total = perfil.seguidores != null ? ` (o perfil tem ${perfil.seguidores} seguidores)` : '';
      const dica = perfil.privado ? ' É um perfil PRIVADO: escolha um perfil público.' : '';
      erro = new Error(`O Instagram não devolveu nenhum seguidor de ${origem}${total}.${dica} Resposta v1: ${e.trechoV1 || '—'} | GraphQL: ${pagina.trecho}`);
      break;
    }
    paginas += 1;
    lidos += pagina.usuarios.length;
    const { aceitos, pulados: p } = filtrarCandidatos(pagina.usuarios, {
      meuId: e.meuId,
      fila: e.fila,
      vistos: e.vistos,
      seguidos: e.seguidos,
      pularPrivados: cfg.pularPrivados,
      pularSemFoto: cfg.pularSemFoto,
      origem,
      agora: Date.now(),
    });
    e.fila.push(...aceitos);
    adicionados += aceitos.length;
    for (const [k, v] of Object.entries(p)) pulados[k] = (pulados[k] || 0) + v;
    if (!pagina.proximo || !pagina.usuarios.length) { maxId = null; break; }
    maxId = pagina.proximo;
  }
  delete e.trechoV1;
  e.origemAtual = origem;
  e.ultimaBusca = { em: Date.now(), origem, lidos, adicionados, pulados, via: modo, erro: erro ? erro.message : null };
  // Guarda onde a lista parou, para reabastecer a fila sozinha depois (mesmo perfil).
  e.cursorOrigem = paginas > 0
    ? { id: perfil.id, username: perfil.username, origem, modo, proximo: maxId, esgotado: !maxId, totais: { lidos, adicionados, pulados: { ...pulados } } }
    : null;
  log(e, { username: perfil.username, acao: 'buscar origem', resultado: resumoBusca(e.ultimaBusca), origem });
  await agendarProximo(e, c);
  await salvar(e);
  return e.ultimaBusca;
}

/**
 * Fila curta (menos que o limite do dia + margem): continua a lista de seguidores do
 * MESMO perfil de referência, devagar — no máximo 3 páginas por vez, com atraso humano
 * entre elas e de 20 em 20 min — até ter fila para ~3 dias.
 */
async function reabastecerFila(e, agora) {
  const cfg = e.config;
  const cur = e.cursorOrigem;
  if (!cur || cur.esgotado || !cur.proximo) return 'ok';
  if (!precisaReabastecer(e.fila.length, cfg.limiteDiario)) return 'ok';
  if (e.ultimoReabastecimentoEm && agora - e.ultimoReabastecimentoEm < INTERVALO_REABASTECER_MS) return 'ok';
  e.ultimoReabastecimentoEm = agora;

  const alvo = alvoFila(cfg.limiteDiario);
  let lidos = 0;
  let adicionados = 0;
  const pulados = {};
  for (let i = 0; i < 3 && e.fila.length < alvo && cur.proximo; i += 1) {
    await pausaHumana();
    let pagina;
    try {
      pagina = cur.modo === 'graphql' ? await api.paginaSeguidoresGraphql(cur.id, cur.proximo) : await api.paginaSeguidores(cur.id, cur.proximo);
    } catch (err) {
      const tipo = tratarErro(e, err, 'reabastecer fila', cur.username);
      if (bloqueante(tipo)) return tipo;
      break;
    }
    lidos += pagina.usuarios.length;
    const { aceitos, pulados: p } = filtrarCandidatos(pagina.usuarios, {
      meuId: e.meuId, fila: e.fila, vistos: e.vistos, seguidos: e.seguidos,
      pularPrivados: cfg.pularPrivados, pularSemFoto: cfg.pularSemFoto, origem: cur.origem, agora: Date.now(),
    });
    e.fila.push(...aceitos);
    adicionados += aceitos.length;
    for (const [k, v] of Object.entries(p)) pulados[k] = (pulados[k] || 0) + v;
    cur.proximo = pagina.usuarios.length ? pagina.proximo : null;
  }
  if (!cur.proximo) cur.esgotado = true;
  cur.totais.lidos += lidos;
  cur.totais.adicionados += adicionados;
  for (const [k, v] of Object.entries(pulados)) cur.totais.pulados[k] = (cur.totais.pulados[k] || 0) + v;
  log(e, {
    username: cur.username,
    acao: 'reabastecer fila',
    resultado: `${resumoBusca({ origem: cur.origem, lidos, adicionados, pulados })} — fila agora ${e.fila.length}${cur.esgotado ? ' (lista deste perfil acabou: escolha outro perfil de referência)' : ''}`,
    origem: cur.origem,
  });
  return 'ok';
}

function mensagemErroBusca(err) {
  const tipo = err instanceof ErroInstagram ? err.tipo : 'outro';
  const msg = err && err.message ? err.message : String(err);
  const dica = {
    sessao: ' → O Instagram não reconheceu o login: abra o instagram.com neste Chrome, confira se está logado e tente de novo.',
    aguarde: ' → Espere alguns minutos e tente de novo (a extensão NÃO foi pausada).',
    limite: ' → Espere alguns minutos e tente de novo (a extensão NÃO foi pausada).',
    nao_encontrado: ' → Confira o @ digitado.',
  }[tipo] || ' → Tente de novo em alguns minutos.';
  return msg + dica;
}

function validarConfig(atual, nova) {
  const n = { ...atual };
  const inteiro = (v, min, max, padrao) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : padrao;
  };
  if ('limiteDiario' in nova) n.limiteDiario = inteiro(nova.limiteDiario, 0, 50, atual.limiteDiario);
  if ('limiteUnfollowDiario' in nova) n.limiteUnfollowDiario = inteiro(nova.limiteUnfollowDiario, 0, 30, atual.limiteUnfollowDiario);
  if ('diasParaUnfollow' in nova) n.diasParaUnfollow = inteiro(nova.diasParaUnfollow, 1, 30, atual.diasParaUnfollow);
  if ('maxBusca' in nova) n.maxBusca = inteiro(nova.maxBusca, 25, 2000, atual.maxBusca);
  if ('intervaloMinimoMin' in nova) n.intervaloMinimoMin = inteiro(nova.intervaloMinimoMin, 5, 120, atual.intervaloMinimoMin);
  if ('pularPrivados' in nova) n.pularPrivados = Boolean(nova.pularPrivados);
  if ('pularSemFoto' in nova) n.pularSemFoto = Boolean(nova.pularSemFoto);
  if ('dmAtiva' in nova) n.dmAtiva = Boolean(nova.dmAtiva);
  if ('mensagem' in nova && String(nova.mensagem).trim()) n.mensagem = String(nova.mensagem);
  return n;
}

// ---------------------------------------------------------------- eventos

async function garantirAlarmes() {
  const cfg = (await carregar()).config;
  if (!(await chrome.alarms.get(ALARME_VERIFICAR))) chrome.alarms.create(ALARME_VERIFICAR, { periodInMinutes: cfg.verificarACadaMin || 2 });
  if (!(await chrome.alarms.get(ALARME_VIGIA))) chrome.alarms.create(ALARME_VIGIA, { periodInMinutes: 5 });
}

chrome.runtime.onInstalled.addListener((detalhes) => {
  serializar(async () => {
    if (detalhes && detalhes.reason === 'update') {
      // A versão 1.0.0 pausava 24 h por um erro isolado na BUSCA de origem
      // (web_profile_info). Essa pausa não deveria ter acontecido: desfaz.
      const e = await carregar();
      if (e.pausaAte && e.alerta && /web_profile_info|buscar origem/.test(e.alerta.texto || '')) {
        e.pausaAte = null;
        e.alerta = null;
        log(e, { acao: 'pausa', resultado: 'pausa de 24 h indevida (erro na busca de origem) desfeita na atualização' });
        await salvar(e);
      }
    }
    await garantirAlarmes();
    await ciclo();
  }).catch((err) => console.error(err));
});
chrome.runtime.onStartup.addListener(() => {
  serializar(async () => { await garantirAlarmes(); await ciclo(); }).catch((err) => console.error(err));
});

chrome.alarms.onAlarm.addListener((alarme) => {
  const fn = alarme.name === ALARME_VERIFICAR ? cicloVerificar : ciclo;
  serializar(fn).catch((err) => console.error('[Seguidor IG] erro no ciclo', err));
});

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  (async () => {
    switch (msg && msg.tipo) {
      case 'pausar': {
        await chrome.storage.local.set({ controle: { pausado: true } });
        await chrome.alarms.clear(ALARME_ACAO);
        await serializar(async () => {
          const e = await carregar();
          log(e, { acao: 'pausa', resultado: 'pausada pelo usuário' });
          await agendarProximo(e, { pausado: true });
          await salvar(e);
        });
        return { ok: true };
      }
      case 'retomar': {
        await chrome.storage.local.set({ controle: { pausado: false } });
        await serializar(async () => {
          const e = await carregar();
          if (e.pausaAte) log(e, { acao: 'pausa', resultado: 'pausa automática de 24 h cancelada pelo usuário' });
          e.pausaAte = null;
          e.esfriarAte = null;
          e.sessaoRecheckEm = null;
          e.errosRecentes = [];
          e.alerta = null;
          log(e, { acao: 'pausa', resultado: 'retomada pelo usuário' });
          await salvar(e);
          await ciclo();
        });
        return { ok: true };
      }
      case 'buscarOrigem':
        return { ok: true, resultado: await serializar(() => buscarOrigem(msg.username)) };
      case 'salvarConfig':
        await serializar(async () => {
          const e = await carregar();
          e.config = validarConfig(e.config, msg.config || {});
          e.agenda.limite = null; // força replanejar o restante do dia com os novos limites
          log(e, { acao: 'configuração', resultado: `limite ${e.config.limiteDiario}/dia, deixar de seguir ${e.config.limiteUnfollowDiario}/dia, privados ${e.config.pularPrivados ? 'pulados' : 'aceitos'}` });
          await salvar(e);
          await ciclo();
        });
        return { ok: true };
      case 'limparFila':
        await serializar(async () => {
          const e = await carregar();
          const n = e.fila.length;
          e.fila = [];
          log(e, { acao: 'fila', resultado: `fila limpa (${n} perfis removidos)` });
          await salvar(e);
        });
        return { ok: true };
      case 'limparAlerta':
        await serializar(async () => {
          const e = await carregar();
          e.alerta = null;
          await salvar(e);
        });
        return { ok: true };
      case 'cicloAgora':
        await serializar(ciclo);
        return { ok: true };
      default:
        return { ok: false, erro: 'mensagem desconhecida' };
    }
  })()
    .then(responder)
    .catch((err) => responder({ ok: false, erro: err && err.message ? err.message : String(err) }));
  return true; // resposta assíncrona
});

// Ao acordar o service worker, confere se os alarmes periódicos existem.
garantirAlarmes().catch(() => {});

// Exportado só para depuração no console do service worker (e para os testes
// esperarem a fila de operações terminar).
globalThis.seguidorIG = {
  ciclo: () => serializar(ciclo),
  verificar: () => serializar(cicloVerificar),
  ocioso: () => serializar(async () => {}),
};
