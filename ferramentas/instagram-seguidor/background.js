// Service worker da extensão: agenda, fila, seguir / deixar de seguir, follow-back e DM.
// Toda a comunicação com o Instagram passa por instagram-tela.js (1.2.0: só pela tela, clicando como o dono — nada de
// API interna, cabeçalhos copiados ou cookies). Ligação com a tela "Extensões" do CRM: lib/crm-link.js.

import { criarTelaChrome, ErroInstagram, haJanelaParaTrabalhar, abrirJanelaTrabalho, situacaoJanelaTrabalho } from './instagram-tela.js';
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
} from './lib/regras.js';
import { normalizarEstado, virarDiaSeNecessario, registrarHistorico, resumoBusca } from './lib/estado.js';
import { aplicarConfigDoCrm, resumoSaude } from './lib/crm-config.js';
import { criarLigacaoCrmChrome, CRM_PADRAO, normalizarUrlCrm } from './lib/crm-link.js';

const api = criarTelaChrome();

// 1.2.0 (EXT-1, dono, 2026-10-29): chave igs_… (gerada na tela Extensões do CRM) e URL do CRM ficam nas Opções.
async function configCrm() {
  const { crm } = await chrome.storage.local.get('crm');
  return { baseUrl: (crm && crm.baseUrl) || CRM_PADRAO, key: (crm && crm.key) || '', version: chrome.runtime.getManifest().version };
}
const crmLink = criarLigacaoCrmChrome(configCrm);

const ALARME_ACAO = 'acao'; // próxima ação agendada (one-shot)
const ALARME_VERIFICAR = 'verificar'; // conferência dos meus seguidores (padrão 10 min desde a 1.2.0; muda no CRM)
const ALARME_VIGIA = 'vigia'; // rede de segurança (a cada 5 min): virada de dia, abertura da janela etc.
const VARREDURA_COMPLETA_MS = 30 * MINUTO; // conferência completa de 30 em 30 min
// Na conferência completa, quem não apareceu na minha lista é conferido um a um (perfil + pesquisa na minha lista),
// no máximo N por rodada, com intervalo humano — nunca uma rajada de visitas.
const PERFIS_POR_VARREDURA = 5;
// 1.2.0: quantos dos MEUS seguidores mais recentes a extensão lê na janela "Seguidores" (rápida / completa / máximo
// procurando o 1º já conhecido).
const MEUS_SEGUIDORES_RAPIDA = 12;
const MEUS_SEGUIDORES_COMPLETA = 48;
const MEUS_SEGUIDORES_MAX = 96;
// 1.1.5: DM que não saiu: até 3 tentativas (agora, +30 min, +2 h) e então alerta no popup.
const DM_MAX_TENTATIVAS_HTML = 3;
const HORA_DM = 60 * MINUTO;
const INTERVALO_MIN_ENTRE_DMS = 60 * 1000;
const INTERVALO_REABASTECER_MS = 20 * MINUTO;
// 1.2.0: reabastecer lê mais 36 perfis da lista do perfil de referência (a lista da tela não tem "página"; relê do
// topo até onde parou) e nunca passa deste total.
const REABASTECER_LOTE = 36;
const LISTA_ORIGEM_MAX = 1000;

/** 1.1.8: todos os registros com DM de boas-vindas: follow-back (`seguidos`) e novos seguidores. */
const registrosDm = (e) => [...Object.values(e.seguidos), ...Object.values(e.novosSeguidores || {})];
/** Meu @: o das Opções, senão o lido na tela (link "Perfil" do menu do Instagram). */
const meuUsuario = (e) => (e.config.meuUsuario || e.meuUsuario || '').toLowerCase();

// ---------------------------------------------------------------- utilidades

let corrente = Promise.resolve();
/** Executa operações uma de cada vez (evita duas rotinas mexendo no estado juntas). */
function serializar(fn) {
  const p = corrente.then(fn, fn);
  corrente = p.catch(() => {}); // o erro chega a quem chamou (p); aqui só mantém a fila andando
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
  // 1.2.0: todo erro vai ao sinal de saúde do CRM (sem o @ da pessoa); parte da tela não achada, também.
  crmLink.registrarErro(contexto, msg).catch(crmLink.engolido('registrar erro no sinal'));
  if (err && err.seletor) crmLink.registrarSeletor(err.seletor, msg).catch(crmLink.engolido('registrar seletor no sinal'));
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
    if (!jaEstava) notificar('Instagram: sem sessão', 'O Instagram está pedindo login neste Chrome. Abra o instagram.com e entre de novo.');
  } else if (tipo === 'indisponivel') {
    // Leitura sem resposta útil: só registra; não pausa, não vira "sem sessão".
    log(e, { username, acao: contexto, resultado: `leitura indisponível: ${msg}` });
  } else {
    log(e, { username, acao: contexto, resultado: `erro (${tipo}): ${msg}` });
    if (tipo === 'mudanca_api') {
      e.alerta = { tipo, em: agora, texto: msg };
    }
  }
  return tipo;
}

// Interrompe a rodada sem perder o perfil da vez (o "sem_janela" não pausa: só espera; "parado" = Parar tudo do CRM).
const bloqueante = (tipo) => tipo === 'limite' || tipo === 'aguarde' || tipo === 'sessao' || tipo === 'sem_janela' || tipo === 'parado';

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

/**
 * 1.2.0: sessão conferida na própria TELA do Instagram (a janela de trabalho está na página de login?), sem cookies.
 * Pausa/retoma sozinha. Também lê o meu @ (link "Perfil" do menu), se as Opções não tiverem.
 */
async function checarSessao(e) {
  if (e.semSessao && e.sessaoRecheckEm && Date.now() < e.sessaoRecheckEm) return false; // recusada há pouco: espera
  let s;
  try {
    s = await api.lerSessao();
  } catch (err) {
    const tipo = tratarErro(e, err, 'sessão');
    return !bloqueante(tipo) && !e.semSessao;
  }
  if (!s.logado) {
    if (!e.semSessao) {
      aplicarPausaPorErro(e, 'sessao', Date.now());
      log(e, { acao: 'sessão', resultado: 'Instagram pedindo login na janela de trabalho — pausado' });
      notificar('Instagram: sem sessão', 'Entre no instagram.com neste Chrome. A extensão volta sozinha.');
    } else {
      e.sessaoRecheckEm = Date.now() + 10 * MINUTO;
    }
    return false;
  }
  if (e.semSessao) {
    e.semSessao = false;
    e.sessaoRecheckEm = null;
    if (e.alerta && e.alerta.tipo === 'sessao') e.alerta = null;
    log(e, { acao: 'sessão', resultado: 'Sessão do Instagram encontrada — retomando' });
  }
  if (s.meuUsuario) e.meuUsuario = s.meuUsuario;
  return true;
}

/**
 * 1.2.0 (EXT-1): estado do CRM — "Parar tudo" e a configuração editada na tela Extensões. Consultado no começo de cada
 * rodada e antes de cada ação (cache de 10 s). Sem chave: segue o painel local. Devolve true se está PARADO.
 */
async function paradoPeloCrm(e) {
  const r = await crmLink.estado();
  if (r.config) {
    const ap = aplicarConfigDoCrm(e, r.config);
    if (ap.mudou.length) {
      log(e, { acao: 'configuração do CRM', resultado: `aplicada: seguir ${e.config.limiteDiario}/dia, deixar de seguir ${e.config.limiteUnfollowDiario}/dia, boas-vindas ${e.config.limiteDmDiario}/dia, conferir seguidores a cada ${e.config.verificarACadaMin} min, das ${e.config.inicioHora}h às ${e.config.fimHora}h` });
      if (ap.limitesMudaram) e.agenda.limite = null; // replaneja o resto do dia
      if (ap.verificarMudou) await chrome.alarms.create(ALARME_VERIFICAR, { periodInMinutes: e.config.verificarACadaMin });
    }
  }
  if (r.outdated && r.latestVersion && e.avisoVersao !== r.latestVersion) {
    e.avisoVersao = r.latestVersion;
    notificar('Seguidor IG: versão nova', `A versão ${r.latestVersion} está no CRM (este PC roda a ${chrome.runtime.getManifest().version}). Abra o popup da extensão para baixar.`);
  }
  e.crm = { stopped: r.stopped === true, outdated: r.outdated === true, latestVersion: r.latestVersion || '', downloadUrl: r.downloadUrl || '', origem: r.origem, verificadoEm: Date.now() };
  if (r.stopped && !e.paradoCrmDesde) { e.paradoCrmDesde = Date.now(); log(e, { acao: 'CRM', resultado: 'Parar tudo no CRM — a extensão não faz nada até Retomar' }); }
  if (!r.stopped && e.paradoCrmDesde) { e.paradoCrmDesde = null; log(e, { acao: 'CRM', resultado: 'Retomada no CRM' }); }
  return r.stopped === true;
}

/** Sinal de saúde ao CRM (no máximo a cada 2 min; com erro, na hora). */
async function enviarSaude(e, c, { forcar = false } = {}) {
  await crmLink.enviarSaude(resumoSaude(e, c, { paradoPeloCrm: Boolean(e.crm && e.crm.stopped) }), { forcar }).catch(crmLink.engolido('sinal de saúde'));
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
  if (await paradoPeloCrm(e)) return 'parado'; // 1.2.0: Parar tudo do CRM, conferido antes de cada ação
  const r = prontas[0];
  // Espaça as demais (nenhuma rajada de DMs).
  prontas.slice(1).forEach((o, i) => { o.dmAgendadaPara = Math.max(o.dmAgendadaPara, agora + (i + 1) * (INTERVALO_MIN_ENTRE_DMS + atrasoDmMs() / 2)); });

  r.dmTentativaEm = Date.now();
  await salvar(e); // marca ANTES de enviar: garante "uma única vez"
  await pausaHumana();
  try {
    const res = await api.enviarDm(r.username, cfg.mensagem);
    r.dmEnviadaEm = Date.now();
    r.dmDigitacaoTentadaEm = r.dmEnviadaEm;
    r.dmVia = 'digitacao';
    e.ultimaDmEm = r.dmEnviadaEm;
    e.contadores.dms += 1;
    log(e, { username: r.username, acao: 'DM', resultado: `boas-vindas enviada (${res.modo})`, origem: r.origem });
    return 'ok';
  } catch (err) {
    const tipo = err instanceof ErroInstagram ? err.tipo : 'outro';
    if (err && err.digitacao) r.dmDigitacaoTentadaEm = Date.now();
    if (bloqueante(tipo)) {
      // Limite/sessão/sem janela antes do Enter: não saiu. Reagenda para depois da pausa.
      r.dmTentativaEm = null;
      tratarErro(e, err, 'DM', r.username);
      erroBoasVindas(e, `DM para @${r.username} adiada: ${err.message || err}`);
      const volta = Math.max(e.pausaAte || 0, e.esfriarAte || 0, Date.now());
      r.dmAgendadaPara = ajustarParaJanela(volta + atrasoDmMs(), volta, cfg);
      return tipo;
    }
    if (tipo === 'nao_enviada') {
      // Certamente não saiu (a tela não chegou ao Enter). Reagenda (30 min, depois 2 h); na 3ª falha desiste COM
      // alerta no popup (nunca em silêncio).
      r.dmTentativaEm = null;
      r.dmFalhas = (r.dmFalhas || 0) + 1;
      if (err.seletor) crmLink.registrarSeletor(err.seletor, err.message).catch(crmLink.engolido('registrar seletor no sinal'));
      crmLink.registrarErro('DM', err.message).catch(crmLink.engolido('registrar erro no sinal'));
      erroBoasVindas(e, `DM para @${r.username} não enviada (tentativa ${r.dmFalhas} de ${DM_MAX_TENTATIVAS_HTML}): ${err.message}`);
      if (r.dmFalhas >= DM_MAX_TENTATIVAS_HTML) {
        r.dmDesistiu = true;
        r.dmDesistiuPor = 'tela';
        const texto = `DM de boas-vindas não pôde ser enviada para @${r.username}: a tela da conversa não deixou digitar e enviar (${r.dmFalhas} tentativas). Envie manualmente pelo Instagram, se quiser.`;
        e.alerta = { tipo: 'dm', em: Date.now(), texto };
        log(e, { username: r.username, acao: 'DM', resultado: `não enviada após ${r.dmFalhas} tentativas — desistindo, alerta no popup`, origem: r.origem });
        notificar('Instagram: DM não enviada', texto.slice(0, 200));
      } else {
        const espera = r.dmFalhas === 1 ? 30 * MINUTO : 2 * HORA_DM;
        r.dmAgendadaPara = ajustarParaJanela(Date.now() + espera, Date.now(), cfg);
        log(e, { username: r.username, acao: 'DM', resultado: `não enviada (${err.message}) — tentativa ${r.dmFalhas + 1} às ${formatarSP(r.dmAgendadaPara)}`, origem: r.origem });
      }
      return tipo;
    }
    // Não dá para saber se saiu: nunca reenviar.
    r.dmIncerta = true;
    e.contadores.dmsIncertas = (e.contadores.dmsIncertas || 0) + 1; // 1.1.8: conta no teto diário (pode ter saído)
    crmLink.registrarErro('DM', err.message || String(err)).catch(crmLink.engolido('registrar erro no sinal'));
    log(e, { username: r.username, acao: 'DM', resultado: `resultado incerto, não será repetida: ${err.message || err}`, origem: r.origem });
    erroBoasVindas(e, `DM para @${r.username} com resultado incerto (não será repetida — confira no Instagram): ${err.message || err}`);
    return tipo;
  }
}

async function processarSeguir(e, agora) {
  const decisao = replanejarSeAtrasado(e, 'follows', agora);
  if (decisao !== 'executar') return 'ok';
  const cfg = e.config;
  if (e.contadores.seguidos >= cfg.limiteDiario) { e.agenda.follows.shift(); return 'ok'; }
  if (e.suspensoSeguir === diaSP(agora)) { e.agenda.follows.shift(); return 'ok'; } // a tela não deixou seguir hoje: só amanhã
  if (await paradoPeloCrm(e)) return 'parado'; // 1.2.0: Parar tudo do CRM (o horário fica para depois)
  e.agenda.follows.shift(); // consome o horário

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
      st = await api.amizade(cand.username);
    } catch (err) {
      const tipo = tratarErro(e, err, 'checar antes de seguir', cand.username);
      if (bloqueante(tipo)) { e.fila.unshift(cand); return tipo; }
      if (tipo === 'indisponivel') {
        // Perfil não lido (botão não apareceu). O perfil volta para a fila sem ser marcado e o limite do dia não é
        // tocado; o horário perdido é replanejado (1.1.1).
        e.fila.unshift(cand);
        return tipo;
      }
      e.vistos[cand.id] = `erro:${tipo}`;
      continue;
    }
    if (st.meSegue || st.seguindo || st.pedidoPendente) {
      e.vistos[cand.id] = 'ja_relacionado';
      log(e, { username: cand.username, acao: 'pulado', resultado: st.meSegue ? 'já me segue' : st.seguindo ? 'já sigo' : 'já Solicitado antes (pedido pendente)', origem: cand.origem });
      continue;
    }
    if (cfg.pularPrivados && st.privado) {
      e.vistos[cand.id] = 'privado';
      log(e, { username: cand.username, acao: 'pulado', resultado: 'perfil privado', origem: cand.origem });
      continue;
    }

    await pausaHumana();
    try {
      const r = await api.seguir(cand.username);
      e.vistos[cand.id] = 'seguido';
      e.seguidos[cand.id] = {
        id: cand.id,
        username: cand.username,
        origem: cand.origem,
        seguidoEm: Date.now(),
        status: statusAposSeguir(r), // perfil privado: "Solicitado" (pedido pendente) — conta no limite do dia
        privado: Boolean(r.privado || st.privado || cand.privado),
      };
      e.contadores.seguidos += 1;
      log(e, { username: cand.username, acao: 'seguir', resultado: `${rotuloSeguir(r)} — confirmado na tela (${r.via})`, origem: cand.origem });
      return 'ok';
    } catch (err) {
      const tipo = tratarErro(e, err, 'seguir', cand.username);
      if (bloqueante(tipo)) { e.fila.unshift(cand); return tipo; }
      if (tipo === 'mudanca_api' || tipo === 'indisponivel') {
        // A tela não deixou seguir (botão não apareceu ou não mudou): para de insistir — SEGUIR suspenso até o fim do
        // dia; o perfil volta para a fila.
        e.fila.unshift(cand);
        e.suspensoSeguir = diaSP(Date.now());
        e.alerta = { tipo, em: Date.now(), texto: `SEGUIR suspenso até amanhã: a tela do Instagram não deixou seguir. ${err.message}` };
        notificar('Instagram: seguir suspenso hoje', 'A tela do Instagram não deixou seguir (botão não apareceu ou não mudou). Veja o painel.');
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
  const cfg = e.config;
  if (e.contadores.deixados >= cfg.limiteUnfollowDiario) { e.agenda.unfollows.shift(); return 'ok'; }
  if (e.suspensoDeixar === diaSP(agora)) { e.agenda.unfollows.shift(); return 'ok'; }
  if (!escolherParaUnfollow(e.seguidos, agora, cfg.diasParaUnfollow)) { e.agenda.unfollows.shift(); return 'ok'; }
  if (await paradoPeloCrm(e)) return 'parado'; // 1.2.0: Parar tudo do CRM
  e.agenda.unfollows.shift();

  const excluir = new Set();
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const r = escolherParaUnfollow(e.seguidos, agora, cfg.diasParaUnfollow, excluir);
    if (!r) return 'ok';
    excluir.add(String(r.id));

    await pausaHumana();
    let st;
    try {
      // 1.2.0: botão do perfil + pesquisa do @ na MINHA lista de seguidores (o botão "Seguindo" não diz se ela me segue).
      st = await api.amizade(r.username, { meuUsuario: meuUsuario(e) });
    } catch (err) {
      const tipo = tratarErro(e, err, 'checar antes de deixar de seguir', r.username);
      if (bloqueante(tipo) || tipo === 'indisponivel') return tipo;
      continue;
    }
    if (st.meSegue) { marcarFollowBack(e, r, Date.now()); continue; }
    if (st.meSegue === undefined) {
      // Não deu para confirmar se a pessoa me segue: na dúvida não deixa de seguir (seria desfazer com quem seguiu de volta).
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
      // "Seguindo" → "Deixar de seguir" também cancela a solicitação pendente ("Solicitado"); só confirma quando o
      // botão do perfil volta a "Seguir".
      await api.deixarDeSeguir(r.username);
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
        e.alerta = { tipo, em: Date.now(), texto: `DEIXAR DE SEGUIR suspenso até amanhã: a tela do Instagram não deixou. ${err.message}` };
      }
      return tipo;
    }
  }
  return 'ok';
}

/**
 * Follow-back e seguidores novos (1.2.0, pela tela): a cada rodada, os MEUS seguidores mais recentes na janela
 * "Seguidores" (12; na conferência completa de 30 min, 48; até 96 procurando o 1º já conhecido). Na conferência completa,
 * quem a extensão seguiu e não apareceu é conferido um a um (perfil + pesquisa na minha lista), no máximo 5.
 */
async function verificarFollowBacks(e, agora, { forcarCompleta = false } = {}) {
  const eu = meuUsuario(e);
  if (!eu) {
    erroBoasVindas(e, 'meu @ do Instagram ainda não conhecido — preencha "Seu @ no Instagram" nas Opções (ou deixe a janela de trabalho no instagram.com logado)');
    return 'ok';
  }
  if (await paradoPeloCrm(e)) return 'parado';
  const ids = new Set(idsParaVerificarFollowBack(e.seguidos));
  const completa = forcarCompleta || !e.ultimaVarreduraEm || agora - e.ultimaVarreduraEm >= VARREDURA_COMPLETA_MS;
  if (completa) e.ultimaVarreduraEm = agora;

  const ms = e.meusSeguidores;
  await pausaHumana();
  let lista;
  try {
    lista = await api.listaSeguidores(eu, { quantos: completa ? MEUS_SEGUIDORES_COMPLETA : MEUS_SEGUIDORES_RAPIDA });
    // Com linha de base, precisa achar um já conhecido (onde começam os antigos): lê mais, até o máximo.
    if (ms.linhaDeBaseEm && !lista.fim && !lista.usuarios.some((u) => ms.conhecidos[u.pk])) {
      await pausaHumana();
      lista = await api.listaSeguidores(eu, { quantos: MEUS_SEGUIDORES_MAX });
    }
  } catch (err) {
    const tipo = tratarErro(e, err, 'verificar follow-back');
    erroBoasVindas(e, `conferir seguidores: ${err.message || err}`);
    return bloqueante(tipo) ? tipo : 'ok';
  }
  e.boasVindas = { ...(e.boasVindas || {}), ultimaChecagemEm: Date.now(), via: 'tela' };
  const lidos = lista.usuarios;
  const achouConhecido = lidos.some((u) => ms.conhecidos[u.pk]);
  for (const u of lidos) {
    if (ids.has(u.pk)) { marcarFollowBack(e, e.seguidos[u.pk], Date.now()); ids.delete(u.pk); }
  }
  const terminou = lista.fim || lidos.length >= MEUS_SEGUIDORES_MAX;
  if (lidos.length && (!ms.linhaDeBaseEm || achouConhecido || terminou)) registrarNovosSeguidores(e, lidos, Date.now());

  if (completa && ids.size) {
    const r2 = await verificarPeloPerfil(e, [...ids]);
    if (r2 !== 'ok') return r2;
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
  const r = detectarNovosSeguidores(usuarios, { conhecidos: ms.conhecidos, linhaDeBaseEm: ms.linhaDeBaseEm, meuId: meuUsuario(e) });
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
 * 1.1.9 → 1.2.0: a carga única dos últimos 3 dias lia a ATIVIDADE do Instagram pela API interna (news/inbox), que a
 * extensão não usa mais (decisão do dono, 29/10/2026: só pela tela). Instalação que ainda não fez a carga: ela fica
 * registrada como indisponível — ninguém recebe DM por ela; os seguidores novos daqui para frente seguem normalmente.
 */
function cargaTresDias(e) {
  const c3 = e.carga3Dias || {};
  if (c3.feitaEm) return 'ok';
  const motivo = 'desde a versão 1.2.0 a extensão só age pela tela (a carga lia a atividade pela API interna do Instagram)';
  e.carga3Dias = { ...c3, feitaEm: Date.now(), erro: motivo, encontrados: 0, agendados: 0 };
  log(e, { acao: 'carga 3 dias', resultado: `Carga dos últimos 3 dias indisponível: ${motivo} — nenhuma DM por esta carga; seguem só os seguidores novos daqui para frente` });
  return 'ok';
}

/**
 * Conferência um a um (no máximo PERFIS_POR_VARREDURA seguidos, os menos conferidos primeiro, com intervalo humano):
 * botão do perfil e, se ele não disser, pesquisa do @ na minha lista de seguidores.
 */
async function verificarPeloPerfil(e, ids) {
  const regs = ids
    .map((id) => e.seguidos[id])
    .filter((r) => r && r.username)
    .sort((a, b) => (a.checadoPerfilEm || 0) - (b.checadoPerfilEm || 0))
    .slice(0, PERFIS_POR_VARREDURA);
  for (const reg of regs) {
    if (await paradoPeloCrm(e)) return 'parado';
    await pausaEntrePerfis();
    let st;
    try {
      st = await api.amizade(reg.username, { meuUsuario: meuUsuario(e) });
    } catch (err) {
      const tipo = tratarErro(e, err, 'verificar follow-back (perfil)', reg.username);
      if (bloqueante(tipo)) return tipo;
      break; // leitura indisponível: tenta de novo na próxima varredura
    }
    reg.checadoPerfilEm = Date.now();
    if (atualizarSolicitacao(reg, st, Date.now())) {
      log(e, { username: reg.username, acao: 'solicitação aceita', resultado: 'aceitou a solicitação (perfil privado)', origem: reg.origem });
    }
    if (st.meSegue === true) marcarFollowBack(e, reg, Date.now());
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
  } else if (e.crm && e.crm.stopped) {
    proxima = { acao: 'Parada pelo CRM (Extensões › Parar tudo)', em: agora + MINUTO }; // confere de novo em 1 min
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

/** Pode agir agora, sem contar a sessão (que é conferida na tela logo depois)? */
const podeAgirSemSessao = (e, c, agora) => estaAtiva({ ...e, semSessao: false }, c, agora);

async function ciclo() {
  const e = await carregar();
  const c = await lerControle();
  const agora = Date.now();
  const parado = await paradoPeloCrm(e); // 1.2.0: Parar tudo + configuração do CRM (antes de planejar o dia)
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
  reabilitarDmsHtml(e, agora);
  reabilitarDmsGetByParticipants(e, agora);

  if (!parado && podeAgirSemSessao(e, c, agora) && dentroDaJanela(agora, e.config) && (await checarJanela(e)) && (await checarSessao(e))) {
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
  await enviarSaude(e, c);
}

/**
 * Conferência dos meus seguidores (alarme; padrão 10 min, muda no CRM). `manual` (botão "Conferir seguidores agora"):
 * faz a conferência completa na hora (no máximo uma a cada 2 min) e devolve { feito, novos, texto } para o popup.
 * Respeita a janela, a pausa, a sessão e o Parar tudo do CRM como a checagem automática.
 */
async function cicloVerificar({ manual = false } = {}) {
  const e = await carregar();
  const c = await lerControle();
  const agora = Date.now();
  const resposta = (feito, texto, novos = 0) => (manual ? { feito, novos, texto } : undefined);
  if (!dentroDaJanela(agora, e.config)) {
    const d2 = (n) => String(n).padStart(2, '0');
    return resposta(false, `Fora da janela de trabalho (${d2(e.config.inicioHora)}:00–${d2(e.config.fimHora)}:00): a conferência fica para a abertura.`);
  }
  if (await paradoPeloCrm(e)) { await agendarProximo(e, c); await salvar(e); return resposta(false, 'Parada pelo CRM (Extensões › Parar tudo) — retome no CRM para conferir.'); }
  if (!podeAgirSemSessao(e, c, agora)) return resposta(false, 'Extensão pausada ou esperando o Instagram — retome para conferir.');
  virarDiaSeNecessario(e, agora); // 1.1.8: o contador de seguidores novos do dia pode ser tocado aqui
  if (!(await checarJanela(e))) { await salvar(e); return resposta(false, 'Nenhuma janela do Chrome aberta — abra uma para conferir.'); }
  if (!(await checarSessao(e))) { await agendarProximo(e, c); await salvar(e); return resposta(false, 'Sem sessão do Instagram neste Chrome — entre no instagram.com.'); }
  const comFollowBack = () => Object.values(e.seguidos).filter((r) => r.followBackEm).length;
  const antes = comFollowBack();
  const novosAntes = Object.keys(e.novosSeguidores).length;
  const erroAntes = e.boasVindas && e.boasVindas.ultimoErro;
  const forcar = manual && (!e.ultimaVarreduraEm || agora - e.ultimaVarreduraEm >= 2 * MINUTO);
  let r = await verificarFollowBacks(e, agora, { forcarCompleta: forcar });
  if (r === 'ok') r = cargaTresDias(e);
  await agendarProximo(e, c);
  await salvar(e);
  await enviarSaude(e, c);
  if (!manual) return undefined;
  const novos = comFollowBack() - antes;
  const erroNovo = e.boasVindas.ultimoErro && e.boasVindas.ultimoErro !== erroAntes ? ` Erro: ${e.boasVindas.ultimoErro.texto}` : '';
  const novosSeg = Object.keys(e.novosSeguidores).length - novosAntes;
  const achados = (novos ? `${novos} ${novos === 1 ? 'novo follow-back' : 'novos follow-backs'} — DM agendada (sai em 1 a 3 min)` : 'nenhum follow-back novo')
    + (novosSeg ? `; ${novosSeg} ${novosSeg === 1 ? 'seguidor novo' : 'seguidores novos'} com boas-vindas agendada` : '');
  const parou = r !== 'ok' ? ` Parou (${r}).` : '';
  return resposta(true, `Conferido às ${formatarSP(Date.now()).slice(11, 16)}: ${achados}.${parou}${erroNovo}`, novos);
}

async function buscarOrigem(username) {
  const e = await carregar();
  const c = await lerControle();
  const agora = Date.now();
  if (e.pausaAte && agora < e.pausaAte) throw new Error(`Pausado por limite do Instagram até ${formatarSP(e.pausaAte)}. Use "Retomar agora" se quiser tentar mesmo assim.`);
  if (await paradoPeloCrm(e)) { await salvar(e); throw new Error('Parada pelo CRM (Extensões › Parar tudo). Retome no CRM para buscar.'); }
  let sessao;
  try {
    sessao = await api.lerSessao();
  } catch (err) {
    throw new Error(mensagemErroBusca(err));
  }
  if (!sessao.logado) throw new Error('Sem sessão: entre no instagram.com neste Chrome e tente de novo.');
  if (sessao.meuUsuario) e.meuUsuario = sessao.meuUsuario;

  const cfg = e.config;
  let perfil;
  try {
    perfil = await api.buscarPerfil(username);
  } catch (err) {
    // Busca de origem é ação MANUAL de leitura: um erro aqui nunca pausa a extensão.
    // Só registra e devolve a mensagem para o dono tentar de novo.
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

  await pausaHumana();
  let lista;
  try {
    lista = await api.listaSeguidores(perfil.username, { quantos: cfg.maxBusca });
  } catch (err) {
    await registrarFalha(`${perfil.privado ? `${origem} é um perfil PRIVADO — escolha um perfil público. ` : ''}${mensagemErroBusca(err)}`);
  }
  if (!lista.usuarios.length) {
    await registrarFalha(`A janela "Seguidores" de ${origem} não mostrou ninguém.${perfil.privado ? ' É um perfil PRIVADO: escolha um perfil público.' : ''}`);
  }
  const { aceitos, pulados } = filtrarCandidatos(lista.usuarios, {
    meuId: meuUsuario(e),
    fila: e.fila,
    vistos: e.vistos,
    seguidos: e.seguidos,
    pularPrivados: cfg.pularPrivados,
    pularSemFoto: cfg.pularSemFoto,
    origem,
    agora: Date.now(),
  });
  e.fila.push(...aceitos);
  e.origemAtual = origem;
  e.ultimaBusca = { em: Date.now(), origem, lidos: lista.usuarios.length, adicionados: aceitos.length, pulados, via: 'tela', erro: null };
  // Guarda até onde a lista foi lida, para reabastecer a fila sozinha depois (mesmo perfil).
  e.cursorOrigem = { username: perfil.username, origem, lidos: lista.usuarios.length, esgotado: lista.fim, totais: { lidos: lista.usuarios.length, adicionados: aceitos.length, pulados: { ...pulados } } };
  log(e, { username: perfil.username, acao: 'buscar origem', resultado: resumoBusca(e.ultimaBusca), origem });
  await agendarProximo(e, c);
  await salvar(e);
  return e.ultimaBusca;
}

/**
 * Fila curta (menos que o limite do dia + margem): continua a lista de seguidores do MESMO perfil de referência,
 * devagar — mais REABASTECER_LOTE perfis por vez (a tela relê do topo até onde parou), de 20 em 20 min — até ter fila
 * para ~3 dias.
 */
async function reabastecerFila(e, agora) {
  const cfg = e.config;
  const cur = e.cursorOrigem;
  if (!cur || cur.esgotado || !cur.username) return 'ok';
  if (!precisaReabastecer(e.fila.length, cfg.limiteDiario)) return 'ok';
  if (e.ultimoReabastecimentoEm && agora - e.ultimoReabastecimentoEm < INTERVALO_REABASTECER_MS) return 'ok';
  if (await paradoPeloCrm(e)) return 'parado';
  e.ultimoReabastecimentoEm = agora;

  const ate = Math.min(LISTA_ORIGEM_MAX, (cur.lidos || 0) + Math.max(REABASTECER_LOTE, alvoFila(cfg.limiteDiario) - e.fila.length));
  await pausaHumana();
  let lista;
  try {
    lista = await api.listaSeguidores(cur.username, { quantos: ate });
  } catch (err) {
    const tipo = tratarErro(e, err, 'reabastecer fila', cur.username);
    return bloqueante(tipo) ? tipo : 'ok';
  }
  const novos = lista.usuarios.slice(cur.lidos || 0);
  const { aceitos, pulados } = filtrarCandidatos(novos, {
    meuId: meuUsuario(e), fila: e.fila, vistos: e.vistos, seguidos: e.seguidos,
    pularPrivados: cfg.pularPrivados, pularSemFoto: cfg.pularSemFoto, origem: cur.origem, agora: Date.now(),
  });
  e.fila.push(...aceitos);
  cur.lidos = Math.max(cur.lidos || 0, lista.usuarios.length);
  if (lista.fim || !novos.length || cur.lidos >= LISTA_ORIGEM_MAX) cur.esgotado = true;
  cur.totais = cur.totais || { lidos: 0, adicionados: 0, pulados: {} };
  cur.totais.lidos += novos.length;
  cur.totais.adicionados += aceitos.length;
  for (const [k, v] of Object.entries(pulados)) cur.totais.pulados[k] = (cur.totais.pulados[k] || 0) + v;
  log(e, {
    username: cur.username,
    acao: 'reabastecer fila',
    resultado: `${resumoBusca({ origem: cur.origem, lidos: novos.length, adicionados: aceitos.length, pulados })} — fila agora ${e.fila.length}${cur.esgotado ? ' (lista deste perfil acabou: escolha outro perfil de referência)' : ''}`,
    origem: cur.origem,
  });
  return 'ok';
}

function mensagemErroBusca(err) {
  const tipo = err instanceof ErroInstagram ? err.tipo : 'outro';
  const msg = err && err.message ? err.message : String(err);
  const dica = {
    sessao: ' → O Instagram está pedindo login: abra o instagram.com neste Chrome, confira se está logado e tente de novo.',
    aguarde: ' → Espere alguns minutos e tente de novo (a extensão NÃO foi pausada).',
    limite: ' → Espere alguns minutos e tente de novo (a extensão NÃO foi pausada).',
    nao_encontrado: ' → Confira o @ digitado.',
    sem_janela: ' → Abra uma janela do Chrome e tente de novo.',
  }[tipo] || ' → Tente de novo em alguns minutos.';
  return msg + dica;
}

function validarConfig(atual, nova) {
  const n = { ...atual };
  const inteiro = (v, min, max, padrao) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : padrao;
  };
  // Faixas iguais às da tela Extensões do CRM (1.2.0); com a chave do CRM, os números de lá valem por cima destes.
  if ('limiteDiario' in nova) n.limiteDiario = inteiro(nova.limiteDiario, 0, 40, atual.limiteDiario);
  if ('limiteUnfollowDiario' in nova) n.limiteUnfollowDiario = inteiro(nova.limiteUnfollowDiario, 0, 40, atual.limiteUnfollowDiario);
  if ('diasParaUnfollow' in nova) n.diasParaUnfollow = inteiro(nova.diasParaUnfollow, 1, 30, atual.diasParaUnfollow);
  if ('maxBusca' in nova) n.maxBusca = inteiro(nova.maxBusca, 25, 1000, atual.maxBusca);
  if ('intervaloMinimoMin' in nova) n.intervaloMinimoMin = inteiro(nova.intervaloMinimoMin, 5, 120, atual.intervaloMinimoMin);
  if ('pularPrivados' in nova) n.pularPrivados = Boolean(nova.pularPrivados);
  if ('pularSemFoto' in nova) n.pularSemFoto = Boolean(nova.pularSemFoto);
  if ('dmAtiva' in nova) n.dmAtiva = Boolean(nova.dmAtiva);
  if ('limiteDmDiario' in nova) n.limiteDmDiario = inteiro(nova.limiteDmDiario, 1, 100, atual.limiteDmDiario);
  if ('mensagem' in nova && String(nova.mensagem).trim()) n.mensagem = String(nova.mensagem);
  if ('meuUsuario' in nova) n.meuUsuario = String(nova.meuUsuario || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30);
  return n;
}

// ---------------------------------------------------------------- eventos

async function garantirAlarmes() {
  const cfg = (await carregar()).config;
  const verificar = await chrome.alarms.get(ALARME_VERIFICAR);
  // 1.2.0: a conferência dos seguidores passou de 2 para 10 min (padrão; muda no CRM) — o alarme antigo é trocado.
  if (!verificar || verificar.periodInMinutes !== (cfg.verificarACadaMin || 10)) chrome.alarms.create(ALARME_VERIFICAR, { periodInMinutes: cfg.verificarACadaMin || 10 });
  if (!(await chrome.alarms.get(ALARME_VIGIA))) chrome.alarms.create(ALARME_VIGIA, { periodInMinutes: 5 });
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
      if (antes && (Number(antes.versao) || 1) < 3) {
        log(m, { acao: 'atualização', resultado: `versão 1.2.0: só pela tela (sem API interna nem cookies); perfis identificados pelo @; seguir ${m.config.limiteDiario}/dia; linha de base dos seguidores lida de novo (sem DM para quem já segue); configuração e Parar tudo pela tela Extensões do CRM` });
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
  }).catch((err) => console.error(err));
});
chrome.runtime.onStartup.addListener(() => {
  serializar(async () => { await garantirAlarmes(); await ciclo(); }).catch((err) => console.error(err));
});

chrome.alarms.onAlarm.addListener((alarme) => {
  // Sem repassar argumento: serializar() entrega à função o resultado da operação anterior.
  const fn = alarme.name === ALARME_VERIFICAR ? () => cicloVerificar() : () => ciclo();
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
      case 'salvarCrm': {
        // 1.2.0: URL do CRM + chave igs_… (tela Extensões do CRM). A chave nunca volta para a tela.
        const { crm } = await chrome.storage.local.get('crm');
        const key = String(msg.key || '').trim();
        if (key && !key.startsWith('igs_')) return { ok: false, erro: 'A chave do Seguidor começa com igs_. Gere uma no CRM (Extensões).' };
        let baseUrl;
        try { baseUrl = normalizarUrlCrm(msg.baseUrl); } catch (err) { return { ok: false, erro: err.message }; }
        await chrome.storage.local.set({ crm: { baseUrl, key: key || (crm && crm.key) || '' } });
        const estado = await crmLink.estado({ forcar: true });
        return { ok: true, origem: estado.origem, parado: estado.stopped === true };
      }
      case 'situacaoCrm': {
        const { crm } = await chrome.storage.local.get('crm');
        const estado = await crmLink.estado();
        return { ok: true, baseUrl: (crm && crm.baseUrl) || CRM_PADRAO, temChave: Boolean(crm && crm.key), parado: estado.stopped === true, desatualizada: estado.outdated === true, versaoNova: estado.latestVersion || '', linkZip: estado.downloadUrl || '', origem: estado.origem, versao: chrome.runtime.getManifest().version };
      }
      case 'abrirJanela':
        return abrirJanelaTrabalho();
      case 'situacaoJanela':
        return { ok: true, ...(await situacaoJanelaTrabalho()) };
      case 'conferirSeguidores':
        // 1.1.7: botão "Conferir seguidores agora" (popup e painel).
        return { ok: true, ...(await serializar(() => cicloVerificar({ manual: true }))) };
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
garantirAlarmes().catch(crmLink.engolido('conferir os alarmes'));

// Exportado só para depuração no console do service worker (e para os testes
// esperarem a fila de operações terminar).
globalThis.seguidorIG = {
  ciclo: () => serializar(ciclo),
  verificar: () => serializar(() => cicloVerificar()),
  ocioso: () => serializar(async () => {}),
};
