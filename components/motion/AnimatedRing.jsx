"use client";

import { motion } from "motion/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

// Anel de progresso (SVG) que anima do zero até o percentual atual —
// reutilizável (Meta Diária hoje). Mesma geometria/CSS que já existia
// (círculo de fundo + círculo de progresso rotacionado -90°), só troca a
// transição CSS por uma animação controlada (spring), com fallback linear
// curto quando prefers-reduced-motion está ativo.
export default function AnimatedRing({ percent, radius = 45, strokeWidth = 9, trackColor = "#E5EAF1", color, className = "" }) {
  const reducedMotion = usePrefersReducedMotion();
  const circumference = 2 * Math.PI * radius;
  const safePercent = Math.min(100, Math.max(0, percent));
  const offset = circumference * (1 - safePercent / 100);

  return (
    <svg viewBox="0 0 100 100" className={`-rotate-90 ${className}`}>
      <circle cx="50" cy="50" r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
      <motion.circle
        cx="50" cy="50" r={radius} fill="none"
        stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={reducedMotion ? { duration: 0.15, ease: "linear" } : { type: "spring", stiffness: 120, damping: 20, mass: 1 }}
        style={{ willChange: "stroke-dashoffset" }}
      />
    </svg>
  );
}
