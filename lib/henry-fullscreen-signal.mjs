// Sinal único "tela cheia do Henry aberta" (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-23): com a cena cheia do Henry
// aberta (navegador e app de desktop), nenhum aviso fixo no meio da tela aparece (Importante da Central, Supervisão,
// Mensagem do dia, Reconhecimento, prompts de PWA/atualização). Eles NÃO se perdem: cada gate guarda a pendência no
// próprio estado (a fila de sempre) e mostra quando a cena fecha. Quem emite: só HenryVoiceAssistant (estado `expanded`).
// Quem lê: o hook `useHenryFullscreen` (components/henry/useHenryFullscreen.js). Não crie outra checagem por DOM/aria.
// Puro (sem React): testado em tests/henry-fullscreen-signal.test.mjs com um EventTarget no lugar do window.

export const HENRY_FULLSCREEN_EVENT = "mm-henry-fullscreen";
const FLAG = "__mmHenryFullscreen";

function defaultTarget() {
  return typeof window === "undefined" ? null : window;
}

export function isHenryFullscreenOpen(target = defaultTarget()) {
  return Boolean(target) && target[FLAG] === true;
}

// Grava o estado e avisa os gates só quando muda (abrir duas vezes não dispara dois eventos). Devolve se mudou.
export function setHenryFullscreenOpen(open, target = defaultTarget()) {
  if (!target) return false;
  const value = open === true;
  if (isHenryFullscreenOpen(target) === value) return false;
  target[FLAG] = value;
  target.dispatchEvent?.(new Event(HENRY_FULLSCREEN_EVENT));
  return true;
}

export function subscribeHenryFullscreen(callback, target = defaultTarget()) {
  if (!target?.addEventListener) return () => {};
  target.addEventListener(HENRY_FULLSCREEN_EVENT, callback);
  return () => target.removeEventListener(HENRY_FULLSCREEN_EVENT, callback);
}

// Fila: o aviso da vez (`item`) fica guardado enquanto a cena está aberta e volta igual quando ela fecha.
export function heldWhileHenryOpen(item, henryOpen) {
  return henryOpen ? null : item ?? null;
}

// Fechou agora (aberta → fechada): os gates que só consultam o servidor de tempos em tempos consultam na hora.
export function henryJustClosed(wasOpen, isOpen) {
  return wasOpen === true && isOpen !== true;
}
