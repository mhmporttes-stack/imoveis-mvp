"use client";

import { useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

// Número que conta do zero até o valor atual — reutilizável (percentual da
// Meta Diária hoje; pontos do ranking, contagens do funil etc. depois). Só
// anima o texto exibido; com prefers-reduced-motion ativo, pula direto pro
// valor final.
export default function AnimatedNumber({ value, format = (n) => String(Math.round(n)), duration = 0.5, className = "" }) {
  const reducedMotion = usePrefersReducedMotion();
  const motionValue = useMotionValue(0);
  const text = useTransform(motionValue, (latest) => format(latest));
  const mounted = useRef(false);

  useEffect(() => {
    if (reducedMotion) {
      motionValue.set(value);
      return;
    }
    // Primeira montagem sempre conta do zero (efeito pedido); atualizações
    // seguintes do mesmo valor animam a partir do valor atual exibido.
    const from = mounted.current ? motionValue.get() : 0;
    motionValue.set(from);
    const controls = animate(motionValue, value, { duration, ease: [0.16, 1, 0.3, 1] });
    mounted.current = true;
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reducedMotion]);

  return <motion.span className={className}>{text}</motion.span>;
}
