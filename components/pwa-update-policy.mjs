// Quando aplicar a versão nova do painel (components/PwaLifecycle.jsx) — regra pura, testada em
// tests/pwa-update-policy.test.mjs.
//
// Dono, 2026-10-26: "Quando eu saio do app por um tempo e volto, ele tem que carregar tudo de novo." Causa: cada
// publicação troca o service worker e o app recarregava a página ao sair/voltar (dezenas de publicações por dia = quase
// toda volta recarregava). Agora:
// - Sair do app ou voltar para ele NUNCA recarrega (a tela continua exatamente onde estava).
// - A versão nova entra no próximo toque num link do painel (vira uma abertura completa da tela que a pessoa pediu — o
//   momento em que ela já espera carregar) ou, se a troca de tela não veio de um link, logo depois dela.
// - Abrir o app do zero já usa a versão nova (o navegador baixa a página de novo).
// Continua valendo: nunca recarregar com um campo sendo digitado.

export const UPDATE_ACTIONS = Object.freeze({ NONE: "none", RELOAD: "reload", HARD_NAVIGATE: "hard-navigate" });

// trigger: "visible" (voltou ao app) | "hidden" (saiu do app) | "link-click" | "route-change" | "controller-change"
export function decideUpdateAction({ pending = false, trigger = "", typing = false } = {}) {
  if (!pending) return UPDATE_ACTIONS.NONE;
  if (trigger === "link-click") return UPDATE_ACTIONS.HARD_NAVIGATE;
  if (trigger === "route-change") return typing ? UPDATE_ACTIONS.NONE : UPDATE_ACTIONS.RELOAD;
  // "visible", "hidden", "controller-change" e qualquer outro: espera a próxima troca de tela.
  return UPDATE_ACTIONS.NONE;
}

// A troca de service worker só conta como "versão nova" se a página já era controlada por um (primeira instalação
// também dispara controllerchange, via clients.claim, e não é atualização nenhuma).
export function isRealUpdate({ hadControllerAtStart = false } = {}) {
  return Boolean(hadControllerAtStart);
}

// Clique num link do próprio site que pode virar abertura completa da tela. Devolve o endereço, ou null para deixar o
// clique seguir normal (nova aba, download, outro site, âncora na mesma tela, botão do meio, teclas de atalho...).
export function hardNavigationTarget({
  href = "",
  origin = "",
  currentHref = "",
  button = 0,
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
  target = "",
  download = false,
  optOut = false
} = {}) {
  if (!href || !origin || optOut || download) return null;
  if (button !== 0 || metaKey || ctrlKey || shiftKey || altKey) return null;
  if (target && target !== "_self") return null;
  let url;
  let current;
  try {
    current = new URL(currentHref || origin, origin);
    url = new URL(href, current);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (!/^https?:$/.test(url.protocol)) return null;
  // Mesmo endereço (só muda o #): não é troca de tela.
  if (url.pathname === current.pathname && url.search === current.search) return null;
  return url.href;
}
