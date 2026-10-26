// Simulador para os testes: um `chrome` falso (storage, alarms, cookies, tabs,
// scripting, notifications, action, runtime) + um Instagram FALSO em memória.
// Nada aqui fala com o Instagram de verdade.

import { mock } from 'node:test';

export function criarInstagramFalso({ meuId = '999', referencia = 'perfilref', totalSeguidores = 120, voltaSe = (n) => n % 3 === 0, atrasoVolta = 40 * 60 * 1000 } = {}) {
  const usuarios = [];
  for (let n = 1; n <= totalSeguidores; n += 1) {
    usuarios.push({
      pk: String(1000 + n),
      username: `pessoa${n}`,
      is_private: n % 10 === 0,
      profile_pic_url: n % 15 === 0 ? 'https://cdn/44884218_345707102882519_2446069589734326272_n.jpg' : `https://cdn/foto${n}.jpg`,
      n,
    });
  }
  const ig = {
    meuId,
    usuarios,
    sigo: new Map(), // id -> desde
    pendentes: new Map(), // id -> desde (solicitação para perfil privado, ainda não aceita)
    aceitaSe: () => false, // (n) => true se o privado aceita a solicitação
    atrasoAceite: 30 * 60 * 1000,
    destroyNaoCancela: false, // friendships/destroy não cancela a solicitação pendente
    meSeguem: new Map(), // id -> desde
    jaMeSeguiam: new Set(['1002']), // pessoa2 já me seguia antes
    dms: [], // { id, texto, em }
    chamadas: [], // { em, metodo, caminho }
    falharProximoSeguir: null, // ex.: { status: 400, texto: '{"message":"feedback_required"}' }
    falharPerfil: null, // resposta forçada para web_profile_info
    perfilPrivado: false, // perfil de referência privado
    createHtml: false, // friendships/create devolve a página HTML (sem seguir)
    legadoFunciona: true, // /web/friendships/{id}/follow/ segue de verdade
    showHtml: false, // 1.1.4: friendships/show devolve a página HTML
    showManyHtml: false, // 1.1.4: friendships/show_many devolve a página HTML
    leituraFalha: false,
    dmHtml: false, // 1.1.5: broadcast/text devolve a página HTML // 1.1.4: a leitura do botão do perfil não acha o botão
    sigoReferencia: false, // eu sigo o perfil de referência
    v1Vazio: false, // friendships/{id}/followers devolve users: []
    graphqlVazio: false, // GraphQL de seguidores devolve lista vazia
    falharSeguidoresDeMim: 0, // quantas vezes a lista dos MEUS seguidores responde "aguarde"
    meusSeguidoresHtml: false, // 1.1.7: a lista v1 dos MEUS seguidores devolve a página HTML
    meusSeguidoresGraphqlFalha: false, // 1.1.7: o GraphQL dos MEUS seguidores também não responde dados
    voltaSe,
    atrasoVolta,
    // 1.1.8: tela da DM (digitação). abre: o botão "Enviar mensagem" aparece; envia: o Enter manda a mensagem;
    // aparece: a mensagem enviada aparece na conversa (confirmação).
    dmTela: { abre: true, envia: true, aparece: true },
    // 1.1.9: atividade (news/inbox). null = endpoint inexistente (404). Senão { modo: 'ok'|'html'|'sem_lista'|'aguarde',
    // historias: [...story], porPagina, falhasAguarde }.
    atividade: null,
  };
  for (const id of ig.jaMeSeguiam) ig.meSeguem.set(id, 0);
  // 1.1.7: outras pessoas (fora da extensão) que passam a me seguir — empurram os follow-backs para fora da 1ª página.
  let outros = 0;
  ig.novosSeguidoresDeFora = (n, em = Date.now()) => { for (let i = 0; i < n; i += 1) { outros += 1; ig.meSeguem.set(`9${String(outros).padStart(5, '0')}`, em + i); } };
  const meusSeguidoresRecentes = () => [...ig.meSeguem.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  function atualizarVoltas(agora) {
    for (const [id, desde] of ig.pendentes) {
      const u = usuarios.find((x) => x.pk === id);
      if (u && ig.aceitaSe(u.n) && agora - desde >= ig.atrasoAceite) { ig.pendentes.delete(id); ig.sigo.set(id, desde); }
    }
    // Seguir de volta vale para quem eu sigo E para quem tem solicitação minha pendente (privado).
    for (const [id, desde] of [...ig.sigo, ...ig.pendentes]) {
      const u = usuarios.find((x) => x.pk === id);
      if (u && ig.voltaSe(u.n) && agora - desde >= ig.atrasoVolta && !ig.meSeguem.has(id)) ig.meSeguem.set(id, desde + ig.atrasoVolta);
    }
  }

  // 1.1.8: tela da conversa simulada (as funções ...NaPagina de instagram-api.js).
  const tela = { conversa: null, caixa: '' };
  const normT = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const naConversa = (trecho) => ig.dms.filter((d) => d.id === tela.conversa && normT(d.texto).includes(normT(trecho))).length;
  ig.telaDm = (nome, args, url) => {
    ig.chamadas.push({ em: Date.now(), metodo: 'DM-TELA', caminho: nome });
    if (nome === 'abrirConversaNaPagina') {
      const usuario = decodeURIComponent((String(url || '').match(/instagram\.com\/([^/?#]+)\/?/) || [])[1] || '');
      const u = usuarios.find((x) => x.username === usuario);
      const pk = u ? u.pk : usuario.startsWith('x') && ig.meSeguem.has(usuario.slice(1)) ? usuario.slice(1) : null;
      if (!ig.dmTela.abre || !pk) return { ok: false, erro: 'botão "Enviar mensagem" não apareceu no perfil' };
      tela.conversa = pk;
      tela.caixa = '';
      return { ok: true };
    }
    if (!tela.conversa) return { ok: false, erro: 'caixa de mensagem sumiu' };
    if (nome === 'prepararCaixaNaPagina') { tela.caixa = ''; return { ok: true, contagem: naConversa(args[0]) }; }
    if (nome === 'escreverNaPagina') { for (const p of args[0]) tela.caixa += p.quebra ? '\n' : p.texto || ''; return { ok: true }; }
    if (nome === 'conferirCaixaNaPagina') {
      if (normT(tela.caixa) === normT(args[0])) return { ok: true };
      tela.caixa = '';
      return { ok: false, erro: 'o texto digitado não conferiu' };
    }
    if (nome === 'apertarEnterNaPagina') {
      if (ig.dmTela.envia && tela.caixa) { ig.dms.push({ id: tela.conversa, texto: tela.caixa, em: Date.now(), via: 'digitacao', visivel: ig.dmTela.aparece }); tela.caixa = ''; }
      return { ok: true };
    }
    if (nome === 'confirmarDmNaPagina') {
      const vistas = ig.dms.filter((d) => d.id === tela.conversa && d.visivel !== false && normT(d.texto).includes(normT(args[0]))).length;
      return vistas > args[1] ? { ok: true, confirmado: true } : { ok: false, confirmado: false, erro: 'a mensagem não apareceu na conversa em 12 s' };
    }
    return { ok: false, erro: `função desconhecida ${nome}` };
  };

  ig.responder = ({ url, metodo, corpo }) => {
    const agora = Date.now();
    atualizarVoltas(agora);
    const u = new URL(url);
    const caminho = u.pathname;
    ig.chamadas.push({ em: agora, metodo, caminho });
    const ok = (obj) => ({ status: 200, texto: JSON.stringify(obj) });
    const params = new URLSearchParams(corpo || '');
    let m;
    if (caminho === '/api/v1/news/inbox/') {
      const a = ig.atividade;
      if (!a) return { status: 404, texto: '<html>not found</html>' };
      if (a.falhasAguarde > 0) { a.falhasAguarde -= 1; return { status: 400, texto: '{"message":"Please wait a few minutes before you try again.","status":"fail"}' }; }
      if (a.modo === 'html') return { status: 200, texto: '<!DOCTYPE html><html><head><title>Instagram</title></head></html>' };
      if (a.modo === 'sem_lista') return ok({ counts: {}, status: 'ok' });
      const porPagina = a.porPagina || 50;
      const ini = Number(u.searchParams.get('max_id') || params.get('max_id') || 0);
      const hist = a.historias || [];
      return ok({ counts: {}, new_stories: [], old_stories: hist.slice(ini, ini + porPagina), ...(ini + porPagina < hist.length ? { next_max_id: String(ini + porPagina) } : {}), status: 'ok' });
    }
    if (caminho === '/api/v1/web/search/topsearch/') {
      const q = u.searchParams.get('query');
      return ok({ users: q === referencia ? [{ position: 0, user: { pk: '555', username: referencia, is_private: false } }] : [], status: 'ok' });
    }
    if (caminho === '/api/v1/users/web_profile_info/') {
      if (ig.falharPerfil) return ig.falharPerfil;
      if (u.searchParams.get('username') !== referencia) return { status: 404, texto: '{"message":"User not found","status":"fail"}' };
      return ok({ data: { user: { id: '555', username: referencia, is_private: ig.perfilPrivado, followed_by_viewer: ig.sigoReferencia, edge_followed_by: { count: usuarios.length } } }, status: 'ok' });
    }
    if (caminho === '/graphql/query/') {
      const vars = JSON.parse(u.searchParams.get('variables'));
      if (vars.id === meuId) {
        // 1.1.7: plano B da lista dos MEUS seguidores (mais recentes primeiro).
        if (ig.meusSeguidoresGraphqlFalha) return { status: 200, texto: '<!DOCTYPE html><html><head><title>Instagram</title></head></html>' };
        const todos = meusSeguidoresRecentes();
        const ini = Number(vars.after || 0);
        const pg = todos.slice(ini, ini + vars.first);
        return ok({ data: { user: { edge_followed_by: {
          count: todos.length,
          page_info: { has_next_page: ini + vars.first < todos.length, end_cursor: String(ini + vars.first) },
          edges: pg.map((id) => ({ node: { id, username: `x${id}`, is_private: false, followed_by_viewer: false, follows_viewer: true } })),
        } } }, status: 'ok' });
      }
      const inicio = Number(vars.after || 0);
      const pagina = ig.graphqlVazio ? [] : usuarios.slice(inicio, inicio + vars.first);
      const fim = inicio + vars.first;
      return ok({
        data: { user: { edge_followed_by: {
          count: usuarios.length,
          page_info: { has_next_page: !ig.graphqlVazio && fim < usuarios.length, end_cursor: String(fim) },
          edges: pagina.map((x) => ({ node: { id: x.pk, username: x.username, is_private: x.is_private, profile_pic_url: x.profile_pic_url, followed_by_viewer: false, follows_viewer: false } })),
        } } },
        status: 'ok',
      });
    }
    if ((m = caminho.match(/^\/api\/v1\/friendships\/(\w+)\/followers\/$/))) {
      if (m[1] === meuId) {
        if (ig.falharSeguidoresDeMim > 0) { ig.falharSeguidoresDeMim -= 1; return { status: 400, texto: '{"message":"Please wait a few minutes before you try again.","status":"fail"}' }; }
        if (ig.meusSeguidoresHtml) return { status: 200, texto: '<!DOCTYPE html><html><head><title>Instagram</title></head></html>' };
        // Como o site: páginas de `count` (12), mais recentes primeiro, com next_max_id.
        const todos = meusSeguidoresRecentes();
        const ini = Number(u.searchParams.get('max_id') || 0);
        const n = Number(u.searchParams.get('count') || 12);
        const lista = todos.slice(ini, ini + n).map((id) => ({ pk: id, username: `x${id}` }));
        return ok({ users: lista, next_max_id: ini + n < todos.length ? String(ini + n) : null, status: 'ok' });
      }
      if (ig.v1Vazio) return ok({ users: [], big_list: false, page_size: 12, status: 'ok' });
      const inicio = Number(u.searchParams.get('max_id') || 0);
      const n = Number(u.searchParams.get('count') || 12);
      const pagina = usuarios.slice(inicio, inicio + n);
      return ok({ users: pagina, next_max_id: inicio + n < usuarios.length ? String(inicio + n) : null, status: 'ok' });
    }
    const PAGINA_HTML = { status: 200, texto: '<!DOCTYPE html><html><head><title>Instagram</title></head></html>' };
    if (ig.showHtml && caminho.startsWith('/api/v1/friendships/show/')) return PAGINA_HTML; // 1.1.4
    if (ig.showManyHtml && caminho === '/api/v1/friendships/show_many/') return PAGINA_HTML; // 1.1.4 (caso real 24/10)
    if ((m = caminho.match(/^\/api\/v1\/friendships\/show\/(\w+)\/$/))) {
      const usr = usuarios.find((x) => x.pk === m[1]);
      return ok({ following: ig.sigo.has(m[1]), followed_by: ig.meSeguem.has(m[1]), outgoing_request: ig.pendentes.has(m[1]), is_private: Boolean(usr && usr.is_private), status: 'ok' });
    }
    if (caminho === '/api/v1/friendships/show_many/') {
      const mapa = {};
      for (const id of (params.get('user_ids') || '').split(',')) mapa[id] = { following: ig.sigo.has(id), outgoing_request: ig.pendentes.has(id), followed_by: ig.meSeguem.has(id) };
      return ok({ friendship_statuses: mapa, status: 'ok' });
    }
    if ((m = caminho.match(/^\/web\/friendships\/(\w+)\/(follow|unfollow)\/$/))) {
      if (!ig.legadoFunciona) return { status: 200, texto: '<!DOCTYPE html><html><head><title>Instagram</title></head></html>' };
      if (m[2] === 'follow') ig.sigo.set(m[1], agora);
      else { ig.sigo.delete(m[1]); if (!ig.destroyNaoCancela) ig.pendentes.delete(m[1]); }
      return ok({ result: m[2] === 'follow' ? 'following' : '', status: 'ok' });
    }
    if ((m = caminho.match(/^\/api\/v1\/friendships\/create\/(\w+)\/$/))) {
      if (ig.falharProximoSeguir) { const f = ig.falharProximoSeguir; ig.falharProximoSeguir = null; return f; }
      if (ig.createHtml) return { status: 200, texto: '<!DOCTYPE html><html><head><title>Instagram</title></head></html>' };
      const alvo = usuarios.find((x) => x.pk === m[1]);
      if (alvo && alvo.is_private) {
        ig.pendentes.set(m[1], agora);
        return ok({ friendship_status: { following: false, outgoing_request: true, is_private: true }, status: 'ok' });
      }
      ig.sigo.set(m[1], agora);
      return ok({ friendship_status: { following: true, outgoing_request: false }, status: 'ok' });
    }
    if ((m = caminho.match(/^\/api\/v1\/friendships\/destroy\/(\w+)\/$/))) {
      ig.sigo.delete(m[1]);
      if (!ig.destroyNaoCancela) ig.pendentes.delete(m[1]);
      return ok({ friendship_status: { following: false, outgoing_request: ig.pendentes.has(m[1]) }, status: 'ok' });
    }
    if (caminho === '/api/v1/direct_v2/threads/broadcast/text/') {
      if (ig.dmHtml) return PAGINA_HTML; // 1.1.5: a API de DM devolve a página HTML (nada enviado)
      const dest = JSON.parse(params.get('recipient_users'))[0][0];
      ig.dms.push({ id: dest, texto: params.get('text'), em: agora });
      return ok({ status: 'ok' });
    }
    return { status: 404, texto: '<html>not found</html>' };
  };
  return ig;
}

export function criarChromeFalso(ig, { logado = true, semJanelas = false } = {}) {
  const dados = {};
  // Janelas do Chrome: a do dono (id 1, com uma aba qualquer) + as criadas pela extensão.
  const janelas = semJanelas ? [] : [{ id: 1, type: 'normal', width: 1400, state: 'maximized', focused: true, tabs: [{ id: 11, url: 'https://exemplo.com/', status: 'complete', active: true }] }];
  const registro = { criadas: [], focos: [], abasCriadas: 0, atualizacoesAba: [] };
  let proximoId = 100;
  const acharAba = (id) => { for (const w of janelas) { const t = w.tabs.find((x) => x.id === id); if (t) return { w, t }; } return null; };
  const alarmes = new Map();
  const ouvintes = { alarm: [], installed: [], startup: [], message: [], tabUpdated: [] };
  const notificacoes = [];
  const sessao = { logado };

  const chrome = {
    storage: {
      local: {
        async get(chaves) {
          const lista = typeof chaves === 'string' ? [chaves] : Array.isArray(chaves) ? chaves : Object.keys(dados);
          const r = {};
          for (const k of lista) if (k in dados) r[k] = structuredClone(dados[k]);
          return r;
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) dados[k] = structuredClone(v); },
        async remove(k) { for (const x of [].concat(k)) delete dados[x]; },
      },
      onChanged: { addListener() {} },
    },
    alarms: {
      async create(nome, info) {
        const when = info.when ?? Date.now() + (info.delayInMinutes ?? info.periodInMinutes) * 60000;
        alarmes.set(nome, { name: nome, scheduledTime: when, periodInMinutes: info.periodInMinutes });
      },
      async get(nome) { return alarmes.get(nome); },
      async clear(nome) { return alarmes.delete(nome); },
      onAlarm: { addListener: (f) => ouvintes.alarm.push(f) },
    },
    cookies: {
      async get({ name }) {
        if (!sessao.logado) return null;
        return { sessionid: { value: 'x' }, ds_user_id: { value: ig.meuId }, csrftoken: { value: 'csrf-teste' } }[name] || null;
      },
    },
    windows: {
      async getAll() { return structuredClone(janelas); },
      async get(id) { const w = janelas.find((x) => x.id === id); if (!w) throw new Error(`No window with id: ${id}`); return structuredClone(w); },
      async create(opc) {
        const w = { id: proximoId++, type: opc.type || 'normal', width: opc.width, height: opc.height, state: opc.state || 'normal', focused: Boolean(opc.focused), tabs: [{ id: proximoId++, url: opc.url, status: 'complete', active: true, autoDiscardable: true }] };
        janelas.push(w);
        registro.criadas.push(structuredClone(opc));
        return structuredClone(w);
      },
      async update(id, opc) { const w = janelas.find((x) => x.id === id); Object.assign(w, opc); if (opc.focused) registro.focos.push(id); return structuredClone(w); },
    },
    tabs: {
      async get(id) { const a = acharAba(id); if (!a) throw new Error(`No tab with id: ${id}`); return { ...structuredClone(a.t), windowId: a.w.id }; },
      async query({ windowId } = {}) { return janelas.filter((w) => windowId == null || w.id === windowId).flatMap((w) => w.tabs.map((t) => ({ ...t, windowId: w.id }))); },
      async create() { registro.abasCriadas += 1; throw new Error('a extensão não deve criar aba'); },
      async update(id, opc) { const a = acharAba(id); registro.atualizacoesAba.push({ id, ...opc }); Object.assign(a.t, opc); return { ...a.t, windowId: a.w.id }; },
      onUpdated: { addListener: (f) => ouvintes.tabUpdated.push(f), removeListener() {} },
    },
    scripting: {
      async executeScript({ target, args, func }) {
        const alvo = acharAba(target.tabId);
        if (!alvo) throw new Error(`No tab with id: ${target.tabId}`);
        registro.execucoes = (registro.execucoes || 0) + 1;
        if (alvo.w.id === 1) throw new Error('usou aba da janela do dono');
        if (func && /NaPagina$/.test(func.name) && func.name !== 'lerEstadoNaPagina' && func.name !== 'clicarNaPagina' && func.name !== 'requisicaoNaPagina') {
          return [{ result: ig.telaDm(func.name, args, alvo.t.url) }]; // 1.1.8: tela da DM
        }
        if (func && func.name === 'lerEstadoNaPagina') {
          // 1.1.4: leitura do botão do perfil (sem clicar). O site web não mostra "Segue você" no simulador.
          const usuario = decodeURIComponent((String(alvo.t.url || '').match(/instagram\.com\/([^/?#]+)\/?/) || [])[1] || '');
          const u = ig.usuarios.find((x) => x.username === usuario);
          ig.chamadas.push({ em: Date.now(), caminho: `leitura:${usuario}`, metodo: 'READ' });
          if (!u || ig.leituraFalha) return [{ result: { ok: false, erro: 'botão Seguir/Seguindo não apareceu' } }];
          const botao = ig.sigo.has(u.pk) ? 'seguindo' : ig.pendentes.has(u.pk) ? 'solicitado' : ig.meSeguem.has(u.pk) ? 'seguir_de_volta' : 'seguir';
          return [{ result: { ok: true, botao, segueVoce: false, privado: Boolean(u.is_private) } }];
        }
        if (Array.isArray(args[0])) {
          // 1.1.3: clique no botão do perfil (clicarNaPagina). Funciona quando o "legado" funcionaria.
          const usuario = decodeURIComponent((String(alvo.t.url || '').match(/instagram\.com\/([^/?#]+)\/?/) || [])[1] || '');
          const u = ig.usuarios.find((x) => x.username === usuario);
          ig.chamadas.push({ caminho: `clique:${usuario}`, metodo: 'CLICK' });
          if (!u || !ig.legadoFunciona) return [{ result: { ok: false, erro: 'botão "seguir" não apareceu (passo 1)' } }];
          const seguir = args[0][0].includes('seguir');
          if (seguir) { if (u.is_private) ig.pendentes.set(u.pk, Date.now()); else ig.sigo.set(u.pk, Date.now()); }
          else { ig.sigo.delete(u.pk); if (!ig.destroyNaoCancela) ig.pendentes.delete(u.pk); }
          return [{ result: { ok: true } }];
        }
        const [url, metodo, corpo, cabecalhos] = args;
        if (Object.keys(cabecalhos).length === 0) return [{ result: ig.responder({ url, metodo, corpo }) }]; // página HTML (sem cabeçalhos de API)
        if (!cabecalhos['x-csrftoken'] || cabecalhos['x-ig-app-id'] !== '936619743392459' || cabecalhos['x-requested-with'] !== 'XMLHttpRequest') {
          return [{ result: { status: 403, texto: '{"message":"cabecalhos faltando"}' } }];
        }
        return [{ result: ig.responder({ url, metodo, corpo }) }];
      },
    },
    notifications: { create: (id, opc) => notificacoes.push({ id, ...opc, em: Date.now() }) },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    runtime: {
      onInstalled: { addListener: (f) => ouvintes.installed.push(f) },
      onStartup: { addListener: (f) => ouvintes.startup.push(f) },
      onMessage: { addListener: (f) => ouvintes.message.push(f) },
    },
  };
  return { chrome, dados, alarmes, ouvintes, notificacoes, sessao, janelas, registro };
}

/** Espera uma promise avançando o relógio falso aos poucos (para os atrasos de 1–4 s). */
export async function aguardar(promessa, passoMs = 1000, maxPassos = 100000) {
  let pronto = false;
  let valor;
  let erro;
  promessa.then((v) => { pronto = true; valor = v; }, (e) => { pronto = true; erro = e; });
  for (let i = 0; i < maxPassos && !pronto; i += 1) {
    await new Promise((r) => setImmediate(r));
    if (!pronto) mock.timers.tick(passoMs);
  }
  if (!pronto) throw new Error('aguardar: promessa não terminou');
  if (erro) throw erro;
  return valor;
}

/** Carrega o background.js com o chrome falso e devolve funções de controle. */
export async function iniciarExtensao(cf, inicio) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: inicio });
  globalThis.chrome = cf.chrome;
  await import(`../../background.js?inst=${Math.random()}`);
  const ocioso = () => aguardar(globalThis.seguidorIG.ocioso());
  for (const f of cf.ouvintes.installed) f({ reason: 'install' });
  await ocioso();

  async function mensagem(msg) {
    const p = new Promise((resolve) => { for (const f of cf.ouvintes.message) f(msg, {}, resolve); });
    return aguardar(p);
  }

  /** Avança o tempo até `ate`, disparando os alarmes no horário. */
  async function avancarAte(ate) {
    for (;;) {
      const prox = [...cf.alarmes.values()].sort((a, b) => a.scheduledTime - b.scheduledTime)[0];
      if (!prox || prox.scheduledTime > ate) break;
      if (prox.scheduledTime > Date.now()) mock.timers.tick(prox.scheduledTime - Date.now());
      if (prox.periodInMinutes) prox.scheduledTime += prox.periodInMinutes * 60000;
      else cf.alarmes.delete(prox.name);
      for (const f of cf.ouvintes.alarm) f({ name: prox.name });
      await ocioso();
    }
    if (ate > Date.now()) mock.timers.tick(ate - Date.now());
  }

  const estado = () => structuredClone(cf.dados.estado);
  return { mensagem, avancarAte, estado, ocioso };
}
