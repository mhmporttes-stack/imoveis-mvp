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
let loading = false;
let onSkip = null;
let pendingDirection = null;

const readyListeners = new Set();
const activeListeners = new Set();
const loadingListeners = new Set();

function emitReady() {
  for (const listener of readyListeners) listener();
}
function emitActive() {
  for (const listener of activeListeners) listener();
}
function emitLoading() {
  for (const listener of loadingListeners) listener();
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

export function getLoadingSnapshot() {
  return loading;
}
export function subscribeLoading(listener) {
  loadingListeners.add(listener);
  return () => loadingListeners.delete(listener);
}

// Cena 1 (saída) já terminou de tocar, mas a navegação ainda não chegou —
// mostra um indicador em vez de deixar a tela em branco parada (era isso
// que "sumia" quando a página de destino demorava mais que a duração da
// própria animação de saída). Ignorado se a transição já foi concluída
// nesse meio-tempo (corrida entre o fim da Cena 1 e a chegada dos dados).
export function startLoadingIndicator() {
  if (sceneReady) return;
  loading = true;
  emitLoading();
}

// Chamado sempre que a página de destino efetivamente monta (com ou sem
// Cena 2), pra garantir que o indicador nunca fique preso ligado.
export function stopLoadingIndicator() {
  if (!loading) return;
  loading = false;
  emitLoading();
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
