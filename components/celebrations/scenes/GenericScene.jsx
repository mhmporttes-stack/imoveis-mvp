"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import { runCelebrationEffect } from "../celebrationEffects";

// Cena provisória (card + emoji) usada por qualquer gatilho que ainda não
// ganhou uma cena cinematográfica própria (ver Scene100.jsx para o padrão
// aprovado a replicar nos demais).
const ICON_BY_ANIMATION = { confete: "🎉", fogos: "🎆", moedas: "🪙", coroa: "👑", combo_200: "🏆" };

export default function GenericScene({ message, animation = "confete" }) {
  const canvasRef = useRef(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) return undefined;
    return runCelebrationEffect(canvasRef.current, animation);
  }, [animation, reducedMotion]);

  const isDark = animation === "combo_200";

  return (
    <div className={`flex h-full w-full items-center justify-center px-4 ${isDark ? "bg-black/70" : "bg-black/40"}`}>
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
      </motion.div>
    </div>
  );
}
