// Entrada dos blocos por rolagem (visual novo do painel, dono, 2026-10-22 — protótipo aprovado):
// cada bloco entra (opacidade + sobe 56px + desfoque de 4px → nítido, 1,1 s) quando chega perto do centro da tela
// (IntersectionObserver com rootMargin '0px 0px -45% 0px'). Utilitário puro de DOM, reutilizável:
//   const stop = revealOnScroll(elementoRaiz);   // devolve a limpeza
// Regras de segurança:
//  - só opacity/transform/filter, pela Web Animations API, sem "fill: both": ao terminar o bloco volta a transform: none
//    (um transform que ficasse viraria o "containing block" dos position: fixed de dentro — docs/INCIDENTES.md, 2026-10-12);
//  - "reduzir movimento" do sistema: nada é escondido nem animado;
//  - o que já está na metade de cima da tela entra na hora (em cascata curta); o que nunca chega ao centro (fim da página)
//    entra quando a rolagem chega ao fim ou quando a página nem rola — nada fica invisível;
//  - fica de fora: Chat, janelas (dialog), elementos fixos/grudados e quem marcar data-no-reveal.

export const REVEAL_DURATION_MS = 1100;
export const REVEAL_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const REVEAL_ROOT_MARGIN = "0px 0px -45% 0px";
const STAGGER_MS = 140;
const MAX_STAGGER_STEPS = 5;
// Lista longa (mais de 8 irmãos): o bloco que entra é a lista, não cada linha.
const LIST_SIBLINGS = 8;

const CANDIDATES = "[data-reveal], section, article, .rounded-card, .rounded-panel, .premium-card";
const EXCLUDED = "dialog, [data-no-reveal], .chat-app-root, .admin-bottom-nav, .admin-sidebar, .ui-sheet, .ui-confirm, [role='dialog']";

const KEYFRAMES = [
  { opacity: 0, transform: "translateY(56px) scale(0.97)", filter: "blur(4px)" },
  { opacity: 1, transform: "none", filter: "none" }
];

export function prefersReducedMotion() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function isEligible(el) {
  if (!(el instanceof HTMLElement) || el.closest(EXCLUDED)) return false;
  const style = window.getComputedStyle(el);
  if (style.position === "fixed" || style.position === "sticky" || style.display === "none" || style.display === "contents") return false;
  return el.getBoundingClientRect().height > 24;
}

// Blocos "folha": candidatos que não contêm outro candidato (cada card entra sozinho, não a página inteira).
export function collectRevealTargets(root) {
  if (!root) return [];
  const all = [...root.querySelectorAll(CANDIDATES)].filter(isEligible);
  const set = new Set(all);
  const leaves = all.filter((el) => !all.some((other) => other !== el && set.has(other) && el.contains(other)));
  const targets = new Set();
  for (const el of leaves) {
    const parent = el.parentElement;
    targets.add(parent && parent !== root && parent.childElementCount > LIST_SIBLINGS && isEligible(parent) ? parent : el);
  }
  // Uma lista promovida a bloco não convive com um ancestral/descendente também marcado.
  const list = [...targets];
  return list.filter((el) => !list.some((other) => other !== el && other.contains(el)));
}

function play(el, delay = 0) {
  el.style.opacity = "";
  if (typeof el.animate !== "function") return;
  el.animate(KEYFRAMES, { duration: REVEAL_DURATION_MS, easing: REVEAL_EASING, delay, fill: "backwards" });
}

export function revealOnScroll(root) {
  if (!root || typeof window === "undefined" || typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return () => {};
  const seen = new WeakSet();
  const pending = new Set();
  const observer = new IntersectionObserver((entries) => {
    let step = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      pending.delete(entry.target);
      play(entry.target, Math.min(step++, MAX_STAGGER_STEPS) * STAGGER_MS);
    }
  }, { rootMargin: REVEAL_ROOT_MARGIN, threshold: 0 });

  const flushAll = () => {
    let step = 0;
    for (const el of pending) {
      observer.unobserve(el);
      play(el, Math.min(step++, MAX_STAGGER_STEPS) * STAGGER_MS);
    }
    pending.clear();
  };
  const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;

  // initial = true: primeira varredura da tela (o que já está na metade de cima entra em cascata). Depois (conteúdo que
  // chega por busca/filtro), o que nasce já visível fica como está — só o que está abaixo espera a rolagem.
  const scan = (initial) => {
    const line = window.innerHeight * 0.55;
    let step = 0;
    for (const el of collectRevealTargets(root)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const top = el.getBoundingClientRect().top;
      if (top < line) {
        if (initial) play(el, Math.min(step++, MAX_STAGGER_STEPS) * STAGGER_MS);
        continue;
      }
      el.style.opacity = "0";
      pending.add(el);
      observer.observe(el);
    }
    if (pending.size && atBottom()) flushAll();
  };

  let timer = 0;
  const mutation = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => scan(false), 200);
  });
  const onScroll = () => { if (pending.size && atBottom()) flushAll(); };
  // Teclado: o foco que cai dentro de um bloco ainda escondido faz ele entrar na hora.
  const onFocus = (event) => {
    for (const el of pending) {
      if (!el.contains(event.target)) continue;
      observer.unobserve(el);
      pending.delete(el);
      play(el);
    }
  };

  scan(true);
  mutation.observe(root, { childList: true, subtree: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  root.addEventListener("focusin", onFocus);

  return () => {
    window.clearTimeout(timer);
    mutation.disconnect();
    observer.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    root.removeEventListener("focusin", onFocus);
    for (const el of pending) el.style.opacity = "";
    pending.clear();
  };
}
