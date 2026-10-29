// Página "acordada" pelo depurador (1.9.8). Problema real (dono, 25/10/2026): "a aba do Marketplace e a do Instagram
// ficam abertas, porém eu abro outra janela para utilizar, em tela cheia; as duas abas das extensões ficam abertas atrás
// dessa." Com a janela de trabalho coberta, o Chrome marca a página do Facebook como OCULTA (document.visibilityState
// "hidden", hasFocus false): para de desenhar, segura os timers e o Facebook não abre a conversa (diagnóstico real
// `aba_oculta`, 24/10).
//
// Solução: durante a AÇÃO (ler a caixa, abrir/ler conversa, enviar, publicar) a extensão liga o depurador na aba de
// trabalho e pede `Emulation.setFocusEmulationEnabled {enabled:true}`. No Chromium isso faz duas coisas (conferido no
// código-fonte em 25/10/2026, content/browser/devtools/protocol/emulation_handler.cc + web_contents_impl.cc):
//   1) a página passa a ter foco (document.hasFocus() true, eventos de foco);
//   2) a aba conta como "capturada visivelmente" (IncrementCapturerCount, stay_hidden=false) — o Chrome a trata como
//      VISÍVEL mesmo coberta por outra janela: visibilityState "visible", volta a desenhar e os timers voltam ao normal.
// Nunca traz a janela para a frente (sem Page.bringToFront, sem focused:true): a tela do dono não muda.
// `Page.setWebLifecycleState {state:"active"}` descongela a página se o Chrome a tiver congelado (economia de energia).
// Ao fim da ação a emulação é desligada e o depurador SOLTO — a faixa "…começou a depurar este navegador" só aparece
// enquanto a ação acontece (a não ser que o Chrome seja aberto com --silent-debugger-extension-api, que a esconde).
//
// Lógica pura (sem chrome.*), testada em tests/page-awake.test.js; o background passa as funções do chrome.debugger.

export const AWAKE_ON = [
  { method: "Emulation.setFocusEmulationEnabled", params: { enabled: true }, required: true },
  { method: "Page.setWebLifecycleState", params: { state: "active" }, required: false }
];
export const AWAKE_OFF = [{ method: "Emulation.setFocusEmulationEnabled", params: { enabled: false } }];

// attach(tabId) / detach(tabId) / send(tabId, method, params): chamadas ao chrome.debugger (com prazo, no background).
// Contagem por aba: ações aninhadas (publicação inteira > clique) ligam uma vez e soltam só quando a última termina.
export function createAwakeManager({ attach, detach, send, warn = () => {} }) {
  const tabs = new Map(); // tabId -> { count, attached, awake, error }

  async function enter(tabId) {
    const entry = tabs.get(tabId);
    if (entry && entry.count > 0) {
      entry.count += 1;
      return { entry, attached: entry.attached, awake: entry.awake, error: entry.error };
    }
    const fresh = { count: 1, attached: false, awake: false, error: "" };
    tabs.set(tabId, fresh);
    try {
      await attach(tabId);
      fresh.attached = true;
    } catch (error) {
      fresh.error = `depurador não ligou: ${error?.message || error}`;
      warn(fresh.error);
      return { entry: fresh, attached: false, awake: false, error: fresh.error };
    }
    for (const command of AWAKE_ON) {
      try {
        await send(tabId, command.method, command.params);
        if (command.required) fresh.awake = true;
      } catch (error) {
        if (command.required) {
          fresh.error = `emulação de foco falhou: ${error?.message || error}`;
          warn(fresh.error);
        }
      }
    }
    return { entry: fresh, attached: fresh.attached, awake: fresh.awake, error: fresh.error };
  }

  // Só mexe na entrada desta ação: depois de um release() forçado, a ação antiga que termina tarde não solta a nova.
  async function leave(tabId, mine) {
    const entry = tabs.get(tabId);
    if (!entry || entry !== mine) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    tabs.delete(tabId);
    if (!entry.attached) return;
    for (const command of AWAKE_OFF) await send(tabId, command.method, command.params).catch((error) => warn(`desligar ${command.method} falhou: ${error?.message || error}`));
    await detach(tabId).catch((error) => warn(`soltar o depurador falhou: ${error?.message || error}`));
  }

  return {
    // Roda fn(info) com a página acordada; solta tudo ao fim (sucesso, erro ou exceção).
    async run(tabId, fn) {
      const { entry, ...info } = await enter(tabId);
      try {
        return await fn(info);
      } finally {
        await leave(tabId, entry);
      }
    },
    isAttached(tabId) {
      return Boolean(tabs.get(tabId)?.attached);
    },
    // Força soltar (fim da rodada com etapa abandonada por prazo, aba órfã): a ação pendurada, se terminar depois,
    // não religa nada.
    async release(tabId) {
      const entry = tabs.get(tabId);
      tabs.delete(tabId);
      if (entry?.attached) {
        for (const command of AWAKE_OFF) await send(tabId, command.method, command.params).catch((error) => warn(`desligar ${command.method} falhou: ${error?.message || error}`));
      }
      await detach(tabId).catch((error) => warn(`soltar o depurador falhou: ${error?.message || error}`));
    },
    // O Chrome soltou o depurador sozinho (dono clicou em "Cancelar" na faixa, aba fechada).
    forget(tabId) {
      tabs.delete(tabId);
    },
    activeTabs() {
      return [...tabs.keys()];
    }
  };
}
