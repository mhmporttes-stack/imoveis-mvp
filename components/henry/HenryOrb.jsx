"use client";

import { useEffect, useRef } from "react";
import { HENRY_ORB_STATES, mixHexColor, orbEase, orbStops } from "./henry-orb-states.mjs";

// Anel de filamentos do Henry (pedido do dono, 2026-10-22: "é nesse perfil que eu quero o ícone da IA… no meu estilo";
// depois "quero mais movimentos quando ele escutar, falar ou pensar"). Canvas 2D + requestAnimationFrame, sem biblioteca:
// N contornos fechados em volta do centro, raio = R + ruído suave (somas de senos) × amplitude; brilho aditivo
// ('lighter'). getSignal() devolve { mode: idle|listening|thinking|speaking, level: 0..1 } — nível REAL do microfone
// (ouvindo) ou da voz de saída (falando). Cada estado tem alvos próprios (henry-orb-states.mjs) e TODOS os parâmetros são
// interpolados (~300 ms), então não há corte entre estados:
//   parado   = respiração lenta e leve rotação;
//   ouvindo  = ondas rápidas que percorrem o anel seguindo o volume, brilho ciano pulsando com cada sílaba;
//   pensando = camadas girando em sentidos opostos, anel contraindo/expandindo, feixe dourado percorrendo o contorno;
//   falando  = incha com a voz, fios abrem em leque e o anel vira quase esfera nos picos, cor quente (dourado e branco).
// devicePixelRatio ≤ 2; pausa com a aba oculta ou sleep=true (fica o último quadro); prefers-reduced-motion = quase parado.

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
    const count = Math.min(60, fibers);
    const seeds = Array.from({ length: count }, (_, index) => ({
      a: index * 2.399963 + 0.3,
      b: index * 1.618 + 1.1,
      c: index * 0.731 + 2.7,
      k: 0.65 + ((index * 37) % 100) / 100 * 0.7,
      dir: index % 2 ? 1 : -1,
      offset: Math.sin(index * 12.9898) * 0.018, // espessura da faixa: cada fio um pouco dentro/fora
      tilt: ((index + 0.5) / count) * Math.PI, // meridiano da "esfera" (falando nos picos)
      turn: index * 0.61803 * Math.PI // orientação do meridiano
    }));

    let frame = 0;
    let time = 0;
    let last = performance.now();
    const state = { ...HENRY_ORB_STATES.idle, rotation: 0, counter: 0, beam: 0, level: 0 };

    const draw = (now) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      const signal = signalRef.current?.() || { mode: "idle", level: 0 };
      const target = HENRY_ORB_STATES[signal.mode] || HENRY_ORB_STATES.idle;
      const raw = Math.max(0, Math.min(1, Number(signal.level) || 0));
      // Nível com ataque rápido e soltura mais lenta (cada sílaba vira um pulso visível).
      state.level += (raw - state.level) * (raw > state.level ? 0.55 : 0.12);
      const ease = orbEase(delta);
      for (const key of Object.keys(target)) state[key] += (target[key] - state[key]) * ease;
      const level = reduce ? 0 : state.level;

      time += reduce ? 0 : delta * (state.speed + level * state.levelSpeed);
      if (!reduce) {
        state.rotation += delta * state.spin;
        state.counter += delta * state.counterSpin;
        state.beam += delta * 2.6;
      }
      const breath = reduce ? 0.01 * Math.sin(now / 1600) : state.breath * Math.sin((now / 1000) * state.breathRate * Math.PI * 2);
      const swell = state.swell + level * state.levelSwell + breath;
      const amp = reduce ? 0.18 : state.amp + level * state.levelAmp;
      const sphere = reduce ? 0 : Math.min(1, state.sphere * (0.25 + level * 1.1));
      const fan = state.fan * (0.4 + level);
      // Nunca passa da borda do canvas: o pico máximo possível (inchaço × leque × ondulação) cabe em ~93% da metade.
      const peak = (1 + swell) * (1 + 0.02 * (1 + fan * 6) + 0.25 * amp * 1.35);
      const radius = baseRadius * (1 + swell) * Math.min(1, (center * 0.93) / (baseRadius * peak));

      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = "lighter";

      // Brilho de fundo: ciano pulsando com a voz (ouvindo) ou dourado quente (falando).
      const glowAlpha = state.glowBase + level * state.glowLevel;
      if (glowAlpha > 0.01) {
        // Termina antes da borda do canvas (senão aparece o quadrado do canvas quando o anel incha).
        const halo = context.createRadialGradient(center, center, radius * 0.4, center, center, Math.min(radius * 1.6, center * 0.98));
        const tint = mixHexColor("#4FC3E0", "#F3DCA6", state.warm);
        halo.addColorStop(0, `${tint}00`);
        halo.addColorStop(0.55, `${tint}${Math.round(Math.min(1, glowAlpha) * 90).toString(16).padStart(2, "0")}`);
        halo.addColorStop(1, `${tint}00`);
        context.globalAlpha = 1;
        context.fillStyle = halo;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      const gradient = context.createLinearGradient(0, center - radius * 1.2, 0, center + radius * 1.3);
      for (const [offset, color] of orbStops(state.warm)) gradient.addColorStop(offset, color);
      context.strokeStyle = gradient;

      for (const seed of seeds) {
        const spin = state.rotation * seed.k + state.counter * seed.dir * seed.k;
        const squash = 1 - sphere * (1 - Math.abs(Math.cos(seed.tilt)));
        const turn = seed.turn * sphere;
        const cosT = Math.cos(turn);
        const sinT = Math.sin(turn);
        const spread = 1 + seed.offset * (1 + fan * 6);
        const path = new Path2D();
        for (let step = 0; step <= points; step += 1) {
          const theta = (step / points) * Math.PI * 2;
          const noise =
            0.06 * Math.sin(3 * theta + time * 0.9 + seed.a) +
            0.045 * Math.sin(5 * theta - time * 1.3 * seed.k + seed.b) +
            0.03 * Math.sin(9 * theta + time * 2.1 + seed.c) +
            0.018 * Math.sin(15 * theta - time * 2.9 * seed.k + seed.a * 0.5) +
            state.travel * (0.35 + level) * 0.07 * Math.sin(4 * theta - time * 5.5 + seed.dir * 0.4); // onda que percorre o anel
          const r = radius * (spread + noise * amp * seed.k);
          const ex = r * Math.cos(theta + spin);
          const ey = r * Math.sin(theta + spin) * squash;
          const x = center + ex * cosT - ey * sinT;
          const y = center + ex * sinT + ey * cosT;
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
        context.globalAlpha = Math.min(1, alpha * (1 + level * 0.6));
        context.lineWidth = lineWidth * dpr;
        context.stroke(path);
      }

      // Feixe dourado percorrendo o contorno (pensando): cabeça brilhante e cauda que some.
      if (state.beamOn > 0.02 && !reduce) {
        const segments = 14;
        for (let index = 0; index < segments; index += 1) {
          const start = state.beam - index * 0.07;
          context.globalAlpha = state.beamOn * (1 - index / segments) * 0.9;
          context.lineWidth = lineWidth * dpr * (index === 0 ? 3.2 : 2.2);
          context.strokeStyle = index < 3 ? "#FFF6DD" : "#F3DCA6";
          context.beginPath();
          context.arc(center, center, radius * 1.04, start - 0.08, start);
          context.stroke();
        }
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

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={{ width: size, height: size, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", pointerEvents: "none" }} />;
}
