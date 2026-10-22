"use client";

import { useEffect, useRef } from "react";

// Anel de filamentos do Henry (pedido do dono, 2026-10-22: "é nesse perfil que eu quero o ícone da IA… no meu estilo").
// Canvas 2D + requestAnimationFrame, sem biblioteca: N contornos fechados em volta do centro, raio = R + ruído suave (somas
// de senos com fase por fio e por tempo) × amplitude; brilho aditivo ('lighter'); gradiente vertical da paleta do painel
// (dourado suave no topo → ciano → azul). getSignal() devolve { mode: idle|listening|thinking|speaking, level: 0..1 } —
// o nível REAL do microfone (ouvindo) ou da voz (falando). Pausa com a aba oculta ou com sleep=true (fica o último quadro).

const STOPS = [
  [0, "#F3DCA6"],
  [0.16, "#BFF1FF"],
  [0.42, "#4FC3E0"],
  [0.72, "#1E9BFF"],
  [1, "#0B3D91"]
];

// Alvos por estado: amplitude do ruído, inchaço do raio e velocidade do tempo do ruído.
const TARGETS = {
  idle: { amp: 0.45, swell: 0, speed: 0.35 },
  listening: { amp: 0.8, swell: 0.04, speed: 0.9 },
  thinking: { amp: 0.6, swell: 0.02, speed: 0.5 },
  speaking: { amp: 0.95, swell: 0.1, speed: 1.2 }
};

export default function HenryOrb({ size = 320, fibers = 48, points = 120, alpha = 0.16, lineWidth = 0.8, glow = false, getSignal, sleep = false, className = "" }) {
  const canvasRef = useRef(null);
  const signalRef = useRef(getSignal);
  signalRef.current = getSignal;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const center = (size * dpr) / 2;
    const baseRadius = size * dpr * 0.3;
    const seeds = Array.from({ length: fibers }, (_, index) => ({
      a: index * 2.399963 + 0.3,
      b: index * 1.618 + 1.1,
      c: index * 0.731 + 2.7,
      k: 0.65 + ((index * 37) % 100) / 100 * 0.7,
      dir: index % 2 ? 1 : -1,
      offset: Math.sin(index * 12.9898) * 0.018 // espessura da faixa: cada fio um pouco dentro/fora
    }));
    const gradient = context.createLinearGradient(0, center - baseRadius * 1.15, 0, center + baseRadius * 1.25);
    for (const [offset, color] of STOPS) gradient.addColorStop(offset, color);

    let frame = 0;
    let time = 0;
    let last = performance.now();
    const state = { amp: TARGETS.idle.amp, swell: 0, speed: TARGETS.idle.speed, rotation: 0 };

    const draw = (now) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      const signal = signalRef.current?.() || { mode: "idle", level: 0 };
      const target = TARGETS[signal.mode] || TARGETS.idle;
      const level = Math.max(0, Math.min(1, Number(signal.level) || 0));
      const ease = 1 - Math.pow(0.002, delta);
      state.amp += (target.amp + level * (signal.mode === "speaking" ? 1.5 : 1.0) - state.amp) * ease;
      state.swell += (target.swell + level * (signal.mode === "speaking" ? 0.32 : 0.12) - state.swell) * ease;
      state.speed += (target.speed - state.speed) * ease;
      if (signal.mode === "thinking") state.rotation += delta * 0.6;
      time += reduce ? 0 : delta * state.speed;
      const breath = reduce ? 0.015 * Math.sin(now / 900) : 0.012 * Math.sin(now / 1400);
      const amp = reduce ? 0.18 : state.amp;
      const radius = baseRadius * (1 + state.swell + breath);

      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = "lighter";
      context.strokeStyle = gradient;
      for (const seed of seeds) {
        const spin = state.rotation * seed.dir * seed.k;
        const path = new Path2D();
        for (let step = 0; step <= points; step += 1) {
          const theta = (step / points) * Math.PI * 2;
          const noise =
            0.06 * Math.sin(3 * theta + time * 0.9 + seed.a) +
            0.045 * Math.sin(5 * theta - time * 1.3 * seed.k + seed.b) +
            0.03 * Math.sin(9 * theta + time * 2.1 + seed.c) +
            0.018 * Math.sin(15 * theta - time * 2.9 * seed.k + seed.a * 0.5);
          const r = radius * (1 + seed.offset + noise * amp * seed.k);
          const x = center + r * Math.cos(theta + spin);
          const y = center + r * Math.sin(theta + spin);
          if (step === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        }
        path.closePath();
        if (glow) {
          // Halo: o mesmo fio, largo e quase transparente (brilho aditivo sem shadowBlur, que pesa).
          context.globalAlpha = alpha * 0.18;
          context.lineWidth = lineWidth * dpr * 5;
          context.stroke(path);
        }
        context.globalAlpha = alpha;
        context.lineWidth = lineWidth * dpr;
        context.stroke(path);
      }
      context.globalAlpha = 1;
    };

    const loop = (now) => {
      draw(now);
      frame = window.requestAnimationFrame(loop);
    };
    const start = () => {
      if (frame || sleep || document.hidden) return;
      last = performance.now();
      frame = window.requestAnimationFrame(loop);
    };
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    draw(performance.now()); // sempre há um quadro desenhado (inclusive dormindo)
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [size, fibers, points, alpha, lineWidth, glow, sleep]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={{ width: size, height: size }} />;
}
