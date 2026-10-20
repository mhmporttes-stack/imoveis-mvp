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
  amizade: (id) => `/api/v1/friendships/show/${id}/`,
  amizadeVarios: () => '/api/v1/friendships/show_many/',
  dmTexto: () => '/api/v1/direct_v2/threads/broadcast/text/',
  dmConversaPorParticipante: (id) => `/api/v1/direct_v2/threads/get_by_participants/?recipient_users=${encodeURIComponent(JSON.stringify([Number(id) || String(id)]))}`,
};

export class ErroInstagram extends Error {
  constructor(tipo, mensagem, { status = 0, endpoint = '', corpo = '' } = {}) {
    super(mensagem);
    this.name = 'ErroInstagram';
    this.tipo = tipo; // 'limite' | 'sessao' | 'nao_encontrado' | 'mudanca_api' | 'aba' | 'incerto' | 'outro'
    this.status = status;
    this.endpoint = endpoint;
    this.corpo = String(corpo || '').slice(0, 500);
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
export function criarApiInstagram({ executar, obterCsrf = async () => '' }) {
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
    if (bruto) {
      if (status >= 200 && status < 300) return texto;
      const tipoB = classificarErro({ status, corpo: texto }) || 'outro';
      throw new ErroInstagram(tipoB, `Erro do Instagram em ${nome} (HTTP ${status}) — resposta: ${trechoSeguro(texto)}`, { status, endpoint: nome, corpo: texto });
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
      throw new ErroInstagram(tipo, `${msgs[tipo] || msgs.outro} Resposta: ${trechoSeguro(texto)}`, { status, endpoint: nome, corpo: texto });
    }
    try {
      return JSON.parse(texto);
    } catch {
      throw new ErroInstagram('mudanca_api', `Resposta de "${nome}" não é JSON (HTTP ${status}). O Instagram pode ter mudado a API. Resposta: ${trechoSeguro(texto)}`, { status, endpoint: nome, corpo: texto });
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

    /** Status de amizade com UM perfil: { seguindo, meSegue, pedidoPendente, privado }. */
    async amizade(id) {
      const j = await chamar('friendships/show', ENDPOINTS.amizade(id));
      return normalizarAmizade(j);
    },

    /**
     * Status de amizade com vários perfis (show_many). Retorna { id: {...} }.
     * Observação: dependendo da versão, show_many não traz "followed_by"; nesse
     * caso `meSegue` fica `undefined` e quem chama deve confirmar por outro meio.
     */
    async amizadeVarios(ids) {
      if (!ids.length) return {};
      const j = await chamar('friendships/show_many', ENDPOINTS.amizadeVarios(), { metodo: 'POST', corpo: form({ user_ids: ids.join(',') }) });
      const mapa = (j && j.friendship_statuses) || {};
      const r = {};
      for (const [id, st] of Object.entries(mapa)) r[String(id)] = normalizarAmizade(st);
      return r;
    },

    async seguir(id) {
      const j = await chamar('friendships/create', ENDPOINTS.seguir(id), {
        metodo: 'POST',
        corpo: form({ container_module: 'profile', nav_chain: '', user_id: id }),
      });
      const st = normalizarAmizade(j.friendship_status || {});
      if (!st.seguindo && !st.pedidoPendente) {
        throw new ErroInstagram('outro', 'O Instagram respondeu, mas o perfil não ficou como "seguindo".', { endpoint: 'friendships/create', corpo: JSON.stringify(j) });
      }
      return st;
    },

    async deixarDeSeguir(id) {
      const j = await chamar('friendships/destroy', ENDPOINTS.deixarDeSeguir(id), {
        metodo: 'POST',
        corpo: form({ container_module: 'profile', nav_chain: '', user_id: id }),
      });
      return normalizarAmizade(j.friendship_status || {});
    },

    /**
     * Envia DM de texto. 1ª tentativa: broadcast/text com recipient_users.
     * Se o endpoint não aceitar, procura a conversa pelo participante e envia por thread_ids.
     * Retorna { modo }.
     */
    async enviarDm(id, texto) {
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
        // Só tenta a alternativa quando o Instagram claramente RECUSOU o pedido
        // (400/404/405) — assim não há risco de a mensagem ter saído duas vezes.
        const recusado = e instanceof ErroInstagram && [400, 404, 405].includes(e.status) && e.tipo !== 'limite' && e.tipo !== 'sessao';
        if (!recusado) throw e;
        // Alternativa: localizar a conversa e enviar por thread_ids.
        const conv = await chamar('direct_v2/get_by_participants', ENDPOINTS.dmConversaPorParticipante(id));
        const threadId = conv && conv.thread && conv.thread.thread_id;
        if (!threadId) {
          throw new ErroInstagram('mudanca_api', `Não foi possível enviar a DM: broadcast/text falhou (${e.message}) e não há conversa existente. O Instagram pode ter mudado a API de mensagens.`, { endpoint: 'direct_v2' });
        }
        const j2 = await chamar('direct_v2/broadcast/text(thread)', ENDPOINTS.dmTexto(), {
          metodo: 'POST',
          corpo: form({ ...comum, client_context: idNumericoCliente(), mutation_token: uuid(), thread_ids: JSON.stringify([threadId]) }),
        });
        if (j2 && j2.status === 'ok') return { modo: 'thread_ids' };
        throw new ErroInstagram('incerto', 'broadcast/text (thread) respondeu sem confirmar o envio — confira a conversa no Instagram.', { endpoint: 'direct_v2/broadcast/text', corpo: JSON.stringify(j2) });
      }
      if (j && j.status === 'ok') return { modo: 'recipient_users' };
      throw new ErroInstagram('incerto', 'broadcast/text respondeu sem confirmar o envio — confira a conversa no Instagram.', { endpoint: 'direct_v2/broadcast/text', corpo: JSON.stringify(j) });
    },
  };
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
  if (ehApi) {
    // csrftoken do cookie da própria página (mais atual que o lido pela extensão).
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    if (m) h['x-csrftoken'] = decodeURIComponent(m[1]);
    // x-ig-www-claim: o site guarda no sessionStorage; se não houver, manda '0' como o site.
    try {
      const claim = sessionStorage.getItem('www-claim-v2');
      h['x-ig-www-claim'] = claim || '0';
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
    return { status: r.status, texto: texto.slice(0, 2_000_000), origem: location.origin };
  } catch (e) {
    return { status: 0, texto: `fetch falhou: ${e && e.message ? e.message : e}`, origem: location.origin };
  }
}

const CHAVE_ABA = 'abaInstagramId';

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

/** Reutiliza uma aba do instagram.com ou abre uma fixada, em segundo plano. */
export async function garantirAbaInstagram() {
  const salvo = (await chrome.storage.local.get(CHAVE_ABA))[CHAVE_ABA];
  if (salvo) {
    try {
      const aba = await chrome.tabs.get(salvo);
      if (aba && aba.url && aba.url.startsWith(`${BASE}/`)) {
        await esperarCarregar(aba.id);
        return aba.id;
      }
    } catch { /* aba fechada */ }
  }
  const abertas = await chrome.tabs.query({ url: `${BASE}/*` });
  let aba = abertas.find((a) => a.pinned) || abertas[0];
  if (!aba) {
    try {
      aba = await chrome.tabs.create({ url: `${BASE}/`, pinned: true, active: false });
    } catch (e) {
      throw new ErroInstagram('aba', `Não consegui abrir a aba do Instagram (há uma janela do Chrome aberta?): ${e.message || e}`);
    }
  }
  await chrome.storage.local.set({ [CHAVE_ABA]: aba.id });
  await esperarCarregar(aba.id);
  return aba.id;
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

/** API pronta para uso dentro da extensão. */
export function criarApiChrome() {
  return criarApiInstagram({ executar: executarNaAba, obterCsrf: async () => (await lerSessao()).csrf });
}
