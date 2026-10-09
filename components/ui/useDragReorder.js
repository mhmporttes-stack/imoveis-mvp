"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Arrastar para reordenar (pedido do dono, 2026-10-09 — "não quero setinha; clicar e arrastar, ou no aplicativo segurar e
// mover"). Sem biblioteca: Pointer Events.
//  - mouse/caneta: arrasta depois de mover 5 px;
//  - toque: segurar ~0,3 s (sem mexer) e mover; mexer antes disso rola a página normalmente.
// Enquanto arrasta, o item segue o dedo/ponteiro e a lista troca de lugar ao passar por cima de outro item
// (onMove(from, to) é chamado a cada troca). Botões dentro do item (ex.: remover) continuam clicáveis.
const LONG_PRESS_MS = 300;
const MOUSE_THRESHOLD = 5;
const TOUCH_TOLERANCE = 8;

export function moveItem(list, from, to) {
  const items = Array.isArray(list) ? [...list] : [];
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  return items;
}

export function useDragReorder(onMove) {
  const nodes = useRef(new Map());
  const state = useRef(null);
  const timer = useRef(null);
  const onMoveRef = useRef(onMove);
  const [dragging, setDragging] = useState(-1);
  onMoveRef.current = onMove;

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const applyTransform = useCallback((x, y) => {
    const s = state.current;
    const node = s && nodes.current.get(s.index);
    if (!node) return;
    // Posição "de base" do item (sem o transform atual) -> desloca para seguir o ponteiro.
    node.style.transform = "";
    const rect = node.getBoundingClientRect();
    node.style.transform = `translate(${x - s.grabX - rect.left}px, ${y - s.grabY - rect.top}px) scale(1.03)`;
  }, []);

  const end = useCallback(() => {
    clearTimer();
    const s = state.current;
    if (s?.active) {
      const node = nodes.current.get(s.index);
      if (node) node.style.transform = "";
      // Depois de arrastar, o "click" que o navegador gera ao soltar não pode disparar nada.
      const stop = (event) => { event.preventDefault(); event.stopPropagation(); };
      window.addEventListener("click", stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 300);
    }
    state.current = null;
    setDragging(-1);
  }, []);

  const activate = useCallback(() => {
    const s = state.current;
    if (!s) return;
    s.active = true;
    setDragging(s.index);
    navigator.vibrate?.(15);
    applyTransform(s.lastX, s.lastY);
  }, [applyTransform]);

  useEffect(() => {
    function onPointerMove(event) {
      const s = state.current;
      if (!s || event.pointerId !== s.pointerId) return;
      s.lastX = event.clientX;
      s.lastY = event.clientY;
      const moved = Math.hypot(event.clientX - s.startX, event.clientY - s.startY);
      if (!s.active) {
        if (s.touch) {
          if (moved > TOUCH_TOLERANCE) { clearTimer(); state.current = null; }
          return;
        }
        if (moved < MOUSE_THRESHOLD) return;
        activate();
      }
      // Trocou de lugar ao passar por cima de outro item.
      for (const [index, node] of nodes.current) {
        if (index === s.index || !node) continue;
        const rect = node.getBoundingClientRect();
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
          const from = s.index;
          s.index = index;
          const previous = nodes.current.get(from);
          if (previous) previous.style.transform = "";
          setDragging(index);
          onMoveRef.current?.(from, index);
          break;
        }
      }
      requestAnimationFrame(() => applyTransform(event.clientX, event.clientY));
    }
    // No celular, depois que o arraste começa, o dedo não pode rolar a página.
    function onTouchMove(event) {
      if (state.current?.active) event.preventDefault();
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("touchmove", onTouchMove);
      clearTimer();
    };
  }, [activate, applyTransform, end]);

  function itemProps(index) {
    return {
      ref: (node) => {
        if (node) nodes.current.set(index, node);
        else nodes.current.delete(index);
      },
      onPointerDown: (event) => {
        if (event.button > 0) return;
        if (event.target.closest?.("button, input, select, textarea, a, [data-no-drag]")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const touch = event.pointerType === "touch";
        state.current = {
          index, pointerId: event.pointerId, touch, active: false,
          startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY,
          grabX: event.clientX - rect.left, grabY: event.clientY - rect.top
        };
        if (touch) {
          clearTimer();
          timer.current = setTimeout(activate, LONG_PRESS_MS);
        }
      },
      onContextMenu: (event) => { if (state.current) event.preventDefault(); },
      onDragStart: (event) => event.preventDefault(),
      "data-dragging": dragging === index ? "true" : undefined
    };
  }

  // Classes para juntar às do próprio item.
  function itemClass(index) {
    return `select-none touch-manipulation [-webkit-touch-callout:none] ${dragging === index ? "relative z-30 cursor-grabbing shadow-2xl ring-2 ring-brand" : "cursor-grab"}`;
  }

  return { itemProps, itemClass, dragging };
}
