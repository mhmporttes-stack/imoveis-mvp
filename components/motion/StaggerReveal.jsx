"use client";

import { motion } from "motion/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

// Container + item reutilizáveis para uma lista/grid que entra em sequência
// (stagger) — usar StaggerContainer envolvendo vários StaggerItem. Pensado
// pros "itens de detalhe" de qualquer card (grupos da Meta Diária hoje;
// linhas do funil/ranking depois). Só transform/opacity; com
// prefers-reduced-motion ativo, os itens aparecem juntos (fade, sem atraso
// entre eles).
export function StaggerContainer({ children, className = "", staggerChildren = 0.06, delayChildren = 0.1, as = "div", ...rest }) {
  const reducedMotion = usePrefersReducedMotion();
  const MotionTag = motion[as] || motion.div;

  return (
    <MotionTag
      className={className}
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: reducedMotion ? { duration: 0 } : { staggerChildren, delayChildren } } }}
      {...rest}
    >
      {children}
    </MotionTag>
  );
}

export function StaggerItem({ children, className = "", as = "div", ...rest }) {
  const reducedMotion = usePrefersReducedMotion();
  const MotionTag = motion[as] || motion.div;

  return (
    <MotionTag
      className={className}
      variants={{
        hidden: reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          transition: reducedMotion ? { duration: 0.15, ease: "linear" } : { type: "spring", stiffness: 280, damping: 26 }
        }
      }}
      style={{ willChange: "transform, opacity" }}
      {...rest}
    >
      {children}
    </MotionTag>
  );
}
