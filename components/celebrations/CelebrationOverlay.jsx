"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { runCelebrationEffect } from "./celebrationEffects";

const ICON_BY_ANIMATION = { confete: "🎉", fogos: "🎆", moedas: "🪙", coroa: "👑", combo_200: "🏆" };
const DURATION_MS = { confete: 4000, fogos: 4500, moedas: 4000, coroa: 4000, combo_200: 5000 };

// Overlay central com card + animação por cima, leve escurecimento do fundo
// (mais escuro no combo dos 200%). Fecha sozinho (3-5s) ou por clique/toque,
// nunca bloqueia o resto do CRM (position: fixed, sem travar formulários).
// previewMode = true é usado pelo botão "Testar" do admin: mesmo componente,
// nenhuma chamada de rede, nenhum evento gravado.
export default function CelebrationOverlay({ message, animation = "confete", onDismiss, previewMode = false }) {
  const canvasRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const handler = (event) => setReducedMotion(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (reducedMotion) return undefined;
    return runCelebrationEffect(canvasRef.current, animation);
  }, [animation, reducedMotion]);

  useEffect(() => {
    const duration = DURATION_MS[animation] || 4000;
    const timer = setTimeout(() => onDismiss?.(), duration);
    return () => clearTimeout(timer);
  }, [animation, onDismiss]);

  const isDark = animation === "combo_200";

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center px-4 ${isDark ? "bg-black/70" : "bg-black/40"}`}
      onClick={() => onDismiss?.()}
      role="dialog"
      aria-modal="true"
      aria-label="Reconhecimento"
    >
      {!reducedMotion ? <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" /> : null}
      <motion.div
        initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.85, y: reducedMotion ? 0 : 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0.2 : 0.35, ease: "easeOut" }}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-sm rounded-[28px] border border-line bg-white p-8 text-center shadow-soft"
      >
        <div className="text-5xl leading-none">{ICON_BY_ANIMATION[animation] || "🎉"}</div>
        <p className="mt-4 text-lg font-black leading-snug text-navy">{message}</p>
        <button type="button" onClick={() => onDismiss?.()} className="mt-6 text-sm font-bold text-muted underline">
          {previewMode ? "Fechar prévia" : "Fechar"}
        </button>
      </motion.div>
    </div>
  );
}
