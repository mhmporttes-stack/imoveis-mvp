// Regra pura da pílula "Carregando…" ao tocar no menu (dono, 2026-11-02): aparece depois de um atraso curto (não pisca em
// navegação instantânea), some quando a nova tela chega e tem teto de segurança se a navegação falhar. Sem React nem DOM:
// o relógio é injetável para os testes (tests/navigation-pill-core.test.mjs).

export const NAVIGATION_PILL_DELAY_MS = 120;
export const NAVIGATION_PILL_CAP_MS = 15000;

// Toque simples com o botão principal (abrir em outra aba/janela com Ctrl/Cmd/Shift/Alt não navega nesta tela).
export function isPlainNavigationClick(event) {
  if (!event || event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  return !event.button;
}

// O destino é a tela em que a pessoa já está? (mesmo caminho e, se o destino tem filtro, o mesmo filtro.)
export function isSameLocation(href, pathname = "", search = "") {
  let url;
  try {
    url = new URL(String(href || ""), "http://local.invalid");
  } catch {
    return false;
  }
  if (url.origin !== "http://local.invalid") return false;
  const clean = (value) => String(value || "").replace(/\/+$/, "") || "/";
  if (clean(url.pathname) !== clean(pathname)) return false;
  if (!url.search) return true;
  const current = String(search || "");
  return url.search === (current && !current.startsWith("?") ? `?${current}` : current);
}

export function createNavigationPill({
  delayMs = NAVIGATION_PILL_DELAY_MS,
  capMs = NAVIGATION_PILL_CAP_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id)
} = {}) {
  let visible = false;
  let pending = false;
  let delayTimer = null;
  let capTimer = null;
  const listeners = new Set();

  function emit() {
    for (const listener of listeners) listener();
  }

  function clearTimers() {
    if (delayTimer !== null) clearTimer(delayTimer);
    if (capTimer !== null) clearTimer(capTimer);
    delayTimer = null;
    capTimer = null;
  }

  function finish() {
    clearTimers();
    pending = false;
    if (visible) {
      visible = false;
      emit();
    }
  }

  function start() {
    clearTimers();
    pending = true;
    delayTimer = setTimer(() => {
      delayTimer = null;
      if (!pending || visible) return;
      visible = true;
      emit();
    }, delayMs);
    capTimer = setTimer(finish, capMs);
  }

  return {
    start,
    finish,
    isPending: () => pending,
    isVisible: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
