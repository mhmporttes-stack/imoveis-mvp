"use client";

import { useLayoutEffect } from "react";

/**
 * Mantém um painel que abre debaixo de um botão (posição absoluta) SEMPRE inteiro dentro da tela, com `margin` de folga:
 * se ele passar da borda esquerda ou direita (comum no celular, onde o botão fica perto da borda e o painel é largo),
 * é empurrado na horizontal o necessário. Mede depois de abrir e de novo ao girar/redimensionar a tela.
 */
export function useKeepInViewport(ref, open, margin = 8) {
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return undefined;
    const fit = () => {
      panel.style.transform = "";
      const rect = panel.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      let shift = 0;
      if (rect.left < margin) shift = margin - rect.left;
      else if (rect.right > width - margin) shift = width - margin - rect.right;
      if (shift) panel.style.transform = `translateX(${Math.round(shift)}px)`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [ref, open, margin]);
}
