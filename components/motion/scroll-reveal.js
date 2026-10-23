// Entrada dos blocos por rolagem (visual novo do painel, dono, 2026-10-22 — protótipo aprovado):
// cada bloco entra (opacidade + sobe 56px + escala 0,97 → normal, 1,1 s) quando entra na tela
// (IntersectionObserver com rootMargin '0px 0px -10% 0px'). Utilitário puro de DOM, reutilizável:
//   const stop = revealOnScroll(elementoRaiz);   // devolve a limpeza
// Velocidade (2026-10-22, etapa 2): sem o desfoque (filter: blur era pintado quadro a quadro por 1,1 s em cada bloco);
// varredura linear (antes cada bloco era comparado com todos — 415 ms travado com 300 cards); depois da primeira
// varredura, cada mutação processa só os nós novos; a linha de entrada desceu de 55% para 90% da altura da tela.
// Regras de segurança:
//  - só opacity/transform, pela Web Animations API, sem "fill: both": ao terminar o bloco volta a transform: none
//    (um transform que ficasse viraria o "containing block" dos position: fixed de dentro — docs/INCIDENTES.md, 2026-10-12);
//  - "reduzir movimento" do sistema: nada é escondido nem animado;
//  - o que já está acima da linha de entrada entra na hora (em cascata curta); o que nunca chega à linha (fim da página)
//    entra quando a rolagem chega ao fim ou quando a página nem rola — nada fica invisível;
//  - fica de fora: Chat, janelas (dialog), elementos fixos/grudados e quem marcar data-no-reveal.

export const REVEAL_DURATION_MS = 1100;
export const REVEAL_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
// Linha de entrada: 90% da altura da tela (o rootMargin de baixo é o complemento, -10%).
export const REVEAL_LINE_RATIO = 0.9;
export const REVEAL_ROOT_MARGIN = "0px 0px -10% 0px";
const STAGGER_MS = 140;
const MAX_STAGGER_STEPS = 5;
// Lista longa (mais de 8 irmãos): o bloco que entra é a lista, não cada linha.
const LIST_SIBLINGS = 8;

const CANDIDATES = "[data-reveal], section, article, .rounded-card, .rounded-panel, .premium-card";
const EXCLUDED = "dialog, [data-no-reveal], .chat-app-root, .admin-bottom-nav, .admin-sidebar, .ui-sheet, .ui-confirm, [role='dialog']";

export const KEYFRAMES = [
  { opacity: 0, transform: "translateY(56px) scale(0.97)" },
  { opacity: 1, transform: "none" }
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
// Linear: querySelectorAll devolve em ordem de documento (pré-ordem), então os descendentes de um elemento vêm logo
// depois dele — ele é folha se o próximo candidato elegível não estiver dentro dele.
// scopes (opcional): só os nós novos de uma mutação; sem scopes, varre a raiz inteira.
export function collectRevealTargets(root, scopes) {
  if (!root) return [];
  const eligibleCache = new Map();
  const eligible = (el) => {
    if (!eligibleCache.has(el)) eligibleCache.set(el, isEligible(el));
    return eligibleCache.get(el);
  };
  const targets = new Set();
  for (const scope of topLevelScopes(root, scopes)) {
    const list = [];
    if (scope !== root && scope.matches(CANDIDATES)) list.push(scope);
    for (const el of scope.querySelectorAll(CANDIDATES)) list.push(el);
    const all = list.filter(eligible);
    for (let index = 0; index < all.length; index += 1) {
      const el = all[index];
      const next = all[index + 1];
      if (next && el.contains(next)) continue;
      const parent = el.parentElement;
      targets.add(parent && parent !== root && parent.childElementCount > LIST_SIBLINGS && eligible(parent) ? parent : el);
    }
  }
  // Uma lista promovida a bloco não convive com um ancestral também marcado (sobe pelos ancestrais: linear na altura).
  return [...targets].filter((el) => {
    for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
      if (targets.has(node)) return false;
    }
    return true;
  });
}

// Escopos da varredura: a raiz inteira, ou os nós novos que ainda estão na raiz, sem repetir um que já está dentro de outro.
function topLevelScopes(root, scopes) {
  if (!scopes) return [root];
  const set = new Set();
  for (const node of scopes) {
    if (node instanceof HTMLElement && node.isConnected && root.contains(node)) set.add(node);
  }
  return [...set].filter((el) => {
    for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
      if (set.has(node)) return false;
    }
    return true;
  });
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

  // initial = true: primeira varredura da tela (o que já está acima da linha de entrada entra em cascata). Depois (conteúdo que
  // chega por busca/filtro), o que nasce já visível fica como está — só o que está abaixo espera a rolagem.
  const scan = (initial, scopes) => {
    const line = window.innerHeight * REVEAL_LINE_RATIO;
    let step = 0;
    for (const el of collectRevealTargets(root, scopes)) {
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
  let added = new Set();
  // Só os elementos adicionados desde a última varredura (antes reprocessava a tela inteira a cada mutação).
  const mutation = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node.nodeType === 1) added.add(node);
    }
    if (!added.size) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const scopes = added;
      added = new Set();
      scan(false, scopes);
    }, 200);
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
    added.clear();
    mutation.disconnect();
    observer.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    root.removeEventListener("focusin", onFocus);
    for (const el of pending) el.style.opacity = "";
    pending.clear();
  };
}
