// Máquina de estados PURA do player da apresentação (sem React, sem DOM): testável com `node --test`.
// O componente só traduz eventos (toque, teclado, swipe, relógio, visibilidade) nestas ações.

export function createPlayerState(total, { reducedMotion = false } = {}) {
  return { index: 0, total: Math.max(0, Math.floor(total) || 0), paused: false, hiddenPause: false, ended: false, reducedMotion: Boolean(reducedMotion) };
}

const clampIndex = (state, index) => Math.min(Math.max(0, index), Math.max(0, state.total - 1));

/** Ações: next | prev | goto(index) | unlock(total) | pause | resume | toggle | hidden | visible | auto (relógio da cena venceu). */
export function playerReducer(state, action = {}) {
  switch (action.type) {
    case "next": {
      if (state.index >= state.total - 1) return state.ended ? state : { ...state, ended: true };
      return { ...state, index: state.index + 1, ended: false };
    }
    case "auto": {
      if (isPaused(state)) return state;
      if (state.index >= state.total - 1) return state.ended ? state : { ...state, ended: true };
      return { ...state, index: state.index + 1 };
    }
    case "prev":
      return state.index <= 0 ? state : { ...state, index: state.index - 1, ended: false };
    case "goto": {
      const index = clampIndex(state, Number(action.index) || 0);
      return index === state.index ? state : { ...state, index, ended: false };
    }
    case "unlock": {
      // VALIDAR SIMULAÇÃO: libera as cenas finais (o total passa a incluí-las) e segue para a próxima.
      const total = Math.max(state.total, Math.floor(Number(action.total)) || 0);
      return { ...state, total, index: Math.min(state.index + 1, total - 1), ended: false };
    }
    case "pause":
      return state.paused ? state : { ...state, paused: true };
    case "resume":
      return state.paused ? { ...state, paused: false } : state;
    case "toggle":
      return { ...state, paused: !state.paused };
    case "hidden":
      return state.hiddenPause ? state : { ...state, hiddenPause: true };
    case "visible":
      return state.hiddenPause ? { ...state, hiddenPause: false } : state;
    default:
      return state;
  }
}

export const isPaused = (state) => state.paused || state.hiddenPause;
export const isLastScene = (state) => state.total > 0 && state.index >= state.total - 1;
/** O relógio da cena só corre quando não há pausa e ainda existe próxima cena. */
export const isAutoAdvancing = (state) => !isPaused(state) && !isLastScene(state) && state.total > 1;

/** Relógio da cena: acumula só o tempo "ativo" (pausa não consome). `delta` em ms. */
export function advanceClock({ elapsed = 0, delta = 0, duration = 0 }) {
  const next = Math.max(0, elapsed + Math.max(0, delta));
  return { elapsed: Math.min(next, duration), done: duration > 0 && next >= duration };
}

/** Cena anterior permanece rápida em tela para a saída suave; reduced-motion = troca simples, sem saída. */
export function transitionPlan(state, previousIndex) {
  if (state.reducedMotion || previousIndex === null || previousIndex === undefined || previousIndex === state.index) {
    return { leaving: null, direction: "none" };
  }
  return { leaving: previousIndex, direction: state.index > previousIndex ? "forward" : "back" };
}

/** Toque: terço esquerdo volta, o resto avança. */
export function tapAction(clientX, width) {
  if (!(width > 0)) return "next";
  return clientX / width < 0.3 ? "prev" : "next";
}

/** Swipe horizontal claro (>= 48px e bem mais horizontal que vertical): esquerda avança, direita volta. */
export function swipeAction(dx, dy) {
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return null;
  return dx < 0 ? "next" : "prev";
}

export function keyAction(key) {
  if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown") return "next";
  if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") return "prev";
  if (key === " " || key === "Spacebar" || key === "k" || key === "K") return "toggle";
  return null;
}

/** Valor mostrado pelo contador animado (easeOutExpo). reduced-motion: sempre o valor final. */
export function countValue(target, progress, reducedMotion = false) {
  const final = Number(target) || 0;
  if (reducedMotion || progress >= 1) return final;
  if (progress <= 0) return 0;
  const eased = 1 - Math.pow(2, -10 * progress);
  return Math.round(final * eased * 100) / 100;
}

/** Eventos de métrica a enviar numa mudança de cena (1-based), sem repetir cena já alcançada. */
export function sceneMetricEvents({ index, total, maxReached }) {
  const scene = index + 1;
  const events = [];
  if (scene > maxReached) events.push({ tipo: "cena", cena: scene });
  if (total > 0 && scene === total) events.push({ tipo: "concluiu", cena: scene });
  return { events, maxReached: Math.max(maxReached, scene) };
}

/** Links das imagens do MESMO token (/s/<token>/imagem e /documentos, com ?baixar=1). Sem token/base: sem link. */
export function buildAssetHrefs({ token = "", preview = false, assetsBase = "", assetsQuery = "" } = {}) {
  const base = assetsBase || (token && !preview ? `/s/${encodeURIComponent(token)}` : "");
  if (!base) return { summary: "", documents: "" };
  const query = `${assetsQuery ? `${assetsQuery}&` : ""}baixar=1`;
  return { summary: `${base}/imagem?${query}`, documents: `${base}/documentos?${query}` };
}
