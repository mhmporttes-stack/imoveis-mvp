// =====================================================================
// instagram-tela.js — TODO o contato com o Instagram fica aqui (1.2.0).
//
// Decisão do dono (29/10/2026, EXT-1): "a extensão só faz o que eu faria clicando". Nada de API interna do Instagram,
// nada de copiar cabeçalhos da página (app-id, csrf, claim), nenhum endpoint GraphQL/legado e nenhum cookie lido: a
// extensão abre a página na janela de trabalho e LÊ/CLICA na tela, como o dono — perfil (botão Seguir/Seguindo),
// lista de seguidores (rolando a janela "Seguidores"), pesquisa nessa lista e a conversa da DM (digitação).
// Quando a tela não permite (botão não aparece, lista não abre, aviso de limite), a extensão PARA e avisa — nunca
// insiste por outro caminho.
//
// As funções `...NaPagina` rodam DENTRO da aba (chrome.scripting): são autossuficientes (serializadas), só leem o DOM
// e clicam no que está visível. Os perfis são identificados pelo @ (o que aparece na tela), não por id interno.
// =====================================================================

import { TAMANHO_JANELA, CHAVE_JANELA, acharJanelaTrabalho, podeCriarJanela, ehUrlInstagram, descreverJanela } from './lib/janela-trabalho.js';
import { createAwakeManager } from './lib/page-awake.js';

export const BASE = 'https://www.instagram.com';

// Textos da tela (pt-BR e inglês), comparados por inteiro, sem maiúsculas/minúsculas.
export const TEXTOS_SEGUIR = ['seguir', 'follow', 'seguir de volta', 'follow back'];
export const TEXTOS_SEGUINDO = ['seguindo', 'following', 'solicitado', 'requested'];
export const TEXTOS_DEIXAR = ['deixar de seguir', 'unfollow', 'cancelar solicitação', 'cancel request'];
export const TEXTOS = {
  seguir_de_volta: ['seguir de volta', 'follow back'],
  seguir: ['seguir', 'follow'],
  seguindo: ['seguindo', 'following'],
  solicitado: ['solicitado', 'requested'],
  segueVoce: ['segue você', 'follows you'],
  privado: ['esta conta é privada', 'this account is private'],
  naoExiste: ['esta página não está disponível', 'sorry, this page isn\'t available', 'a página não está disponível', 'perfil não está disponível'],
  perfil: ['perfil', 'profile'],
  sugestoes: ['sugestões para você', 'suggested for you', 'sugestões', 'suggestions for you'],
  semResultado: ['nenhum usuário encontrado', 'no users found', 'nenhum resultado encontrado', 'no results found'],
  pesquisar: ['pesquisar', 'search'],
  // Aviso do Instagram na tela (diálogo): limite/bloqueio → pausa; "espere" → esfria 15 min.
  bloqueio: ['ação bloqueada', 'action blocked', 'restringimos determinadas atividades', 'we restrict certain activity', 'sua conta foi temporariamente bloqueada', 'temporarily blocked', 'confirme que é você', 'confirm it\'s you', 'help us confirm'],
  aguarde: ['tente novamente mais tarde', 'try again later', 'aguarde alguns minutos', 'please wait a few minutes'],
};

// 1.1.8: envio da DM por digitação na tela da conversa (desde a 1.2.0, o ÚNICO caminho da DM).
export const TEXTOS_DM = {
  mensagem: ['enviar mensagem', 'mensagem', 'message', 'send message'],
  agoraNao: ['agora não', 'not now'],
  enviar: ['enviar', 'send'],
};

/** Trecho que identifica a mensagem na conversa: a linha mais longa, com espaços normalizados (até 80 caracteres). */
export function trechoDaMensagem(texto) {
  const linhas = String(texto || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const maior = linhas.sort((a, b) => b.length - a.length)[0] || '';
  return maior.slice(0, 80);
}

export class ErroInstagram extends Error {
  constructor(tipo, mensagem, { endpoint = '', seletor = '' } = {}) {
    super(mensagem);
    this.name = 'ErroInstagram';
    // 'limite' | 'aguarde' | 'sessao' | 'nao_encontrado' | 'mudanca_api' (a tela mudou: parte não achada) |
    // 'indisponivel' (leitura sem resposta útil — não gasta perfil nem cota) | 'nao_enviada' (DM: nada saiu) |
    // 'aba' | 'sem_janela' | 'incerto' (DM: pode ter saído — nunca reenviar) | 'outro'
    this.tipo = tipo;
    this.status = 0;
    this.endpoint = endpoint; // nome da etapa da tela (para o histórico)
    this.seletor = seletor; // parte da tela que não foi achada (vai ao sinal de saúde do CRM)
  }
}

/** @ válido do Instagram (minúsculo) ou null. Aceita "@fulano", "fulano" e o link do perfil. */
export function limparUsuario(valor) {
  const limpo = String(valor || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(limpo) ? limpo : null;
}

/**
 * Leitura do botão do perfil → { seguindo, meSegue, pedidoPendente, privado, via } (ou null se não reconheceu).
 * "Seguir de volta" = a pessoa me segue e eu não; "Seguir" = não me segue. "Seguindo"/"Solicitado" não dizem se ela
 * me segue: `meSegue` só é true com o selo "Segue você"; senão fica `undefined` (nunca deduzir "não segue").
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

/** Linha da lista "Seguidores" (tela) → formato usado pelas regras (pk = @). */
export function usuarioDaLista(item) {
  const username = limparUsuario(item && item.username);
  if (!username) return null;
  const rel = item.relacao || '';
  return {
    pk: username,
    username,
    profile_pic_url: String(item.foto || ''),
    friendship_status: { following: rel === 'seguindo' || rel === 'solicitado', followed_by: rel === 'seguir_de_volta' },
  };
}

function erroDaTela(r, etapa) {
  if (r && r.bloqueio) {
    const msgs = {
      limite: `O Instagram mostrou aviso de limite/bloqueio na tela (${etapa}).`,
      aguarde: `O Instagram pediu para esperar alguns minutos (${etapa}).`,
      sessao: `O Instagram está pedindo login (${etapa}).`,
    };
    return new ErroInstagram(r.bloqueio, `${msgs[r.bloqueio] || msgs.limite}${r.aviso ? ` Aviso: "${String(r.aviso).slice(0, 160)}"` : ''}`, { endpoint: etapa });
  }
  return null;
}

/**
 * Cria a camada de tela. `executar({ caminho, func, args, acordar })` abre `BASE + caminho` na janela de trabalho (se
 * `caminho` vier e for outro endereço) e roda `func(...args)` na aba; devolve o resultado. `digitarDm({ username, texto })`
 * e `procurar({ meuUsuario, username })` fazem as etapas com teclado (nos testes, falsos).
 */
export function criarTelaInstagram({ executar, digitarDm = null, procurar = null }) {
  async function rodar(etapa, opcoes) {
    let r;
    try {
      r = await executar(opcoes);
    } catch (e) {
      if (e instanceof ErroInstagram) throw e;
      throw new ErroInstagram('aba', `Falha ao abrir ${etapa} na janela de trabalho: ${e.message || e}`, { endpoint: etapa });
    }
    const erro = erroDaTela(r, etapa);
    if (erro) throw erro;
    return r || { ok: false, erro: 'a aba não respondeu' };
  }

  async function lerPerfil(username, motivo = '') {
    // recarregar: a leitura decide o que fazer — nunca o botão de uma página aberta há horas.
    const r = await rodar(`perfil @${username}`, { caminho: `/${encodeURIComponent(username)}/`, func: lerPerfilNaPagina, args: [TEXTOS], recarregar: true });
    if (r.naoExiste) throw new ErroInstagram('nao_encontrado', `Perfil @${username} não encontrado (a página do perfil diz que não está disponível).`, { endpoint: 'perfil' });
    const st = amizadeDoBotao(r);
    if (!st) {
      throw new ErroInstagram('indisponivel', `Leitura do perfil @${username} indisponível: ${r.erro || 'botão Seguir/Seguindo não reconhecido'}${motivo ? ` — ${motivo}` : ''}.`, { endpoint: 'perfil (botão)', seletor: 'perfil: botão Seguir/Seguindo' });
    }
    return st;
  }

  async function clicarEConfirmar({ nome, username, passos, esperado }) {
    const r = await rodar(`${nome} @${username}`, { caminho: `/${encodeURIComponent(username)}/`, func: clicarPerfilNaPagina, args: [passos, TEXTOS, esperado] });
    if (!r.ok) {
      throw new ErroInstagram('mudanca_api', `Não consegui ${nome} @${username} pela tela: ${r.erro || 'botão não encontrado'}. Parei sem insistir.`, { endpoint: `botão ${nome}`, seletor: `perfil: ${r.passo || 'botão'}` });
    }
    return r;
  }

  return {
    /** Sessão vista na própria tela (sem cookies): { logado, meuUsuario }. Não navega. */
    async lerSessao() {
      const r = await rodar('sessão', { caminho: null, func: lerSessaoNaPagina, args: [TEXTOS], acordar: false });
      return { logado: r.logado !== false, meuUsuario: limparUsuario(r.meuUsuario) || null };
    },

    /** Perfil de referência: { id (= @), username, privado, sigoEsse, via }. */
    async buscarPerfil(valor) {
      const limpo = limparUsuario(valor);
      if (!limpo) throw new ErroInstagram('outro', `@${String(valor || '').replace(/^@/, '')} não parece um nome de usuário válido.`);
      const st = await lerPerfil(limpo);
      return { id: limpo, username: limpo, privado: st.privado, sigoEsse: st.seguindo || st.pedidoPendente, via: 'perfil' };
    },

    /**
     * Seguidores de @username, lidos na janela "Seguidores" (rolando, como a pessoa faz): até `quantos` perfis, na ordem
     * da tela. { usuarios, fim } — `fim` = a lista acabou antes de `quantos`.
     */
    async listaSeguidores(username, { quantos = 12 } = {}) {
      const r = await rodar(`seguidores de @${username}`, { caminho: `/${encodeURIComponent(username)}/followers/`, func: lerListaNaPagina, args: [{ quantos, textos: TEXTOS }], recarregar: true });
      if (!r.ok) {
        throw new ErroInstagram('indisponivel', `Lista de seguidores de @${username} indisponível na tela: ${r.erro || 'a janela "Seguidores" não abriu'}.`, { endpoint: 'lista de seguidores', seletor: 'lista: janela Seguidores' });
      }
      return { usuarios: (r.usuarios || []).map(usuarioDaLista).filter(Boolean), fim: Boolean(r.fim), via: 'tela' };
    },

    /**
     * Amizade com @username pelo botão do perfil. Com `meuUsuario` e o botão sem dizer se a pessoa me segue
     * ("Seguindo"/"Solicitado"), pesquisa o @ na MINHA lista de seguidores (como o dono faria). Sem como confirmar,
     * `meSegue` fica `undefined`.
     */
    async amizade(username, { meuUsuario = '' } = {}) {
      const st = await lerPerfil(username);
      if (st.meSegue !== undefined || !meuUsuario || !procurar) return st;
      let r;
      try {
        r = await procurar({ meuUsuario, username });
      } catch (e) {
        if (e instanceof ErroInstagram && ['limite', 'aguarde', 'sessao', 'sem_janela'].includes(e.tipo)) throw e;
        return { ...st, via: `${st.via}; pesquisa nos meus seguidores falhou (${e.message || e})` };
      }
      const erro = erroDaTela(r, 'pesquisa nos meus seguidores');
      if (erro) throw erro;
      if (r && r.ok && typeof r.encontrado === 'boolean') return { ...st, meSegue: r.encontrado, via: `${st.via} + pesquisa nos meus seguidores` };
      return { ...st, via: `${st.via}; pesquisa nos meus seguidores sem resposta (${(r && r.erro) || 'não deu para confirmar'})` };
    },

    /** SEGUIR: clica em "Seguir" no perfil e confere que virou "Seguindo" (ou "Solicitado", perfil privado). */
    async seguir(username) {
      const r = await clicarEConfirmar({ nome: 'seguir', username, passos: [TEXTOS_SEGUIR], esperado: ['seguindo', 'solicitado'] });
      return { seguindo: r.botaoDepois === 'seguindo', pedidoPendente: r.botaoDepois === 'solicitado', privado: r.botaoDepois === 'solicitado' || Boolean(r.privado), via: 'botão Seguir' };
    },

    /** DEIXAR DE SEGUIR / CANCELAR SOLICITAÇÃO: "Seguindo"/"Solicitado" → "Deixar de seguir"; confere que voltou a "Seguir". */
    async deixarDeSeguir(username) {
      const r = await clicarEConfirmar({ nome: 'deixar de seguir', username, passos: [TEXTOS_SEGUINDO, TEXTOS_DEIXAR], esperado: ['seguir', 'seguir_de_volta'] });
      return { seguindo: false, pedidoPendente: false, meSegue: r.botaoDepois === 'seguir_de_volta', via: 'botão Seguindo → Deixar de seguir' };
    },

    /**
     * DM por digitação na tela da conversa (perfil → Enviar mensagem → digita → Enter). Antes do Enter nada saiu
     * ('nao_enviada': pode tentar de novo); Enter sem a mensagem aparecer = 'incerto' (nunca reenviar).
     */
    async enviarDm(username, texto) {
      if (!digitarDm || !username) throw new ErroInstagram('nao_enviada', 'DM não enviada: sem o @ da pessoa para abrir a conversa.', { endpoint: 'digitação na DM' });
      let r;
      try {
        r = await digitarDm({ username, texto });
      } catch (err) {
        if (err instanceof ErroInstagram && err.tipo === 'sem_janela') throw err;
        const x = new ErroInstagram('incerto', `DM por digitação interrompida (${err.message || err}) — não será repetida; confira a conversa no Instagram.`, { endpoint: 'digitação na DM' });
        x.digitacao = true;
        throw x;
      }
      const erro = erroDaTela(r, 'conversa da DM');
      if (erro && !r.apertouEnter) throw erro;
      if (r && r.jaEstava) return { modo: 'digitação — a mensagem já estava na conversa (nada digitado)', digitacao: true };
      if (r && r.ok && r.confirmado) return { modo: 'digitação na tela da DM', digitacao: true };
      const motivo = (r && r.erro) || 'sem resposta da aba';
      const x = r && r.apertouEnter
        ? new ErroInstagram('incerto', `DM digitada e Enter apertado, mas a mensagem não apareceu na conversa (${motivo}) — não será repetida; confira no Instagram.`, { endpoint: 'digitação na DM' })
        : new ErroInstagram('nao_enviada', `DM não enviada: a digitação não chegou a enviar (${motivo}).`, { endpoint: 'digitação na DM', seletor: r && r.seletor ? `DM: ${r.seletor}` : '' });
      x.digitacao = true;
      throw x;
    },
  };
}

// ---------------------------------------------------------------------
// Funções que rodam NA PÁGINA (autossuficientes).
// ---------------------------------------------------------------------

/** NA PÁGINA, sem navegar: está logado? qual o meu @ (link "Perfil" do menu)? Aviso de limite na tela? */
export async function lerSessaoNaPagina(textos) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const avisos = norm([...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="alert"]')].map((d) => d.innerText || '').join(' '));
  const login = location.pathname.startsWith('/accounts/login') || Boolean(document.querySelector('input[name="password"]'));
  let bloqueio = '';
  if (/\/challenge\//.test(location.pathname) || textos.bloqueio.some((x) => avisos.includes(x))) bloqueio = 'limite';
  else if (textos.aguarde.some((x) => avisos.includes(x))) bloqueio = 'aguarde';
  // Meu @: o link "Perfil" do menu do Instagram (com texto; na janela estreita, o menu só tem ícones — aí o link do menu
  // com a minha foto). Só dentro do menu (nav), nunca um perfil qualquer da página.
  let meuUsuario = '';
  const menus = [...document.querySelectorAll('nav, [role="navigation"]')];
  const doMenu = menus.flatMap((n) => [...n.querySelectorAll('a[href^="/"]')]);
  const unico = (a) => (String(a.getAttribute('href') || '').match(/^\/([A-Za-z0-9._]{1,30})\/?$/) || [])[1] || '';
  const reservados = ['explore', 'reels', 'direct', 'accounts', 'stories'];
  const comRotulo = doMenu.find((a) => unico(a) && textos.perfil.some((p) => { const r = norm(a.innerText || a.getAttribute('aria-label') || ''); return r === p || r.endsWith(` ${p}`); }));
  const comFoto = doMenu.find((a) => unico(a) && !reservados.includes(unico(a).toLowerCase()) && a.querySelector('img'));
  meuUsuario = unico(comRotulo || comFoto || document.createElement('a'));
  return { ok: true, logado: !login, meuUsuario, bloqueio, aviso: bloqueio ? avisos.slice(0, 200) : '', origem: location.origin };
}

/**
 * NA PÁGINA do perfil, SEM clicar: espera (até 8 s) o botão principal do perfil e devolve
 * { ok, botao: 'seguir'|'seguir_de_volta'|'seguindo'|'solicitado', segueVoce, privado } — ou naoExiste/bloqueio.
 * Procura no <header> do perfil (as sugestões "Seguir" da página ficam fora dele). Texto exato, só botões visíveis.
 */
export async function lerPerfilNaPagina(textos) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const avisoNaTela = () => {
    if (location.pathname.startsWith('/accounts/login') || document.querySelector('input[name="password"]')) return { bloqueio: 'sessao', aviso: '' };
    if (/\/challenge\//.test(location.pathname)) return { bloqueio: 'limite', aviso: 'challenge' };
    const t = norm([...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="alert"]')].map((d) => d.innerText || '').join(' '));
    if (textos.bloqueio.some((x) => t.includes(x))) return { bloqueio: 'limite', aviso: t.slice(0, 200) };
    if (textos.aguarde.some((x) => t.includes(x))) return { bloqueio: 'aguarde', aviso: t.slice(0, 200) };
    return null;
  };
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
    const aviso = avisoNaTela();
    if (aviso) return { ok: false, ...aviso, origem: location.origin };
    botao = achar();
    if (!botao) {
      if (textos.naoExiste.some((x) => norm(document.body ? document.body.innerText : '').includes(x))) return { ok: false, naoExiste: true, origem: location.origin };
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!botao) return { ok: false, erro: 'botão Seguir/Seguindo não apareceu', origem: location.origin };
  const cab = norm((document.querySelector('header') || {}).innerText || '');
  const corpo = norm(document.body ? document.body.innerText : '');
  return { ok: true, botao, segueVoce: textos.segueVoce.some((x) => cab.includes(x)), privado: textos.privado.some((x) => corpo.includes(x)), origem: location.origin };
}

/**
 * NA PÁGINA do perfil: clica nos botões em sequência (o 1º no <header>; os seguintes onde aparecerem — o menu
 * "Deixar de seguir" abre num diálogo) e espera (até 8 s) o botão do perfil virar um dos `esperado`.
 * Devolve { ok, botaoDepois, privado } | { ok:false, erro, passo } | { bloqueio }.
 */
export async function clicarPerfilNaPagina(passos, textos, esperado) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const avisoNaTela = () => {
    if (location.pathname.startsWith('/accounts/login') || document.querySelector('input[name="password"]')) return { bloqueio: 'sessao', aviso: '' };
    if (/\/challenge\//.test(location.pathname)) return { bloqueio: 'limite', aviso: 'challenge' };
    const t = norm([...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="alert"]')].map((d) => d.innerText || '').join(' '));
    if (textos.bloqueio.some((x) => t.includes(x))) return { bloqueio: 'limite', aviso: t.slice(0, 200) };
    if (textos.aguarde.some((x) => t.includes(x))) return { bloqueio: 'aguarde', aviso: t.slice(0, 200) };
    return null;
  };
  const ordem = ['seguir_de_volta', 'seguindo', 'solicitado', 'seguir'];
  const botaoDoPerfil = () => {
    const raiz = document.querySelector('header') || document;
    for (const el of raiz.querySelectorAll('button, div[role="button"]')) {
      if (!visivel(el)) continue;
      const t = norm(el.innerText || el.textContent);
      const tipo = ordem.find((k) => textos[k].includes(t));
      if (tipo) return { el, tipo };
    }
    return null;
  };
  for (let i = 0; i < passos.length; i += 1) {
    const raiz = i === 0 ? document.querySelector('header') || document : document;
    let alvo = null;
    for (let t = 0; t < 32 && !alvo; t += 1) {
      const aviso = avisoNaTela();
      if (aviso) return { ok: false, ...aviso };
      alvo = [...raiz.querySelectorAll('button, div[role="button"]')].find((el) => visivel(el) && passos[i].includes(norm(el.innerText || el.textContent)));
      if (!alvo) await esperar(250);
    }
    if (!alvo) return { ok: false, erro: `botão "${passos[i][0]}" não apareceu (passo ${i + 1})`, passo: `botão "${passos[i][0]}"` };
    alvo.click();
    await esperar(900 + Math.random() * 600);
  }
  for (let t = 0; t < 32; t += 1) {
    const aviso = avisoNaTela();
    if (aviso) return { ok: false, ...aviso };
    const b = botaoDoPerfil();
    if (b && esperado.includes(b.tipo)) return { ok: true, botaoDepois: b.tipo, privado: textos.privado.some((x) => norm(document.body.innerText).includes(x)) };
    await esperar(250);
  }
  const b = botaoDoPerfil();
  return { ok: false, erro: `depois do clique o botão ficou "${b ? b.tipo : 'nenhum'}" (esperado: ${esperado.join(' ou ')})`, passo: 'confirmação do botão' };
}

/**
 * NA PÁGINA /@/followers/: a janela "Seguidores" (abre pelo endereço; se não abrir, clica no link "seguidores" do
 * perfil). Lê os @ na ordem da tela, rolando a lista devagar, até `quantos` ou o fim. Ignora "Sugestões para você".
 * Cada item: { username, foto, relacao: botão da linha (seguir / seguir_de_volta / seguindo / solicitado / '') }.
 */
export async function lerListaNaPagina({ quantos, textos }) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const avisoNaTela = () => {
    if (location.pathname.startsWith('/accounts/login') || document.querySelector('input[name="password"]')) return { bloqueio: 'sessao', aviso: '' };
    if (/\/challenge\//.test(location.pathname)) return { bloqueio: 'limite', aviso: 'challenge' };
    const t = norm([...document.querySelectorAll('[role="alertdialog"], [role="alert"]')].map((d) => d.innerText || '').join(' '));
    if (textos.bloqueio.some((x) => t.includes(x))) return { bloqueio: 'limite', aviso: t.slice(0, 200) };
    if (textos.aguarde.some((x) => t.includes(x))) return { bloqueio: 'aguarde', aviso: t.slice(0, 200) };
    return null;
  };
  const reservados = new Set(['explore', 'accounts', 'reels', 'reel', 'direct', 'p', 'stories', 'about', 'legal', 'privacy', 'web', 'tv']);
  const dono = (location.pathname.match(/^\/([^/]+)\//) || [])[1] || '';
  const dialogo = () => [...document.querySelectorAll('div[role="dialog"]')].filter(visivel).find((d) => d.querySelector('a[href^="/"] img, a[href^="/"]'));
  let dlg = null;
  for (let t = 0; t < 40 && !dlg; t += 1) {
    const aviso = avisoNaTela();
    if (aviso) return { ok: false, ...aviso };
    dlg = dialogo();
    if (!dlg && t === 16) {
      const link = [...document.querySelectorAll('a[href$="/followers/"]')].find(visivel);
      if (link) link.click(); // como a pessoa: clica em "seguidores" no perfil
    }
    if (!dlg) await esperar(250);
  }
  if (!dlg) return { ok: false, erro: 'a janela "Seguidores" não abriu (perfil privado, sem seguidores visíveis ou tela mudou)' };
  const caixa = [dlg, ...dlg.querySelectorAll('div')].filter((el) => el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || dlg;
  const relacaoDe = (a) => {
    let el = a;
    for (let i = 0; i < 7 && el && el !== dlg; i += 1) {
      el = el.parentElement;
      const b = el && [...el.querySelectorAll('button, div[role="button"]')].map((x) => norm(x.innerText || x.textContent)).find(Boolean);
      if (b) return ['seguir_de_volta', 'seguindo', 'solicitado', 'seguir'].find((k) => textos[k].includes(b)) || '';
    }
    return '';
  };
  const ler = () => {
    const corte = [...dlg.querySelectorAll('h1, h2, h3, h4, span, div')].find((el) => el.children.length === 0 && textos.sugestoes.includes(norm(el.textContent)));
    const vistos = new Map();
    for (const a of dlg.querySelectorAll('a[href^="/"]')) {
      if (corte && (corte.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const m = String(a.getAttribute('href') || '').match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
      if (!m || reservados.has(m[1].toLowerCase()) || m[1].toLowerCase() === dono.toLowerCase()) continue;
      const u = m[1].toLowerCase();
      if (vistos.has(u)) continue;
      const img = a.querySelector('img') || (a.parentElement && a.parentElement.querySelector('img'));
      vistos.set(u, { username: u, foto: img ? img.getAttribute('src') || '' : '', relacao: relacaoDe(a) });
    }
    return [...vistos.values()];
  };
  let lidos = ler();
  let parados = 0;
  for (let volta = 0; volta < 80 && lidos.length < quantos && parados < 4; volta += 1) {
    const antes = lidos.length;
    caixa.scrollTop += Math.max(200, caixa.clientHeight * 0.85);
    await esperar(900 + Math.random() * 700);
    const aviso = avisoNaTela();
    if (aviso) return { ok: false, ...aviso };
    lidos = ler();
    parados = lidos.length > antes ? 0 : parados + 1;
  }
  return { ok: true, usuarios: lidos.slice(0, quantos), fim: lidos.length < quantos, origem: location.origin };
}

/** NA PÁGINA da janela "Seguidores": foca a caixa "Pesquisar" e devolve os @ que a lista mostra antes de pesquisar. */
export async function focarPesquisaNaPagina(textos) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  let dlg = null;
  for (let t = 0; t < 40 && !dlg; t += 1) {
    dlg = [...document.querySelectorAll('div[role="dialog"]')].filter(visivel).find((d) => d.querySelector('input'));
    if (!dlg && t === 16) {
      const link = [...document.querySelectorAll('a[href$="/followers/"]')].find(visivel);
      if (link) link.click();
    }
    if (!dlg) await esperar(250);
  }
  if (!dlg) return { ok: false, erro: 'a janela "Seguidores" não abriu' };
  const campo = [...dlg.querySelectorAll('input')].find((el) => visivel(el) && (textos.pesquisar.includes(norm(el.getAttribute('placeholder'))) || textos.pesquisar.includes(norm(el.getAttribute('aria-label'))))) || [...dlg.querySelectorAll('input[type="text"], input:not([type])')].find(visivel);
  if (!campo) return { ok: false, erro: 'a caixa "Pesquisar" da lista não apareceu' };
  campo.focus();
  if (campo.value) { campo.select(); document.execCommand('delete'); }
  const antes = [...dlg.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')).join('|');
  return { ok: true, antes };
}

/** NA PÁGINA: digita na caixa "Pesquisar" já focada (sem o depurador). */
export async function escreverPesquisaNaPagina(texto) {
  const campo = document.activeElement;
  if (!campo || campo.tagName !== 'INPUT') return { ok: false, erro: 'a caixa "Pesquisar" perdeu o foco' };
  document.execCommand('insertText', false, texto);
  return { ok: true };
}

/**
 * NA PÁGINA, depois de digitar: espera (até ~8 s) o resultado. encontrado = o @ aparece na lista; false só quando a
 * tela mostra "nenhum usuário encontrado" ou a lista mudou e não tem o @. Sem mudança visível = sem resposta (ok:false).
 */
export async function resultadoPesquisaNaPagina(username, antes, textos) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const alvo = `/${String(username).toLowerCase()}/`;
  for (let t = 0; t < 32; t += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const dlg = [...document.querySelectorAll('div[role="dialog"]')].filter(visivel).find((d) => d.querySelector('input'));
    if (!dlg) return { ok: false, erro: 'a janela "Seguidores" fechou' };
    const links = [...dlg.querySelectorAll('a[href^="/"]')].map((a) => String(a.getAttribute('href') || '').toLowerCase());
    if (links.includes(alvo)) return { ok: true, encontrado: true };
    if (textos.semResultado.some((x) => norm(dlg.innerText).includes(x))) return { ok: true, encontrado: false };
    if (t >= 12 && links.join('|') !== String(antes || '').toLowerCase()) return { ok: true, encontrado: false };
  }
  return { ok: false, erro: 'a pesquisa não mostrou resultado' };
}

// ---------------------------------------------------------------------
// Parte específica do Chrome: janela de trabalho + execução na aba.
// ---------------------------------------------------------------------

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


// --- Página acordada (1.1.6) ------------------------------------------------------------------------------------
// Problema real (dono, 25/10/2026): "abro outra janela para utilizar, em tela cheia; as duas abas das extensões ficam
// abertas atrás dessa." Coberta, a aba de trabalho fica OCULTA para o Chrome: ele para de desenhar o perfil e segura os
// timers da página (a espera de 250 ms pelo botão vira até 1 min por volta) — a leitura do botão e os cliques do perfil
// demoram ou falham. Durante cada leitura/clique na tela (1.2.0: perfil, lista de seguidores, pesquisa e DM) a extensão liga o
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


// --- DM por digitação (1.1.8) ------------------------------------------------------------------------------------
// Decisão do dono (26/10/2026, ciente do risco; desde a 1.2.0 é o ÚNICO caminho da DM): a boas-vindas é digitada
// na tela da conversa, como uma pessoa: abre o perfil na janela de trabalho (sem foco, página acordada pelo depurador
// da 1.1.6), clica em "Enviar mensagem", digita e aperta Enter. Só conta como enviada se a mensagem APARECER na
// conversa; Enter apertado sem confirmação = incerto (nunca reenvia). Antes do Enter, qualquer falha = nada saiu.
// As funções `...NaPagina` rodam DENTRO da aba (chrome.scripting, mundo MAIN): não usam nada de fora delas.

/** NA PÁGINA do perfil: clica em "Enviar mensagem" e espera a caixa de texto da conversa (até ~15 s). */
export async function abrirConversaNaPagina(textos) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const botoes = (raiz, lista) => [...raiz.querySelectorAll('button, div[role="button"], a[role="button"]')].find((el) => visivel(el) && lista.includes(norm(el.innerText || el.textContent)));
  const caixa = () => [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
  let botao = null;
  for (let t = 0; t < 32 && !botao; t += 1) {
    botao = botoes(document.querySelector('header') || document, textos.mensagem) || botoes(document.querySelector('main') || document, textos.mensagem);
    if (!botao) await esperar(250);
  }
  if (!botao) return { ok: false, erro: 'botão "Enviar mensagem" não apareceu no perfil', origem: location.origin };
  botao.click();
  for (let t = 0; t < 60; t += 1) {
    await esperar(250);
    const agoraNao = botoes(document, textos.agoraNao); // "Ativar notificações?" → Agora não
    if (agoraNao) agoraNao.click();
    if (caixa()) return { ok: true, caminho: location.pathname, origem: location.origin };
  }
  return { ok: false, erro: 'a caixa de mensagem da conversa não apareceu', origem: location.origin };
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

/** NA PÁGINA: digita um pedaço de texto (`quebra`: quebra de linha) na caixa já focada. Sem atraso (página oculta). */
export async function escreverNaPagina(partes) {
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const caixa = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
  if (!caixa) return { ok: false, erro: 'caixa de mensagem sumiu' };
  caixa.focus();
  for (const p of partes) {
    if (p.quebra) { if (caixa.tagName === 'TEXTAREA') document.execCommand('insertText', false, '\n'); else document.execCommand('insertLineBreak'); }
    else if (p.texto) document.execCommand('insertText', false, p.texto);
  }
  return { ok: true };
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
 * NA PÁGINA, depois do Enter: espera (até ~12 s) a mensagem aparecer na conversa (mais ocorrências do trecho que
 * antes, fora da caixa). Se a caixa continua com a mensagem inteira depois de ~3 s (o Enter não enviou), clica UMA
 * vez no botão "Enviar".
 */
export async function confirmarDmNaPagina(trecho, antes, textos) {
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const conta = (texto, alvo) => { let n = 0; let i = texto.indexOf(alvo); while (alvo && i !== -1) { n += 1; i = texto.indexOf(alvo, i + alvo.length); } return n; };
  const alvo = norm(trecho);
  let clicou = false;
  for (let t = 0; t < 48; t += 1) {
    await esperar(250);
    const caixa = [...document.querySelectorAll('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label], textarea')].filter(visivel).pop();
    const naCaixa = caixa ? conta(norm(caixa.value ?? caixa.innerText), alvo) : 0;
    const naConversa = conta(norm(document.body.innerText), alvo) - naCaixa;
    if (naConversa > antes && !naCaixa) return { ok: true, confirmado: true, clicouEnviar: clicou };
    if (!clicou && t >= 12 && naCaixa) {
      const enviar = [...document.querySelectorAll('button, div[role="button"]')].find((el) => visivel(el) && textos.enviar.includes(norm(el.innerText || el.textContent || el.getAttribute('aria-label'))));
      if (enviar) { enviar.click(); clicou = true; }
    }
  }
  return { ok: false, confirmado: false, erro: 'a mensagem não apareceu na conversa em 12 s' };
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

/**
 * Executor real da DM (1.2.0: o único caminho). Devolve { ok, confirmado, jaEstava, apertouEnter, erro } (nunca lança, exceto
 * 'sem_janela'). Com o depurador ligado, digita palavra por palavra (Input.insertText, eventos de teclado reais) e
 * aperta Enter; sem ele, digita pela própria página. Quebra de linha sempre pela página (insertLineBreak) — um Enter
 * de verdade no meio do texto enviaria a mensagem pela metade.
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
      const partes = partesDaDigitacao(texto);
      const comDepurador = info.attached && paginaAcordada.isAttached(tabId);
      if (comDepurador) {
        for (const p of partes) {
          if (p.quebra) {
            // 1.1.11: quebra de linha = Shift+Enter real (como a pessoa faz). O execCommand('insertLineBreak') no editor
            // da DM apagava as linhas anteriores (print do dono: só "Conte comigo! 😊" ficou na caixa).
            await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...TECLA_ENTER, modifiers: 8 });
            await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...TECLA_ENTER, modifiers: 8 });
          } else await cdp(tabId, 'Input.insertText', { text: p.texto });
          await pausa(60, 220);
        }
      } else {
        const w = await exec(escreverNaPagina, [partes]);
        if (!w.ok) return { ok: false, apertouEnter, erro: w.erro };
      }
      const conferida = await exec(conferirCaixaNaPagina, [texto]);
      if (!conferida.ok) return { ok: false, apertouEnter, erro: conferida.erro };
      await pausa(700, 1800);
      apertouEnter = true; // a partir daqui a mensagem pode ter saído: nunca mais "não enviada"
      if (comDepurador) {
        await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...TECLA_ENTER, text: '\r', unmodifiedText: '\r' });
        await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...TECLA_ENTER });
      } else {
        await exec(apertarEnterNaPagina, []);
      }
      const conf = await exec(confirmarDmNaPagina, [trecho, caixa.contagem, TEXTOS_DM]);
      return { ok: Boolean(conf.confirmado), confirmado: Boolean(conf.confirmado), apertouEnter, erro: conf.erro, viaDepurador: comDepurador };
    } catch (err) {
      return { ok: false, apertouEnter, erro: err && err.message ? err.message : String(err) };
    }
  });
}


// --- Execução na aba (1.2.0) -----------------------------------------------------------------------------------------
const sem = (url) => String(url || '').replace(/[?#].*$/, '');

/**
 * Executor real: abre `BASE + caminho` na janela de trabalho (se a aba estiver em outro endereço ou com `recarregar` —
 * leituras que decidem algo sempre carregam a página de novo) e roda `func(...args)` na aba. `acordar` (padrão): com a página acordada pelo depurador (lib/page-awake.js), para
 * a tela desenhar e reagir mesmo com a janela atrás de outra; a leitura da sessão não precisa (sem faixa a cada rodada).
 */
export async function executarNaAba({ caminho = null, func, args = [], acordar = true, recarregar = false }) {
  const tabId = await garantirAbaInstagram();
  const rodar = async () => {
    if (caminho) {
      const aba = await chrome.tabs.get(tabId);
      if (recarregar || sem(aba.url) !== `${BASE}${caminho}`) {
        await chrome.tabs.update(tabId, { url: `${BASE}${caminho}` });
        await new Promise((r) => setTimeout(r, 400));
        await esperarCarregar(tabId);
      }
    }
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
    const r = (res && res.result) || { ok: false, erro: 'a aba não respondeu' };
    if (r.origem && r.origem !== BASE) throw new ErroInstagram('aba', `A aba de trabalho não está em ${BASE} (está em ${r.origem}).`);
    return r;
  };
  return acordar ? paginaAcordada.run(tabId, rodar) : rodar();
}

/**
 * Pesquisa o @ na MINHA lista de seguidores (como o dono faria para saber se a pessoa o segue): abre a janela
 * "Seguidores" do meu perfil, foca "Pesquisar", digita (teclado real com o depurador; sem ele, pela página) e lê o
 * resultado. Devolve { ok, encontrado } | { ok:false, erro } | { bloqueio }.
 */
export async function procurarNaListaNaAba({ meuUsuario, username }) {
  const tabId = await garantirAbaInstagram();
  const exec = async (func, args) => {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
    return (res && res.result) || { ok: false, erro: 'a aba não respondeu' };
  };
  return paginaAcordada.run(tabId, async (info) => {
    // Sempre carrega a lista de novo (uma lista aberta antes não mostra quem começou a seguir depois).
    await chrome.tabs.update(tabId, { url: `${BASE}/${encodeURIComponent(meuUsuario)}/followers/` });
    await new Promise((r) => setTimeout(r, 400));
    await esperarCarregar(tabId);
    const foco = await exec(focarPesquisaNaPagina, [TEXTOS]);
    if (!foco.ok) return foco;
    await new Promise((r) => setTimeout(r, 500 + Math.round(Math.random() * 700)));
    if (info.attached && paginaAcordada.isAttached(tabId)) {
      for (const letra of String(username)) {
        await cdp(tabId, 'Input.insertText', { text: letra });
        await new Promise((r) => setTimeout(r, 70 + Math.round(Math.random() * 150)));
      }
    } else {
      const w = await exec(escreverPesquisaNaPagina, [String(username)]);
      if (!w.ok) return w;
    }
    return exec(resultadoPesquisaNaPagina, [username, foco.antes, TEXTOS]);
  });
}

/** Camada de tela pronta para uso dentro da extensão. */
export function criarTelaChrome() {
  return criarTelaInstagram({ executar: executarNaAba, digitarDm: digitarDmNaAba, procurar: procurarNaListaNaAba });
}
