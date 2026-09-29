"use client";

import { useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

// Número que conta do zero até o valor atual — reutilizável (percentual da
// Meta Diária hoje; pontos do ranking, contagens do funil etc. depois). Só
// anima o texto exibido (e, com `colorStops`, a cor do texto acompanhando o
// mesmo valor em tempo real — nunca só o resultado final); com
// prefers-reduced-motion ativo, pula direto pro valor final.
//
// `introOvershoot`: só na PRIMEIRA contagem, sobe até 100 e volta até o
// valor real, em vez de ir direto — efeito pedido para o percentual da
// Meta Diária. Atualizações seguintes do mesmo componente (ex.: depois de
// registrar uma tentativa) contam direto do valor atual, sem repetir.
export default function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  duration = 0.5,
  introOvershoot = false,
  introDuration = 3,
  colorStops,
  colorStopPositions = [0, 50, 100],
  className = ""
}) {
  const reducedMotion = usePrefersReducedMotion();
  const motionValue = useMotionValue(0);
  const text = useTransform(motionValue, (latest) => format(latest));
  const color = useTransform(motionValue, colorStopPositions, colorStops || colorStopPositions.map(() => "currentColor"));
  const mounted = useRef(false);

  useEffect(() => {
    if (reducedMotion) {
      motionValue.set(value);
      mounted.current = true;
      return;
    }
    let controls;
    if (!mounted.current && introOvershoot) {
      controls = animate(motionValue, [0, 100, value], { duration: introDuration, times: [0, 0.55, 1], ease: ["easeOut", "easeInOut"] });
    } else {
      const from = mounted.current ? motionValue.get() : 0;
      motionValue.set(from);
      controls = animate(motionValue, value, { duration, ease: [0.16, 1, 0.3, 1] });
    }
    mounted.current = true;
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reducedMotion]);

  return (
    <motion.span className={className} style={colorStops ? { color } : undefined}>
      {text}
    </motion.span>
  );
}
