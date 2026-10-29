// Simulador para os testes: um `chrome` falso (storage, alarms, tabs, scripting, notifications, action, runtime) + uma
// TELA do Instagram FALSA em memória (1.2.0: a extensão só lê/clica na tela — o simulador responde às funções
// `...NaPagina` de instagram-tela.js pelo nome, com o endereço da aba). Nada aqui fala com o Instagram de verdade.

import { mock } from 'node:test';

const FOTO_PADRAO = 'https://cdn/44884218_345707102882519_2446069589734326272_n.jpg';
const usuarioDaUrl = (url) => decodeURIComponent((String(url || '').match(/instagram\.com\/([^/?#]+)\/?/) || [])[1] || '').toLowerCase();

export function criarInstagramFalso({ meuUsuario = 'eu', referencia = 'perfilref', totalSeguidores = 120, voltaSe = (n) => n % 3 === 0, atrasoVolta = 40 * 60 * 1000 } = {}) {
  const usuarios = [];
  for (let n = 1; n <= totalSeguidores; n += 1) {
    usuarios.push({ username: `pessoa${n}`, privado: n % 10 === 0, foto: n % 15 === 0 ? FOTO_PADRAO : `https://cdn/foto${n}.jpg`, n });
  }
  const ig = {
    meuUsuario,
    referencia,
    usuarios,
    logado: true,
    sigo: new Map(), // @ -> desde
    pendentes: new Map(), // @ -> desde (solicitação para perfil privado, ainda não aceita)
    aceitaSe: () => false, // (n) => true se o privado aceita a solicitação
    atrasoAceite: 30 * 60 * 1000,
    meSeguem: new Map(), // @ -> desde
    jaMeSeguiam: new Set(['pessoa2']), // pessoa2 já me seguia antes
    dms: [], // { username, texto, em, via, visivel }
    chamadas: [], // { em, tipo, alvo }
    perfilPrivado: false, // perfil de referência privado
    sigoReferencia: false,
    bloqueioNoClique: null, // 'limite' | 'aguarde' — o próximo clique mostra o aviso do Instagram
    aguardeNaLista: 0, // quantas leituras da lista mostram "Tente novamente mais tarde"
    cliqueNaoMuda: false, // o botão do perfil não muda depois do clique (tela mudou)
    leituraFalha: false, // o botão do perfil não aparece
    listaNaoAbre: false, // a janela "Seguidores" não abre
    minhaListaNaoAbre: false,
    pesquisaFalha: false, // a pesquisa na minha lista não mostra resultado
    listaVazia: false,
    voltaSe,
    atrasoVolta,
    // Tela da DM (digitação). abre: o botão "Enviar mensagem" aparece; envia: o Enter manda; aparece: confirma na conversa.
    dmTela: { abre: true, envia: true, aparece: true },
  };
  for (const u of ig.jaMeSeguiam) ig.meSeguem.set(u, 0);
  let outros = 0;
  // Outras pessoas (fora da extensão) que passam a me seguir — empurram os follow-backs para baixo na minha lista.
  ig.novosSeguidoresDeFora = (n, em = Date.now()) => { for (let i = 0; i < n; i += 1) { outros += 1; ig.meSeguem.set(`fora${outros}`, em + i); } };
  const meusSeguidoresRecentes = () => [...ig.meSeguem.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
  const acharUsuario = (u) => usuarios.find((x) => x.username === u);
  ig.relacao = (u) => (ig.sigo.has(u) ? 'seguindo' : ig.pendentes.has(u) ? 'solicitado' : ig.meSeguem.has(u) ? 'seguir_de_volta' : 'seguir');

  function atualizarVoltas(agora) {
    for (const [u, desde] of ig.pendentes) {
      const x = acharUsuario(u);
      if (x && ig.aceitaSe(x.n) && agora - desde >= ig.atrasoAceite) { ig.pendentes.delete(u); ig.sigo.set(u, desde); }
    }
    for (const [u, desde] of [...ig.sigo, ...ig.pendentes]) {
      const x = acharUsuario(u);
      if (x && ig.voltaSe(x.n) && agora - desde >= ig.atrasoVolta && !ig.meSeguem.has(u)) ig.meSeguem.set(u, desde + ig.atrasoVolta);
    }
  }

  const tela = { conversa: null, caixa: '', pesquisa: '' };
  const normT = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const naConversa = (trecho, soVisiveis = false) => ig.dms.filter((d) => d.username === tela.conversa && (!soVisiveis || d.visivel !== false) && normT(d.texto).includes(normT(trecho))).length;

  /** Responde a uma função `...NaPagina` (nome, argumentos, endereço da aba). */
  ig.tela = (nome, args, url) => {
    const agora = Date.now();
    atualizarVoltas(agora);
    const alvo = usuarioDaUrl(url);
    const registrar = (tipo) => ig.chamadas.push({ em: agora, tipo, alvo, url });
    if (!ig.logado && nome !== 'lerSessaoNaPagina') return { ok: false, bloqueio: 'sessao' };
    switch (nome) {
      case 'lerSessaoNaPagina':
        registrar('sessao');
        return { ok: true, logado: ig.logado, meuUsuario: ig.logado ? ig.meuUsuario : '' };
      case 'lerPerfilNaPagina': {
        registrar('leitura');
        if (alvo === ig.referencia) return { ok: true, botao: ig.sigoReferencia ? 'seguindo' : 'seguir', privado: ig.perfilPrivado };
        if (ig.leituraFalha) return { ok: false, erro: 'botão Seguir/Seguindo não apareceu' };
        const x = acharUsuario(alvo);
        if (!x && !ig.meSeguem.has(alvo)) return { ok: false, naoExiste: true };
        return { ok: true, botao: ig.relacao(alvo), segueVoce: false, privado: Boolean(x && x.privado) };
      }
      case 'clicarPerfilNaPagina': {
        const [passos] = args;
        const seguir = passos.length === 1;
        registrar(seguir ? 'clique-seguir' : 'clique-deixar');
        if (ig.bloqueioNoClique) { const b = ig.bloqueioNoClique; ig.bloqueioNoClique = null; return { ok: false, bloqueio: b, aviso: 'Tente novamente mais tarde' }; }
        if (ig.cliqueNaoMuda) return { ok: false, erro: 'depois do clique o botão ficou "seguir"', passo: 'confirmação do botão' };
        const x = acharUsuario(alvo);
        if (!x) return { ok: false, erro: 'botão não apareceu', passo: 'botão' };
        if (seguir) {
          if (x.privado) ig.pendentes.set(alvo, agora); else ig.sigo.set(alvo, agora);
        } else {
          ig.sigo.delete(alvo);
          ig.pendentes.delete(alvo);
        }
        return { ok: true, botaoDepois: ig.relacao(alvo), privado: x.privado };
      }
      case 'lerListaNaPagina': {
        const [{ quantos }] = args;
        registrar(alvo === ig.meuUsuario ? 'lista-minha' : 'lista');
        if (ig.aguardeNaLista > 0) { ig.aguardeNaLista -= 1; return { ok: false, bloqueio: 'aguarde', aviso: 'Tente novamente mais tarde' }; }
        if (alvo === ig.meuUsuario) {
          if (ig.minhaListaNaoAbre) return { ok: false, erro: 'a janela "Seguidores" não abriu' };
          const todos = meusSeguidoresRecentes();
          return { ok: true, usuarios: todos.slice(0, quantos).map((u) => ({ username: u, foto: '', relacao: ig.relacao(u) })), fim: todos.length <= quantos };
        }
        if (alvo === ig.referencia) {
          if (ig.listaNaoAbre || (ig.perfilPrivado && !ig.sigoReferencia)) return { ok: false, erro: 'a janela "Seguidores" não abriu' };
          if (ig.listaVazia) return { ok: true, usuarios: [], fim: true };
          return { ok: true, usuarios: usuarios.slice(0, quantos).map((x) => ({ username: x.username, foto: x.foto, relacao: ig.relacao(x.username) })), fim: usuarios.length <= quantos };
        }
        return { ok: false, erro: 'a janela "Seguidores" não abriu' };
      }
      case 'focarPesquisaNaPagina':
        registrar('pesquisa');
        if (alvo !== ig.meuUsuario || ig.minhaListaNaoAbre) return { ok: false, erro: 'a janela "Seguidores" não abriu' };
        tela.pesquisa = '';
        return { ok: true, antes: 'lista' };
      case 'escreverPesquisaNaPagina':
        tela.pesquisa += args[0];
        return { ok: true };
      case 'resultadoPesquisaNaPagina':
        if (ig.pesquisaFalha) return { ok: false, erro: 'a pesquisa não mostrou resultado' };
        return { ok: true, encontrado: ig.meSeguem.has(String(args[0]).toLowerCase()) };
      // --- DM (digitação) ---
      case 'abrirConversaNaPagina': {
        registrar('DM-TELA');
        if (!ig.dmTela.abre || (!acharUsuario(alvo) && !ig.meSeguem.has(alvo))) return { ok: false, erro: 'botão "Enviar mensagem" não apareceu no perfil' };
        tela.conversa = alvo;
        tela.caixa = '';
        return { ok: true };
      }
      default:
        break;
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
      if (ig.dmTela.envia && tela.caixa) { ig.dms.push({ username: tela.conversa, texto: tela.caixa, em: Date.now(), via: 'digitacao', visivel: ig.dmTela.aparece }); tela.caixa = ''; }
      return { ok: true };
    }
    if (nome === 'confirmarDmNaPagina') {
      return naConversa(args[0], true) > args[1] ? { ok: true, confirmado: true } : { ok: false, confirmado: false, erro: 'a mensagem não apareceu na conversa em 12 s' };
    }
    return { ok: false, erro: `função desconhecida ${nome}` };
  };

  /** Chamadas de um tipo (ex.: 'clique-seguir'). */
  ig.de = (tipo) => ig.chamadas.filter((c) => c.tipo === tipo);
  return ig;
}

export function criarChromeFalso(ig, { semJanelas = false } = {}) {
  const dados = {};
  // Janelas do Chrome: a do dono (id 1, com uma aba qualquer) + as criadas pela extensão.
  const janelas = semJanelas ? [] : [{ id: 1, type: 'normal', width: 1400, state: 'maximized', focused: true, tabs: [{ id: 11, url: 'https://exemplo.com/', status: 'complete', active: true }] }];
  const registro = { criadas: [], focos: [], abasCriadas: 0, atualizacoesAba: [], execucoes: 0, funcoes: [] };
  let proximoId = 100;
  const acharAba = (id) => { for (const w of janelas) { const t = w.tabs.find((x) => x.id === id); if (t) return { w, t }; } return null; };
  const alarmes = new Map();
  const ouvintes = { alarm: [], installed: [], startup: [], message: [], tabUpdated: [] };
  const notificacoes = [];

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
        registro.execucoes += 1;
        registro.funcoes.push(func && func.name);
        if (alvo.w.id === 1) throw new Error('usou aba da janela do dono');
        if (!func || !/NaPagina$/.test(func.name)) throw new Error(`função inesperada na aba: ${func && func.name}`);
        return [{ result: { origem: 'https://www.instagram.com', ...ig.tela(func.name, args || [], alvo.t.url) } }];
      },
    },
    permissions: { async request() { return true; } },
    notifications: { create: (id, opc) => notificacoes.push({ id, ...opc, em: Date.now() }) },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    runtime: {
      getManifest: () => ({ version: '1.2.0' }),
      onInstalled: { addListener: (f) => ouvintes.installed.push(f) },
      onStartup: { addListener: (f) => ouvintes.startup.push(f) },
      onMessage: { addListener: (f) => ouvintes.message.push(f) },
    },
  };
  return { chrome, dados, alarmes, ouvintes, notificacoes, janelas, registro };
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

/**
 * Carrega o background.js com o chrome falso e devolve funções de controle. `crm` (opcional): CRM falso
 * { stopped, config, latestVersion } — com ele a extensão ganha chave e o fetch responde a /api/extensoes/*.
 */
export async function iniciarExtensao(cf, inicio, { crm = null } = {}) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: inicio });
  globalThis.chrome = cf.chrome;
  const saude = [];
  globalThis.fetch = async (url, opcoes = {}) => {
    if (!crm) throw new Error('sem rede nos testes');
    if (String(url).endsWith('/api/extensoes/estado')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, stopped: Boolean(crm.stopped), config: crm.config || {}, latestVersion: crm.latestVersion || '1.2.0', outdated: Boolean(crm.latestVersion && crm.latestVersion !== '1.2.0'), downloadUrl: 'https://crm/download' }) };
    }
    if (String(url).endsWith('/api/extensoes/saude')) {
      saude.push(JSON.parse(opcoes.body));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  if (crm) cf.dados.crm = { baseUrl: 'https://www.matheusmachadoimoveis.com.br', key: 'igs_teste' };
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
  return { mensagem, avancarAte, estado, ocioso, saude };
}
