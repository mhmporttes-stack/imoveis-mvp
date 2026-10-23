// Modo escuro do painel (pedido do dono, 2026-10-16: "deixar o app mais confortável para os corretores").
// Só apresentação: preferência POR APARELHO (localStorage), nunca no servidor. Vale para o painel (/admin),
// o app "Chat" (/chat-app) e a vitrine de desenvolvimento (/dev); o site público nunca escurece.
// Cores escuras: app/admin-theme.css (componentes) e app/admin-theme-auto.css (gerado por
// .claude/design/tools/gerar-tema-escuro.mjs — tokens, paletas e classes de cor fixa).

export const ADMIN_THEME_STORAGE_KEY = "mm-admin-theme";
export const ADMIN_THEME_DARK_CLASS = "mm-dark";
export const ADMIN_THEME_EVENT = "mm-admin-theme-change";
// Visual novo do painel (dono, 2026-10-22): html.mm-panel liga os tokens do painel (paleta clara nova, raios
// 12/16/18px — app/admin-theme.css) só nas rotas do painel; o site público nunca recebe a classe.
export const ADMIN_PANEL_CLASS = "mm-panel";
// Cor da barra do sistema (PWA): a do modo claro é a mesma de app/layout.jsx (viewport.themeColor).
export const ADMIN_THEME_COLORS = { light: "#031D3A", dark: "#07111F" };

export function isThemedPath(pathname = "") {
  return /^\/(admin|chat-app|dev)(\/|$)/.test(pathname || "");
}

// Largura do painel (dono, 2026-10-22: "quero a opção de expandir para os limites da tela ou deixar padrão"):
// html.mm-wide tira o limite de largura do conteúdo (app/admin-theme.css). Preferência por aparelho, como o tema.
export const ADMIN_WIDE_STORAGE_KEY = "mm-admin-wide";
export const ADMIN_WIDE_CLASS = "mm-wide";
export const ADMIN_WIDE_EVENT = "mm-admin-wide-change";

// Roda antes da pintura (app/layout.jsx): sem isso a tela piscaria branca ao abrir o app no escuro.
export const ADMIN_THEME_BOOT_SCRIPT = `try{if(/^\\/(admin|chat-app|dev)(\\/|$)/.test(location.pathname))document.documentElement.classList.add("${ADMIN_PANEL_CLASS}");if(localStorage.getItem("${ADMIN_WIDE_STORAGE_KEY}")==="1")document.documentElement.classList.add("${ADMIN_WIDE_CLASS}");if(/^\\/(admin|chat-app|dev)(\\/|$)/.test(location.pathname)&&localStorage.getItem("${ADMIN_THEME_STORAGE_KEY}")==="dark"){document.documentElement.classList.add("${ADMIN_THEME_DARK_CLASS}");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","${ADMIN_THEME_COLORS.dark}")}}catch(e){}`;

export function readStoredAdminTheme() {
  try {
    return window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

// Aplica (ou tira) o escuro no <html>. Desliga as transições por um quadro para a troca não "escorrer"
// em cada botão com `transition`.
export function applyAdminTheme(theme, pathname = typeof window === "undefined" ? "" : window.location.pathname) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const panel = isThemedPath(pathname);
  root.classList.toggle(ADMIN_PANEL_CLASS, panel);
  const dark = theme === "dark" && panel;
  if (root.classList.contains(ADMIN_THEME_DARK_CLASS) === dark) return;
  root.classList.add("mm-theme-switching");
  root.classList.toggle(ADMIN_THEME_DARK_CLASS, dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? ADMIN_THEME_COLORS.dark : ADMIN_THEME_COLORS.light);
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => root.classList.remove("mm-theme-switching")));
}

export function setAdminTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  try {
    if (next === "dark") window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, "dark");
    else window.localStorage.removeItem(ADMIN_THEME_STORAGE_KEY);
  } catch {
    // Safari privado / armazenamento bloqueado: vale só até recarregar.
  }
  applyAdminTheme(next);
  window.dispatchEvent(new CustomEvent(ADMIN_THEME_EVENT, { detail: next }));
}

export function readStoredAdminWide() {
  try {
    return window.localStorage.getItem(ADMIN_WIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAdminWide(wide) {
  try {
    if (wide) window.localStorage.setItem(ADMIN_WIDE_STORAGE_KEY, "1");
    else window.localStorage.removeItem(ADMIN_WIDE_STORAGE_KEY);
  } catch {
    // Armazenamento bloqueado: vale só até recarregar.
  }
  if (typeof document !== "undefined") document.documentElement.classList.toggle(ADMIN_WIDE_CLASS, Boolean(wide));
  window.dispatchEvent(new CustomEvent(ADMIN_WIDE_EVENT, { detail: Boolean(wide) }));
}
