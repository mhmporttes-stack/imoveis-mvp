// Atalho "Financeiro" na tela inicial: o app instalado guarda (nesta sessão) para onde voltar depois do login
// (sessionStorage: vale só para a janela do atalho, nunca afeta o app "Painel").
const KEY = "mm_pwa_home";
export const FINANCEIRO_HOME = "/admin/financeiro?aba=saude";

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
