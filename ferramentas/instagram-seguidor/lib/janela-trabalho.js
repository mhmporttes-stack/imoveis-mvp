// Janela de trabalho (1.1.0, pedido do dono em 2026-10-23: "deixar ela sem me atrapalhar
// igual a extensão do Marketplace"). Lógica pura (testada em tests/janela-trabalho.test.mjs);
// as chamadas ao Chrome ficam em instagram-api.js. Uma janela PEQUENA só da extensão, com
// UMA aba do instagram.com reutilizada sempre — nunca aba na janela em que o dono trabalha,
// nunca foco (nasce com focused:false; só vem para a frente pelo botão do popup).

export const TAMANHO_JANELA = { width: 520, height: 760 };
export const CHAVE_JANELA = 'janelaTrabalho';

export function ehUrlInstagram(url) {
  return /^https:\/\/www\.instagram\.com\//.test(String(url || ''));
}

/**
 * windows: chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
 * guardada: { windowId, tabId } de chrome.storage.local.
 * 1) a guardada, se a janela e a aba ainda existem juntas;
 * 2) depois de reiniciar o Chrome (ids mudam): janela normal, estreita (até 700 px), com UMA
 *    aba só, no instagram.com — o formato que só a janela de trabalho tem.
 * Senão, null (quem chama cria outra, se houver alguma janela do Chrome aberta).
 */
export function acharJanelaTrabalho(janelas = [], guardada = null) {
  const mantida = janelas.find((w) => w.id === guardada?.windowId && (w.tabs || []).some((t) => t.id === guardada?.tabId));
  if (mantida) return { windowId: mantida.id, tabId: guardada.tabId, como: 'guardada' };
  const recuperada = janelas.find((w) => (w.type || 'normal') === 'normal'
    && (w.tabs || []).length === 1
    && ehUrlInstagram(w.tabs[0].url || w.tabs[0].pendingUrl)
    && Number(w.width || 0) > 0 && Number(w.width) <= 700);
  if (recuperada) return { windowId: recuperada.id, tabId: recuperada.tabs[0].id, como: 'recuperada' };
  return null;
}

/** Pode criar a janela de trabalho? Só se o Chrome já tiver alguma janela normal aberta. */
export function podeCriarJanela(janelas = []) {
  return janelas.some((w) => (w.type || 'normal') === 'normal');
}

/** Texto do popup sobre a janela de trabalho. */
export function descreverJanela(v) {
  if (!v || !v.existe) return { ok: false, texto: 'Fechada — reabre sozinha (sem foco) na próxima ação, ou toque em "Abrir janela de trabalho".' };
  if (v.estado === 'minimized') return { ok: true, texto: 'Aberta (minimizada). Pode deixar assim.' };
  return { ok: true, texto: 'Aberta — pode ficar atrás das outras janelas.' };
}
