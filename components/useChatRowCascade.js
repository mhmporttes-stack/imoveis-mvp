"use client";

import { useLayoutEffect } from "react";

// Cena de entrada da lista do Chat (dono, 2026-10-12: "deve levar 3 segundos"), compartilhada pelo Chat do WhatsApp
// (components/WhatsappChat.jsx) e pelo Chat do Marketplace (components/marketplace/MarketplaceChat.jsx, dono, 2026-10-22:
// "deve ter a mesma cena do chat do WhatsApp"). Keyframes e tempos (--mm-motion-cascade-total / --mm-motion-row) ficam em
// app/globals.css ([data-chat-enter] [data-chat-rows] > [data-hop]).
//
// Marca só as linhas que cabem na tela (data-hop + --hop = posição), antes da pintura, e calcula --mm-motion-row-stagger
// para a cena inteira durar --mm-motion-cascade-total qualquer que seja o número de linhas visíveis (entre 60 e 600 ms
// por linha, no máximo 20 linhas). Linhas que chegarem depois (tempo real, revalidação) não são marcadas e não pulam.
// As que ainda não pularam ficam transparentes, mas tocar e rolar funcionam (só opacity/transform).
// Desliga sozinho (setRowsEnter(false)) depois da cascata; com prefers-reduced-motion nem começa.

// "3000ms" no código vira "3s" no CSS publicado (minificador): converte os dois formatos para milissegundos.
export function cssTimeMs(value, fallback) {
  const text = String(value || "").trim();
  const number = parseFloat(text);
  if (!Number.isFinite(number)) return fallback;
  return text.endsWith("ms") ? number : text.endsWith("s") ? number * 1000 : number;
}

// sceneRef: elemento com [data-chat-enter]; dentro dele, a lista [data-chat-rows]. rowTag: tag das linhas (filhos diretos
// da lista) que pulam — "BUTTON" no WhatsApp, "LI" no Marketplace.
export function useChatRowCascade({ sceneRef, rowsEnter, setRowsEnter, hasRows, rowTag = "BUTTON" }) {
  useLayoutEffect(() => {
    if (!rowsEnter || !hasRows) return undefined;
    const box = sceneRef.current;
    const list = box?.querySelector("[data-chat-rows]");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!box || !list || reduce) { setRowsEnter(false); return undefined; }
    const style = getComputedStyle(box);
    const total = cssTimeMs(style.getPropertyValue("--mm-motion-cascade-total"), 1000);
    const hop = cssTimeMs(style.getPropertyValue("--mm-motion-row"), 400);
    const bottom = list.getBoundingClientRect().bottom;
    const rows = Array.from(list.children).filter((node) => node.tagName === rowTag);
    const visible = [];
    for (const row of rows) {
      if (row.getBoundingClientRect().top >= bottom || visible.length >= 20) break;
      visible.push(row);
    }
    const stagger = visible.length > 1 ? Math.min(600, Math.max(60, (total - hop) / (visible.length - 1))) : 0;
    box.style.setProperty("--mm-motion-row-stagger", `${Math.round(stagger)}ms`);
    visible.forEach((row, index) => { row.dataset.hop = ""; row.style.setProperty("--hop", String(index)); });
    const timer = window.setTimeout(() => setRowsEnter(false), stagger * Math.max(0, visible.length - 1) + hop + 200);
    return () => {
      window.clearTimeout(timer);
      visible.forEach((row) => { delete row.dataset.hop; row.style.removeProperty("--hop"); });
    };
  }, [rowsEnter, hasRows]); // eslint-disable-line react-hooks/exhaustive-deps
}
