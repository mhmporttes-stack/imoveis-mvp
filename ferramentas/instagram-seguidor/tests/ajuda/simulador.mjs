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
    meSeguem: new Map(), // id -> desde
    jaMeSeguiam: new Set(['1002']), // pessoa2 já me seguia antes
    dms: [], // { id, texto, em }
    chamadas: [], // { em, metodo, caminho }
    falharProximoSeguir: null, // ex.: { status: 400, texto: '{"message":"feedback_required"}' }
    falharPerfil: null, // resposta forçada para web_profile_info
    falharSeguidoresDeMim: 0, // quantas vezes a lista dos MEUS seguidores responde "aguarde"
    voltaSe,
    atrasoVolta,
  };
  for (const id of ig.jaMeSeguiam) ig.meSeguem.set(id, 0);

  function atualizarVoltas(agora) {
    for (const [id, desde] of ig.sigo) {
      const u = usuarios.find((x) => x.pk === id);
      if (u && ig.voltaSe(u.n) && agora - desde >= ig.atrasoVolta && !ig.meSeguem.has(id)) ig.meSeguem.set(id, desde + ig.atrasoVolta);
    }
  }

  ig.responder = ({ url, metodo, corpo }) => {
    const agora = Date.now();
    atualizarVoltas(agora);
    const u = new URL(url);
    const caminho = u.pathname;
    ig.chamadas.push({ em: agora, metodo, caminho });
    const ok = (obj) => ({ status: 200, texto: JSON.stringify(obj) });
    const params = new URLSearchParams(corpo || '');
    let m;
    if (caminho === '/api/v1/web/search/topsearch/') {
      const q = u.searchParams.get('query');
      return ok({ users: q === referencia ? [{ position: 0, user: { pk: '555', username: referencia, is_private: false } }] : [], status: 'ok' });
    }
    if (caminho === '/api/v1/users/web_profile_info/') {
      if (ig.falharPerfil) return ig.falharPerfil;
      if (u.searchParams.get('username') !== referencia) return { status: 404, texto: '{"message":"User not found","status":"fail"}' };
      return ok({ data: { user: { id: '555', username: referencia, is_private: false } }, status: 'ok' });
    }
    if ((m = caminho.match(/^\/api\/v1\/friendships\/(\w+)\/followers\/$/))) {
      if (m[1] === meuId) {
        if (ig.falharSeguidoresDeMim > 0) { ig.falharSeguidoresDeMim -= 1; return { status: 400, texto: '{"message":"Please wait a few minutes before you try again.","status":"fail"}' }; }
        const lista = [...ig.meSeguem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([id]) => ({ pk: id, username: `x${id}` }));
        return ok({ users: lista, next_max_id: null, status: 'ok' });
      }
      const inicio = Number(u.searchParams.get('max_id') || 0);
      const pagina = usuarios.slice(inicio, inicio + 25);
      return ok({ users: pagina, next_max_id: inicio + 25 < usuarios.length ? String(inicio + 25) : null, status: 'ok' });
    }
    if ((m = caminho.match(/^\/api\/v1\/friendships\/show\/(\w+)\/$/))) {
      const usr = usuarios.find((x) => x.pk === m[1]);
      return ok({ following: ig.sigo.has(m[1]), followed_by: ig.meSeguem.has(m[1]), outgoing_request: false, is_private: Boolean(usr && usr.is_private), status: 'ok' });
    }
    if (caminho === '/api/v1/friendships/show_many/') {
      const mapa = {};
      for (const id of (params.get('user_ids') || '').split(',')) mapa[id] = { following: ig.sigo.has(id), outgoing_request: false, followed_by: ig.meSeguem.has(id) };
      return ok({ friendship_statuses: mapa, status: 'ok' });
    }
    if ((m = caminho.match(/^\/api\/v1\/friendships\/create\/(\w+)\/$/))) {
      if (ig.falharProximoSeguir) { const f = ig.falharProximoSeguir; ig.falharProximoSeguir = null; return f; }
      ig.sigo.set(m[1], agora);
      return ok({ friendship_status: { following: true, outgoing_request: false }, status: 'ok' });
    }
    if ((m = caminho.match(/^\/api\/v1\/friendships\/destroy\/(\w+)\/$/))) {
      ig.sigo.delete(m[1]);
      return ok({ friendship_status: { following: false }, status: 'ok' });
    }
    if (caminho === '/api/v1/direct_v2/threads/broadcast/text/') {
      const dest = JSON.parse(params.get('recipient_users'))[0][0];
      ig.dms.push({ id: dest, texto: params.get('text'), em: agora });
      return ok({ status: 'ok' });
    }
    return { status: 404, texto: '<html>not found</html>' };
  };
  return ig;
}

export function criarChromeFalso(ig, { logado = true } = {}) {
  const dados = {};
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
    tabs: {
      async get(id) { return { id, url: 'https://www.instagram.com/', status: 'complete', pinned: true }; },
      async query() { return [{ id: 7, url: 'https://www.instagram.com/', status: 'complete', pinned: true }]; },
      async create() { return { id: 7, url: 'https://www.instagram.com/', status: 'complete', pinned: true }; },
      onUpdated: { addListener: (f) => ouvintes.tabUpdated.push(f), removeListener() {} },
    },
    scripting: {
      async executeScript({ args }) {
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
  return { chrome, dados, alarmes, ouvintes, notificacoes, sessao };
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
