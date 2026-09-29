"use client";

// Estado compartilhado (fora do React) que faz o clique num ícone (numa
// tela) e a área de transição (montada uma vez no layout, em outra árvore
// de componentes) se falarem sem precisar de Context atravessando Server
// Components. Nada aqui toca em dado/negócio — é só coreografia visual.
//
// `sceneReady`: começa (e volta a ficar) `true` sempre que não há uma
// transição controlada em andamento — por isso navegação direta, refresh ou
// voltar do navegador NUNCA ficam bloqueados por engano; só quem inicia a
// transição pelo SceneTransitionLink passa por `sceneReady = false` até a
// cena de entrada terminar.
let sceneReady = true;
let active = false;
let onSkip = null;
let pendingDirection = null;

const readyListeners = new Set();
const activeListeners = new Set();

function emitReady() {
  for (const listener of readyListeners) listener();
}
function emitActive() {
  for (const listener of activeListeners) listener();
}

export function getSceneReadySnapshot() {
  return sceneReady;
}
export function subscribeSceneReady(listener) {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

export function getActiveSnapshot() {
  return active;
}
export function subscribeActive(listener) {
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}

// Chamado ao iniciar qualquer animação de cena (saída OU entrada) — guarda
// como "pular" essa animação específica (usado pelo toque na tela).
export function beginScene({ controls, onFinish }) {
  active = true;
  sceneReady = false;
  onSkip = () => {
    controls.stop();
    onFinish();
  };
  emitActive();
  emitReady();
}

// Fim natural (ou pulado) de uma animação de cena — sempre chamado uma vez,
// pelo próprio `onFinish` de quem iniciou.
export function markSceneDone() {
  active = false;
  onSkip = null;
  emitActive();
}

export function releaseSceneReady() {
  sceneReady = true;
  emitReady();
}

// Toque em qualquer lugar da tela durante uma cena ativa (SceneSkipCatcher).
export function requestSkip() {
  if (!onSkip) return;
  const skip = onSkip;
  onSkip = null;
  skip();
}

// Direção pendente entre "terminei a saída, vou navegar" e "a próxima
// página montou, hora de tocar a entrada" — consumida uma única vez.
export function setPendingDirection(direction) {
  pendingDirection = direction;
}
export function consumePendingDirection() {
  const direction = pendingDirection;
  pendingDirection = null;
  return direction;
}
