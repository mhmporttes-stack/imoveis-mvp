"use client";

import { motion } from "motion/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

// Card que "nasce" com uma transição spring suave (escala + leve
// deslocamento), em vez de simplesmente aparecer. Reutilizável em qualquer
// card do painel (Meta Diária hoje; funil, ranking etc. depois) — só anima
// transform/opacity (performance no celular). Com prefers-reduced-motion
// ativo, troca para um fade simples sem escala/deslocamento.
export default function RevealCard({ children, className = "", delay = 0, as = "div", ...rest }) {
  const reducedMotion = usePrefersReducedMotion();
  const MotionTag = motion[as] || motion.div;

  return (
    <MotionTag
      className={className}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={
        reducedMotion
          ? { duration: 0.15, ease: "linear" }
          : { type: "spring", stiffness: 260, damping: 26, mass: 0.9, delay }
      }
      style={{ willChange: "transform, opacity" }}
      {...rest}
    >
      {children}
    </MotionTag>
  );
}
