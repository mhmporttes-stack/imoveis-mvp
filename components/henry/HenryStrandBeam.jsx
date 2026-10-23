"use client";

import { useEffect, useRef } from "react";
import { pulseEase } from "@/lib/henry-pulse-core.mjs";
import { HENRY_BEAM_GROW_MS, drawStrandBeam, quadraticPoint } from "./henry-strand-beam.mjs";

export { HENRY_BEAM_CYAN, HENRY_BEAM_GOLD } from "./henry-strand-beam.mjs";

// Feixe padrão do Henry (dono, 2026-10-23, protótipo v18): TODA linha que liga o Henry a uma informação é o mesmo feixe
// dos cards do Pulso — 5 fios finos vibrando bem juntos, gradiente da cor até o branco, 2 gotinhas brancas correndo,
// saindo da borda do anel e crescendo até o card em ~600 ms. Usado pelo Pulso do CRM (HenryPulse), pelo card do Spotify
// (HenryMusicScene) e pelos cards/scanner de corretor (HenryBrokerCards). Não crie outro desenho de feixe.

// Camada de canvas (mesmo sistema de coordenadas do SVG das cenas, size × size, com sobra em volta) com os feixes padrão.
// beams = [{ id, start: [x,y], control: [x,y], end: [x,y], color }]; cada id cresce do anel até o card em ~600 ms ao
// aparecer. Laço só com a aba visível; movimento reduzido = linha inteira e parada.
export function HenryStrandBeams({ beams = [], size, reduced = false, hidden = false, className = "" }) {
  const canvasRef = useRef(null);
  // Os cards ficam FORA do quadrado do anel (o SVG antigo usava overflow visível): a tela sobra `pad` de cada lado.
  const pad = Math.round(size * 0.45);
  const full = size + pad * 2;
  const beamsRef = useRef(beams);
  const bornRef = useRef(new Map());
  beamsRef.current = beams;
  // Movimento reduzido desenha uma vez: redesenha quando um feixe muda (id, cor ou ponta).
  const beamsKey = beams.map((beam) => `${beam.id}:${beam.color}:${beam.end.join(",")}`).join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(full * dpr);
    canvas.height = Math.round(full * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, pad * dpr, pad * dpr); // origem = canto do contêiner das cenas
    let frame = 0;
    const draw = (t) => {
      ctx.clearRect(-pad, -pad, full, full);
      const born = bornRef.current;
      const ids = new Set();
      for (const beam of beamsRef.current) {
        ids.add(beam.id);
        if (!born.has(beam.id)) born.set(beam.id, { at: t, seed: Math.random() * 1000 });
        const meta = born.get(beam.id);
        const grow = reduced ? 1 : Math.min(1, (t - meta.at) / HENRY_BEAM_GROW_MS);
        drawStrandBeam(ctx, { point: quadraticPoint(beam.start, beam.control, beam.end), sx: beam.start[0], sy: beam.start[1], reach: pulseEase(grow), color: beam.color, t, seed: meta.seed, reduced });
      }
      for (const id of [...born.keys()]) if (!ids.has(id)) born.delete(id);
    };
    const loop = (t) => {
      draw(t);
      frame = reduced ? 0 : window.requestAnimationFrame(loop);
    };
    if (!hidden) frame = window.requestAnimationFrame(loop);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [size, reduced, hidden, beamsKey]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={{ position: "absolute", left: -pad, top: -pad, width: full, height: full, pointerEvents: "none" }} />;
}
