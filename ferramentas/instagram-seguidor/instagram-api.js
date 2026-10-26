// =====================================================================
// instagram-api.js — TODO o contato com o Instagram fica aqui.
//
// As chamadas usam a API web (www.instagram.com/api/v1/...) e são executadas
// DENTRO de uma aba do instagram.com (chrome.scripting), para irem com a mesma
// origem e os mesmos cookies da sessão já logada no navegador. Nenhuma senha,
// token ou cookie é gravado: o csrftoken é lido na hora (chrome.cookies).
//
// Se o Instagram mudar um endpoint, o erro volta como tipo 'mudanca_api' com o
// nome do endpoint na mensagem — ajuste a constante ENDPOINTS abaixo.
// =====================================================================

import { classificarErro, trechoSeguro } from './lib/regras.js';
import { TAMANHO_JANELA, CHAVE_JANELA, acharJanelaTrabalho, podeCriarJanela, ehUrlInstagram, descreverJanela } from './lib/janela-trabalho.js';
import { createAwakeManager } from './lib/page-awake.js';

export const BASE = 'https://www.instagram.com';
export const IG_APP_ID_WEB = '936619743392459';
// x-asbd-id que o site web manda hoje (muda raramente; se o Instagram passar a recusar, atualize aqui).
export const IG_ASBD_ID_WEB = '359341';

export const ENDPOINTS = {
  perfil: (username) => `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
  pesquisa: (termo) => `/api/v1/web/search/topsearch/?context=blended&query=${encodeURIComponent(termo)}&include_reel=false`,
  paginaPerfil: (username) => `/${encodeURIComponent(username)}/`,
  // Mesmo formato do site: 1ª página com count=12, as seguintes com max_id.
  seguidores: (id, maxId, count = 12) =>
    `/api/v1/friendships/${id}/followers/?count=${count}&search_surface=follow_list_page${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`,
  // Plano B (GraphQL antigo do site). Pode deixar de existir; usado só se o v1 vier vazio.
  seguidoresGraphql: (id, depois, n = 24) =>
    `/graphql/query/?query_hash=c76146de99bb02f6415203be841dd25a&variables=${encodeURIComponent(JSON.stringify({ id: String(id), include_reel: false, fetch_mutual: false, first: n, ...(depois ? { after: depois } : {}) }))}`,
  seguir: (id) => `/api/v1/friendships/create/${id}/`,
  deixarDeSeguir: (id) => `/api/v1/friendships/destroy/${id}/`,
  // Endpoints legados (fallback; ainda costumam responder JSON).
  seguirLegado: (id) => `/web/friendships/${id}/follow/`,
  deixarDeSeguirLegado: (id) => `/web/friendships/${id}/unfollow/`,
  amizade: (id) => `/api/v1/friendships/show/${id}/`,
  amizadeVarios: () => '/api/v1/friendships/show_many/',
  dmTexto: () => '/api/v1/direct_v2/threads/broadcast/text/',
  // 1.1.9: atividade (notificações "começou a seguir você", com data) — só para a carga única dos últimos 3 dias.
  atividade: (maxId) => `/api/v1/news/inbox/?mark_as_seen=false&timezone_offset=-10800${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`,
  atividadePost: () => '/api/v1/news/inbox/',
  dmConversaPorParticipante: (id) => `/api/v1/direct_v2/threads/get_by_participants/?recipient_users=${encodeURIComponent(JSON.stringify([Number(id) || String(id)]))}`,
};

// Textos dos botões do perfil (pt-BR e inglês), comparados por inteiro, sem maiúsculas/minúsculas.
export const TEXTOS_SEGUIR = ['seguir', 'follow', 'seguir de volta', 'follow back'];
export const TEXTOS_SEGUINDO = ['seguindo', 'following', 'solicitado', 'requested'];
export const TEXTOS_DEIXAR = ['deixar de seguir', 'unfollow', 'cancelar solicitação', 'cancel request'];
// 1.1.4: leitura (sem clicar) do botão do perfil, para checar a amizade quando a API responde HTML.
export const TEXTOS_LEITURA = {
  seguir_de_volta: ['seguir de volta', 'follow back'],
  seguir: ['seguir', 'follow'],
  seguindo: ['seguindo', 'following'],
  solicitado: ['solicitado', 'requested'],
  segueVoce: ['segue você', 'follows you'],
  privado: ['esta conta é privada', 'this account is private'],
};

// 1.1.8: envio da DM por digitação na tela da conversa (plano B quando a API de DM responde HTML).
export const TEXTOS_DM = {
  mensagem: ['enviar mensagem', 'mensagem', 'message', 'send message'],
  agoraNao: ['agora não', 'not now'],
  enviar: ['enviar', 'send'],
  // 1.1.11 (dono, 26/10): "clicou em enviar mensagem, ocorreu um erro, tente novamente, mas ele não clica de novo".
  erroAbrir: ['ocorreu um erro', 'tente novamente', 'algo deu errado', 'something went wrong', 'try again'],
};

/** Trecho que identifica a mensagem na conversa: a linha mais longa, com espaços normalizados (até 80 caracteres). */
export function trechoDaMensagem(texto) {
  const linhas = String(texto || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const maior = linhas.sort((a, b) => b.length - a.length)[0] || '';
  return maior.slice(0, 80);
}

export class ErroInstagram extends Error {
  constructor(tipo, mensagem, { status = 0, endpoint = '', corpo = '' } = {}) {
    super(mensagem);
    this.name = 'ErroInstagram';
    // 'indisponivel' (1.1.4) = checagem de amizade sem resposta utilizável (API respondeu HTML e a leitura do
    // botão do perfil também falhou): não é sessão, não é bloqueio, não gasta perfil da fila nem cota.
    // 'nao_enviada' (1.1.5) = DM que certamente não saiu (API respondeu HTML): reagendar, nunca marcar incerta.
    // 'ja_relacionado' (1.1.11) = na hora do clique em Seguir o perfil mostrou que já me segue: pulado, sem cota.
    this.tipo = tipo; // 'ja_relacionado' | 'limite' | 'sessao' | 'nao_encontrado' | 'mudanca_api' | 'indisponivel' | 'nao_enviada' | 'aba' | 'sem_janela' | 'incerto' | 'outro'
    this.status = status;
    this.endpoint = endpoint;
    this.corpo = String(corpo || '').slice(0, 500);
    // true quando a API (JSON) devolveu uma página HTML com HTTP 2xx/3xx — a página do site, não um erro da API.
    this.html = status > 0 && status < 400 && /^\s*</.test(String(corpo || ''));
  }
}

function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function idNumericoCliente() {
  // client_context / offline_threading_id: número grande "aleatório" (formato usado pelo app web).
  return String(Date.now()) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
}

function form(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Cria a API. `executar({ url, metodo, corpo, cabecalhos })` deve devolver
 * `{ status, texto }` (nos testes é um falso; na extensão é a aba do Instagram).
 * `obterCsrf()` devolve o csrftoken atual (ou '').
 */
export function criarApiInstagram({ executar, obterCsrf = async () => '', clicar = null, lerPerfil = null, digitarDm = null }) {
  /**
   * Faz uma chamada. `referer` é o caminho da página "de onde" a chamada parte
   * (ex.: '/fulano/'), como o site faz. `bruto: true` devolve o texto (HTML) sem
   * converter para JSON.
   */
  async function chamar(nome, caminho, { metodo = 'GET', corpo = null, referer = '/', bruto = false } = {}) {
    const csrf = (await obterCsrf()) || '';
    // Os mesmos cabeçalhos que o site web manda. x-csrftoken e x-ig-www-claim são
    // completados DENTRO da aba (cookie e sessionStorage do próprio instagram.com).
    const cabecalhos = {
      'x-ig-app-id': IG_APP_ID_WEB,
      'x-asbd-id': IG_ASBD_ID_WEB,
      'x-requested-with': 'XMLHttpRequest',
    };
    if (csrf) cabecalhos['x-csrftoken'] = csrf;
    if (metodo !== 'GET') cabecalhos['content-type'] = 'application/x-www-form-urlencoded';
    if (bruto) {
      // Página HTML: o navegador manda só os cabeçalhos normais de navegação.
      for (const k of Object.keys(cabecalhos)) delete cabecalhos[k];
    }

    let resp;
    try {
      resp = await executar({ url: BASE + caminho, metodo, corpo, cabecalhos, referer: BASE + referer });
    } catch (e) {
      if (e instanceof ErroInstagram) throw e;
      throw new ErroInstagram('aba', `Falha ao executar ${nome} na aba do Instagram: ${e.message || e}`, { endpoint: nome });
    }
    const status = Number(resp && resp.status) || 0;
    const texto = String((resp && resp.texto) || '');
    const diag = diagnostico({ metodo, url: BASE + caminho, cabecalhos, corpo, resp });
    const comDiag = (msg) => `${msg} [${diag}]`;
    if (bruto) {
      if (status >= 200 && status < 300) return texto;
      const tipoB = classificarErro({ status, corpo: texto }) || 'outro';
      throw new ErroInstagram(tipoB, comDiag(`Erro do Instagram em ${nome} (HTTP ${status}) — resposta: ${trechoSeguro(texto)}`), { status, endpoint: nome, corpo: texto });
    }
    const tipo = classificarErro({ status, corpo: texto });
    if (tipo) {
      const msgs = {
        limite: `Instagram sinalizou limite/bloqueio (${nome}, HTTP ${status}).`,
        aguarde: `Instagram pediu para esperar alguns minutos (${nome}, HTTP ${status}).`,
        sessao: `Instagram não reconheceu a sessão logada (${nome}, HTTP ${status}).`,
        nao_encontrado: `Perfil não encontrado (${nome}).`,
        mudanca_api: `O endpoint "${nome}" respondeu de forma inesperada (HTTP ${status}). O Instagram pode ter mudado a API — ajuste ENDPOINTS em instagram-api.js.`,
        outro: `Erro do Instagram em ${nome} (HTTP ${status}).`,
      };
      throw new ErroInstagram(tipo, comDiag(`${msgs[tipo] || msgs.outro} Resposta: ${trechoSeguro(texto)}`), { status, endpoint: nome, corpo: texto });
    }
    try {
      return JSON.parse(texto);
    } catch {
      throw new ErroInstagram('mudanca_api', comDiag(`Resposta de "${nome}" não é JSON (HTTP ${status}). O Instagram pode ter mudado a API. Resposta: ${trechoSeguro(texto)}`), { status, endpoint: nome, corpo: texto });
    }
  }

  /** 1.1.4: amizade lida do botão do perfil (Seguir / Seguir de volta / Seguindo / Solicitado), sem clicar. */
  async function amizadePeloPerfil(username, motivo = '') {
    if (!lerPerfil || !username) {
      throw new ErroInstagram('indisponivel', `Checagem de amizade indisponível${motivo ? ` (${motivo})` : ''}${username ? '' : ' — sem o @ do perfil para ler o botão'}.`, { endpoint: 'perfil (botão)' });
    }
    let r;
    try {
      r = await lerPerfil({ username });
    } catch (e) {
      if (e instanceof ErroInstagram && e.tipo !== 'aba' && e.tipo !== 'outro') throw e; // sem_janela etc. sobem como estão
      throw new ErroInstagram('indisponivel', `Checagem de amizade indisponível: falha ao ler o perfil @${username} (${e.message || e})${motivo ? ` — ${motivo}` : ''}.`, { endpoint: 'perfil (botão)' });
    }
    const st = amizadeDoBotao(r);
    if (!st) {
      throw new ErroInstagram('indisponivel', `Checagem de amizade indisponível: ${r && r.erro ? r.erro : 'botão não reconhecido'} no perfil @${username}${motivo ? ` — ${motivo}` : ''}.`, { endpoint: 'perfil (botão)' });
    }
    return st;
  }

  /**
   * Amizade com UM perfil: friendships/show; se a API devolver HTML (1.1.4), lê o botão do perfil.
   * HTML aqui nunca vira "sessão" nem "mudança de API": vira 'indisponivel' se a leitura também falhar.
   */
  async function amizadeDe(id, username = '') {
    try {
      return { ...normalizarAmizade(await chamar('friendships/show', ENDPOINTS.amizade(id))), via: 'friendships/show' };
    } catch (e) {
      if (!(e instanceof ErroInstagram) || !e.html) throw e;
      return amizadePeloPerfil(username, 'friendships/show respondeu HTML');
    }
  }

  /**
   * Ação de escrita com confirmação no friendships/show e um único fallback.
   * Limite/sessão sobem na hora (quem chama decide a pausa). Resposta estranha
   * (HTML, sem JSON) não conta como sucesso: confere e tenta o próximo endpoint.
   */
  async function acaoEscrita({ nome, id, username, tentativas, confirmado }) {
    const referer = username ? `/${username}/` : '/';
    const corpo = form({ container_module: 'profile', nav_chain: '', user_id: String(id) });
    const falhas = [];
    const usadas = [];
    for (const [rotulo, caminho, opcoes = {}] of tentativas) {
      if (opcoes.soSemClique && clicar) continue; // endpoint legado: só sem o clique no botão (testes/antigo)
      if (opcoes.clique && !clicar) continue;
      usadas.push(rotulo);
      let falha = null;
      try {
        if (opcoes.clique) {
          // 1.1.3: o Instagram passou a responder HTML ao POST da API de seguir; o caminho que não depende
          // da API é fazer o que a pessoa faz: abrir o perfil na janela de trabalho e clicar no botão.
          const r = await clicar({ username, passos: opcoes.clique, ...(opcoes.seguir ? { seguir: true } : {}) });
          if (r && r.recusado && (r.botao === 'seguir_de_volta' || r.segueVoce)) {
            // 1.1.11: na hora do clique o perfil mostrou que já me segue — não segue (não é erro, não gasta cota).
            throw new ErroInstagram('ja_relacionado', `@${username} já me segue (botão "${r.botao === 'seguir_de_volta' ? 'Seguir de volta' : 'Segue você'}" no perfil) — não seguido`, { endpoint: rotulo });
          }
          if (r && r.recusado) {
            // "Seguindo"/"Solicitado" na hora do clique: nada clicado. Se foi o pedido anterior (API) que seguiu, a
            // conferência abaixo confirma; senão segue para a próxima tentativa sem clicar.
            falha = `${rotulo}: o perfil já mostra "${r.botao === 'solicitado' ? 'Solicitado' : 'Seguindo'}" (nada clicado)`;
          } else if (!r || !r.ok) throw new ErroInstagram('mudanca_api', `${rotulo}: ${r && r.erro ? r.erro : 'botão não encontrado na página do perfil'}`, { endpoint: rotulo });
        } else {
          await chamar(rotulo, caminho, { metodo: 'POST', corpo, referer });
        }
      } catch (e) {
        if (!(e instanceof ErroInstagram) || (e.tipo !== 'mudanca_api' && e.tipo !== 'outro' && e.tipo !== 'indisponivel')) throw e;
        falha = e.message;
      }
      let st = await amizadeDe(id, username);
      if (!confirmado(st) && (!falha || opcoes.clique)) {
        // 1.1.2: o friendships/show às vezes demora a refletir a ação; confere de novo antes de tentar o legado
        // (evita mandar um segundo pedido para quem já foi seguido).
        await new Promise((r) => setTimeout(r, 2500));
        st = await amizadeDe(id, username);
      }
      if (confirmado(st)) return { ...st, via: rotulo };
      falhas.push(falha || `${rotulo} respondeu, mas o friendships/show não confirmou`);
    }
    throw new ErroInstagram('mudanca_api', `Não consegui ${nome} (sem confirmação no friendships/show após ${usadas.join(' e ')}): ${falhas.join(' | ')}`, { endpoint: tentativas[0][0] });
  }

  /**
   * 1.1.5: a API de DM devolveu a página HTML do Instagram (HTTP 2xx/3xx): o pedido não foi processado,
   * então a mensagem certamente NÃO saiu. Vira 'nao_enviada' (pode reagendar), nunca 'incerto'.
   */
  function naoEnviadaSeHtml(e) {
    if (e instanceof ErroInstagram && e.html) {
      throw new ErroInstagram('nao_enviada', `DM não enviada: a API de mensagens respondeu a página HTML do Instagram (nada foi processado). ${e.message}`, { status: e.status, endpoint: e.endpoint, corpo: e.corpo });
    }
  }

  return {
    chamar,

    /**
     * id e dados básicos de um @perfil. Tenta, em ordem:
     * 1) web_profile_info; 2) pesquisa (topsearch); 3) HTML da página do perfil.
     * Se todos falharem, lança o erro mais informativo (com trecho da resposta).
     */
    async buscarPerfil(username) {
      const limpo = String(username || '')
        .trim()
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/[?#].*$/, '')
        .replace(/^@/, '')
        .replace(/\/+$/, '')
        .toLowerCase();
      if (!/^[a-z0-9._]{1,30}$/.test(limpo)) throw new ErroInstagram('outro', `@${limpo} não parece um nome de usuário válido.`);
      const referer = `/${limpo}/`;
      const erros = [];

      try {
        const j = await chamar('web_profile_info', ENDPOINTS.perfil(limpo), { referer });
        const u = j && j.data && j.data.user;
        if (u && u.id) {
          return {
            id: String(u.id),
            username: u.username || limpo,
            privado: Boolean(u.is_private),
            sigoEsse: u.followed_by_viewer === undefined ? undefined : Boolean(u.followed_by_viewer),
            seguidores: u.edge_followed_by ? u.edge_followed_by.count : null,
            via: 'web_profile_info',
          };
        }
        erros.push(new ErroInstagram('nao_encontrado', `Perfil @${limpo} não encontrado (web_profile_info).`, { endpoint: 'web_profile_info' }));
      } catch (e) {
        if (!(e instanceof ErroInstagram)) throw e;
        erros.push(e);
      }

      try {
        const j = await chamar('web/search/topsearch', ENDPOINTS.pesquisa(limpo), { referer: '/' });
        const achado = ((j && j.users) || []).map((x) => x.user || x).find((u) => String(u.username || '').toLowerCase() === limpo);
        if (achado && (achado.pk || achado.pk_id || achado.id)) {
          return { id: String(achado.pk || achado.pk_id || achado.id), username: achado.username, privado: Boolean(achado.is_private), seguidores: null, via: 'topsearch' };
        }
        erros.push(new ErroInstagram('nao_encontrado', `Perfil @${limpo} não apareceu na pesquisa (topsearch).`, { endpoint: 'web/search/topsearch' }));
      } catch (e) {
        if (!(e instanceof ErroInstagram)) throw e;
        erros.push(e);
      }

      try {
        const html = await chamar('página do perfil', ENDPOINTS.paginaPerfil(limpo), { bruto: true, referer: '/' });
        const id = extrairIdDoHtml(html, limpo);
        if (id) return { id, username: limpo, privado: /"is_private":true/.test(html), seguidores: null, via: 'pagina' };
        erros.push(new ErroInstagram('nao_encontrado', `Não achei o id de @${limpo} na página do perfil.`, { endpoint: 'página do perfil' }));
      } catch (e) {
        if (!(e instanceof ErroInstagram)) throw e;
        erros.push(e);
      }

      // Prioridade do erro a mostrar: sessão > limite > aguarde > não encontrado > o primeiro.
      const ordem = ['sessao', 'limite', 'aguarde', 'nao_encontrado'];
      const principal = ordem.map((t) => erros.find((e) => e.tipo === t)).find(Boolean) || erros[0];
      const detalhes = erros.map((e) => `• ${e.message}`).join('\n');
      throw new ErroInstagram(principal.tipo, `Não consegui obter o id de @${limpo} (3 tentativas):\n${detalhes}`, { status: principal.status, endpoint: principal.endpoint, corpo: principal.corpo });
    },

    /** Uma página de seguidores de `id`. Retorna { usuarios, proximo }. */
    /**
     * Uma página de seguidores de `id`: { usuarios, proximo, via, trecho }.
     * `trecho` = parte da resposta (sem tokens) para explicar uma lista vazia.
     */
    async paginaSeguidores(id, maxId = null) {
      const j = await chamar('friendships/followers', ENDPOINTS.seguidores(id, maxId), { referer: '/' });
      if (!Array.isArray(j.users)) {
        throw new ErroInstagram('mudanca_api', `Lista de seguidores veio sem o campo "users" — o Instagram pode ter mudado a API. Resposta: ${trechoSeguro(JSON.stringify(j))}`, { endpoint: 'friendships/followers' });
      }
      return { usuarios: j.users, proximo: j.next_max_id ? String(j.next_max_id) : null, via: 'v1', trecho: trechoSeguro(JSON.stringify(j)) };
    },

    /**
     * 1.1.9: uma página da atividade (news/inbox) — o JSON cru; quem chama interpreta (lib/carga-tres-dias.js).
     * GET como o app; se não vier JSON, o POST que o site usa. HTML, 404 ou resposta estranha nos dois = 'indisponivel'
     * (nunca vira sessão, pausa ou alerta de mudança de API). Limite/aguarde/sessão sobem como são.
     */
    async atividade(maxId = null) {
      const falhas = [];
      const tentativas = [
        () => chamar('news/inbox', ENDPOINTS.atividade(maxId), { referer: '/' }),
        () => chamar('news/inbox (POST)', ENDPOINTS.atividadePost(), {
          metodo: 'POST',
          referer: '/',
          corpo: form({ could_truncate_feed: 'true', should_skip_su: 'true', mark_as_seen: 'false', timezone_offset: '-10800', ...(maxId ? { max_id: maxId } : {}) }),
        }),
      ];
      for (const t of tentativas) {
        try {
          return await t();
        } catch (e) {
          if (e instanceof ErroInstagram && ['limite', 'aguarde', 'sessao', 'sem_janela', 'aba'].includes(e.tipo)) throw e; // passageiros: tenta de novo depois
          falhas.push(e instanceof ErroInstagram ? (e.html ? 'respondeu a página HTML' : `${e.tipo}: ${String(e.message).split(' [')[0]}`) : String((e && e.message) || e));
        }
      }
      throw new ErroInstagram('indisponivel', `atividade do Instagram (news/inbox) indisponível — ${falhas.join(' | ')}`, { endpoint: 'news/inbox' });
    },

    /** Plano B: seguidores pelo GraphQL do site. Mesmo formato de paginaSeguidores. */
    async paginaSeguidoresGraphql(id, depois = null) {
      const j = await chamar('graphql seguidores', ENDPOINTS.seguidoresGraphql(id, depois), { referer: '/' });
      const edge = j && j.data && j.data.user && j.data.user.edge_followed_by;
      if (!edge || !Array.isArray(edge.edges)) {
        throw new ErroInstagram('mudanca_api', `GraphQL de seguidores respondeu sem a lista. Resposta: ${trechoSeguro(JSON.stringify(j))}`, { endpoint: 'graphql seguidores' });
      }
      const usuarios = edge.edges.map(({ node: n }) => ({
        pk: String(n.id),
        username: n.username,
        is_private: Boolean(n.is_private),
        profile_pic_url: n.profile_pic_url,
        friendship_status: { following: Boolean(n.followed_by_viewer), followed_by: Boolean(n.follows_viewer) },
      }));
      const pi = edge.page_info || {};
      return { usuarios, proximo: pi.has_next_page && pi.end_cursor ? pi.end_cursor : null, via: 'graphql', trecho: trechoSeguro(JSON.stringify(j)) };
    },

    /**
     * Status de amizade com UM perfil: { seguindo, meSegue, pedidoPendente, privado, via }.
     * Com `username`, se a API responder HTML, lê o botão do perfil (aí meSegue pode vir `undefined`).
     */
    async amizade(id, username = '') {
      return amizadeDe(id, username);
    },

    /** 1.1.4: amizade lida direto do botão do perfil (sem API). */
    async amizadePeloPerfil(username) {
      return amizadePeloPerfil(username);
    },

    /**
     * Status de amizade com vários perfis (show_many). Retorna { id: {...} }.
     * Observação: dependendo da versão, show_many não traz "followed_by"; nesse
     * caso `meSegue` fica `undefined` e quem chama deve confirmar por outro meio.
     */
    async amizadeVarios(ids) {
      if (!ids.length) return {};
      let j;
      try {
        j = await chamar('friendships/show_many', ENDPOINTS.amizadeVarios(), { metodo: 'POST', corpo: form({ user_ids: ids.join(',') }) });
      } catch (e) {
        // 1.1.4 (caso real 24/10): show_many respondeu a página HTML do Instagram (HTTP 200). Não é sessão nem
        // bloqueio: a checagem em lote fica indisponível e quem chama segue com a leitura do botão do perfil.
        if (!(e instanceof ErroInstagram) || !e.html) throw e;
        throw new ErroInstagram('indisponivel', `Checagem em lote (show_many) indisponível: a API respondeu a página HTML do Instagram. ${e.message}`, { status: e.status, endpoint: 'friendships/show_many', corpo: e.corpo });
      }
      const mapa = (j && j.friendship_statuses) || {};
      const r = {};
      for (const [id, st] of Object.entries(mapa)) r[String(id)] = normalizarAmizade(st);
      return r;
    },

    /**
     * SEGUIR: POST friendships/create. Só conta como seguido se o friendships/show
     * confirmar (following ou pedido pendente — perfil privado: outgoing_request = "Solicitado"). Se não confirmar, tenta UMA vez o
     * endpoint legado /web/friendships/{id}/follow/ e confere de novo.
     */
    async seguir(id, username = '') {
      return acaoEscrita({
        nome: 'seguir',
        id,
        username,
        tentativas: [
          ['friendships/create', ENDPOINTS.seguir(id)],
          ['botão Seguir', null, { clique: [TEXTOS_SEGUIR], seguir: true }],
          ['web/friendships/follow', ENDPOINTS.seguirLegado(id), { soSemClique: true }],
        ],
        confirmado: (st) => st.seguindo || st.pedidoPendente,
      });
    },

    /**
     * DEIXAR DE SEGUIR: friendships/destroy → legado /web/friendships/{id}/unfollow/.
     * Também CANCELA uma solicitação pendente (perfil privado): só confirma quando o
     * friendships/show mostra following E outgoing_request falsos.
     */
    async deixarDeSeguir(id, username = '') {
      return acaoEscrita({
        nome: 'deixar de seguir',
        id,
        username,
        tentativas: [
          ['friendships/destroy', ENDPOINTS.deixarDeSeguir(id)],
          ['botão Seguindo → Deixar de seguir', null, { clique: [TEXTOS_SEGUINDO, TEXTOS_DEIXAR] }],
          ['web/friendships/unfollow', ENDPOINTS.deixarDeSeguirLegado(id), { soSemClique: true }],
        ],
        confirmado: (st) => !st.seguindo && !st.pedidoPendente,
      });
    },

    /**
     * Envia DM de texto. 1ª tentativa: broadcast/text com recipient_users (ver enviarDmPelaApi).
     * 1.1.8 (decisão do dono, 26/10, ciente do risco): se a API responder a página HTML ('nao_enviada') e houver
     * `username`, digita a mensagem na tela da conversa (perfil → Mensagem) e aperta Enter, como uma pessoa.
     * Retorna { modo, digitacao? }.
     */
    async enviarDm(id, texto, { username = '' } = {}) {
      try {
        return await enviarDmPelaApi(id, texto);
      } catch (e) {
        if (!(e instanceof ErroInstagram) || e.tipo !== 'nao_enviada' || !digitarDm || !username) throw e;
        return enviarPorDigitacao(username, texto, e);
      }
    },
  };

  /**
   * Envia pela API: broadcast/text com recipient_users. Se o endpoint não aceitar, procura a conversa pelo
   * participante e envia por thread_ids. Retorna { modo }.
   */
  async function enviarDmPelaApi(id, texto) {
    const comum = {
      action: 'send_item',
      is_shh_mode: '0',
      send_attribution: 'direct_thread',
      client_context: idNumericoCliente(),
      offline_threading_id: idNumericoCliente(),
      mutation_token: uuid(),
      text: texto,
    };
    let j;
    try {
      j = await chamar('direct_v2/broadcast/text', ENDPOINTS.dmTexto(), {
        metodo: 'POST',
        corpo: form({ ...comum, recipient_users: JSON.stringify([[String(id)]]) }),
      });
    } catch (e) {
      naoEnviadaSeHtml(e);
      // Só tenta a alternativa quando o Instagram claramente RECUSOU o pedido
      // (400/404/405) — assim não há risco de a mensagem ter saído duas vezes.
      const recusado = e instanceof ErroInstagram && [400, 404, 405].includes(e.status) && e.tipo !== 'limite' && e.tipo !== 'sessao';
      if (!recusado) throw e;
      // Alternativa: localizar a conversa e enviar por thread_ids.
      let conv;
      try {
        conv = await chamar('direct_v2/get_by_participants', ENDPOINTS.dmConversaPorParticipante(id));
      } catch (e2) {
        naoEnviadaSeHtml(e2);
        // 1.1.10: o broadcast/text já foi RECUSADO (nada saiu) e a busca da conversa falhou (ex.: 404 em HTML): é
        // 'nao_enviada' — segue para a digitação na tela da DM em vez de virar "mudança de API" e parar.
        if (e2 instanceof ErroInstagram && e2.tipo !== 'limite' && e2.tipo !== 'sessao') {
          throw new ErroInstagram('nao_enviada', `DM não enviada pela API: broadcast/text recusado (${e.message}) e get_by_participants falhou (${e2.message}).`, { status: e2.status, endpoint: 'direct_v2', corpo: e2.corpo });
        }
        throw e2;
      }
      const threadId = conv && conv.thread && conv.thread.thread_id;
      if (!threadId) {
        // Sem conversa existente e broadcast/text recusado: nada saiu → digitação na tela da DM (1.1.10).
        throw new ErroInstagram('nao_enviada', `DM não enviada pela API: broadcast/text recusado (${e.message}) e não há conversa existente.`, { endpoint: 'direct_v2' });
      }
      let j2;
      try {
        j2 = await chamar('direct_v2/broadcast/text(thread)', ENDPOINTS.dmTexto(), {
          metodo: 'POST',
          corpo: form({ ...comum, client_context: idNumericoCliente(), mutation_token: uuid(), thread_ids: JSON.stringify([threadId]) }),
        });
      } catch (e2) {
        naoEnviadaSeHtml(e2);
        throw e2;
      }
      if (j2 && j2.status === 'ok') return { modo: 'thread_ids' };
      throw new ErroInstagram('incerto', 'broadcast/text (thread) respondeu sem confirmar o envio — confira a conversa no Instagram.', { endpoint: 'direct_v2/broadcast/text', corpo: JSON.stringify(j2) });
    }
    if (j && j.status === 'ok') return { modo: 'recipient_users' };
    throw new ErroInstagram('incerto', 'broadcast/text respondeu sem confirmar o envio — confira a conversa no Instagram.', { endpoint: 'direct_v2/broadcast/text', corpo: JSON.stringify(j) });
  }

  /**
   * 1.1.8: plano B da DM — digitação na tela da conversa. `digitarDm` devolve { ok, confirmado, jaEstava, apertouEnter,
   * erro }. Antes do Enter nada saiu (pode tentar de novo: 'nao_enviada'); depois do Enter sem a mensagem aparecer na
   * conversa = 'incerto' (nunca reenviar). Erro inesperado no meio = 'incerto' também (não dá para saber).
   */
  async function enviarPorDigitacao(username, texto, erroApi) {
    let r;
    try {
      r = await digitarDm({ username, texto });
    } catch (err) {
      if (err instanceof ErroInstagram && err.tipo === 'sem_janela') throw err;
      const x = new ErroInstagram('incerto', `DM por digitação interrompida (${err.message || err}) — não será repetida; confira a conversa no Instagram.`, { endpoint: 'digitação na DM' });
      x.digitacao = true;
      throw x;
    }
    if (r && r.jaEstava) return { modo: 'digitação — a mensagem já estava na conversa (nada digitado)', digitacao: true };
    if (r && r.ok && r.confirmado) return { modo: `digitação na tela da DM${r.como || r.envio ? ` — ${[r.como && `mensagem ${r.como}`, r.envio].filter(Boolean).join(', ')}` : ''}`, digitacao: true };
    const motivo = (r && r.erro) || 'sem resposta da aba';
    const x = r && r.apertouEnter
      ? new ErroInstagram('incerto', `DM digitada e enviada (${(r && r.envio) || 'clique em Enviar/Enter'}), mas a mensagem não apareceu na conversa (${motivo}) — não será repetida; confira no Instagram.`, { endpoint: 'digitação na DM' })
      : new ErroInstagram('nao_enviada', `DM não enviada: a API respondeu HTML e a digitação não chegou a enviar (${motivo}). ${erroApi.message}`, { endpoint: 'digitação na DM' });
    x.digitacao = true;
    throw x;
  }
}

/** Resumo técnico da chamada para o log (sem valores de tokens). */
export function diagnostico({ metodo, url, cabecalhos = {}, corpo = null, resp = {} }) {
  const partes = [`${resp.metodoUsado || metodo} ${resp.urlPedida || url}`];
  if (cabecalhos['content-type']) partes.push(`content-type enviado ${cabecalhos['content-type']}`);
  if (Array.isArray(resp.cabecalhosDaPagina)) partes.push(`cabeçalhos da página: ${resp.cabecalhosDaPagina.length ? resp.cabecalhosDaPagina.join(' ') : 'nenhum'}`);
  if (metodo !== 'GET') partes.push(`corpo ${corpo ? `enviado (${String(corpo).length} caracteres)` : 'VAZIO'}`);
  if (resp.status != null) partes.push(`→ HTTP ${resp.status}${resp.tipoResposta ? ` (${resp.tipoResposta})` : ''}`);
  if (resp.redirecionado) partes.push(`redirecionado para ${resp.urlFinal}`);
  else if (resp.urlFinal && resp.urlFinal !== (resp.urlPedida || url)) partes.push(`URL final ${resp.urlFinal}`);
  return partes.join(', ');
}

/** Procura o id numérico do perfil no HTML da página dele. */
export function extrairIdDoHtml(html, username) {
  const h = String(html || '');
  const padroes = [
    /"profilePage_(\d+)"/,
    new RegExp(`"id":"(\\d+)","username":"${username.replace(/\./g, '\\.')}"`, 'i'),
    new RegExp(`"username":"${username.replace(/\./g, '\\.')}"[^{}]{0,400}?"(?:id|pk)":"(\\d+)"`, 'i'),
  ];
  for (const p of padroes) {
    const m = h.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * 1.1.4: leitura do botão do perfil → mesmo formato de normalizarAmizade (ou null se não reconheceu).
 * "Seguir de volta" = a pessoa me segue e eu não; "Seguir" = não me segue. "Seguindo"/"Solicitado" não dizem
 * se ela me segue: `meSegue` só é true com o selo "Segue você"; senão fica `undefined` (nunca deduzir "não segue").
 */
export function amizadeDoBotao(leitura) {
  if (!leitura || !leitura.ok) return null;
  const privado = Boolean(leitura.privado);
  const segue = leitura.segueVoce ? true : undefined;
  const via = 'perfil (botão)';
  switch (leitura.botao) {
    case 'seguir_de_volta': return { seguindo: false, meSegue: true, pedidoPendente: false, privado, via };
    case 'seguir': return { seguindo: false, meSegue: Boolean(leitura.segueVoce), pedidoPendente: false, privado, via };
    case 'seguindo': return { seguindo: true, meSegue: segue, pedidoPendente: false, privado, via };
    case 'solicitado': return { seguindo: false, meSegue: segue, pedidoPendente: true, privado: true, via };
    default: return null;
  }
}

export function normalizarAmizade(st) {
  return {
    seguindo: Boolean(st.following),
    meSegue: st.followed_by === undefined ? undefined : Boolean(st.followed_by),
    pedidoPendente: Boolean(st.outgoing_request),
    privado: Boolean(st.is_private),
  };
}

// ---------------------------------------------------------------------
// Parte específica do Chrome: aba do Instagram + execução da requisição nela.
// ---------------------------------------------------------------------

/**
 * Função injetada na aba do instagram.com, no MESMO contexto da página (world
 * 'MAIN'): o fetch sai da origem https://www.instagram.com, com os cookies da
 * sessão (credentials: 'include'), como as chamadas do próprio site.
 * Precisa ser autossuficiente (é serializada pelo chrome.scripting).
 */
export async function requisicaoNaPagina(url, metodo, corpo, cabecalhos, referer) {
  const h = { ...cabecalhos };
  const ehApi = Object.keys(h).length > 0;
  const daPagina = [];
  if (ehApi) {
    // 1.1.4: os cabeçalhos que o próprio site manda, tirados da página aberta (configuração embutida nos
    // <script> do instagram.com). Os fixos da extensão ficam só como reserva se a página não tiver o valor.
    try {
      const fontes = [];
      for (const s of document.querySelectorAll('script')) {
        const t = s.textContent || '';
        if (t && t.length < 5000000) fontes.push(t);
      }
      const texto = fontes.join('\n');
      const achar = (re) => { const x = texto.match(re); return x ? x[1] : ''; };
      const valores = {
        'x-ig-app-id': achar(/"(?:X-IG-App-ID|APP_ID|appId|app_id|instagramWebDesktopFBAppId)"\s*:\s*"?(\d{6,20})/),
        'x-asbd-id': achar(/"(?:X-ASBD-ID|ASBD_ID|asbd_id|asbdId)"\s*:\s*"?(\d{3,10})/),
        'x-instagram-ajax': achar(/"rollout_hash"\s*:\s*"([0-9a-z]{6,64})"/i) || achar(/"(?:server_revision|client_revision|__spin_r)"\s*:\s*(\d{6,15})/),
        'x-csrftoken': achar(/"csrf_token"\s*:\s*"([^"]{8,128})"/),
      };
      for (const [k, v] of Object.entries(valores)) {
        if (v) { h[k] = v; daPagina.push(k); }
      }
    } catch { /* sem acesso aos scripts: segue com os cabeçalhos fixos */ }
    // csrftoken do cookie da própria página (mais atual que o lido pela extensão e que o embutido no HTML).
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    if (m) h['x-csrftoken'] = decodeURIComponent(m[1]);
    // x-ig-www-claim: o site guarda no sessionStorage; se não houver, manda '0' como o site.
    try {
      const claim = sessionStorage.getItem('www-claim-v2');
      h['x-ig-www-claim'] = claim || '0';
      if (claim) daPagina.push('x-ig-www-claim');
    } catch {
      h['x-ig-www-claim'] = '0';
    }
  }
  try {
    const r = await fetch(url, {
      method: metodo,
      headers: h,
      body: corpo || undefined,
      credentials: 'include',
      mode: 'same-origin',
      referrer: referer || 'https://www.instagram.com/',
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
    const texto = await r.text();
    return {
      status: r.status,
      texto: texto.slice(0, 2_000_000),
      origem: location.origin,
      metodoUsado: metodo,
      urlPedida: url,
      urlFinal: r.url,
      redirecionado: r.redirected,
      tipoResposta: r.headers.get('content-type') || '',
      cabecalhosDaPagina: daPagina, // só os NOMES (nunca os valores) — para o diagnóstico
    };
  } catch (e) {
    return { status: 0, texto: `fetch falhou: ${e && e.message ? e.message : e}`, origem: location.origin, metodoUsado: metodo, urlPedida: url };
  }
}

// Chave da versão 1.0.x (aba fixada na janela do dono). Não é mais usada: só é apagada.
const CHAVE_ABA_ANTIGA = 'abaInstagramId';

async function esperarCarregar(tabId, limiteMs = 30000) {
  const aba = await chrome.tabs.get(tabId);
  if (aba.status === 'complete') return;
  await new Promise((resolve) => {
    const fim = setTimeout(() => { chrome.tabs.onUpdated.removeListener(ouvinte); resolve(); }, limiteMs);
    function ouvinte(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(fim);
        chrome.tabs.onUpdated.removeListener(ouvinte);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(ouvinte);
  });
}

async function listarJanelas() {
  try {
    return await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  } catch {
    return [];
  }
}

let janelaPendente = null;

/**
 * Janela de trabalho (1.1.0, mesmo padrão do marketplace-publicador): janela PEQUENA só da
 * extensão, com UMA aba do instagram.com reutilizada sempre (guardada em
 * chrome.storage.local.janelaTrabalho). Nunca abre/usa aba na janela do dono, nunca puxa foco
 * (focused:false) e a aba não é descartada pelo Chrome (autoDiscardable:false). Se o dono
 * fechar, reabre sem foco na próxima ação. Sem NENHUMA janela do Chrome aberta, não cria
 * (lança ErroInstagram 'sem_janela' — quem chama só espera). `criar: false` só procura.
 */
export async function garantirAbaInstagram({ criar = true } = {}) {
  if (janelaPendente) return janelaPendente;
  janelaPendente = (async () => {
    const guardada = (await chrome.storage.local.get(CHAVE_JANELA))[CHAVE_JANELA];
    const janelas = await listarJanelas();
    const achada = acharJanelaTrabalho(janelas, guardada);
    if (achada) {
      if (achada.windowId !== guardada?.windowId || achada.tabId !== guardada?.tabId) {
        await chrome.storage.local.set({ [CHAVE_JANELA]: { windowId: achada.windowId, tabId: achada.tabId } });
      }
      const aba = await chrome.tabs.get(achada.tabId);
      // O dono navegou para fora do Instagram nessa aba: volta para o instagram.com (sem foco).
      if (!ehUrlInstagram(aba.url || aba.pendingUrl)) await chrome.tabs.update(aba.id, { url: `${BASE}/` });
      await esperarCarregar(aba.id);
      return aba.id;
    }
    if (!criar) return null;
    if (!podeCriarJanela(janelas)) {
      throw new ErroInstagram('sem_janela', 'Nenhuma janela do Chrome aberta — a extensão espera abrir uma (não cria janela sozinha).');
    }
    let win;
    try {
      win = await chrome.windows.create({ url: `${BASE}/`, type: 'normal', focused: false, state: 'normal', ...TAMANHO_JANELA });
    } catch (e) {
      throw new ErroInstagram('aba', `Não consegui abrir a janela de trabalho do Instagram: ${e.message || e}`);
    }
    const aba = (win.tabs && win.tabs[0]) || (await chrome.tabs.query({ windowId: win.id }))[0];
    await chrome.storage.local.set({ [CHAVE_JANELA]: { windowId: win.id, tabId: aba.id } });
    await chrome.storage.local.remove?.(CHAVE_ABA_ANTIGA);
    await chrome.tabs.update(aba.id, { autoDiscardable: false }).catch(() => {});
    await esperarCarregar(aba.id);
    return aba.id;
  })().finally(() => { janelaPendente = null; });
  return janelaPendente;
}

/** Há janela do Chrome onde trabalhar (a de trabalho ou alguma outra, para criá-la)? */
export async function haJanelaParaTrabalhar() {
  return podeCriarJanela(await listarJanelas());
}

/** Botão do popup (pedido explícito do dono): única vez em que a janela vem para a frente. */
export async function abrirJanelaTrabalho() {
  const tabId = await garantirAbaInstagram();
  const aba = await chrome.tabs.get(tabId);
  await chrome.windows.update(aba.windowId, { focused: true, state: 'normal' });
  await chrome.tabs.update(tabId, { active: true });
  return { ok: true };
}

/** Situação da janela de trabalho para o popup (nunca cria). */
export async function situacaoJanelaTrabalho() {
  const tabId = await garantirAbaInstagram({ criar: false }).catch(() => null);
  if (!tabId) return descreverJanela({ existe: false });
  const aba = await chrome.tabs.get(tabId).catch(() => null);
  const win = aba ? await chrome.windows.get(aba.windowId).catch(() => ({})) : {};
  return descreverJanela({ existe: Boolean(aba), estado: win.state });
}

/** Executor real: roda `requisicaoNaPagina` na aba do Instagram. */
export async function executarNaAba({ url, metodo, corpo, cabecalhos, referer }) {
  const tabId = await garantirAbaInstagram();
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: requisicaoNaPagina,
    args: [url, metodo, corpo, cabecalhos, referer || `${BASE}/`],
  });
  if (!res || res.result == null) throw new ErroInstagram('aba', 'A aba do Instagram não devolveu resposta (foi fechada ou recarregada?).');
  if (res.result.origem && res.result.origem !== BASE) {
    throw new ErroInstagram('aba', `A aba usada não está em ${BASE} (está em ${res.result.origem}). Abra o instagram.com e tente de novo.`);
  }
  return res.result;
}

/** Lê a sessão do navegador (sem gravar nada): { logado, meuId, csrf }. */
export async function lerSessao() {
  const pegar = async (name) => {
    try {
      const c = await chrome.cookies.get({ url: `${BASE}/`, name });
      return c ? c.value : '';
    } catch {
      return '';
    }
  };
  const [sessao, meuId, csrf] = await Promise.all([pegar('sessionid'), pegar('ds_user_id'), pegar('csrftoken')]);
  return { logado: Boolean(sessao && meuId), meuId: meuId || null, csrf };
}

/**
 * Roda NA PÁGINA do perfil: espera cada botão aparecer (até 8 s), clica, e passa para o próximo
 * passo (ex.: "Seguindo" abre o menu, depois "Deixar de seguir"). Só botões visíveis, texto exato.
 */
export async function clicarNaPagina(passos) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const achar = (textos) => [...document.querySelectorAll('button, div[role="button"]')].find((el) => visivel(el) && textos.includes(norm(el.innerText || el.textContent)));
  for (let i = 0; i < passos.length; i += 1) {
    let alvo = null;
    for (let t = 0; t < 32 && !alvo; t += 1) {
      alvo = achar(passos[i]);
      if (!alvo) await new Promise((r) => setTimeout(r, 250));
    }
    if (!alvo) return { ok: false, erro: `botão "${passos[i][0]}" não apareceu (passo ${i + 1})`, origem: location.origin };
    alvo.click();
    await new Promise((r) => setTimeout(r, 900 + Math.random() * 600));
  }
  return { ok: true, origem: location.origin };
}

/**
 * 1.1.4 — roda NA PÁGINA do perfil, SEM clicar: espera (até 8 s) o botão principal do perfil e devolve
 * { ok, botao: 'seguir'|'seguir_de_volta'|'seguindo'|'solicitado', segueVoce, privado }. Procura no <header>
 * do perfil (as sugestões "Seguir" da página ficam fora dele). Texto exato, só botões visíveis.
 */
export async function lerEstadoNaPagina(textos) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const ordem = ['seguir_de_volta', 'seguindo', 'solicitado', 'seguir'];
  const achar = () => {
    const raiz = document.querySelector('header') || document;
    for (const el of raiz.querySelectorAll('button, div[role="button"]')) {
      if (!visivel(el)) continue;
      const t = norm(el.innerText || el.textContent);
      const tipo = ordem.find((k) => textos[k].includes(t));
      if (tipo) return tipo;
    }
    return null;
  };
  let botao = null;
  for (let t = 0; t < 32 && !botao; t += 1) {
    botao = achar();
    if (!botao) await new Promise((r) => setTimeout(r, 250));
  }
  if (!botao) return { ok: false, erro: 'botão Seguir/Seguindo não apareceu', origem: location.origin };
  const cab = norm((document.querySelector('header') || {}).innerText || '');
  const corpo = norm(document.body ? document.body.innerText : '');
  return {
    ok: true,
    botao,
    segueVoce: textos.segueVoce.some((x) => cab.includes(x)),
    privado: textos.privado.some((x) => corpo.includes(x)),
    origem: location.origin,
  };
}

/**
 * 1.1.11 — NA PÁGINA do perfil: clica em "Seguir" SÓ se o botão principal do perfil (no <header>) for exatamente "Seguir"
 * e o perfil não mostrar "Segue você". "Seguir de volta"/"Segue você" (já me segue), "Seguindo" ou "Solicitado" (já
 * sigo / já pedi) = NÃO clica e devolve { ok: false, recusado: true, botao, segueVoce } (dono, 26/10: "Não deve seguir
 * quem já me segue. Ele acabou de abrir um perfil que eu estava seguindo."). Nunca clica nos "Seguir" das sugestões.
 */
export async function seguirNaPagina(textos) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const ordem = ['seguir_de_volta', 'seguindo', 'solicitado', 'seguir'];
  const achar = () => {
    const raiz = document.querySelector('header') || document;
    for (const el of raiz.querySelectorAll('button, div[role="button"]')) {
      if (!visivel(el)) continue;
      const t = norm(el.innerText || el.textContent);
      const tipo = ordem.find((k) => textos[k].includes(t));
      if (tipo) return { tipo, el };
    }
    return null;
  };
  let achado = null;
  for (let t = 0; t < 32 && !achado; t += 1) {
    achado = achar();
    if (!achado) await new Promise((r) => setTimeout(r, 250));
  }
  if (!achado) return { ok: false, erro: 'botão "Seguir" não apareceu no perfil', origem: location.origin };
  const cab = norm((document.querySelector('header') || {}).innerText || '');
  const segueVoce = textos.segueVoce.some((x) => cab.includes(x));
  if (achado.tipo !== 'seguir' || segueVoce) return { ok: false, recusado: true, botao: achado.tipo, segueVoce, origem: location.origin };
  achado.el.click();
  await new Promise((r) => setTimeout(r, 900 + Math.random() * 600));
  return { ok: true, botao: 'seguir', origem: location.origin };
}

// --- Página acordada (1.1.6) ------------------------------------------------------------------------------------
// Problema real (dono, 25/10/2026): "abro outra janela para utilizar, em tela cheia; as duas abas das extensões ficam
// abertas atrás dessa." Coberta, a aba de trabalho fica OCULTA para o Chrome: ele para de desenhar o perfil e segura os
// timers da página (a espera de 250 ms pelo botão vira até 1 min por volta) — a leitura do botão e os cliques do perfil
// demoram ou falham. Durante a leitura/clique do perfil (só eles; as chamadas de API não precisam) a extensão liga o
// depurador e emula foco (lib/page-awake.js — cópia idêntica da do marketplace-publicador, conferida em teste): a página
// fica visível e com foco sem trazer nada para a frente. Solto logo depois; a faixa "…começou a depurar este navegador"
// aparece só nesses segundos (some 5 s depois). Depurador recusado (DevTools aberto na aba): segue como antes.
function comPrazo(promessa, ms, rotulo) {
  let timer;
  return Promise.race([promessa, new Promise((_, rejeitar) => { timer = setTimeout(() => rejeitar(new Error(`${rotulo}: passou de ${Math.round(ms / 1000)} s`)), ms); })])
    .finally(() => clearTimeout(timer));
}

const paginaAcordada = createAwakeManager({
  attach: (tabId) => comPrazo(chrome.debugger.attach({ tabId }, '1.3'), 8000, 'ligar o depurador'),
  detach: (tabId) => chrome.debugger.detach({ tabId }),
  send: (tabId, method, params) => comPrazo(chrome.debugger.sendCommand({ tabId }, method, params), 8000, method),
  warn: (mensagem) => console.warn('[seguidor-ig]', mensagem),
});
// O dono clicou em "Cancelar" na faixa ou a aba fechou: o Chrome soltou o depurador.
if (globalThis.chrome?.debugger?.onDetach) chrome.debugger.onDetach.addListener((origem) => origem?.tabId && paginaAcordada.forget(origem.tabId));

async function abrirPerfilEExecutar(username, func, args) {
  const tabId = await garantirAbaInstagram();
  return paginaAcordada.run(tabId, async () => {
    await chrome.tabs.update(tabId, { url: `${BASE}/${encodeURIComponent(username)}/` });
    await new Promise((r) => setTimeout(r, 400));
    await esperarCarregar(tabId);
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
    return (res && res.result) || { ok: false, erro: 'a aba não respondeu' };
  });
}

/** 1.1.4: abre o perfil na janela de trabalho (sem foco) e LÊ o botão (não clica). 1.1.6: com a página acordada. */
export async function lerPerfilNaAba({ username }) {
  if (!username) return { ok: false, erro: 'sem @ do perfil' };
  return abrirPerfilEExecutar(username, lerEstadoNaPagina, [TEXTOS_LEITURA]);
}

/**
 * Abre o perfil na janela de trabalho (sem foco) e executa os cliques. 1.1.6: com a página acordada.
 * 1.1.11: `seguir: true` = clique de SEGUIR conferindo o botão do perfil na hora (seguirNaPagina).
 */
export async function clicarNaAba({ username, passos, seguir = false }) {
  if (!username) return { ok: false, erro: 'sem @ do perfil' };
  if (seguir) return abrirPerfilEExecutar(username, seguirNaPagina, [TEXTOS_LEITURA]);
  return abrirPerfilEExecutar(username, clicarNaPagina, [passos]);
}

// --- DM por digitação (1.1.8) ------------------------------------------------------------------------------------
// Decisão do dono (26/10/2026, ciente do risco): com a API de DM respondendo a página HTML, a boas-vindas é digitada
// na tela da conversa, como uma pessoa: abre o perfil na janela de trabalho (sem foco, página acordada pelo depurador
// da 1.1.6), clica em "Enviar mensagem", digita e aperta Enter. Só conta como enviada se a mensagem APARECER na
// conversa; Enter apertado sem confirmação = incerto (nunca reenvia). Antes do Enter, qualquer falha = nada saiu.
// 1.1.11: a mensagem é colada inteira (plano B: digitada com Shift+Enter) e o envio é o CLIQUE no botão Enviar (Enter só
// como plano B) — ver digitarDmNaAba. "apertouEnter" continua sendo o marco "pode ter saído" (clique ou Enter).
// As funções `...NaPagina` rodam DENTRO da aba (chrome.scripting, mundo MAIN): não usam nada de fora delas.

/**
 * NA PÁGINA do perfil: clica em "Enviar mensagem" e espera a caixa de texto da conversa (até ~15 s na última tentativa).
 * 1.1.11 (dono, 26/10): "clicou em enviar mensagem, ocorreu um erro, tente novamente, mas ele não clica de novo. Se eu
 * clicar, abre." — se aparecer esse erro (ou nada abrir e o botão continuar ali), espera 1–3 s e clica de novo, até
 * `maxCliques` vezes. Abrir a conversa não envia nada: repetir o clique é seguro.
 */
export async function abrirConversaNaPagina(textos, maxCliques = 4) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const botoes = (raiz, lista) => [...raiz.querySelectorAll('button, div[role="button"], a[role="button"]')].find((el) => visivel(el) && lista.includes(norm(el.innerText || el.textContent)));
  const caixa = () => [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
  const botaoMensagem = () => botoes(document.querySelector('header') || document, textos.mensagem) || botoes(document.querySelector('main') || document, textos.mensagem);
  const textoPagina = () => norm(document.body ? document.body.innerText : '');
  const erros = textos.erroAbrir || [];
  let botao = null;
  for (let t = 0; t < 32 && !botao; t += 1) {
    botao = botaoMensagem();
    if (!botao) await esperar(250);
  }
  if (!botao) return { ok: false, erro: 'botão "Enviar mensagem" não apareceu no perfil', origem: location.origin };
  // Erros que já estavam na página antes do clique não contam (só o aviso que surge depois dele).
  const antes = textoPagina();
  const erroNovo = () => { const agora = textoPagina(); return erros.find((x) => agora.includes(x) && !antes.includes(x)) || null; };
  let cliques = 0;
  let errosVistos = 0;
  while (cliques < maxCliques) {
    // O aviso do clique anterior ainda na tela não é um erro novo: só conta se sumir e voltar.
    let sumiu = !erroNovo();
    botao.click();
    cliques += 1;
    const ultima = cliques >= maxCliques;
    let viuErro = false;
    for (let t = 0; t < (ultima ? 60 : 24); t += 1) {
      await esperar(250);
      const agoraNao = botoes(document, textos.agoraNao); // "Ativar notificações?" → Agora não
      if (agoraNao) agoraNao.click();
      if (caixa()) return { ok: true, caminho: location.pathname, origem: location.origin, cliques, errosVistos };
      if (!erroNovo()) sumiu = true;
      else if (sumiu) { viuErro = true; break; }
    }
    if (viuErro) errosVistos += 1;
    if (ultima) break;
    await esperar(1000 + Math.round(Math.random() * 2000)); // pausa de 1–3 s antes de clicar de novo
    if (caixa()) return { ok: true, caminho: location.pathname, origem: location.origin, cliques, errosVistos };
    const denovo = botaoMensagem();
    if (!denovo) {
      // O botão sumiu (a conversa está carregando em outra tela): só espera a caixa, sem clicar.
      for (let t = 0; t < 40; t += 1) { await esperar(250); if (caixa()) return { ok: true, caminho: location.pathname, origem: location.origin, cliques, errosVistos }; }
      break;
    }
    botao = denovo;
  }
  const motivo = errosVistos ? `o Instagram mostrou "Ocorreu um erro" ${errosVistos} vez(es)` : 'a caixa de mensagem da conversa não apareceu';
  return { ok: false, erro: `${motivo} (${cliques} clique(s) em "Enviar mensagem")`, origem: location.origin, cliques, errosVistos };
}

/**
 * NA PÁGINA da conversa: conta quantas vezes o trecho da mensagem já aparece na conversa (fora da caixa de texto),
 * esvazia a caixa (rascunho velho nunca é enviado) e deixa o cursor nela.
 */
export async function prepararCaixaNaPagina(trecho) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const caixa = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
  if (!caixa) return { ok: false, erro: 'caixa de mensagem sumiu' };
  const conta = (texto, alvo) => { let n = 0; let i = texto.indexOf(alvo); while (alvo && i !== -1) { n += 1; i = texto.indexOf(alvo, i + alvo.length); } return n; };
  const alvo = norm(trecho);
  const textoCaixa = norm(caixa.value ?? caixa.innerText);
  const contagem = Math.max(0, conta(norm(document.body.innerText), alvo) - conta(textoCaixa, alvo));
  caixa.focus();
  if (textoCaixa) {
    if (caixa.tagName === 'TEXTAREA') caixa.select(); else document.getSelection().selectAllChildren(caixa);
    document.execCommand('delete');
  }
  return { ok: true, contagem };
}

/**
 * 1.1.11 — NA PÁGINA: cola a mensagem INTEIRA de uma vez na caixa (evento "colar" com o texto, como o Ctrl+V de uma
 * pessoa). O editor da DM (Lexical) transforma cada "\n" do texto colado em quebra de linha no próprio modelo dele —
 * diferente do insertLineBreak da 1.1.8, que fazia o editor apagar o que já estava escrito (dono, 26/10: "escreve,
 * apaga, escreve outro pedaço e apaga; no final só fica 'Conte comigo! 😊'"). Não aperta tecla nenhuma: nada sai daqui.
 * Devolve o texto que ficou na caixa (quem chama confere).
 */
export async function colarNaPagina(texto) {
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const caixa = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
  if (!caixa) return { ok: false, erro: 'caixa de mensagem sumiu' };
  caixa.focus();
  if (caixa.tagName === 'TEXTAREA') {
    document.execCommand('insertText', false, texto);
  } else {
    // Cursor no fim da caixa (o editor só aceita o colar com uma seleção dentro dele).
    const sel = document.getSelection();
    const faixa = document.createRange();
    faixa.selectNodeContents(caixa);
    faixa.collapse(false);
    sel.removeAllRanges();
    sel.addRange(faixa);
    await esperar(120);
    const dados = new DataTransfer();
    dados.setData('text/plain', texto);
    caixa.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dados, bubbles: true, cancelable: true }));
  }
  await esperar(400);
  return { ok: true, texto: caixa.value ?? caixa.innerText };
}

/**
 * NA PÁGINA (sem depurador, plano B do colar): digita os pedaços na caixa já focada. Quebra de linha = inserir o texto
 * "\n" (o editor da DM a trata como quebra de linha) — nunca insertLineBreak (1.1.11: apagava o texto) e nunca Enter.
 */
export async function escreverNaPagina(partes) {
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const caixa = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
  if (!caixa) return { ok: false, erro: 'caixa de mensagem sumiu' };
  caixa.focus();
  for (const p of partes) {
    if (p.quebra) document.execCommand('insertText', false, '\n');
    else if (p.texto) document.execCommand('insertText', false, p.texto);
  }
  return { ok: true };
}

/**
 * 1.1.11 — NA PÁGINA, sem mexer em nada: texto atual da caixa (espaços normalizados) e quantas vezes `trecho` já aparece
 * na conversa fora da caixa (para saber se uma quebra de linha mandou parte da mensagem).
 */
export async function lerCaixaNaPagina(trecho) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const caixa = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
  if (!caixa) return { ok: false, erro: 'caixa de mensagem sumiu' };
  const conta = (texto, alvo) => { let n = 0; let i = texto.indexOf(alvo); while (alvo && i !== -1) { n += 1; i = texto.indexOf(alvo, i + alvo.length); } return n; };
  const textoCaixa = norm(caixa.value ?? caixa.innerText);
  const alvo = norm(trecho).toLowerCase();
  return { ok: true, texto: textoCaixa, conversa: Math.max(0, conta(norm(document.body.innerText).toLowerCase(), alvo) - conta(textoCaixa.toLowerCase(), alvo)) };
}

/** NA PÁGINA: o texto da caixa é exatamente a mensagem (espaços normalizados)? Só então o Enter é apertado. */
export async function conferirCaixaNaPagina(texto) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const caixa = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
  if (!caixa) return { ok: false, erro: 'caixa de mensagem sumiu' };
  const atual = norm(caixa.value ?? caixa.innerText);
  if (atual === norm(texto)) return { ok: true };
  // Texto errado: esvazia para nunca mandar mensagem truncada/estranha.
  caixa.focus();
  if (caixa.tagName === 'TEXTAREA') caixa.select(); else document.getSelection().selectAllChildren(caixa);
  document.execCommand('delete');
  return { ok: false, erro: `o texto digitado não conferiu com a mensagem (${atual.length} de ${norm(texto).length} caracteres)` };
}

/** NA PÁGINA (sem depurador): Enter na caixa de texto. */
export async function apertarEnterNaPagina() {
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const caixa = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
  if (!caixa) return { ok: false, erro: 'caixa de mensagem sumiu' };
  caixa.focus();
  for (const tipo of ['keydown', 'keypress', 'keyup']) {
    caixa.dispatchEvent(new KeyboardEvent(tipo, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  }
  return { ok: true };
}

/**
 * 1.1.11 — NA PÁGINA da conversa: acha o botão Enviar (o avião azul à direita da caixa). Procura subindo a partir da
 * caixa de texto (só no bloco da caixa, nunca o "Enviar" de um post da página): botão/role=button com rótulo ou
 * aria-label "Enviar"/"Send", ou o svg do avião com esse aria-label. Devolve o centro dele na tela (para o clique de
 * verdade pelo depurador) — `clicar: true` clica pela própria página (sem depurador).
 */
export async function acharEnviarNaPagina(textos, clicar = false) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const caixa = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
  if (!caixa) return { ok: false, erro: 'caixa de mensagem sumiu' };
  const ehEnviar = (el) => [el.getAttribute('aria-label'), el.innerText || el.textContent].some((t) => textos.enviar.includes(norm(t)));
  const clicavel = (el) => (el.closest && el.closest('button, [role="button"]')) || el;
  let alvo = null;
  for (let bloco = caixa.parentElement, nivel = 0; bloco && nivel < 8 && !alvo; bloco = bloco.parentElement, nivel += 1) {
    const achado = [...bloco.querySelectorAll('button, [role="button"], svg[aria-label]')].find((el) => el !== caixa && !caixa.contains(el) && ehEnviar(el) && visivel(clicavel(el)));
    if (achado) alvo = clicavel(achado);
  }
  if (!alvo) return { ok: false, erro: 'botão Enviar não apareceu ao lado da caixa' };
  if (alvo.scrollIntoView) alvo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = alvo.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);
  // O ponto do clique cai mesmo no botão (nada por cima)?
  const noPonto = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
  const livre = Boolean(noPonto && (noPonto === alvo || alvo.contains(noPonto)));
  if (clicar) {
    for (const tipo of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) alvo.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    alvo.click();
  }
  return { ok: true, x, y, livre, clicou: clicar };
}

/**
 * NA PÁGINA, depois do clique em Enviar (ou do Enter): espera (até `esperaMs`) a mensagem aparecer na conversa (mais
 * ocorrências do trecho que antes, fora da caixa). Não clica nem aperta nada (1.1.11): devolve também se a mensagem
 * INTEIRA continua na caixa (`naCaixa` — aí certamente não saiu e quem chama pode tentar o plano B).
 */
export async function confirmarDmNaPagina(trecho, antes, esperaMs = 12000) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const conta = (texto, alvo) => { let n = 0; let i = texto.indexOf(alvo); while (alvo && i !== -1) { n += 1; i = texto.indexOf(alvo, i + alvo.length); } return n; };
  const alvo = norm(trecho);
  let naCaixa = 0;
  for (let t = 0; t < Math.max(1, Math.round(esperaMs / 250)); t += 1) {
    await esperar(250);
    const caixa = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
    naCaixa = caixa ? conta(norm(caixa.value ?? caixa.innerText), alvo) : 0;
    const naConversa = conta(norm(document.body.innerText), alvo) - naCaixa;
    if (naConversa > antes && !naCaixa) return { ok: true, confirmado: true, naCaixa: false };
  }
  return { ok: false, confirmado: false, naCaixa: naCaixa > 0, erro: `a mensagem não apareceu na conversa em ${Math.round(esperaMs / 1000)} s` };
}

/** Partes da digitação: palavras (com o espaço) e quebras de linha. */
export function partesDaDigitacao(texto) {
  const partes = [];
  String(texto || '').split('\n').forEach((linha, i) => {
    if (i > 0) partes.push({ quebra: true });
    for (const pedaco of linha.match(/\S+\s*|\s+/g) || []) partes.push({ texto: pedaco });
  });
  return partes;
}

const cdp = (tabId, metodo, params) => comPrazo(chrome.debugger.sendCommand({ tabId }, metodo, params), 8000, metodo);
const TECLA_ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
// 1.1.11: Shift+Enter de verdade (modifiers 8 = Shift, sem `text`): no editor da DM é quebra de linha, nunca envio.
export const SHIFT_ENTER = [
  { type: 'keyDown', ...TECLA_ENTER, modifiers: 8 },
  { type: 'keyUp', ...TECLA_ENTER, modifiers: 8 },
];

/** Linhas da mensagem (para a digitação com Shift+Enter): ['Oi', '', 'Tudo bem?']. */
export function linhasDaMensagem(texto) {
  return String(texto || '').split('\n');
}

/**
 * Executor real do plano B da DM. Devolve { ok, confirmado, jaEstava, apertouEnter, erro, como, envio } (nunca lança,
 * exceto 'sem_janela'). `apertouEnter` = a partir daqui a mensagem PODE ter saído (clique em Enviar, Enter ou uma
 * quebra de linha que mandou parte dela) — nunca mais "não enviada".
 *
 * 1.1.11 (dono, 26/10/2026, olhando a tela): a mensagem tem que estar INTEIRA na caixa antes de enviar, e o envio é o
 * clique no botão Enviar (o Enter não enviava nesse popup de conversa).
 *  1) Escrita: cola a mensagem inteira de uma vez (colarNaPagina). Se a caixa não ficar exatamente com a mensagem,
 *     esvazia e digita linha por linha — com depurador, palavras por Input.insertText e quebra = Shift+Enter real
 *     (conferindo depois de cada quebra que nada se apagou nem saiu); sem depurador, pela página (quebra = texto "\n").
 *  2) Conferência do texto exato (como antes): diferente = esvazia a caixa, nada sai ('nao_enviada').
 *  3) Envio: clique no botão Enviar (com depurador, clique de mouse de verdade no centro dele); Enter só se o botão não
 *     for achado ou se a mensagem continuar inteira na caixa depois do clique (certamente não saiu).
 *  4) Só conta como enviada se a mensagem aparecer na conversa; sem isso depois do clique = 'incerto' (nunca reenvia).
 */
export async function digitarDmNaAba({ username, texto }) {
  if (!username) return { ok: false, apertouEnter: false, erro: 'sem @ do perfil' };
  let tabId;
  try {
    tabId = await garantirAbaInstagram();
  } catch (err) {
    if (err instanceof ErroInstagram && err.tipo === 'sem_janela') throw err;
    return { ok: false, apertouEnter: false, erro: err.message || String(err) };
  }
  const exec = async (func, args) => {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
    return (res && res.result) || { ok: false, erro: 'a aba não respondeu' };
  };
  const pausa = (min, max) => new Promise((r) => setTimeout(r, min + Math.round(Math.random() * (max - min))));
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  return paginaAcordada.run(tabId, async (info) => {
    let apertouEnter = false;
    try {
      await chrome.tabs.update(tabId, { url: `${BASE}/${encodeURIComponent(username)}/` });
      await new Promise((r) => setTimeout(r, 400));
      await esperarCarregar(tabId);
      const aberta = await exec(abrirConversaNaPagina, [TEXTOS_DM]);
      if (!aberta.ok) return { ok: false, apertouEnter, erro: aberta.erro };
      const trecho = trechoDaMensagem(texto);
      const caixa = await exec(prepararCaixaNaPagina, [trecho]);
      if (!caixa.ok) return { ok: false, apertouEnter, erro: caixa.erro };
      if (caixa.contagem > 0) return { ok: true, jaEstava: true, apertouEnter };
      await pausa(800, 2000);
      const comDepurador = info.attached && paginaAcordada.isAttached(tabId);

      // 1) Escrita — a) colar a mensagem inteira.
      let como = 'colada';
      await exec(colarNaPagina, [texto]);
      let conferida = await exec(conferirCaixaNaPagina, [texto]); // diferente: já esvazia a caixa
      if (!conferida.ok) {
        // b) Plano B: digitar linha por linha.
        como = comDepurador ? 'digitada (Shift+Enter)' : 'digitada pela página';
        if (comDepurador) {
          const linhas = linhasDaMensagem(texto);
          const inicio = norm(linhas.find((l) => norm(l)) || '');
          const base = await exec(lerCaixaNaPagina, [inicio]);
          if (!base.ok) return { ok: false, apertouEnter, erro: base.erro };
          let escrito = '';
          for (let i = 0; i < linhas.length; i += 1) {
            if (i > 0) {
              for (const tecla of SHIFT_ENTER) await cdp(tabId, 'Input.dispatchKeyEvent', tecla);
              await pausa(150, 350);
              const agora = await exec(lerCaixaNaPagina, [inicio]);
              if (!agora.ok) return { ok: false, apertouEnter, erro: agora.erro };
              if (inicio && agora.conversa > base.conversa) {
                // A quebra de linha mandou parte da mensagem: pode ter saído — nunca repetir.
                return { ok: false, apertouEnter: true, erro: 'a quebra de linha (Shift+Enter) enviou parte da mensagem' };
              }
              if (agora.texto !== norm(escrito)) {
                await exec(conferirCaixaNaPagina, [texto]); // esvazia (o texto não confere)
                return { ok: false, apertouEnter, erro: `a quebra de linha apagou o texto da caixa (${agora.texto.length} de ${norm(escrito).length} caracteres)` };
              }
              escrito += '\n';
            }
            for (const pedaco of linhas[i].match(/\S+\s*|\s+/g) || []) {
              await cdp(tabId, 'Input.insertText', { text: pedaco });
              escrito += pedaco;
              await pausa(60, 220);
            }
          }
        } else {
          const w = await exec(escreverNaPagina, [partesDaDigitacao(texto)]);
          if (!w.ok) return { ok: false, apertouEnter, erro: w.erro };
        }
        // 2) Conferência do texto exato.
        conferida = await exec(conferirCaixaNaPagina, [texto]);
        if (!conferida.ok) return { ok: false, apertouEnter, erro: conferida.erro };
      }
      await pausa(700, 1800);

      // 3) Envio: clique no botão Enviar.
      apertouEnter = true; // a partir daqui a mensagem pode ter saído: nunca mais "não enviada"
      const enviar = await exec(acharEnviarNaPagina, [TEXTOS_DM, !comDepurador]); // sem depurador já clica aqui
      let envio;
      if (enviar.ok && comDepurador && enviar.livre) {
        envio = 'clique no botão Enviar';
        await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: enviar.x, y: enviar.y });
        await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: enviar.x, y: enviar.y, button: 'left', buttons: 1, clickCount: 1 });
        await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: enviar.x, y: enviar.y, button: 'left', buttons: 0, clickCount: 1 });
      } else if (enviar.ok && comDepurador) {
        envio = 'clique no botão Enviar (pela página)';
        await exec(acharEnviarNaPagina, [TEXTOS_DM, true]); // algo por cima do ponto: clica pelo próprio elemento
      } else if (enviar.ok) {
        envio = 'clique no botão Enviar (pela página)'; // já clicado por acharEnviarNaPagina(…, true)
      } else {
        envio = 'Enter (botão Enviar não achado)';
        await apertarEnter(comDepurador);
      }
      let conf = await exec(confirmarDmNaPagina, [trecho, caixa.contagem, enviar.ok ? 4000 : 12000]);
      if (!conf.confirmado && enviar.ok && conf.naCaixa) {
        // A mensagem continua inteira na caixa: o clique não enviou (nada saiu). Plano B: Enter, uma vez.
        envio += ' + Enter (plano B)';
        await apertarEnter(comDepurador);
        conf = await exec(confirmarDmNaPagina, [trecho, caixa.contagem, 12000]);
      } else if (!conf.confirmado && enviar.ok) {
        conf = await exec(confirmarDmNaPagina, [trecho, caixa.contagem, 8000]);
      }
      return { ok: Boolean(conf.confirmado), confirmado: Boolean(conf.confirmado), apertouEnter, erro: conf.erro, viaDepurador: comDepurador, como, envio };
    } catch (err) {
      return { ok: false, apertouEnter, erro: err && err.message ? err.message : String(err) };
    }
  });

  async function apertarEnter(comDepurador) {
    if (comDepurador) {
      await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...TECLA_ENTER, text: '\r', unmodifiedText: '\r' });
      await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...TECLA_ENTER });
    } else {
      await exec(apertarEnterNaPagina, []);
    }
  }
}

/** API pronta para uso dentro da extensão. */
export function criarApiChrome() {
  return criarApiInstagram({ executar: executarNaAba, obterCsrf: async () => (await lerSessao()).csrf, clicar: clicarNaAba, lerPerfil: lerPerfilNaAba, digitarDm: digitarDmNaAba });
}
