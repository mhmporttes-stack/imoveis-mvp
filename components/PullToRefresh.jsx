"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { classifyMove, isPullBlocked, phaseFor, pullDistance, pullLabel, PULL_HOLD_MS, PULL_MAX_PX } from "@/components/pull-to-refresh-core.mjs";
import { isHenryFullscreenOpen } from "@/lib/henry-fullscreen-signal.mjs";

// Puxar para atualizar (dono, 2026-11-04: "quando eu arrastar para baixo, segurar um pouquinho e soltar, ele atualiza o
// aplicativo; aparece algo como 'carregando'"). Só no painel; recarrega a página inteira (o mesmo que fechar e abrir). Regras
// em components/pull-to-refresh-core.mjs. Não atrapalha rolagem: só age com a tela no topo e puxada para baixo; digitando,
// com gaveta/modal aberto ou lista interna rolada, nada acontece.

const FIELD_SELECTOR = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-no-pull]";
const DIALOG_SELECTOR = "dialog[open], [role='dialog']";

function scrollerOffTop(target) {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const scrollable = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    if (scrollable && node.scrollTop > 0) return true;
    node = node.parentElement;
  }
  return false;
}

export default function PullToRefresh() {
  const [ui, setUi] = useState({ phase: "idle", distance: 0 });
  const state = useRef({ active: false, pulling: false, startX: 0, startY: 0, overAt: 0, refreshing: false });
  const uiRef = useRef(ui);
  uiRef.current = ui;

  useEffect(() => {
    const reset = () => {
      state.current.active = false;
      state.current.pulling = false;
      state.current.overAt = 0;
      setUi({ phase: "idle", distance: 0 });
    };

    const onStart = (event) => {
      const s = state.current;
      if (s.refreshing || event.touches.length !== 1) return;
      const target = event.target;
      const pageTop = Math.max(window.scrollY || 0, document.scrollingElement?.scrollTop || 0);
      const blocked = isPullBlocked({
        insideField: target instanceof Element && Boolean(target.closest(FIELD_SELECTOR)),
        insideDialog: target instanceof Element && Boolean(target.closest(DIALOG_SELECTOR)),
        overlayOpen: document.documentElement.classList.contains("ui-sheet-open") || isHenryFullscreenOpen(),
        scrollerOffTop: scrollerOffTop(target),
        pageOffTop: pageTop > 0
      });
      if (blocked) return;
      s.active = true;
      s.pulling = false;
      s.overAt = 0;
      s.startX = event.touches[0].clientX;
      s.startY = event.touches[0].clientY;
    };

    const onMove = (event) => {
      const s = state.current;
      if (!s.active || event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - s.startX;
      const dy = event.touches[0].clientY - s.startY;
      if (!s.pulling) {
        const move = classifyMove({ dx, dy });
        if (move === "ignore") { s.active = false; return; }
        if (move === "wait") return;
        s.pulling = true;
      }
      if (event.cancelable) event.preventDefault(); // sem o "elástico" do iPhone enquanto puxa
      const distance = pullDistance(dy);
      if (phaseFor({ distance, heldMs: PULL_HOLD_MS }) === "pulling" || distance <= 0) s.overAt = 0;
      else if (!s.overAt) s.overAt = Date.now();
      const heldMs = s.overAt ? Date.now() - s.overAt : 0;
      setUi({ phase: phaseFor({ distance, heldMs }), distance });
    };

    // Segurar parado também conta: reavalia a fase enquanto o dedo está na tela.
    const timer = setInterval(() => {
      const s = state.current;
      if (!s.active || !s.pulling) return;
      const current = uiRef.current;
      if (current.phase !== "ready" || !s.overAt) return;
      const heldMs = Date.now() - s.overAt;
      const phase = phaseFor({ distance: current.distance, heldMs });
      if (phase !== current.phase) setUi({ phase, distance: current.distance });
    }, 80);

    const onEnd = () => {
      const s = state.current;
      if (!s.active) return;
      const armed = s.pulling && uiRef.current.phase === "armed";
      if (!armed) { reset(); return; }
      s.refreshing = true;
      s.active = false;
      setUi({ phase: "refreshing", distance: 56 });
      // Dá um instante para o "Atualizando…" aparecer; recarrega a página inteira (como fechar e abrir).
      setTimeout(() => window.location.reload(), 120);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      clearInterval(timer);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", reset);
    };
  }, []);

  if (ui.phase === "idle") return null;
  const refreshing = ui.phase === "refreshing";
  const progress = Math.min(1, ui.distance / 64);
  const offset = Math.min(ui.distance, PULL_MAX_PX);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)", transform: `translateY(${Math.max(0, offset - 44)}px)`, opacity: refreshing ? 1 : 0.35 + progress * 0.65 }}
    >
      <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-sm font-extrabold text-ink shadow-soft">
        <RefreshCw className={`h-4 w-4 text-accent-text ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} style={refreshing ? undefined : { transform: `rotate(${Math.round(progress * 270)}deg)` }} aria-hidden="true" />
        {pullLabel(ui.phase)}
      </span>
    </div>
  );
}
