// Service worker da extensão: agenda, fila, seguir / deixar de seguir, follow-back e DM.
// Toda a comunicação com o Instagram passa por instagram-api.js.

import { criarApiChrome, lerSessao, ErroInstagram, haJanelaParaTrabalhar, abrirJanelaTrabalho, situacaoJanelaTrabalho, tirarDiagnostico, digitarDmNaAba, clicarNaAba, aplicarConfigRemota } from './instagram-api.js';
import { CHAVE_CONFIG_REMOTA, CHAVE_COMANDOS, INTERVALO_SINCRONIZAR_MIN, validarConfigRemota, comandosPendentes, marcarExecutado } from './lib/config-remota.js';
import { CHAVE_CRM, CHAVE_ULTIMO_ENVIO, montarDiagnostico, enviarDiagnosticoCrm, normalizarUrlCrm, CRM_URL_PADRAO } from './lib/diagnostico.js';
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
  rotuloSeguir,
  statusAposSeguir,
  atualizarSolicitacao,
  rotuloDeixar,
  LIMITE_DM_DIARIO_PADRAO,
  jaTemBoasVindas,
  temBoasVindas,
  detectarNovosSeguidores,
  novoRegistroSeguidor,
  tetoDmAtingido,
  reabilitarDesistidasPorHtml,
  proximaBoasVindasPendente,
  resetarDmsDigitacao,
} from './lib/regras.js';
import { normalizarEstado, virarDiaSeNecessario, registrarHistorico, resumoBusca } from './lib/estado.js';
import { CARGA_JANELA_MS, CARGA_PAGINAS_MAX, CARGA_TENTATIVAS_MAX, interpretarAtividade, separarCarga, registroDaCarga } from './lib/carga-tres-dias.js';

const api = criarApiChrome();

const ALARME_ACAO = 'acao'; // próxima ação agendada (one-shot)
const ALARME_VERIFICAR = 'verificar'; // checagem de follow-back (a cada 2 min)
const ALARME_CRM = 'crm'; // 1.1.13: configuração e comandos do CRM (a cada 5 min)
const ALARME_VIGIA = 'vigia'; // rede de segurança (a cada 5 min): virada de dia, abertura da janela etc.
const VARREDURA_COMPLETA_MS = 30 * MINUTO; // show_many em todos os seguidos, de 30 em 30 min
// 1.1.4: com o show_many respondendo HTML, a varredura lê o botão de no máximo N perfis por rodada (30 min),
// com intervalo humano entre eles — nunca uma rajada de visitas.
const PERFIS_POR_VARREDURA = 5;
// 1.1.7: na conferência completa (30 min), páginas lidas da lista dos MEUS seguidores (mais recentes primeiro).
// A cada 2 min só a 1ª página: quem seguiu de volta à noite, com o PC desligado ou antes de outras pessoas novas
// ficava fora dela e, com show_many/show em HTML, nunca era visto — nenhuma DM saía.
const PAGINAS_MEUS_SEGUIDORES = 4;
// 1.1.5: DM com resposta HTML (não saiu): até 3 tentativas (agora, +30 min, +2 h) e então alerta no popup.
const DM_MAX_TENTATIVAS_HTML = 3;
const HORA_DM = 60 * MINUTO;
const INTERVALO_MIN_ENTRE_DMS = 60 * 1000;
const INTERVALO_REABASTECER_MS = 20 * MINUTO;
// 1.1.8: boas-vindas para TODO seguidor novo. Se a 1ª página dos meus seguidores não tiver nenhum já conhecido, lê
// mais páginas (até este total) procurando o ponto em que começam os antigos; sem achar, ninguém recebe DM.
const PAGINAS_MAX_NOVOS_SEGUIDORES = 8;
// 1.1.12: perfis com o botão "Seguir" não localizado no mesmo dia antes de suspender o SEGUIR até amanhã.
const LIMITE_FALHAS_BOTAO_SEGUIR = 3;

/** 1.1.8: todos os registros com DM de boas-vindas: follow-back (`seguidos`) e novos seguidores. */
const registrosDm = (e) => [...Object.values(e.seguidos), ...Object.values(e.novosSeguidores || {})];

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
const pausaEntrePerfis = () => esperar(5000 + Math.round(Math.random() * 7000) + atrasoHumanoMs());

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

/** 1.1.7: último erro das boas-vindas (checagem de seguidores ou DM), mostrado no popup. */
function erroBoasVindas(e, texto) {
  e.boasVindas = { ...(e.boasVindas || {}), ultimoErro: { em: Date.now(), texto: String(texto || '').slice(0, 400) } };
}

// ---------------------------------------------------------------- 1.1.12: diagnóstico remoto (CRM)

const versaoExtensao = () => { try { return chrome.runtime.getManifest().version; } catch { return ''; } };

async function lerConfigCrm() {
  const c = (await chrome.storage.local.get(CHAVE_CRM))[CHAVE_CRM] || {};
  return { url: c.url || CRM_URL_PADRAO, chave: c.chave || '', versao: versaoExtensao() };
}

/**
 * Manda ao CRM o rastro + esqueleto desta tentativa (anonimizados — lib/diagnostico.js). Nunca atrasa nem derruba a
 * ação: roda em paralelo e só registra o resultado do envio (CHAVE_ULTIMO_ENVIO, mostrado no painel). Sem chave
 * configurada, não faz nada.
 */
function diagnosticar(kind, { acao, username = '', resultado = '', rastro = [], extra = null }) {
  const pagina = username ? tirarDiagnostico(username) : null;
  return (async () => {
    const crm = await lerConfigCrm();
    if (!crm.chave) return { ok: false, erro: 'sem chave do CRM' };
    const payload = montarDiagnostico({
      versao: crm.versao,
      acao,
      resultado,
      rastro: [...rastro, ...((pagina && pagina.rastro) || [])],
      esqueleto: (pagina && pagina.esqueleto) || null,
      extra,
      usuarios: [username],
    });
    try {
      const r = await enviarDiagnosticoCrm(crm, kind, payload);
      await chrome.storage.local.set({ [CHAVE_ULTIMO_ENVIO]: { em: Date.now(), kind, ok: true, id: r.id } });
      return { ok: true, id: r.id };
    } catch (err) {
      const erro = err && err.message ? err.message : String(err);
      await chrome.storage.local.set({ [CHAVE_ULTIMO_ENVIO]: { em: Date.now(), kind, ok: false, erro } });
      return { ok: false, erro };
    }
  })().catch((err) => ({ ok: false, erro: String(err) }));
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
  if (tipo === 'sem_janela') {
    // Nenhuma janela do Chrome aberta: não cria janela sozinha, só espera (sem pausa, sem repetir o aviso).
    marcarSemJanela(e, true);
    return tipo;
  }
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
  } else if (tipo === 'indisponivel') {
    // 1.1.4: HTML na resposta da API → só registra; não pausa, não vira "sem sessão" nem alerta de mudança de API.
    log(e, { username, acao: contexto, resultado: `checagem indisponível: ${msg}` });
  } else {
    log(e, { username, acao: contexto, resultado: `erro (${tipo}): ${msg}` });
    if (tipo === 'mudanca_api') {
      e.alerta = { tipo, em: agora, texto: msg };
    }
  }
  return tipo;
}

// Interrompe a rodada sem perder o perfil da vez (o "sem_janela" não pausa: só espera).
const bloqueante = (tipo) => tipo === 'limite' || tipo === 'aguarde' || tipo === 'sessao' || tipo === 'sem_janela';

/** Registra (uma vez por mudança) que não há janela do Chrome aberta para trabalhar. */
function marcarSemJanela(e, sem) {
  if (Boolean(e.semJanela) === sem) return;
  e.semJanela = sem;
  log(e, { acao: 'janela de trabalho', resultado: sem ? 'nenhuma janela do Chrome aberta — esperando (não cria janela sozinha)' : 'janela do Chrome disponível — retomando' });
}

/** Há janela do Chrome para a janela de trabalho? Atualiza o aviso. */
async function checarJanela(e) {
  const ha = await haJanelaParaTrabalhar();
  marcarSemJanela(e, !ha);
  return ha;
}

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
  if (a.dia === hoje && a.limite === cfg.limiteDiario && a.limiteUnfollow === cfg.limiteUnfollowDiario) {
    // 1.1.1: horários de "seguir" gastos sem seguir ninguém (fila vazia ou só perfis pulados) voltam para a agenda
    // assim que a fila tiver perfis — antes o dia inteiro ficava em "0 seguidos" depois de uma busca feita tarde.
    // Cada "seguir" feito consome um horário E um do limite; se sobram menos horários que o limite restante, a
    // diferença foi gasta sem seguir ninguém. O 1º horário replanejado fica a 2+ min de agora (nunca rajada).
    const restF = Math.max(0, cfg.limiteDiario - e.contadores.seguidos);
    if (a.follows.length < restF && e.fila.length && e.suspensoSeguir !== hoje && agora < fim) {
      a.follows = planejarHorarios({ inicio: Math.max(agora + 2 * MINUTO, inicio), fim, quantidade: restF, intervaloMinimoMs: minimo });
      log(e, { acao: 'agenda', resultado: `fila com perfis de novo: ${a.follows.length} horários de seguir replanejados até o fim da janela${a.follows[0] ? ` (1º ${formatarSP(a.follows[0])})` : ''}` });
    }
    return;
  }

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
  for (const r of registrosDm(e)) {
    if (r.dmTentativaEm && !r.dmEnviadaEm && !r.dmIncerta && agora - r.dmTentativaEm > 5 * MINUTO) {
      r.dmIncerta = true;
      log(e, { username: r.username, acao: 'DM', resultado: 'envio interrompido — não será repetido (confira no Instagram)', origem: r.origem });
      erroBoasVindas(e, `DM para @${r.username}: envio interrompido — não será repetido (confira no Instagram)`);
    }
  }
  if (!cfg.dmAtiva) return 'ok';
  const prontas = registrosDm(e).filter((r) => dmPronta(r, agora, cfg)).sort((a, b) => a.dmAgendadaPara - b.dmAgendadaPara);
  if (!prontas.length) return 'ok';
  if (tetoDmAtingido(e.contadores, cfg)) {
    // 1.1.8: teto diário de boas-vindas atingido — o excedente fica para o dia seguinte (espaçado, 1–3 min + 1 min).
    const amanha = proximaAbertura(janelaDoDia(agora, cfg).fim, cfg);
    prontas.forEach((r, i) => { r.dmAgendadaPara = amanha + atrasoDmMs() + i * (INTERVALO_MIN_ENTRE_DMS + atrasoDmMs() / 2); });
    if (e.avisoTetoDm !== diaSP(agora)) {
      e.avisoTetoDm = diaSP(agora);
      log(e, { acao: 'DM', resultado: `teto diário de ${cfg.limiteDmDiario || LIMITE_DM_DIARIO_PADRAO} boas-vindas atingido — ${prontas.length} ficam para amanhã a partir de ${formatarSP(prontas[0].dmAgendadaPara)}` });
    }
    return 'ok';
  }
  if (e.ultimaDmEm && agora - e.ultimaDmEm < INTERVALO_MIN_ENTRE_DMS) {
    for (const r of prontas) r.dmAgendadaPara = e.ultimaDmEm + INTERVALO_MIN_ENTRE_DMS + atrasoHumanoMs() * 10;
    return 'ok';
  }
  const r = prontas[0];
  // Espaça as demais (nenhuma rajada de DMs).
  prontas.slice(1).forEach((o, i) => { o.dmAgendadaPara = Math.max(o.dmAgendadaPara, agora + (i + 1) * (INTERVALO_MIN_ENTRE_DMS + atrasoDmMs() / 2)); });

  return (await enviarBoasVindas(e, r)).tipo;
}

/**
 * Envia a boas-vindas para UM registro (marca a tentativa antes: "uma única vez"). 1.1.12: separado de processarDm para
 * o botão "Enviar a próxima boas-vindas agora"; devolve { tipo, situacao: 'enviada'|'incerta'|'nao_enviada', texto } e
 * manda o diagnóstico `ig_dm` ao CRM (rastro + esqueleto da conversa, se a extensão abriu a tela).
 */
async function enviarBoasVindas(e, r, { manual = false } = {}) {
  const cfg = e.config;
  const fimDm = (tipo, situacao, texto) => {
    diagnosticar('ig_dm', { acao: manual ? 'DM (botão enviar agora)' : 'DM', username: r.username, resultado: `${situacao}: ${texto}`, rastro: [{ passo: 'boas-vindas', registro: r.followBackEm ? 'follow-back' : 'novo seguidor', tentativasAntes: r.dmFalhas || 0 }] });
    return { tipo, situacao, texto };
  };
  r.dmTentativaEm = Date.now();
  await salvar(e); // marca ANTES de enviar: garante "uma única vez"
  if (!manual) await pausaHumana();
  try {
    const res = await api.enviarDm(r.id, cfg.mensagem, { username: r.username });
    r.dmEnviadaEm = Date.now();
    if (res.digitacao) { r.dmDigitacaoTentadaEm = r.dmEnviadaEm; r.dmVia = 'digitacao'; }
    e.ultimaDmEm = r.dmEnviadaEm;
    e.contadores.dms += 1;
    log(e, { username: r.username, acao: 'DM', resultado: `boas-vindas enviada (${res.modo})`, origem: r.origem });
    return fimDm('ok', 'enviada', `boas-vindas enviada (${res.modo})`);
  } catch (err) {
    const status = err && err.status;
    const tipo = err instanceof ErroInstagram ? err.tipo : 'outro';
    if (err && err.digitacao) r.dmDigitacaoTentadaEm = Date.now(); // 1.1.8: já passou pela digitação na tela da DM
    if (bloqueante(tipo)) {
      // O Instagram recusou: não saiu. Reagenda para depois da pausa.
      r.dmTentativaEm = null;
      tratarErro(e, err, 'DM', r.username);
      erroBoasVindas(e, `DM para @${r.username} adiada: ${err.message || err}`);
      const volta = Math.max(e.pausaAte || 0, e.esfriarAte || 0, Date.now());
      r.dmAgendadaPara = ajustarParaJanela(volta + atrasoDmMs(), volta, cfg);
      return fimDm(tipo, 'nao_enviada', `adiada (${tipo}): ${err.message || err}`);
    }
    if (tipo === 'nao_enviada') {
      // 1.1.5: a API de DM devolveu a página HTML — certamente não saiu. Reagenda (30 min, depois 2 h); na 3ª
      // falha desiste COM alerta no popup (nunca em silêncio). 1.1.8: antes de contar a falha, a extensão já tentou
      // digitar na tela da DM (instagram-api.js) — 'nao_enviada' aqui = a digitação também não chegou ao Enter.
      r.dmTentativaEm = null;
      r.dmFalhas = (r.dmFalhas || 0) + 1;
      erroBoasVindas(e, `DM para @${r.username} não enviada (tentativa ${r.dmFalhas} de ${DM_MAX_TENTATIVAS_HTML}): ${err.digitacao ? `API respondeu HTML e a digitação não enviou — ${String(err.message).split('. DM não enviada')[0]}` : 'o Instagram respondeu a página HTML'}`);
      if (r.dmFalhas >= DM_MAX_TENTATIVAS_HTML) {
        r.dmDesistiu = true;
        r.dmDesistiuPor = 'html';
        const texto = `DM de boas-vindas não pôde ser enviada para @${r.username}: o Instagram respondeu a página HTML em vez de processar a mensagem${err.digitacao ? ' e a digitação na tela da DM também não conseguiu enviar' : ''} (${r.dmFalhas} tentativas). Envie manualmente pelo Instagram, se quiser.`;
        e.alerta = { tipo: 'dm', em: Date.now(), texto };
        log(e, { username: r.username, acao: 'DM', resultado: `não enviada após ${r.dmFalhas} tentativas (resposta HTML) — desistindo, alerta no popup`, origem: r.origem });
        notificar('Instagram: DM não enviada', texto.slice(0, 200));
      } else {
        const espera = r.dmFalhas === 1 ? 30 * MINUTO : 2 * HORA_DM;
        r.dmAgendadaPara = ajustarParaJanela(Date.now() + espera, Date.now(), cfg);
        log(e, { username: r.username, acao: 'DM', resultado: `não enviada (Instagram respondeu HTML) — tentativa ${r.dmFalhas + 1} às ${formatarSP(r.dmAgendadaPara)}`, origem: r.origem });
      }
      return fimDm(tipo, 'nao_enviada', `não enviada (nada saiu): ${err.message || err}`);
    }
    if (tipo !== 'incerto' && status >= 400 && status < 500) {
      r.dmTentativaEm = null;
      r.dmFalhas = (r.dmFalhas || 0) + 1;
      erroBoasVindas(e, `DM para @${r.username} recusada (tentativa ${r.dmFalhas} de 3): ${err.message}`);
      if (r.dmFalhas >= 3) {
        r.dmDesistiu = true;
        log(e, { username: r.username, acao: 'DM', resultado: `falhou 3 vezes — desistindo (${err.message})`, origem: r.origem });
      } else {
        r.dmAgendadaPara = ajustarParaJanela(Date.now() + 15 * MINUTO, Date.now(), cfg);
        log(e, { username: r.username, acao: 'DM', resultado: `recusada (${err.message}) — nova tentativa às ${formatarSP(r.dmAgendadaPara)}`, origem: r.origem });
      }
      if (tipo === 'mudanca_api') e.alerta = { tipo, em: Date.now(), texto: err.message };
      return fimDm(tipo, 'nao_enviada', `recusada: ${err.message || err}`);
    }
    // Não dá para saber se saiu: nunca reenviar.
    r.dmIncerta = true;
    e.contadores.dmsIncertas = (e.contadores.dmsIncertas || 0) + 1; // 1.1.8: conta no teto diário (pode ter saído)
    log(e, { username: r.username, acao: 'DM', resultado: `resultado incerto, não será repetida: ${err.message || err}`, origem: r.origem });
    erroBoasVindas(e, `DM para @${r.username} com resultado incerto (não será repetida — confira no Instagram): ${err.message || err}`);
    return fimDm(tipo, 'incerta', `resultado incerto (não será repetida — confira no Instagram): ${err.message || err}`);
  }
}

/**
 * 1.1.11: ids que a extensão já sabe que me seguem — a lista dos meus seguidores lida para as boas-vindas
 * (`meusSeguidores.conhecidos`) e os novos seguidores detectados. Usado para pular sem abrir o perfil.
 */
function meSeguemConhecidos(e) {
  return { ...((e.meusSeguidores && e.meusSeguidores.conhecidos) || {}), ...(e.novosSeguidores || {}) };
}

async function processarSeguir(e, agora) {
  const decisao = replanejarSeAtrasado(e, 'follows', agora);
  if (decisao !== 'executar') return 'ok';
  e.agenda.follows.shift(); // consome o horário
  const cfg = e.config;
  if (e.contadores.seguidos >= cfg.limiteDiario) return 'ok';
  if (e.suspensoSeguir === diaSP(agora)) return 'ok'; // falha de API hoje: só amanhã

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
    // 1.1.11 (dono, 26/10: "Não deve seguir quem já me segue"): já está na lista dos meus seguidores que a extensão
    // conhece → pula sem abrir o perfil, sem checar na API e sem gastar a cota nem uma das 5 tentativas desta vez.
    if (meSeguemConhecidos(e)[cand.id]) {
      e.vistos[cand.id] = 'ja_relacionado';
      log(e, { username: cand.username, acao: 'pulado', resultado: 'já me segue (está na lista dos meus seguidores) — perfil nem aberto', origem: cand.origem });
      tentativa -= 1;
      continue;
    }

    await pausaHumana();
    let st;
    try {
      st = await api.amizade(cand.id, cand.username);
    } catch (err) {
      const tipo = tratarErro(e, err, 'checar antes de seguir', cand.username);
      if (bloqueante(tipo)) { e.fila.unshift(cand); return tipo; }
      if (tipo === 'indisponivel') {
        // 1.1.4: checagem indisponível (API respondeu HTML e o botão do perfil não foi lido). O perfil volta para
        // a fila sem ser marcado e o limite do dia não é tocado; o horário perdido é replanejado (1.1.1).
        e.fila.unshift(cand);
        return tipo;
      }
      e.vistos[cand.id] = `erro:${tipo}`;
      continue;
    }
    const rastro = [{ passo: 'checar amizade', via: st.via || 'friendships/show', seguindo: st.seguindo, meSegue: st.meSegue, pedidoPendente: st.pedidoPendente, privado: st.privado }];
    if (st.meSegue || st.seguindo || st.pedidoPendente) {
      e.vistos[cand.id] = 'ja_relacionado';
      const motivo = st.meSegue ? 'já me segue' : st.seguindo ? 'já sigo' : 'já Solicitado antes (pedido pendente)';
      log(e, { username: cand.username, acao: 'pulado', resultado: motivo, origem: cand.origem });
      diagnosticar('ig_follow', { acao: 'seguir', username: cand.username, resultado: `pulado: ${motivo}`, rastro });
      continue;
    }
    if (cfg.pularPrivados && st.privado) {
      e.vistos[cand.id] = 'privado';
      log(e, { username: cand.username, acao: 'pulado', resultado: 'perfil privado', origem: cand.origem });
      continue;
    }

    await pausaHumana();
    try {
      const r = await api.seguir(cand.id, cand.username);
      e.vistos[cand.id] = 'seguido';
      e.seguidos[cand.id] = {
        id: cand.id,
        username: cand.username,
        origem: cand.origem,
        seguidoEm: Date.now(),
        status: statusAposSeguir(r), // perfil privado: "Solicitado" (pedido pendente) — conta no limite do dia
        privado: Boolean(r.privado || cand.privado),
      };
      e.contadores.seguidos += 1;
      log(e, { username: cand.username, acao: 'seguir', resultado: `${rotuloSeguir(r)} — confirmado (${r.via})`, origem: cand.origem });
      diagnosticar('ig_follow', { acao: 'seguir', username: cand.username, resultado: `seguido — confirmado (${r.via})`, rastro });
      return 'ok';
    } catch (err) {
      const tipoErro = err instanceof ErroInstagram ? err.tipo : 'outro';
      diagnosticar('ig_follow', { acao: 'seguir', username: cand.username, resultado: `falhou (${tipoErro}): ${err && err.message ? err.message : err}`, rastro });
      if (err instanceof ErroInstagram && err.tipo === 'ja_relacionado') {
        // 1.1.11: na hora do clique o botão do perfil mostrou que já me segue — nada clicado, não conta no limite.
        e.vistos[cand.id] = 'ja_relacionado';
        log(e, { username: cand.username, acao: 'pulado', resultado: `já me segue (visto no botão do perfil na hora de seguir) — não seguido`, origem: cand.origem });
        continue;
      }
      if (err instanceof ErroInstagram && err.semBotao && err.tipo === 'mudanca_api') {
        // 1.1.12 (teste real do dono: "SEGUIR suspenso … botão 'Seguir' não apareceu", com o botão na tela): API em
        // HTML + botão não localizado num perfil NÃO suspende o dia. O perfil vai para o fim da fila (sem marcar) e o
        // diagnóstico vai ao CRM; só 3 perfis seguidos assim no mesmo dia suspendem o SEGUIR (algo sistemático).
        const hoje = diaSP(Date.now());
        e.falhasBotaoSeguir = e.falhasBotaoSeguir && e.falhasBotaoSeguir.dia === hoje ? e.falhasBotaoSeguir : { dia: hoje, n: 0 };
        e.falhasBotaoSeguir.n += 1;
        if (e.falhasBotaoSeguir.n < LIMITE_FALHAS_BOTAO_SEGUIR) {
          e.fila.push(cand);
          log(e, { username: cand.username, acao: 'seguir', resultado: `não seguido: botão "Seguir" não localizado (falha ${e.falhasBotaoSeguir.n} de ${LIMITE_FALHAS_BOTAO_SEGUIR} hoje) — perfil volta para o fim da fila; diagnóstico enviado ao CRM. ${err.message}`, origem: cand.origem });
          return 'ok';
        }
      }
      const tipo = tratarErro(e, err, 'seguir', cand.username);
      if (bloqueante(tipo)) { e.fila.unshift(cand); return tipo; }
      if (tipo === 'mudanca_api' || tipo === 'indisponivel') {
        // Resposta inesperada (ex.: HTML) mesmo após o endpoint legado: não é sucesso
        // nem bloqueio. Suspende o SEGUIR até o fim do dia; o perfil volta para a fila.
        e.fila.unshift(cand);
        e.suspensoSeguir = diaSP(Date.now());
        e.alerta = { tipo, em: Date.now(), texto: `SEGUIR suspenso até amanhã: o Instagram respondeu de forma inesperada. ${err.message}` };
        notificar('Instagram: seguir suspenso hoje', 'O Instagram respondeu de forma inesperada ao seguir. Veja o diagnóstico no painel.');
        return tipo;
      }
      e.vistos[cand.id] = `erro:${tipo}`;
      return tipo;
    }
  }
  return 'ok';
}

function marcarFollowBack(e, r, agora) {
  const ja = Boolean(r.followBackEm);
  // 1.1.8: já tem boas-vindas como "novo seguidor" (ex.: seguido depois de ter me seguido) → nunca uma 2ª DM.
  if (!temBoasVindas(r) && e.novosSeguidores && e.novosSeguidores[String(r.id)]) r.dmCoberta = true;
  registrarFollowBack(r, agora, e.config);
  if (!ja && !e.config.dmAtiva && !r.dmEnviadaEm && !r.dmCoberta) {
    // DM desligada no painel: esta pessoa não recebe mensagem depois, nem se religar.
    r.dmAgendadaPara = null;
    r.dmDesistiu = true;
  }
  if (!ja) {
    e.contadores.followBacks += 1;
    log(e, {
      username: r.username,
      acao: 'follow-back',
      resultado: r.dmCoberta ? 'seguiu de volta — boas-vindas já cuidada como novo seguidor (sem 2ª DM)' : e.config.dmAtiva ? `seguiu de volta — DM agendada para ${formatarSP(r.dmAgendadaPara)}` : 'seguiu de volta',
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
  if (e.suspensoDeixar === diaSP(agora)) return 'ok';

  const excluir = new Set();
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const r = escolherParaUnfollow(e.seguidos, agora, cfg.diasParaUnfollow, excluir);
    if (!r) return 'ok';
    excluir.add(String(r.id));

    await pausaHumana();
    let st;
    try {
      st = await api.amizade(r.id, r.username);
    } catch (err) {
      const tipo = tratarErro(e, err, 'checar antes de deixar de seguir', r.username);
      if (bloqueante(tipo) || tipo === 'indisponivel') return tipo;
      continue;
    }
    if (st.meSegue) { marcarFollowBack(e, r, Date.now()); continue; }
    if (st.meSegue === undefined) {
      // 1.1.4: lido pelo botão "Seguindo"/"Solicitado" (API respondeu HTML) — não diz se a pessoa me segue.
      // Na dúvida não deixa de seguir (seria desfazer com quem seguiu de volta).
      log(e, { username: r.username, acao: 'deixar de seguir', resultado: `adiado: não deu para confirmar se segue de volta (${st.via || 'sem dado'})`, origem: r.origem });
      continue;
    }
    if (atualizarSolicitacao(r, st, Date.now())) {
      log(e, { username: r.username, acao: 'solicitação aceita', resultado: 'aceitou a solicitação (perfil privado), mas não seguiu de volta', origem: r.origem });
    }
    if (!st.seguindo && !st.pedidoPendente) {
      r.status = STATUS.NAO_SEGUE_MAIS;
      log(e, { username: r.username, acao: 'deixar de seguir', resultado: 'já não seguia (nada feito)', origem: r.origem });
      continue;
    }

    await pausaHumana();
    try {
      // friendships/destroy também cancela a solicitação pendente; a API só confirma com
      // following E outgoing_request falsos no friendships/show.
      await api.deixarDeSeguir(r.id, r.username);
      const cancelada = !st.seguindo && st.pedidoPendente;
      r.status = STATUS.DEIXADO;
      r.deixadoEm = Date.now();
      if (cancelada) r.solicitacaoCancelada = true;
      e.contadores.deixados += 1;
      log(e, { username: r.username, acao: cancelada ? 'cancelar solicitação' : 'deixar de seguir', resultado: rotuloDeixar(st, cfg.diasParaUnfollow), origem: r.origem });
      return 'ok';
    } catch (err) {
      const tipo = tratarErro(e, err, 'deixar de seguir', r.username);
      if (tipo === 'mudanca_api') {
        e.suspensoDeixar = diaSP(Date.now());
        e.alerta = { tipo, em: Date.now(), texto: `DEIXAR DE SEGUIR suspenso até amanhã: o Instagram respondeu de forma inesperada. ${err.message}` };
      }
      return tipo;
    }
  }
  return 'ok';
}

/**
 * 1.1.7: uma página da lista dos MEUS seguidores (mais recentes primeiro). 1ª página: o modo que funcionou da última
 * vez (v1 por padrão); se ele não der dados (HTML, mudança de API, lista vazia), tenta o outro (GraphQL do site — o
 * mesmo plano B da busca de origem). As páginas seguintes ficam no modo da 1ª (o cursor é de cada um).
 */
async function paginaMeusSeguidores(e, cursor, modo) {
  const ler = (m, c) => (m === 'graphql' ? api.paginaSeguidoresGraphql(e.meuId, c) : api.paginaSeguidores(e.meuId, c));
  if (modo) return ler(modo, cursor);
  const ordem = e.boasVindas && e.boasVindas.via === 'graphql' ? ['graphql', 'v1'] : ['v1', 'graphql'];
  const falhas = [];
  let vazia = null;
  let erro = null;
  for (const m of ordem) {
    try {
      const pagina = await ler(m, null);
      if (pagina.usuarios.length) return pagina;
      falhas.push(`${m}: lista vazia (${pagina.trecho || '—'})`);
      vazia = vazia || pagina;
    } catch (err) {
      if (err instanceof ErroInstagram && bloqueante(err.tipo)) throw err; // limite/sessão/sem janela: decide quem chama
      falhas.push(`${m}: ${err.message || err}`);
      erro = err;
    }
  }
  if (vazia && !erro) return vazia; // as duas vieram vazias, sem erro: não há o que conferir
  const tipo = erro instanceof ErroInstagram ? erro.tipo : 'outro';
  throw new ErroInstagram(tipo, `Lista dos meus seguidores indisponível — ${falhas.join(' | ')}`, { endpoint: 'meus seguidores' });
}

/**
 * Follow-back: a cada 2 min, a 1ª página dos meus seguidores; de 30 em 30 min (ou no botão "Conferir seguidores
 * agora"), a conferência completa: até PAGINAS_MEUS_SEGUIDORES páginas e, para quem faltar, show_many (ou, se ele
 * responder HTML, friendships/show / botão do perfil de poucos perfis).
 */
async function verificarFollowBacks(e, agora, { forcarCompleta = false } = {}) {
  const ids = new Set(idsParaVerificarFollowBack(e.seguidos));
  if (!e.meuId) return 'ok';
  const completa = forcarCompleta || !e.ultimaVarreduraEm || agora - e.ultimaVarreduraEm >= VARREDURA_COMPLETA_MS;
  if (completa) e.ultimaVarreduraEm = agora;

  // 1) Meus seguidores mais recentes: pega follow-back em poucos minutos (e, na conferência completa, mais páginas).
  // 1.1.8: a mesma leitura acha os seguidores NOVOS (boas-vindas para todos): lê até achar um já conhecido.
  const ms = e.meusSeguidores;
  const lidos = [];
  let achouConhecido = false;
  let terminou = false; // leu até o fim da lista ou até o limite de páginas, sem erro
  let cursor = null;
  let modo = null;
  for (let p = 0; p < PAGINAS_MAX_NOVOS_SEGUIDORES; p += 1) {
    const paraFollowBack = p < (completa ? PAGINAS_MEUS_SEGUIDORES : 1) && ids.size;
    const paraNovos = ms.linhaDeBaseEm && !achouConhecido;
    if (p > 0 && !paraFollowBack && !paraNovos) break;
    await pausaHumana();
    let pagina;
    try {
      pagina = await paginaMeusSeguidores(e, cursor, modo);
    } catch (err) {
      const tipo = tratarErro(e, err, 'verificar follow-back');
      erroBoasVindas(e, `conferir seguidores: ${err.message || err}`);
      if (bloqueante(tipo)) return tipo;
      break;
    }
    modo = pagina.via;
    e.boasVindas = { ...(e.boasVindas || {}), ultimaChecagemEm: Date.now(), via: modo };
    for (const u of pagina.usuarios) {
      const id = String(u.pk ?? u.id ?? u.pk_id ?? '');
      lidos.push(u);
      if (ms.conhecidos[id]) achouConhecido = true;
      if (ids.has(id)) { marcarFollowBack(e, e.seguidos[id], Date.now()); ids.delete(id); }
    }
    if (!pagina.proximo || !pagina.usuarios.length) { terminou = true; break; }
    if (p === PAGINAS_MAX_NOVOS_SEGUIDORES - 1) terminou = true;
    cursor = pagina.proximo;
  }
  if (lidos.length && (!ms.linhaDeBaseEm || achouConhecido || terminou)) registrarNovosSeguidores(e, lidos, Date.now());

  // 2) Conferência completa por show_many para quem não apareceu nas páginas (ex.: solicitação aceita).
  if (completa && ids.size) {
    const lista = [...ids];
    for (let i = 0; i < lista.length; i += 50) {
      await pausaHumana();
      try {
        const mapa = await api.amizadeVarios(lista.slice(i, i + 50));
        for (const [id, st] of Object.entries(mapa)) {
          const reg = e.seguidos[id];
          if (!reg) continue;
          if (atualizarSolicitacao(reg, st, Date.now())) {
            log(e, { username: reg.username, acao: 'solicitação aceita', resultado: 'aceitou a solicitação (perfil privado)', origem: reg.origem });
          }
          if (st.meSegue === true) marcarFollowBack(e, reg, Date.now());
        }
      } catch (err) {
        if (err instanceof ErroInstagram && err.tipo === 'indisponivel') {
          // 1.1.4: show_many respondeu HTML. Não é sessão nem bloqueio e não gera alerta: segue pelo botão do perfil.
          log(e, { acao: 'verificar follow-back', resultado: `checagem em lote indisponível (show_many respondeu HTML) — conferindo até ${PERFIS_POR_VARREDURA} perfis um a um` });
          const r2 = await verificarPeloPerfil(e, lista);
          if (r2 !== 'ok') return r2;
          break;
        }
        const tipo = tratarErro(e, err, 'verificar follow-back (show_many)');
        if (bloqueante(tipo)) return tipo;
        break;
      }
      limparAlertaShowMany(e);
    }
  }
  return 'ok';
}

/**
 * 1.1.8 (decisão do dono, 26/10): boas-vindas para TODO seguidor novo, uma única vez por pessoa. A 1ª leitura depois
 * de atualizar só grava a linha de base (todos = já conhecidos, sem DM). Depois, novo = quem aparece acima do 1º já
 * conhecido na lista (mais recentes primeiro). Quem foi seguido pela extensão segue pelo follow-back (marcarFollowBack).
 */
function registrarNovosSeguidores(e, usuarios, agora) {
  const ms = e.meusSeguidores;
  const r = detectarNovosSeguidores(usuarios, { conhecidos: ms.conhecidos, linhaDeBaseEm: ms.linhaDeBaseEm, meuId: e.meuId });
  for (const id of r.conhecer) if (!ms.conhecidos[id]) ms.conhecidos[id] = agora;
  if (r.linhaDeBase) {
    ms.linhaDeBaseEm = agora;
    log(e, { acao: 'novos seguidores', resultado: `linha de base gravada: ${r.conhecer.length} seguidores atuais marcados como já conhecidos (nenhuma DM para eles)` });
    return;
  }
  if (r.anomalia) {
    log(e, { acao: 'novos seguidores', resultado: `${r.conhecer.length} seguidores lidos sem nenhum já conhecido entre eles — por segurança nenhuma DM (nunca DM em lote); marcados como conhecidos` });
    erroBoasVindas(e, `${r.conhecer.length} seguidores novos de uma vez sem ponto de referência — sem DM para eles (proteção contra envio em lote)`);
    return;
  }
  // Do mais antigo para o mais recente: a fila de DMs sai na ordem em que as pessoas seguiram.
  for (const u of [...r.novos].reverse()) {
    const seguido = e.seguidos[u.id];
    if (seguido && (seguido.followBackEm || seguido.status === STATUS.SEGUINDO || seguido.status === STATUS.SOLICITADO)) continue; // follow-back: marcarFollowBack cuida
    e.contadores.novosSeguidores = (e.contadores.novosSeguidores || 0) + 1;
    if (jaTemBoasVindas(e, u.id)) {
      log(e, { username: u.username, acao: 'novo seguidor', resultado: 'já recebeu (ou vai receber) boas-vindas — sem 2ª DM', origem: 'novo seguidor' });
      continue;
    }
    if (!e.config.dmAtiva) {
      log(e, { username: u.username, acao: 'novo seguidor', resultado: 'passou a me seguir (DM desligada no painel — sem mensagem)', origem: 'novo seguidor' });
      continue;
    }
    const reg = novoRegistroSeguidor(u, agora, e.config);
    e.novosSeguidores[reg.id] = reg;
    log(e, { username: reg.username, acao: 'novo seguidor', resultado: `passou a me seguir — DM de boas-vindas agendada para ${formatarSP(reg.dmAgendadaPara)}`, origem: reg.origem });
  }
}

/**
 * 1.1.9 (pedido do dono, 26/10): "puxar os últimos 3 dias hoje; depois só até a última conferida". Carga ÚNICA por
 * instalação (marca `e.carga3Dias.feitaEm`), inclusive para quem já tem a linha de base da 1.1.8: lê a atividade do
 * Instagram (notificações "começou a seguir você", com data) e agenda boas-vindas só para quem seguiu nas últimas 72 h
 * (contadas da 1ª tentativa), ainda sem DM — mesmo ritmo, janela e teto diário de processarDm. Sem a fonte com data
 * (HTML, formato desconhecido, data não confirmável): ninguém recebe DM por esta carga e o motivo fica no popup.
 * Limite/aguarde/sessão/sem janela: tenta de novo na próxima conferência (até CARGA_TENTATIVAS_MAX).
 */
async function cargaTresDias(e, agora) {
  const c3 = e.carga3Dias || {};
  if (c3.feitaEm || !e.meuId) return 'ok';
  const inicioEm = c3.inicioEm || agora;
  const desde = inicioEm - CARGA_JANELA_MS;
  const tentativas = (c3.tentativas || 0) + 1;
  e.carga3Dias = { ...c3, inicioEm, desde, tentativas };
  const encerrar = (extra) => { e.carga3Dias = { ...e.carga3Dias, feitaEm: Date.now(), ...extra }; };
  const indisponivel = (motivo) => {
    encerrar({ erro: motivo, encontrados: 0, agendados: 0 });
    log(e, { acao: 'carga 3 dias', resultado: `Carga dos últimos 3 dias indisponível: ${motivo} — nenhuma DM por esta carga; seguem só os seguidores novos daqui para frente` });
  };

  const eventos = [];
  const tot = { seguiu: 0, agrupados: 0, semData: 0 };
  let parcial = null;
  let maxId = null;
  for (let p = 0; p < CARGA_PAGINAS_MAX; p += 1) {
    await pausaHumana();
    let j;
    try {
      j = await api.atividade(maxId);
    } catch (err) {
      const tipo = err instanceof ErroInstagram ? err.tipo : 'outro';
      if (p > 0) { parcial = `a página ${p + 1} da atividade falhou (${String(err.message || err).slice(0, 160)})`; if (bloqueante(tipo)) tratarErro(e, err, 'carga 3 dias'); break; }
      if (bloqueante(tipo) || tipo === 'aba') {
        const msg = String(err.message || err).split(' [')[0];
        if (tentativas >= CARGA_TENTATIVAS_MAX) { indisponivel(`${tentativas} tentativas sem resposta (${msg})`); return 'ok'; }
        e.carga3Dias.ultimoErro = msg;
        if (bloqueante(tipo)) tratarErro(e, err, 'carga 3 dias');
        else log(e, { acao: 'carga 3 dias', resultado: `tentativa ${tentativas} falhou (${msg}) — tenta de novo na próxima conferência` });
        return bloqueante(tipo) ? tipo : 'ok';
      }
      indisponivel(String(err.message || err).split(' [')[0].slice(0, 300));
      return 'ok';
    }
    const r = interpretarAtividade(j, { agora: Date.now(), desde, meuId: e.meuId });
    if (!r.ok) {
      if (p > 0) { parcial = `a página ${p + 1} da atividade veio fora do formato`; break; }
      indisponivel(r.motivo);
      return 'ok';
    }
    eventos.push(...r.eventos);
    tot.seguiu += r.seguiu; tot.agrupados += r.agrupados; tot.semData += r.semData;
    const chegouAntes = r.maisAntigoEm != null && r.maisAntigoEm < desde; // já passou das 72 h: não precisa de mais páginas
    if (chegouAntes) break;
    if (!r.proximo) { parcial = `a atividade do Instagram só mostrou até ${r.maisAntigoEm ? formatarSP(r.maisAntigoEm) : 'agora'} — quem seguiu antes disso não aparece nela`; break; }
    if (p === CARGA_PAGINAS_MAX - 1) { parcial = `lidas ${CARGA_PAGINAS_MAX} páginas da atividade sem chegar a 72 h atrás`; break; }
    maxId = r.proximo;
  }
  if (tot.seguiu > 0 && tot.seguiu === tot.semData) {
    indisponivel(`${tot.semData} notificações de "começou a seguir você" sem data confirmável`);
    return 'ok';
  }

  const { encontrados, novos, followBack, jaTinham } = separarCarga(e, eventos);
  let agendados = 0;
  const agoraR = Date.now();
  if (e.config.dmAtiva) {
    novos.forEach((u, i) => {
      const reg = registroDaCarga(u, agoraR, e.config, i);
      e.novosSeguidores[reg.id] = reg;
      agendados += 1;
      log(e, { username: reg.username, acao: 'carga 3 dias', resultado: `seguiu em ${formatarSP(u.em)} — DM de boas-vindas agendada para ${formatarSP(reg.dmAgendadaPara)}`, origem: reg.origem });
    });
  }
  for (const id of followBack) {
    const reg = e.seguidos[id];
    marcarFollowBack(e, reg, agoraR);
    if (reg.dmAgendadaPara && !reg.dmCoberta && !reg.dmDesistiu) agendados += 1;
  }
  const notas = [];
  if (!e.config.dmAtiva && novos.length) notas.push('DM desligada no painel — nenhuma agendada');
  if (jaTinham) notas.push(`${jaTinham} já tinham boas-vindas`);
  if (tot.agrupados) notas.push(`${tot.agrupados} notificações agrupadas sem a data de cada pessoa ficaram de fora`);
  if (tot.semData) notas.push(`${tot.semData} sem data confirmável ficaram de fora`);
  if (parcial) notas.push(`cobertura parcial: ${parcial}`);
  encerrar({ erro: null, encontrados: encontrados.length, agendados, notas });
  log(e, { acao: 'carga 3 dias', resultado: `Carga 3 dias: ${encontrados.length} encontrados, ${agendados} agendados${notas.length ? ` (${notas.join('; ')})` : ''}` });
  return 'ok';
}

/** O alerta antigo de "show_many respondeu de forma inesperada" some quando a checagem volta a funcionar. */
function limparAlertaShowMany(e) {
  if (e.alerta && e.alerta.tipo === 'mudanca_api' && /show_many/.test(e.alerta.texto || '')) e.alerta = null;
}

/**
 * 1.1.4: plano B da varredura — no máximo PERFIS_POR_VARREDURA seguidos, os menos conferidos primeiro, com
 * intervalo humano entre eles. 1.1.7: primeiro o friendships/show (diz se a pessoa me segue); só se ele responder
 * HTML, a leitura do botão do perfil (sem clicar) — o botão "Seguindo" não diz se a pessoa segue de volta.
 */
async function verificarPeloPerfil(e, ids) {
  const regs = ids
    .map((id) => e.seguidos[id])
    .filter((r) => r && r.username)
    .sort((a, b) => (a.checadoPerfilEm || 0) - (b.checadoPerfilEm || 0))
    .slice(0, PERFIS_POR_VARREDURA);
  let conferidos = 0;
  for (const reg of regs) {
    await pausaEntrePerfis();
    let st;
    try {
      st = await api.amizade(reg.id, reg.username);
    } catch (err) {
      const tipo = tratarErro(e, err, 'verificar follow-back (perfil)', reg.username);
      if (bloqueante(tipo)) return tipo;
      break; // leitura indisponível: tenta de novo na próxima varredura
    }
    reg.checadoPerfilEm = Date.now();
    conferidos += 1;
    if (atualizarSolicitacao(reg, st, Date.now())) {
      log(e, { username: reg.username, acao: 'solicitação aceita', resultado: 'aceitou a solicitação (perfil privado)', origem: reg.origem });
    }
    if (st.meSegue === true) marcarFollowBack(e, reg, Date.now());
  }
  if (conferidos) limparAlertaShowMany(e);
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
  } else if (e.semJanela) {
    proxima = { acao: 'Esperando abrir uma janela do Chrome', em: null }; // o alarme "vigia" (5 min) confere de novo
  } else {
    const opcoes = [];
    if (e.agenda.follows[0]) opcoes.push({ acao: 'Seguir', em: e.agenda.follows[0] });
    if (e.agenda.unfollows[0]) opcoes.push({ acao: 'Deixar de seguir (se houver alguém com 3 dias)', em: e.agenda.unfollows[0] });
    if (cfg.dmAtiva) {
      for (const r of registrosDm(e)) {
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

/**
 * 1.1.8 (uma vez, na atualização): as boas-vindas que desistiram por HTML na API, antes de existir a digitação na tela
 * da DM, ganham UMA nova tentativa (que já usa a digitação se a API continuar em HTML).
 */
function reabilitarDmsHtml(e, agora) {
  if (e.reabilitacaoDmHtml) return;
  e.reabilitacaoDmHtml = agora;
  const feitos = reabilitarDesistidasPorHtml(registrosDm(e), e.historico, agora, e.config, DM_MAX_TENTATIVAS_HTML);
  for (const r of feitos) {
    log(e, { username: r.username, acao: 'DM', resultado: `versão 1.1.8: nova tentativa (uma vez) da boas-vindas que não saiu por HTML — agora com digitação na tela da DM, às ${formatarSP(r.dmAgendadaPara)}`, origem: r.origem });
  }
  if (feitos.length && e.alerta && e.alerta.tipo === 'dm') e.alerta = null;
}

/**
 * 1.1.10 (uma vez, na atualização): boas-vindas que pararam porque a busca da conversa (get_by_participants) respondeu
 * 404 — tratada como "mudança de API" até a 1.1.9 — ganham UMA nova tentativa, que agora segue para a digitação.
 * Nunca mexe em DM já enviada, incerta ou que já passou pela digitação.
 */
function reabilitarDmsGetByParticipants(e, agora) {
  if (e.reabilitacaoDm1110) return;
  e.reabilitacaoDm1110 = agora;
  let n = 0;
  for (const r of registrosDm(e)) {
    if (!r.dmDesistiu || r.dmEnviadaEm || r.dmIncerta || r.dmDigitacaoTentadaEm) continue;
    r.dmDesistiu = false;
    r.dmFalhas = 0;
    r.dmTentativaEm = null;
    r.dmAgendadaPara = ajustarParaJanela(agora + atrasoDmMs() + n * INTERVALO_MIN_ENTRE_DMS, agora, e.config);
    n += 1;
    log(e, { username: r.username, acao: 'DM', resultado: `versão 1.1.10: nova tentativa (uma vez) da boas-vindas — agora com digitação na tela da DM, às ${formatarSP(r.dmAgendadaPara)}`, origem: r.origem });
  }
  if (e.alerta && e.alerta.tipo === 'mudanca_api' && /get_by_participants|direct_v2/.test(e.alerta.texto || '')) e.alerta = null;
}

/**
 * 1.1.13 (uma vez, na atualização): as boas-vindas que a digitação na tela da DM deu como enviadas/incertas sem terem
 * saído (dono, 26/10: "nenhuma mensagem foi enviada, mas ali constam 13 DMs enviadas"; ele confirmou que nenhuma saiu)
 * voltam a pendentes, espaçadas, e o contador de hoje passa a contar só as reais.
 */
function resetarDmsFalsas1113(e, agora) {
  if (e.resetDm1113) return;
  e.resetDm1113 = agora;
  const n = aplicarResetDms(e, agora, {});
  if (n) log(e, { acao: 'DM', resultado: `versão 1.1.13: ${n} boas-vindas marcadas como enviadas/incertas pela digitação (nenhuma saiu de verdade) voltaram a pendentes; o contador de hoje conta só as reais` });
}

/** Reset das DMs da digitação (atualização 1.1.13 e comando remoto reset_dms). Devolve quantas voltaram a pendentes. */
function aplicarResetDms(e, agora, { ids = null, desde = null }) {
  const hoje = diaSP(agora);
  const r = resetarDmsDigitacao(registrosDm(e), { agora, cfg: e.config, dia: hoje, diaDe: diaSP, ids, desde, intervaloMs: INTERVALO_MIN_ENTRE_DMS });
  if (e.contadores.dia === hoje) {
    e.contadores.dms = Math.max(0, (e.contadores.dms || 0) - r.enviadasHoje);
    e.contadores.dmsIncertas = Math.max(0, (e.contadores.dmsIncertas || 0) - r.incertasHoje);
  }
  for (const x of r.resetados) log(e, { username: x.username, acao: 'DM', resultado: `boas-vindas volta a pendente (não tinha saído) — nova tentativa às ${formatarSP(x.dmAgendadaPara)}`, origem: x.origem });
  if (r.resetados.length && e.alerta && e.alerta.tipo === 'dm') e.alerta = null;
  return r.resetados.length;
}

// ---------------------------------------------------------------- 1.1.13: configuração e comandos do CRM

/**
 * Busca no CRM (GET /api/marketplace/ig-config, chave mkp_) a configuração (só dados — lib/config-remota.js) e os
 * comandos da lista fechada. Configuração inválida ou CRM fora do ar: fica a última boa (ou o padrão). Cada comando
 * roda UMA vez (o id é marcado antes de rodar) e responde com o diagnóstico `ig_ack`.
 */
async function sincronizarCrm() {
  const crm = await lerConfigCrm();
  await aplicarConfigGuardada();
  if (!crm.chave) return { ok: false, erro: 'sem chave do CRM' };
  const guardada = (await chrome.storage.local.get(CHAVE_CONFIG_REMOTA))[CHAVE_CONFIG_REMOTA] || {};
  let dados;
  try {
    const resp = await fetch(`${normalizarUrlCrm(crm.url)}/api/marketplace/ig-config`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${crm.chave}`, ...(crm.versao ? { 'X-Extension-Version': `instagram-seguidor ${crm.versao}` } : {}) },
      cache: 'no-store',
    });
    dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(resp.status === 401 ? 'chave do CRM recusada' : dados.error || `CRM respondeu ${resp.status}`);
  } catch (err) {
    await chrome.storage.local.set({ [CHAVE_CONFIG_REMOTA]: { ...guardada, erro: `${err.message || err}`, erroEm: Date.now() } });
    return { ok: false, erro: err.message || String(err) };
  }
  const config = validarConfigRemota(dados.config);
  aplicarConfigRemota(config);
  configAplicada = true;
  await chrome.storage.local.set({ [CHAVE_CONFIG_REMOTA]: { config, recebidaEm: Date.now() } });
  const estadoCmd = (await chrome.storage.local.get(CHAVE_COMANDOS))[CHAVE_COMANDOS] || { executados: [] };
  const novos = comandosPendentes(dados.commands, estadoCmd.executados || []);
  for (const cmd of novos) {
    estadoCmd.executados = marcarExecutado(estadoCmd.executados || [], cmd.id); // antes de rodar: nunca 2 vezes
    await chrome.storage.local.set({ [CHAVE_COMANDOS]: estadoCmd });
    let resultado;
    try {
      resultado = await executarComando(cmd);
    } catch (err) {
      resultado = { ok: false, erro: err && err.message ? err.message : String(err) };
    }
    const resumo = String(resultado.texto || resultado.erro || (resultado.ok ? 'ok' : 'falhou')).slice(0, 300);
    estadoCmd.ultimo = { id: cmd.id, tipo: cmd.tipo, em: Date.now(), resultado: resumo };
    await chrome.storage.local.set({ [CHAVE_COMANDOS]: estadoCmd });
    await diagnosticar('ig_ack', { acao: `comando ${cmd.tipo}`, username: cmd.args.username ? limparArroba(cmd.args.username) : '', resultado: resumo, extra: { id: cmd.id, tipo: cmd.tipo, ok: Boolean(resultado.ok), resultado } });
  }
  return { ok: true, versao: config.versao || null, comandos: novos.length };
}

let configAplicada = false;
/** A configuração guardada vale desde o início do service worker (ele reinicia o tempo todo). */
async function aplicarConfigGuardada() {
  if (configAplicada) return;
  configAplicada = true;
  const g = (await chrome.storage.local.get(CHAVE_CONFIG_REMOTA))[CHAVE_CONFIG_REMOTA];
  if (g && g.config) aplicarConfigRemota(validarConfigRemota(g.config));
}

/** Comandos remotos (lista fechada — lib/config-remota.js TIPOS_COMANDO). Nunca código. */
async function executarComando(cmd) {
  switch (cmd.tipo) {
    case 'ping':
      return { ok: true, texto: `versão ${versaoExtensao() || '?'} ativa` };
    case 'dryrun_dm':
      return testarDmSeco(cmd.args.username);
    case 'dryrun_follow':
      return testarSeguirSeco(cmd.args.username);
    case 'send_next_now':
      return enviarProximaDmAgora();
    case 'check_followers':
      return { ok: true, ...(await cicloVerificar({ manual: true })) };
    case 'reset_dms': {
      const e = await carregar();
      const n = aplicarResetDms(e, Date.now(), { ids: cmd.args.ids || null, desde: cmd.args.desde ?? null });
      log(e, { acao: 'DM', resultado: `comando do CRM: ${n} boas-vindas da digitação voltaram a pendentes` });
      await agendarProximo(e, await lerControle());
      await salvar(e);
      return { ok: true, texto: `${n} boas-vindas voltaram a pendentes` };
    }
    default:
      return { ok: false, erro: `comando desconhecido: ${cmd.tipo}` };
  }
}

async function ciclo() {
  await aplicarConfigGuardada();
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
  reabilitarDmsHtml(e, agora);
  reabilitarDmsGetByParticipants(e, agora);
  resetarDmsFalsas1113(e, agora);

  if (estaAtiva(e, c, agora) && dentroDaJanela(agora, e.config) && (await checarJanela(e))) {
    let r = await processarDm(e, agora);
    if (!bloqueante(r)) r = await processarSeguir(e, Date.now());
    if (!bloqueante(r)) r = await processarDeixarDeSeguir(e, Date.now());
    if (!bloqueante(r)) await reabastecerFila(e, Date.now());
  } else if (!dentroDaJanela(agora, e.config)) {
    // Fora da janela: DMs pendentes vão para a próxima abertura + 1–3 min.
    for (const r of registrosDm(e)) {
      if (r.dmAgendadaPara && !r.dmEnviadaEm && !r.dmTentativaEm && !dentroDaJanela(r.dmAgendadaPara, e.config)) {
        r.dmAgendadaPara = ajustarParaJanela(r.dmAgendadaPara, agora, e.config);
      }
    }
  }
  await agendarProximo(e, c);
  await salvar(e);
}

/**
 * Checagem de follow-back (alarme de 2 min). `manual` (1.1.7, botão "Conferir seguidores agora"): faz a conferência
 * completa na hora (no máximo uma a cada 2 min) e devolve { feito, novos, texto } para o popup. Respeita a janela,
 * a pausa e a sessão como a checagem automática.
 */
async function cicloVerificar({ manual = false } = {}) {
  await aplicarConfigGuardada();
  const e = await carregar();
  const c = await lerControle();
  const agora = Date.now();
  const resposta = (feito, texto, novos = 0) => (manual ? { feito, novos, texto } : undefined);
  if (!dentroDaJanela(agora, e.config)) {
    const d2 = (n) => String(n).padStart(2, '0');
    return resposta(false, `Fora da janela de trabalho (${d2(e.config.inicioHora)}:00–${d2(e.config.fimHora)}:00): a conferência fica para a abertura.`);
  }
  if (!estaAtiva(e, c, agora)) return resposta(false, 'Extensão pausada ou esperando o Instagram — retome para conferir.');
  virarDiaSeNecessario(e, agora); // 1.1.8: o contador de seguidores novos do dia pode ser tocado aqui
  if (!(await checarSessao(e))) { await agendarProximo(e, c); await salvar(e); return resposta(false, 'Sem sessão do Instagram neste Chrome — entre no instagram.com.'); }
  if (!(await checarJanela(e))) { await salvar(e); return resposta(false, 'Nenhuma janela do Chrome aberta — abra uma para conferir.'); }
  const comFollowBack = () => Object.values(e.seguidos).filter((r) => r.followBackEm).length;
  const antes = comFollowBack();
  const novosAntes = Object.keys(e.novosSeguidores).length;
  const erroAntes = e.boasVindas && e.boasVindas.ultimoErro;
  const forcar = manual && (!e.ultimaVarreduraEm || agora - e.ultimaVarreduraEm >= 2 * MINUTO);
  let r = await verificarFollowBacks(e, agora, { forcarCompleta: forcar });
  if (r === 'ok') r = await cargaTresDias(e, Date.now()); // 1.1.9: uma vez por instalação
  await agendarProximo(e, c);
  await salvar(e);
  if (!manual) return undefined;
  const novos = comFollowBack() - antes;
  const erroNovo = e.boasVindas.ultimoErro && e.boasVindas.ultimoErro !== erroAntes ? ` Erro: ${e.boasVindas.ultimoErro.texto}` : '';
  const novosSeg = Object.keys(e.novosSeguidores).length - novosAntes;
  const achados = (novos ? `${novos} ${novos === 1 ? 'novo follow-back' : 'novos follow-backs'} — DM agendada (sai em 1 a 3 min)` : 'nenhum follow-back novo')
    + (novosSeg ? `; ${novosSeg} ${novosSeg === 1 ? 'seguidor novo' : 'seguidores novos'} com boas-vindas agendada` : '');
  const parou = r !== 'ok' ? ` O Instagram pediu para parar (${r}).` : '';
  return resposta(true, `Conferido às ${formatarSP(Date.now()).slice(11, 16)}: ${achados}.${parou}${erroNovo}`, novos);
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
      meSeguem: meSeguemConhecidos(e),
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
      meuId: e.meuId, fila: e.fila, vistos: e.vistos, seguidos: e.seguidos, meSeguem: meSeguemConhecidos(e),
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
  if ('limiteDmDiario' in nova) n.limiteDmDiario = inteiro(nova.limiteDmDiario, 1, 100, atual.limiteDmDiario);
  if ('mensagem' in nova && String(nova.mensagem).trim()) n.mensagem = String(nova.mensagem);
  return n;
}

// ---------------------------------------------------------------- 1.1.12: testes na hora (popup/painel)

const limparArroba = (u) => String(u || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '').toLowerCase();

async function testarDmSeco(usuario) {
  await aplicarConfigGuardada();
  const username = limparArroba(usuario);
  if (!/^[a-z0-9._]{1,30}$/.test(username)) return { ok: false, erro: 'Digite um @ válido.' };
  const e = await carregar();
  let r;
  try {
    r = await digitarDmNaAba({ username, texto: e.config.mensagem, seco: true });
  } catch (err) {
    r = { ok: false, erro: err && err.message ? err.message : String(err) };
  }
  const partes = [
    r.erro && !('textoConferido' in r) ? `parou antes: ${r.erro}` : null,
    'textoConferido' in r ? `mensagem ${r.textoConferido ? `inteira na caixa (${r.como})` : 'NÃO ficou inteira na caixa'}` : null,
    'botaoEnviar' in r ? `botão Enviar ${r.botaoEnviar ? 'encontrado (não clicado)' : 'NÃO encontrado'}` : null,
    'caixaLimpa' in r ? `caixa ${r.caixaLimpa ? 'apagada' : 'NÃO ficou vazia — apague à mão'}` : null,
    r.jaNaConversa ? 'a mensagem já está nessa conversa' : null,
  ].filter(Boolean);
  const texto = `Teste a seco da DM para @${username} (nada enviado): ${partes.join('; ')}.`;
  const envio = await diagnosticar('ig_dryrun', { acao: 'testar DM (sem enviar)', username, resultado: texto, rastro: [{ passo: 'teste a seco da DM' }] });
  log(e, { username, acao: 'teste a seco', resultado: texto });
  await salvar(e);
  return { ok: Boolean(r.ok), texto: `${texto}${envio.ok ? ' Diagnóstico enviado ao CRM.' : ` Diagnóstico não enviado (${envio.erro}).`}` };
}

async function testarSeguirSeco(usuario) {
  await aplicarConfigGuardada();
  const username = limparArroba(usuario);
  if (!/^[a-z0-9._]{1,30}$/.test(username)) return { ok: false, erro: 'Digite um @ válido.' };
  const e = await carregar();
  let r;
  try {
    r = await clicarNaAba({ username, seguir: true, seco: true });
  } catch (err) {
    r = { ok: false, erro: err && err.message ? err.message : String(err) };
  }
  const nomes = { seguir: 'Seguir', seguir_de_volta: 'Seguir de volta', seguindo: 'Seguindo', solicitado: 'Solicitado' };
  const texto = r.botao
    ? `Teste do botão em @${username} (nada clicado): botão "${nomes[r.botao] || r.botao}" encontrado${r.segueVoce ? ' e "Segue você"' : ''}${r.botao === 'seguir' && !r.segueVoce ? ` — a extensão clicaria nele${r.livre === false ? ' (pela página: há algo por cima do ponto)' : ''}` : ' — a extensão NÃO seguiria'}.`
    : `Teste do botão em @${username} (nada clicado): ${r.erro || 'botão não encontrado'}.`;
  const envio = await diagnosticar('ig_dryrun', { acao: 'testar botão Seguir (sem clicar)', username, resultado: texto, rastro: [{ passo: 'teste a seco do seguir' }] });
  log(e, { username, acao: 'teste a seco', resultado: texto });
  await salvar(e);
  return { ok: Boolean(r.botao), texto: `${texto}${envio.ok ? ' Diagnóstico enviado ao CRM.' : ` Diagnóstico não enviado (${envio.erro}).`}` };
}

/**
 * 1.1.12 — botão "Enviar a próxima boas-vindas agora": a próxima pendente (a mais antiga) sai NA HORA, sem esperar o
 * agendamento. Mantém tudo o mais: janela 05–22h, extensão ativa, teto diário, 1 min entre DMs, uma única vez,
 * conferência de texto, confirmação na conversa, incerta nunca reenviada.
 */
async function enviarProximaDmAgora() {
  await aplicarConfigGuardada();
  const e = await carregar();
  const c = await lerControle();
  const cfg = e.config;
  const agora = Date.now();
  if (!cfg.dmAtiva) return { ok: false, erro: 'A DM de boas-vindas está desligada no painel.' };
  if (!dentroDaJanela(agora, cfg)) return { ok: false, erro: 'Fora da janela (05:00–22:00) — nada enviado.' };
  if (!estaAtiva(e, c, agora)) return { ok: false, erro: 'Extensão pausada ou esperando o Instagram — retome antes.' };
  if (tetoDmAtingido(e.contadores, cfg)) return { ok: false, erro: `Teto diário de ${cfg.limiteDmDiario || LIMITE_DM_DIARIO_PADRAO} boas-vindas atingido.` };
  if (e.ultimaDmEm && agora - e.ultimaDmEm < INTERVALO_MIN_ENTRE_DMS) return { ok: false, erro: `Espere ${Math.ceil((INTERVALO_MIN_ENTRE_DMS - (agora - e.ultimaDmEm)) / 1000)} s (1 min entre DMs).` };
  const r = proximaBoasVindasPendente(e);
  if (!r) return { ok: false, erro: 'Nenhuma boas-vindas pendente.' };
  log(e, { username: r.username, acao: 'DM', resultado: 'enviando agora (botão "Enviar a próxima boas-vindas agora")', origem: r.origem });
  const res = await enviarBoasVindas(e, r, { manual: true });
  await salvar(e);
  const rotulo = { enviada: 'ENVIADA', incerta: 'INCERTA (não será repetida — confira no Instagram)', nao_enviada: 'NÃO ENVIADA' }[res.situacao] || res.situacao;
  return { ok: res.situacao === 'enviada', situacao: res.situacao, username: r.username, texto: `@${r.username}: ${rotulo} — ${res.texto}` };
}

// ---------------------------------------------------------------- eventos

async function garantirAlarmes() {
  const cfg = (await carregar()).config;
  if (!(await chrome.alarms.get(ALARME_VERIFICAR))) chrome.alarms.create(ALARME_VERIFICAR, { periodInMinutes: cfg.verificarACadaMin || 2 });
  if (!(await chrome.alarms.get(ALARME_VIGIA))) chrome.alarms.create(ALARME_VIGIA, { periodInMinutes: 5 });
  if (!(await chrome.alarms.get(ALARME_CRM))) chrome.alarms.create(ALARME_CRM, { periodInMinutes: INTERVALO_SINCRONIZAR_MIN });
}

chrome.runtime.onInstalled.addListener((detalhes) => {
  serializar(async () => {
    if (detalhes && detalhes.reason === 'update') {
      // 1.1.0: carregar() já migra as opções (padrão "pular privados" passa a desligado);
      // salva para registrar a migração uma vez no histórico.
      const m = await carregar();
      const antes = (await chrome.storage.local.get('estado')).estado;
      if (antes && (Number(antes.versao) || 1) < 2) {
        log(m, { acao: 'atualização', resultado: `versão 1.1.0: perfis privados passam a ser seguidos (Solicitado); "pular privados" ${m.config.pularPrivados ? 'continua ligado' : 'desligado'}; janela de trabalho própria no lugar da aba fixada` });
        await salvar(m);
      }
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
    await sincronizarCrm();
  }).catch((err) => console.error(err));
});
chrome.runtime.onStartup.addListener(() => {
  serializar(async () => { await garantirAlarmes(); await ciclo(); await sincronizarCrm(); }).catch((err) => console.error(err));
});

chrome.alarms.onAlarm.addListener((alarme) => {
  // Sem repassar argumento: serializar() entrega à função o resultado da operação anterior.
  const fn = alarme.name === ALARME_VERIFICAR ? () => cicloVerificar() : alarme.name === ALARME_CRM ? () => sincronizarCrm() : () => ciclo();
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
          e.suspensoSeguir = null;
          e.suspensoDeixar = null;
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
          log(e, { acao: 'configuração', resultado: `limite ${e.config.limiteDiario}/dia, deixar de seguir ${e.config.limiteUnfollowDiario}/dia, boas-vindas até ${e.config.limiteDmDiario}/dia, privados ${e.config.pularPrivados ? 'pulados' : 'aceitos (Solicitado)'}` });
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
      case 'abrirJanela':
        return abrirJanelaTrabalho();
      case 'situacaoJanela':
        return { ok: true, ...(await situacaoJanelaTrabalho()) };
      case 'conferirSeguidores':
        // 1.1.7: botão "Conferir seguidores agora" (popup e painel).
        return { ok: true, ...(await serializar(() => cicloVerificar({ manual: true }))) };
      case 'salvarCrm': {
        // 1.1.12: URL e chave do CRM (chave pessoal mkp_… da extensão do Marketplace). Fora do estado/histórico/CSV.
        const url = normalizarUrlCrm(msg.url);
        const nova = String(msg.chave || '').trim();
        if (nova && !/^mkp_[A-Za-z0-9_-]{8,}$/.test(nova)) return { ok: false, erro: 'A chave do CRM começa com mkp_ (copie de Cadastros › Marketplace).' };
        const atual = (await chrome.storage.local.get(CHAVE_CRM))[CHAVE_CRM] || {};
        const chave = msg.apagarChave ? '' : nova || atual.chave || ''; // campo vazio = mantém a chave já salva
        await chrome.storage.local.set({ [CHAVE_CRM]: { url, chave } });
        return { ok: true, url, temChave: Boolean(chave) };
      }
      case 'testarCrm': {
        const crm = await lerConfigCrm();
        if (!crm.chave) return { ok: false, erro: 'Configure a chave do CRM primeiro.' };
        try {
          const r = await enviarDiagnosticoCrm(crm, 'ig_ping', montarDiagnostico({ versao: crm.versao, acao: 'testar conexão', resultado: 'ok' }));
          await chrome.storage.local.set({ [CHAVE_ULTIMO_ENVIO]: { em: Date.now(), kind: 'ig_ping', ok: true, id: r.id } });
          return { ok: true, texto: `Conexão com o CRM OK (${crm.url}).` };
        } catch (err) {
          return { ok: false, erro: `CRM não respondeu: ${err.message}` };
        }
      }
      case 'testarDm':
        // 1.1.12: teste a seco — abre, cola, confere, acha o Enviar e PARA (nada é enviado); apaga a caixa.
        return serializar(() => testarDmSeco(msg.username));
      case 'testarSeguir':
        // 1.1.12: abre o perfil e só relata o botão encontrado (nunca clica).
        return serializar(() => testarSeguirSeco(msg.username));
      case 'enviarProximaDm':
        return serializar(() => enviarProximaDmAgora());
      case 'sincronizarCrm':
        // 1.1.13: popup/painel abertos — busca a configuração e os comandos do CRM na hora.
        return serializar(() => sincronizarCrm());
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
  verificar: () => serializar(() => cicloVerificar()),
  ocioso: () => serializar(async () => {}),
};
