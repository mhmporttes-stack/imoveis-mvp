// Janela de trabalho (1.9.4, pedido do dono em 2026-10-22: "ela fica a todo momento abrindo novas guias; às vezes estou
// numa página e ela abre outra"). Lógica pura (testada em tests/work-window.test.js); as chamadas ao Chrome ficam em
// background.js. Uma janela pequena só da extensão, com UMA aba do Facebook reutilizada em toda rodada do chat, no
// diagnóstico, na publicação e no "manter acordado" — nunca aba nova na janela em que o dono trabalha, nunca foco.

export const WORK_WINDOW_SIZE = { width: 520, height: 760 };

export function isFacebookUrl(url) {
  return /^https:\/\/(www|web|m)\.facebook\.com\//.test(String(url || ""));
}

// windows: chrome.windows.getAll({ populate: true }); stored: { windowId, tabId } guardado em chrome.storage.local.
// 1) a guardada, se a janela e a aba ainda existem juntas;
// 2) depois de reiniciar o Chrome (ids mudam, a janela pode ter sido restaurada): janela normal, estreita (até 700 px)
//    com UMA aba só, no Facebook — o formato que só a janela de trabalho tem. Senão, null (o background cria outra).
export function findWorkWindow(windows = [], stored = null) {
  const kept = windows.find((win) => win.id === stored?.windowId && (win.tabs || []).some((tab) => tab.id === stored?.tabId));
  if (kept) return { windowId: kept.id, tabId: stored.tabId, how: "guardada" };
  const restored = windows.find((win) => (win.type || "normal") === "normal" && (win.tabs || []).length === 1 && isFacebookUrl(win.tabs[0].url || win.tabs[0].pendingUrl) && Number(win.width || 0) > 0 && Number(win.width) <= 700);
  if (restored) return { windowId: restored.id, tabId: restored.tabs[0].id, how: "recuperada" };
  return null;
}

// Texto do popup sobre a janela de trabalho (visibilidade lida na própria página do Facebook).
export function describeWorkView(view) {
  if (!view?.exists) return { ok: false, text: "Janela de trabalho fechada — toque em \"Abrir janela de trabalho\" (ou ela reabre sozinha na próxima rodada)." };
  if (view.windowState === "minimized") return { ok: false, text: "Janela de trabalho MINIMIZADA: o Facebook pode não abrir conversa assim. Deixe-a aberta (pode ficar atrás de outras janelas, inclusive em tela cheia)." };
  if (view.visibility === "visible") return { ok: true, text: "Janela de trabalho visível — a extensão consegue trabalhar agora." };
  // 1.9.8: atrás de outra janela (inclusive tela cheia) a extensão acorda a página durante cada ação (emulação de foco
  // pelo depurador, lib/page-awake.js) — não precisa mais do atalho do Chrome.
  if (view.visibility === "hidden") return { ok: true, text: "Janela de trabalho atrás de outra janela — tudo bem: a extensão acorda a página durante cada ação (pode aparecer a faixa \"…começou a depurar este navegador\" por alguns segundos)." };
  return { ok: false, text: "Não consegui ler a janela de trabalho agora (página carregando)." };
}
