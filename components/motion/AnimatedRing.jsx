"use client";

import { useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

// Anel de progresso (SVG) que anima do zero até o percentual atual —
// reutilizável (Meta Diária hoje). Um único motion value controla a posição
// do traço E a cor (quando `colorStops` é informado), então as duas coisas
// sempre andam juntas, em qualquer ponto da animação — nunca só o resultado
// final.
//
// `introOvershoot`: só na PRIMEIRA vez que o anel aparece (ex.: ao entrar na
// tela), sobe até 100% e volta até o percentual real, em vez de ir direto —
// efeito pedido para a Meta Diária. Atualizações seguintes do mesmo
// percentual (ex.: depois de registrar uma tentativa) animam direto, sem
// repetir o efeito.
export default function AnimatedRing({
  percent,
  radius = 45,
  strokeWidth = 9,
  trackColor = "#E5EAF1",
  color = "#0d3b66",
  colorStops,
  colorStopPositions = [0, 50, 100],
  introOvershoot = false,
  introDuration = 3,
  updateDuration = 0.6,
  className = ""
}) {
  const reducedMotion = usePrefersReducedMotion();
  const circumference = 2 * Math.PI * radius;
  const safePercent = Math.min(100, Math.max(0, percent));
  const mounted = useRef(false);

  const percentValue = useMotionValue(0);
  const dashOffset = useTransform(percentValue, (value) => circumference * (1 - Math.min(100, Math.max(0, value)) / 100));
  const stroke = useTransform(percentValue, colorStopPositions, colorStops || colorStopPositions.map(() => color));

  useEffect(() => {
    if (reducedMotion) {
      percentValue.set(safePercent);
      mounted.current = true;
      return;
    }
    let controls;
    if (!mounted.current && introOvershoot) {
      controls = animate(percentValue, [0, 100, safePercent], { duration: introDuration, times: [0, 0.55, 1], ease: ["easeOut", "easeInOut"] });
    } else {
      controls = animate(percentValue, safePercent, { duration: updateDuration, ease: [0.16, 1, 0.3, 1] });
    }
    mounted.current = true;
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePercent, reducedMotion]);

  return (
    <svg viewBox="0 0 100 100" className={`-rotate-90 ${className}`}>
      <circle cx="50" cy="50" r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
      <motion.circle
        cx="50" cy="50" r={radius} fill="none"
        strokeWidth={strokeWidth} strokeLinecap="round"
        strokeDasharray={circumference}
        style={{ stroke: colorStops ? stroke : color, strokeDashoffset: dashOffset, willChange: "stroke-dashoffset" }}
      />
    </svg>
  );
}
