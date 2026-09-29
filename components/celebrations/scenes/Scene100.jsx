"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import AnimatedRing from "@/components/motion/AnimatedRing";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { StaggerContainer, StaggerItem } from "@/components/motion/StaggerReveal";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import { burstConfettiExplosion, getParticleQuality } from "../celebrationEffects";

// Cena cinematográfica dos 100% da Meta Diária: anel dourado que se desenha
// até fechar, pulso de luz + explosão de confete no fechamento, e o texto
// entrando em cascata, palavra por palavra. Isolada e ajustável — ver
// comentários pontuais para o que mexer em cor/duração/partículas.
const RING_DURATION_S = 1.4;
const RING_DELAY_S = 0.35;

export default function Scene100({ message }) {
  const reducedMotion = usePrefersReducedMotion();
  const canvasRef = useRef(null);
  const [peaked, setPeaked] = useState(false);

  useEffect(() => {
    if (reducedMotion) return undefined;
    const timer = setTimeout(() => setPeaked(true), (RING_DELAY_S + RING_DURATION_S) * 1000);
    return () => clearTimeout(timer);
  }, [reducedMotion]);

  useEffect(() => {
    if (!peaked || reducedMotion) return undefined;
    return burstConfettiExplosion(canvasRef.current, { quality: getParticleQuality() });
  }, [peaked, reducedMotion]);

  const words = message.split(" ").filter(Boolean);

  if (reducedMotion) {
    return (
      <motion.div
        className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#04101f] px-6 text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <p className="text-6xl font-extrabold text-[var(--cel-gold)]">100%</p>
        <p className="max-w-sm text-xl font-extrabold text-white">{message}</p>
      </motion.div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {/* Fundo: gradiente escuro + vinheta nas bordas — troque as cores aqui. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 50% 40%, #0a1f3d 0%, #04101f 65%, #020810 100%)" }}
      />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(circle, transparent 35%, rgba(0,0,0,0.65) 100%)" }}
      />

      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Brilho radial atrás do anel — ajuste blur/tamanho aqui. */}
      <motion.div
        className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(closest-side, var(--cel-gold), transparent 70%)", filter: "blur(55px)" }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: peaked ? 0.95 : 0.55, scale: peaked ? 1.2 : 1 }}
        transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
      />

      {/* Pulso de luz no fechamento do anel. */}
      {peaked ? (
        <motion.div
          className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          initial={{ opacity: 0.85, scale: 0.4 }}
          animate={{ opacity: 0, scale: 3.4 }}
          transition={{ duration: 0.65, ease: "easeOut" }}
        />
      ) : null}

      <div className="relative flex flex-col items-center gap-7 px-6 text-center">
        <motion.div
          className="relative h-56 w-56 sm:h-64 sm:w-64"
          initial={{ opacity: 0, scale: 0.7, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 160, damping: 18, delay: RING_DELAY_S }}
        >
          <AnimatedRing
            percent={100}
            radius={44}
            strokeWidth={7}
            trackColor="rgba(255,255,255,0.14)"
            color="var(--cel-gold)"
            updateDuration={RING_DURATION_S}
            className="h-full w-full"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatedNumber
              value={100}
              format={(n) => `${Math.round(n)}%`}
              duration={RING_DURATION_S}
              className="text-5xl font-extrabold tabular-nums text-white sm:text-6xl [text-shadow:0_0_28px_var(--cel-gold)]"
            />
          </div>
        </motion.div>

        <StaggerContainer
          className="flex max-w-md flex-wrap justify-center gap-x-2.5 gap-y-1"
          delayChildren={RING_DELAY_S + RING_DURATION_S + 0.2}
          staggerChildren={0.09}
        >
          {words.map((word, index) => (
            <StaggerItem
              key={`${word}-${index}`}
              className="text-2xl font-extrabold text-white sm:text-3xl [text-shadow:0_0_18px_rgba(244,200,107,0.55)]"
            >
              {word}
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </div>
  );
}
