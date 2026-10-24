// "A página está escondida?" para pausar animação e consulta periódica (app lento, 2026-10-23 — docs/INCIDENTES.md).
// No navegador = document.hidden. No app de desktop do dono (desktop-app/) a view do CRM roda com backgroundThrottling
// desligado (a voz do Henry precisa de timers em tempo real com o app minimizado) e por isso document.hidden NUNCA fica
// true: o app avisa pela ponte (window.mmDesktop.onWindowVisibility, versão 1.3.1+) quando a janela é minimizada ou vai
// para a bandeja. Sem a ponte (navegador, app antigo) vale só o document.hidden — nada muda.
const CHANGE_EVENT = "mm-page-visibility";
let installed = false;
let desktopHidden = false;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const notify = () => window.dispatchEvent(new Event(CHANGE_EVENT));
  document.addEventListener("visibilitychange", notify);
  const bridge = window.mmDesktop;
  if (bridge?.isDesktopApp === true && typeof bridge.onWindowVisibility === "function") {
    bridge.onWindowVisibility(({ hidden } = {}) => {
      const next = hidden === true;
      if (next === desktopHidden) return;
      desktopHidden = next;
      notify();
    });
  }
}

export function isPageHidden() {
  if (typeof document === "undefined") return false;
  install();
  return document.hidden || desktopHidden;
}

// Avisa a cada mudança (aba ou janela do app); devolve a função que cancela.
export function onPageVisibilityChange(callback) {
  if (typeof window === "undefined") return () => {};
  install();
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}
