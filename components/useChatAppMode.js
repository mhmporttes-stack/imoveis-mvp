"use client";

import { useLayoutEffect } from "react";

// Modo aplicativo do Chat (pedido do dono, 2026-10-09): marca <html class="chat-app-mode"> e os ancestrais da tela para o
// CSS (app/globals.css, "Chat em modo aplicativo") fixar a tela na altura da janela — some o rodapé "Sair" e só a lista /
// as mensagens rolam por dentro. A tela marca o próprio bloco com a classe `chat-app-root`. Usado pelo Chat do WhatsApp
// e pelo Chat do Marketplace (dono, 2026-10-22: "deixe como o Chat").
// useLayoutEffect (2026-10-12): marca antes da 1ª pintura — com useEffect aparecia um quadro com o banner do ranking
// e a página fora da moldura, e depois tudo pulava para cima.
export function useChatAppMode(enabled, ref) {
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return undefined;
    const root = document.documentElement;
    const ancestors = [];
    for (let node = ref.current.parentElement; node && node !== document.body; node = node.parentElement) {
      node.classList.add("chat-app-ancestor");
      ancestors.push(node);
    }
    root.classList.add("chat-app-mode");
    window.scrollTo(0, 0);
    return () => {
      root.classList.remove("chat-app-mode");
      ancestors.forEach((node) => node.classList.remove("chat-app-ancestor"));
    };
  }, [enabled, ref]);
}
