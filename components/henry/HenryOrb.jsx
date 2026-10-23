"use client";

import { useEffect, useRef } from "react";
import { HENRY_ORB_STATES, buildNeuralNet, mixHexColor, orbEase, orbStops } from "./henry-orb-states.mjs";

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
//   esperando = conversa aberta (ainda escuta sem o nome): brilho pulsando de leve no contorno;
//   parado também fica escurecido (dim), para não confundir com "esperando".
// Rede neural no centro (dono, 2026-10-23: "neurônios se conectando ali, entre os círculos, um ligando ao outro"): só
// pensando/buscando. Nós de luz ligados por filamentos finos no mesmo estilo dos fios; pulsos (sinapses) correm de um nó a
// outro e acendem o nó de chegada, às vezes disparando o seguinte; ligações aparecem e somem; tentáculos tocam os anéis de
// dentro. Intensidade = signal.activity (papo calmo, dados/web/relatório intenso) + signal.burst (evento de progresso).
// Ao começar a falar, neural → 0 em ~300 ms (os nós se abrem para os anéis e apagam). nodes = quantidade de nós (ícone: poucos).
// devicePixelRatio ≤ 2; pausa com a aba oculta ou sleep=true (fica o último quadro); prefers-reduced-motion = quase parado
// (rede com nós e ligações estáticos, só um leve fade).

export default function HenryOrb({ size = 320, fibers = 48, points = 120, alpha = 0.16, lineWidth = 0.8, glow = false, nodes = 22, getSignal, sleep = false, className = "" }) {
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

    const net = buildNeuralNet(nodes);
    const adjacency = net.nodes.map(() => []);
    net.edges.forEach((edge, index) => {
      adjacency[edge.a].push(index);
      adjacency[edge.b].push(index);
    });
    const flashes = new Float32Array(net.nodes.length);
    const edgeStrength = new Float32Array(net.edges.length);
    const edgeCurve = net.edges.map(() => new Float32Array(6));
    const tendrilStrength = new Float32Array(net.tendrils.length);
    const tendrilCurve = net.tendrils.map(() => new Float32Array(6));
    const pulses = [];
    const sparks = [];
    const unit = dpr * Math.max(0.55, Math.min(1.2, size / 420));
    let netTime = 0;
    let spawnDebt = 0;

    let frame = 0;
    let time = 0;
    let last = performance.now();
    const state = { ...HENRY_ORB_STATES.idle, rotation: 0, counter: 0, beam: 0, level: 0, activity: 0 };

    const bezier = (curve, t) => {
      const u = 1 - t;
      return [u * u * curve[0] + 2 * u * t * curve[2] + t * t * curve[4], u * u * curve[1] + 2 * u * t * curve[3] + t * t * curve[5]];
    };
    const strokeCurve = (curve) => {
      context.beginPath();
      context.moveTo(curve[0], curve[1]);
      context.quadraticCurveTo(curve[2], curve[3], curve[4], curve[5]);
      context.stroke();
    };
    const dot = (x, y, r) => {
      context.beginPath();
      context.arc(x, y, r, 0, Math.PI * 2);
      context.fill();
    };
    const spawnPulse = (fromNode = -1) => {
      if (pulses.length >= 36) return;
      if (fromNode < 0 && net.tendrils.length && Math.random() < 0.18) {
        const index = Math.floor(Math.random() * net.tendrils.length);
        if (tendrilStrength[index] > 0.25) pulses.push({ tendril: true, index, forward: true, t: 0, speed: 0.9 + Math.random() * 0.7, gold: Math.random() < 0.25 });
        return;
      }
      const options = fromNode >= 0 ? adjacency[fromNode] : null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const index = options ? options[Math.floor(Math.random() * options.length)] : Math.floor(Math.random() * net.edges.length);
        if (index == null || edgeStrength[index] < 0.25) continue;
        const edge = net.edges[index];
        const forward = fromNode >= 0 ? edge.a === fromNode : Math.random() < 0.5;
        pulses.push({ tendril: false, index, forward, t: 0, speed: 1.1 + Math.random() * 1.1, gold: edge.gold || Math.random() < 0.15 });
        return;
      }
    };

    // Rede neural do centro (pensando/buscando). radius = raio atual do anel.
    const drawNeural = (now, delta, radius) => {
      const on = state.neural;
      if (on < 0.02) {
        pulses.length = 0;
        sparks.length = 0;
        return;
      }
      const activity = reduce ? 0.4 : state.activity;
      if (!reduce) netTime += delta * (0.45 + activity * 1.1);
      const spread = radius * (1 + (1 - on) * 0.35); // ao se desfazer, os nós se abrem em direção aos anéis
      const fade = on * (reduce ? 0.75 + 0.25 * Math.sin(now / 1800) : 1);
      const pos = net.nodes.map((node) => {
        const wobble = reduce ? 0 : 0.035;
        return [center + spread * (node.x + wobble * Math.sin(netTime * 0.8 + node.phase)), center + spread * (node.y + wobble * Math.cos(netTime * 0.65 + node.phase * 1.3))];
      });
      const strengthOf = (seed, rate) =>
        reduce ? (Math.sin(seed * 3.7) > -0.3 ? 0.6 : 0) : Math.max(0, Math.min(1, 0.45 + 0.9 * Math.sin(netTime * rate + seed) + (activity - 0.5) * 0.9));
      const curveInto = (curve, ax, ay, bx, by, bend) => {
        const dx = bx - ax;
        const dy = by - ay;
        curve[0] = ax;
        curve[1] = ay;
        curve[2] = (ax + bx) / 2 - dy * bend;
        curve[3] = (ay + by) / 2 + dx * bend;
        curve[4] = bx;
        curve[5] = by;
      };

      // Filamentos entre os nós: halo largo e quase transparente + traço fino (mesmo brilho aditivo dos fios do anel).
      net.edges.forEach((edge, index) => {
        const strength = strengthOf(edge.seed, edge.rate);
        edgeStrength[index] = strength;
        const curve = edgeCurve[index];
        curveInto(curve, pos[edge.a][0], pos[edge.a][1], pos[edge.b][0], pos[edge.b][1], edge.bend * (reduce ? 0.08 : 0.11 * Math.sin(netTime * 0.5 + edge.seed)));
        if (strength < 0.03) return;
        context.strokeStyle = edge.gold ? "#F3DCA6" : mixHexColor("#4FC3E0", "#FFFFFF", strength * 0.55);
        context.globalAlpha = fade * strength * 0.1;
        context.lineWidth = unit * 3.2;
        strokeCurve(curve);
        context.globalAlpha = fade * strength * 0.78;
        context.lineWidth = unit * 0.8;
        strokeCurve(curve);
      });

      // Tentáculos: dos nós de fora até os anéis de dentro ("entre os círculos, um ligando ao outro").
      net.tendrils.forEach((tendril, index) => {
        const strength = strengthOf(tendril.seed, tendril.rate) * 0.85;
        tendrilStrength[index] = strength;
        const angle = tendril.angle + (reduce ? 0 : 0.12 * Math.sin(netTime * 0.4 + tendril.seed));
        const [ax, ay] = pos[tendril.node];
        const curve = tendrilCurve[index];
        curveInto(curve, ax, ay, center + radius * 0.93 * Math.cos(angle), center + radius * 0.93 * Math.sin(angle), reduce ? 0.1 : 0.16 * Math.sin(netTime * 0.6 + tendril.seed));
        if (strength < 0.03) return;
        context.strokeStyle = "#7FD6EE";
        context.globalAlpha = fade * strength * 0.08;
        context.lineWidth = unit * 3;
        strokeCurve(curve);
        context.globalAlpha = fade * strength * 0.45;
        context.lineWidth = unit * 0.6;
        strokeCurve(curve);
      });

      // Sinapses: pulsos correm pelos filamentos; chegada acende o nó e às vezes dispara o próximo.
      if (!reduce) {
        const burst = Math.max(0, Math.min(1, state.burst || 0));
        spawnDebt = Math.min(2, spawnDebt + delta * (0.6 + activity * 4.5 + burst * 6) * Math.max(0.35, net.nodes.length / 22) * on);
        while (spawnDebt >= 1) {
          spawnDebt -= 1;
          spawnPulse();
        }
        for (let index = pulses.length - 1; index >= 0; index -= 1) {
          const pulse = pulses[index];
          pulse.t += delta * pulse.speed;
          if (pulse.t < 1) continue;
          pulses.splice(index, 1);
          if (pulse.tendril) {
            const curve = tendrilCurve[pulse.index];
            sparks.push({ x: curve[4], y: curve[5], life: 1 });
            continue;
          }
          const edge = net.edges[pulse.index];
          const target = pulse.forward ? edge.b : edge.a;
          flashes[target] = 1;
          if (Math.random() < 0.25 + activity * 0.45) spawnPulse(target);
        }
        for (const pulse of pulses) {
          const curve = pulse.tendril ? tendrilCurve[pulse.index] : edgeCurve[pulse.index];
          const color = pulse.gold ? "#FFF1CF" : "#E9FBFF";
          for (let tail = 4; tail >= 0; tail -= 1) {
            const t = pulse.t - tail * 0.045;
            if (t < 0) continue;
            const [x, y] = bezier(curve, pulse.forward ? t : 1 - t);
            context.fillStyle = tail === 0 ? color : pulse.gold ? "#F3DCA6" : "#4FC3E0";
            context.globalAlpha = on * (tail === 0 ? 0.95 : 0.5 * (1 - tail / 5));
            dot(x, y, unit * (tail === 0 ? 2 : 1.3));
          }
          const [hx, hy] = bezier(curve, pulse.forward ? pulse.t : 1 - pulse.t);
          context.fillStyle = pulse.gold ? "#F3DCA6" : "#4FC3E0";
          context.globalAlpha = on * 0.24;
          dot(hx, hy, unit * 6);
        }
        for (let index = sparks.length - 1; index >= 0; index -= 1) {
          const spark = sparks[index];
          spark.life -= delta * 2.4;
          if (spark.life <= 0) {
            sparks.splice(index, 1);
            continue;
          }
          context.fillStyle = "#BFF1FF";
          context.globalAlpha = on * spark.life * 0.35;
          dot(spark.x, spark.y, unit * (2 + (1 - spark.life) * 6));
        }
      }

      // Nós: brilho suave + núcleo; o nó atingido por uma sinapse acende e apaga devagar.
      net.nodes.forEach((node, index) => {
        if (!reduce) flashes[index] *= Math.exp(-delta * 2.8);
        const flash = flashes[index];
        const glowLevel = reduce ? 0.55 : 0.35 + 0.65 * flash + 0.12 * Math.sin(netTime * 2.3 + node.phase);
        const [x, y] = pos[index];
        context.fillStyle = node.gold ? "#F3DCA6" : "#4FC3E0";
        context.globalAlpha = fade * glowLevel * 0.26;
        dot(x, y, unit * (4 + flash * 6));
        context.fillStyle = node.gold ? "#FFF6DD" : "#E9FBFF";
        context.globalAlpha = fade * Math.min(1, glowLevel + 0.2);
        dot(x, y, unit * (1.4 + flash * 1.2));
      });
    };

    const draw = (now) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      const signal = signalRef.current?.() || { mode: "idle", level: 0 };
      const target = HENRY_ORB_STATES[signal.mode] || HENRY_ORB_STATES.idle;
      const raw = Math.max(0, Math.min(1, Number(signal.level) || 0));
      state.burst = Math.max(0, Math.min(1, Number(signal.burst) || 0));
      // Nível com ataque rápido e soltura mais lenta (cada sílaba vira um pulso visível).
      state.level += (raw - state.level) * (raw > state.level ? 0.55 : 0.12);
      const ease = orbEase(delta);
      for (const key of Object.keys(target)) state[key] += (target[key] - state[key]) * ease;
      state.activity += (Math.max(0, Math.min(1, Number(signal.activity) || 0)) - state.activity) * ease * 0.5;
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
          context.globalAlpha = alpha * 0.18 * state.dim;
          context.lineWidth = lineWidth * dpr * 5;
          context.stroke(path);
        }
        context.globalAlpha = Math.min(1, alpha * (1 + level * 0.6) * state.dim);
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

      // Conversa aberta esperando o dono: brilho pulsando de leve no contorno (diferente do parado, que só escurece).
      if (state.rim > 0.02) {
        const pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * 2 * 0.45);
        context.strokeStyle = "#4FC3E0";
        context.beginPath();
        context.arc(center, center, radius * 1.1, 0, Math.PI * 2);
        context.globalAlpha = state.rim * 0.13 * (0.35 + pulse);
        context.lineWidth = lineWidth * dpr * 7;
        context.stroke();
        context.globalAlpha = state.rim * 0.7 * (0.3 + 0.7 * pulse);
        context.lineWidth = lineWidth * dpr * 1.1;
        context.stroke();
      }

      drawNeural(now, reduce ? 0 : delta, radius);
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
  }, [size, fibers, points, alpha, lineWidth, glow, nodes, sleep]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={{ width: size, height: size, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", pointerEvents: "none" }} />;
}
