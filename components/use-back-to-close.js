"use client";

import { useEffect, useRef } from "react";

// "Voltar" (gesto de passar o dedo para o lado no app, botão do navegador) fecha só a camada que está aberta — ficha do
// cliente, conversa do Chat — e devolve à tela de baixo exatamente como estava (mesma rolagem, mesmos filtros), em vez de sair
// da tela inteira para o começo (dono, 2026-11-04: "quando você clicar em voltar, ele volte apenas à etapa anterior").
//
// Como funciona: ao abrir, grava UMA entrada no histórico (mesma URL, com marca). O gesto de voltar tira essa entrada e a camada
// fecha; se a camada fecha por outro caminho (X, fundo, botão da tela), a entrada é retirada em seguida. Nunca muda a URL,
// nunca navega, e se a tela inteira sai (troca de página) não mexe no histórico.
export function useBackToClose(active, onClose, { minWidth = 0, maxWidth = 0 } = {}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const unmounting = useRef(false);

  useEffect(() => () => { unmounting.current = true; }, []);

  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    // Só vale nas larguras em que a camada cobre a tela (celular): no computador a conversa/gaveta convive com a lista.
    if (maxWidth && window.innerWidth >= maxWidth) return undefined;
    if (minWidth && window.innerWidth < minWidth) return undefined;
    let token = "";
    let popped = false;
    try {
      token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      // Mantém o estado do Next (se houver) e só acrescenta a marca; a URL não muda.
      window.history.pushState({ ...(window.history.state || {}), mmBack: token }, "", window.location.href);
    } catch {
      return undefined;
    }
    const onPop = () => {
      if (window.history.state?.mmBack === token) return; // voltou para cima da nossa entrada (avançar): nada a fechar
      popped = true;
      window.removeEventListener("popstate", onPop);
      closeRef.current?.();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (popped || unmounting.current) return;
      // A camada fechou por outro caminho: retira a entrada que ela deixou no histórico (só se ainda é a de cima).
      try {
        if (window.history.state?.mmBack === token) window.history.back();
      } catch {
        // sem histórico: nada a retirar
      }
    };
  }, [active, minWidth, maxWidth]);
}
