// Ligação da extensão com a tela "Extensões" do CRM (EXT-1, dono, 2026-10-29). Cópia IDÊNTICA em
// ferramentas/instagram-seguidor/lib/crm-link.js e ferramentas/marketplace-publicador/lib/crm-link.js (teste confere).
//
// - estado(): GET /api/extensoes/estado — "Parar tudo", configuração editada pelo dono e versão mais nova. Consultado
//   antes de cada ação (cache curto). CRM fora do ar: vale o último estado conhecido (nunca inventa "parado").
// - registrarErro / registrarSeletor / engolido: erros, partes da tela não achadas e falhas internas que antes sumiam
//   em silêncio vão para um buffer local (últimas 24 h) e seguem no sinal de saúde.
// - enviarSaude(): POST /api/extensoes/saude — sem dado de terceiros (o texto é limpo aqui e de novo no servidor).
// Só a chave pessoal da extensão vai no cabeçalho; nada de segredo no código.

export const CRM_PADRAO = 'https://www.matheusmachadoimoveis.com.br';
export const CACHE_ESTADO_MS = 10 * 1000;
export const INTERVALO_SAUDE_MS = 2 * 60 * 1000;
export const JANELA_24H_MS = 24 * 60 * 60 * 1000;
const MAX_ITENS = 30;
const CHAVE = 'crmLink';

/** Texto sem @usuário, e-mail, telefone nem link (nunca dado de terceiros no CRM). */
export function limparTexto(valor, max = 300) {
  return String(valor || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/@[A-Za-z0-9._]{1,30}/g, '@…')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[número]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function normalizarUrlCrm(valor) {
  const bruto = String(valor || '').trim() || CRM_PADRAO;
  const url = new URL(/^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('A URL do CRM precisa começar com https://');
  return url.origin;
}

const recentes = (lista, agora, campo = 'at') => (Array.isArray(lista) ? lista : []).filter((x) => x && agora - Date.parse(x[campo]) <= JANELA_24H_MS).slice(-MAX_ITENS);

/**
 * deps: { fetchImpl, ler: async () => objeto guardado, gravar: async (objeto) => void, config: async () => ({ baseUrl, key, version }), agora: () => ms }
 */
export function criarLigacaoCrm({ fetchImpl = (...a) => fetch(...a), ler, gravar, config, agora = () => Date.now() }) {
  let memoria = null;
  let fila = Promise.resolve();

  async function carregar() {
    if (!memoria) {
      const salvo = (await ler()) || {};
      memoria = { estado: null, estadoEm: 0, erros: [], seletores: [], engolidos: [], saudeEm: 0, ...salvo };
    }
    return memoria;
  }
  // Uma gravação por vez (registrar erro pode acontecer em paralelo com a consulta do estado).
  function salvar() {
    fila = fila.then(() => gravar(memoria)).catch((err) => console.warn('[crm-link] não gravou o buffer local:', err && err.message ? err.message : err));
    return fila;
  }

  async function chamar(caminho, opcoes = {}) {
    const cfg = await config();
    if (!cfg.key) return { semChave: true };
    const resp = await fetchImpl(`${normalizarUrlCrm(cfg.baseUrl)}${caminho}`, {
      ...opcoes,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', 'X-Extension-Version': String(cfg.version || '') },
    });
    const dados = await resp.json().catch(() => ({}));
    if (resp.status === 401) return { chaveInvalida: true };
    if (!resp.ok) throw new Error(dados.error || `CRM respondeu ${resp.status}`);
    return dados;
  }

  /** { stopped, config, latestVersion, outdated, downloadUrl, origem: 'crm'|'cache'|'sem_chave'|'chave_invalida', erro } */
  async function estado({ forcar = false } = {}) {
    const m = await carregar();
    const t = agora();
    if (!forcar && m.estado && t - m.estadoEm < CACHE_ESTADO_MS) return { ...m.estado, origem: 'crm' };
    try {
      const r = await chamar('/api/extensoes/estado', { method: 'GET' });
      if (r.semChave) return { stopped: false, config: null, origem: 'sem_chave' };
      if (r.chaveInvalida) return { ...(m.estado || { stopped: false, config: null }), origem: 'chave_invalida' };
      m.estado = { stopped: r.stopped === true, config: r.config || null, latestVersion: r.latestVersion || '', outdated: r.outdated === true, downloadUrl: r.downloadUrl || '' };
      m.estadoEm = t;
      await salvar();
      return { ...m.estado, origem: 'crm' };
    } catch (err) {
      // CRM fora do ar: o último estado conhecido continua valendo (inclusive "parado").
      return { ...(m.estado || { stopped: false, config: null }), origem: 'cache', erro: limparTexto(err && err.message ? err.message : err, 160) };
    }
  }

  async function registrarErro(tipo, texto) {
    const m = await carregar();
    m.erros = [...recentes(m.erros, agora()), { at: new Date(agora()).toISOString(), kind: limparTexto(tipo, 30), text: limparTexto(texto) }].slice(-MAX_ITENS);
    await salvar();
  }

  async function registrarSeletor(nome, detalhe = '') {
    const m = await carregar();
    m.seletores = [...recentes(m.seletores, agora()), { at: new Date(agora()).toISOString(), name: limparTexto(nome, 80), detail: limparTexto(detalhe, 160) }].slice(-MAX_ITENS);
    await salvar();
  }

  /** Para `.catch(engolido('contexto'))`: registra a falha (antes sumia) e devolve null. */
  function engolido(contexto) {
    return (err) => {
      carregar().then((m) => {
        const lista = recentes(m.engolidos, agora(), 'lastAt');
        const atual = lista.find((x) => x.context === contexto);
        const lastAt = new Date(agora()).toISOString();
        const lastError = limparTexto(err && err.message ? err.message : err, 160);
        if (atual) Object.assign(atual, { count: (atual.count || 0) + 1, lastAt, lastError });
        else lista.push({ context: contexto, count: 1, lastAt, lastError });
        m.engolidos = lista.slice(-MAX_ITENS);
        return salvar();
      }).catch(() => { /* o próprio registro falhou: só o console */ });
      console.warn(`[crm-link] ${contexto}:`, err && err.message ? err.message : err);
      return null;
    };
  }

  /**
   * Sinal de saúde. resumo: { ok, stage, error, today: { chave: { done, limit } }, pausedUntil, pauseReason, manualPause,
   * stoppedByCrm }. Sem `forcar`, no máximo 1 a cada INTERVALO_SAUDE_MS (rodada com erro sempre manda).
   */
  async function enviarSaude(resumo, { forcar = false } = {}) {
    const m = await carregar();
    const t = agora();
    if (!forcar && resumo.ok !== false && t - (m.saudeEm || 0) < INTERVALO_SAUDE_MS) return { enviado: false, motivo: 'intervalo' };
    const corpo = {
      ok: resumo.ok === true,
      stage: limparTexto(resumo.stage, 60),
      error: limparTexto(resumo.error),
      today: resumo.today || {},
      pausedUntil: resumo.pausedUntil || null,
      pauseReason: limparTexto(resumo.pauseReason),
      manualPause: resumo.manualPause === true,
      stoppedByCrm: resumo.stoppedByCrm === true,
      errors: recentes(m.erros, t),
      selectorFailures: recentes(m.seletores, t),
      swallowed: recentes(m.engolidos, t, 'lastAt'),
    };
    try {
      const r = await chamar('/api/extensoes/saude', { method: 'POST', body: JSON.stringify(corpo) });
      if (r.semChave || r.chaveInvalida) return { enviado: false, motivo: r.semChave ? 'sem_chave' : 'chave_invalida' };
      m.saudeEm = t;
      await salvar();
      return { enviado: true };
    } catch (err) {
      return { enviado: false, motivo: limparTexto(err && err.message ? err.message : err, 160) };
    }
  }

  async function memoriaAtual() {
    return structuredClone(await carregar());
  }

  return { estado, registrarErro, registrarSeletor, engolido, enviarSaude, memoriaAtual };
}

/** Ligação pronta para o Chrome: buffer em chrome.storage.local. */
export function criarLigacaoCrmChrome(config) {
  return criarLigacaoCrm({
    ler: async () => (await chrome.storage.local.get(CHAVE))[CHAVE] || null,
    gravar: (valor) => chrome.storage.local.set({ [CHAVE]: valor }),
    config,
  });
}
