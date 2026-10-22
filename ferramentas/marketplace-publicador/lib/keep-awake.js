// "Manter acordado" (1.9.0, pedido do dono em 2026-10-22: a extensão ficou ~11 h sem falar com o CRM com o PC ligado).
// Lógica pura (testada em tests/keep-awake.test.js); as chamadas ao Chrome ficam em background.js.
// - A cada 1 min (alarme próprio) o service worker acorda, segura o computador acordado (chrome.power "system") e abre
//   uma aba em segundo plano que fecha em ~2 s (pedido literal do dono).
// - Liga por padrão; desliga nas Opções. O botão Pausar do popup também solta o "acordado".

export const KEEP_AWAKE_ALARM = "mp-keep-awake";
export const KEEP_AWAKE_EVERY_MINUTES = 1;
export const PULSE_TAB_CLOSE_MS = 2000;
export const PULSE_PAGE = "manter-acordado.html";

// Preferência guardada em chrome.storage.local.keepAwake (booleano). Ausente = ligado.
export function keepAwakeEnabled(pref) {
  return pref !== false;
}

// Segura o computador acordado? Só com a opção ligada e sem a pausa manual (Pausar do popup).
export function shouldHoldPower(pref, state) {
  return keepAwakeEnabled(pref) && !state?.manualPause;
}

// Abre a aba de "acordar" agora? Nunca durante publicação ou sincronização do chat (as duas mexem em abas/foco), nem
// sem janela normal aberta (o Chrome abriria uma janela nova e roubaria o foco), nem se a aba anterior ainda existe.
export function decidePulse(pref, state, { chatBusy = false, hasNormalWindow = true, previousPulseOpen = false } = {}) {
  if (!shouldHoldPower(pref, state)) return { pulse: false, reason: keepAwakeEnabled(pref) ? "pausado" : "desligado" };
  if (state?.running) return { pulse: false, reason: "publicando" };
  if (chatBusy) return { pulse: false, reason: "sincronizando" };
  if (!hasNormalWindow) return { pulse: false, reason: "sem_janela" };
  if (previousPulseOpen) return { pulse: false, reason: "aba_anterior_aberta" };
  return { pulse: true, reason: "ok" };
}
