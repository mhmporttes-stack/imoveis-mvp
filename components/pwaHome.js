// Atalhos da tela inicial além do "Painel" (pedido do dono, 2026-10-09): "Financeiro" e "Chat". O app instalado
// guarda (nesta sessão) qual é a sua casa — para voltar a ela depois do login e para o modo "só esta área"
// (sessionStorage: vale só para a janela do atalho, nunca afeta o app "Painel").
const KEY = "mm_pwa_home";
export const FINANCEIRO_HOME = "/admin/financeiro?aba=saude";
export const CHAT_HOME = "/chat-app";

// app → casa e rotas permitidas (o app nunca leva a outra área do painel).
export const MM_APPS = {
  financeiro: { home: FINANCEIRO_HOME, allowed: ["/admin/financeiro"] },
  chat: { home: CHAT_HOME, allowed: ["/admin/chat", "/chat-app"] }
};

export function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function setPwaHome(path) {
  try { window.sessionStorage.setItem(KEY, path); } catch {}
}

export function getPwaHome() {
  if (!isStandaloneApp()) return "";
  try {
    const value = window.sessionStorage.getItem(KEY) || "";
    return value.startsWith("/admin/") ? value : "";
  } catch {
    return "";
  }
}

// "financeiro" | "chat" | "" — marcado em app/layout.jsx antes da pintura, só no app instalado pelo ícone.
export function getMmApp() {
  if (typeof document === "undefined") return "";
  const app = document.documentElement.getAttribute("data-mm-app") || "";
  return MM_APPS[app] ? app : "";
}

export function isFinanceiroApp() {
  return getMmApp() === "financeiro";
}
