"use client";

import { useEffect, useRef } from "react";
import { isPageHidden, onPageVisibilityChange } from "@/components/page-visibility";
import { buildHenryBrain, createHenryBrain } from "./henry-brain.js";
import { HENRY_ORB_HIT_MS, HENRY_ORB_STATES, HENRY_ORB_VIB as VIB, mixHexColor, orbEase, orbHitArc, orbStops } from "./henry-orb-states.mjs";

// Anel de filamentos do Henry (pedido do dono, 2026-10-22: "é nesse perfil que eu quero o ícone da IA… no meu estilo";
// depois "quero mais movimentos quando ele escutar, falar ou pensar"). Canvas 2D + requestAnimationFrame, sem biblioteca:
// N contornos fechados em volta do centro, raio = R + ruído suave (somas de senos) × amplitude; brilho aditivo
// ('lighter'). getSignal() devolve { mode: idle|listening|thinking|speaking, level: 0..1 } — nível REAL do microfone
// (ouvindo) ou da voz de saída (falando). Cada estado tem alvos próprios (henry-orb-states.mjs) e TODOS os parâmetros são
// interpolados (~300 ms), então não há corte entre estados:
//   parado   = respiração lenta e leve rotação;
//   ouvindo  = ondas rápidas que percorrem o anel seguindo o volume, brilho ciano pulsando com cada sílaba;
//   pensando = anel calmo (frio, sem dourado, sem feixe) e o Cérebro realista por dentro (henry-brain.js);
//   falando  = incha com a voz, fios abrem em leque e se embaraçam só na faixa do anel (squash × 0,2), cor quente, e
//              5 ondas vocais no meio seguem a voz real (estado `voice`, dono 2026-10-23).
//   esperando = conversa aberta (ainda escuta sem o nome): brilho pulsando de leve no contorno;
//   parado também fica escurecido (dim), para não confundir com "esperando".
// Cérebro realista no centro (só pensando/buscando; dono, 2026-10-25, aprovado no protótipo "Pulso do CRM", substitui a rede
// neural de 2026-10-23): cérebro humano 3D girando devagar, impulsos pelos feixes de fibras, ondas que acendem as regiões e
// varredura holográfica, nas cores do anel. ~938 nós no computador, ~399 no celular (< 820 px) e nos ícones. Ao começar a falar,
// neural → 0 em ~300 ms (o cérebro apaga). Intensidade única (não depende do assunto).
// devicePixelRatio ≤ 2; pausa com a aba oculta (ou a janela do app de desktop minimizada) ou sleep=true (fica o último
// quadro); prefers-reduced-motion = quadro parado do cérebro.
// Tela cheia (glow; app lento, 2026-10-23 — docs/INCIDENTES.md): mesmo desenho, custo menor — o halo dos fios sai de uma
// camada em meia resolução (createGlowLayer) e o ritmo é o de createFullscreenPacer (30 fps; 15 fps ociosa; menos fios e
// pontos só se o quadro atrasar).

// Halo dos fios da tela cheia. Antes: cada fio desenhado 2× (o traço largo 5× mais grosso e quase transparente custava
// ~12–15 ms por quadro sem GPU — o custo é do traço largo em si, não dos pixels). Agora: os fios finos vão para uma camada
// fora da tela (fibers), que é somada ao anel; o halo é essa mesma camada reduzida (meia resolução por pixel de CSS) e
// ampliada de volta — o desfoque da redução/ampliação faz a faixa larga e suave — somada com a MESMA energia de luz do
// traço largo: 5× a largura × 0,18 do alfa base = 0,9 ÷ (1 + 0,6 × nível), porque o fio fino ganha +60% com o nível da voz
// e o halo não (× 1,12: a borda suavizada do traço largo somava ~12% de luz — medido contra o desenho antigo em quadros
// idênticos: luz total ±2%, diferença média ~5/255 por pixel aceso). Tudo aditivo ('lighter'): a ordem não muda a soma.
const GLOW_ENERGY = 5 * 0.18 * 1.12;
function createGlowLayer(width, height, dpr) {
  if (typeof document === "undefined") return null;
  const fibers = document.createElement("canvas");
  fibers.width = width;
  fibers.height = height;
  const small = document.createElement("canvas");
  const scale = 0.5 / Math.max(1, Math.round(dpr));
  small.width = Math.max(1, Math.round(width * scale));
  small.height = Math.max(1, Math.round(height * scale));
  const fiberContext = fibers.getContext("2d");
  const smallContext = small.getContext("2d");
  if (!fiberContext || !smallContext) return null;
  smallContext.imageSmoothingQuality = "medium"; // redução sem serrilhado (fio fino não some)
  return {
    // Limpa e devolve o contexto dos fios (mesmas coordenadas do canvas principal).
    begin() {
      fiberContext.globalCompositeOperation = "source-over";
      fiberContext.globalAlpha = 1;
      fiberContext.clearRect(0, 0, width, height);
      fiberContext.globalCompositeOperation = "lighter";
      return fiberContext;
    },
    // Soma fios + halo no canvas principal. level = nível da voz já suavizado (o mesmo do alfa dos fios).
    composite(target, level) {
      smallContext.globalCompositeOperation = "copy";
      smallContext.drawImage(fibers, 0, 0, small.width, small.height);
      target.globalCompositeOperation = "lighter";
      target.globalAlpha = 1;
      target.drawImage(fibers, 0, 0);
      target.globalAlpha = Math.min(1, GLOW_ENERGY / (1 + level * 0.6));
      target.drawImage(small, 0, 0, width, height);
      target.globalAlpha = 1;
    }
  };
}

// Ritmo da tela cheia: no máximo 30 fps; parado, sem música e sem mouse/teclado por 60 s → 15 fps (mesmo desenho; qualquer
// atividade volta na hora). Qualidade adaptativa como a do HenryMusicScene: só quando o quadro atrasa (> 1,5× o intervalo
// em mais de 8 quadros) cai um nível — 1/4 dos fios e 15% dos pontos, depois metade dos fios e 30% dos pontos; o brilho
// dos fios que ficam sobe na mesma proporção (o total de luz não muda).
const FULLSCREEN_FRAME_MS = 1000 / 30;
const FULLSCREEN_ECO_FRAME_MS = 1000 / 15;
const FULLSCREEN_ECO_AFTER_MS = 60000;
const FULLSCREEN_QUALITY = [
  { dropEvery: 0, points: 1 },
  { dropEvery: 4, points: 0.85 },
  { dropEvery: 2, points: 0.7 }
];
function createFullscreenPacer() {
  let lastDraw = -Infinity;
  let busyAt = 0;
  let slow = 0;
  let level = 0;
  let measureFrom = 0;
  return {
    quality: () => FULLSCREEN_QUALITY[level],
    touch(now) {
      busyAt = now;
    },
    // Retomou (abriu, voltou a aparecer): conta como atividade e não mede o primeiro segundo.
    reset(now) {
      lastDraw = -Infinity;
      busyAt = now;
      slow = 0;
      measureFrom = now + 1000;
    },
    due(now, busy) {
      if (busy) busyAt = now;
      const frameMs = now - busyAt > FULLSCREEN_ECO_AFTER_MS ? FULLSCREEN_ECO_FRAME_MS : FULLSCREEN_FRAME_MS;
      const since = now - lastDraw;
      if (since < frameMs - 4) return false; // folga para o vsync (60/144 Hz)
      if (Number.isFinite(lastDraw) && now >= measureFrom && level < FULLSCREEN_QUALITY.length - 1) {
        slow = since > frameMs * 1.5 ? slow + 1 : Math.max(0, slow - 1);
        if (slow > 8) {
          level += 1;
          slow = 0;
          measureFrom = now + 1000;
        }
      }
      lastDraw = now;
      return true;
    }
  };
}

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

    const glowLayer = glow ? createGlowLayer(canvas.width, canvas.height, dpr) : null;
    const pacer = glow ? createFullscreenPacer() : null;

    // Cérebro realista do "pensando" (henry-brain.js): computador ~938 nós, celular (< 820 px) e ícone ~399. Raio fixo = anel
    // pensando (swell -0,02): o cache em revezamento do desenho depende dele. O contexto é escalado pelo dpr (desenho em px de CSS).
    const brainSmall = window.innerWidth < 820 || size < 200;
    const brain = createHenryBrain({ ctx: context, size, radius: size * 0.3 * (1 + HENRY_ORB_STATES.thinking.swell), small: brainSmall, reduced: reduce });
    // A geometria (~220 ms no computador) é montada uma vez, fora do caminho do primeiro "pensando".
    const prebuild = window.setTimeout(() => buildHenryBrain(brainSmall), 1500);

    let frame = 0;
    let time = 0;
    let last = performance.now();
    const state = { ...HENRY_ORB_STATES.idle, rotation: 0, counter: 0, level: 0 };

    const drawBrain = (now, delta) => {
      const on = state.neural;
      if (on < 0.02) {
        brain.reset();
        return;
      }
      context.save();
      context.scale(dpr, dpr);
      brain.draw(reduce ? 6 : now / 1000, on, delta);
      context.restore();
    };

    const draw = (now, signal = signalRef.current?.() || { mode: "idle", level: 0 }) => {
      const delta = Math.min(pacer ? 0.1 : 0.05, (now - last) / 1000); // 15 fps (tela cheia ociosa) anda no mesmo ritmo
      last = now;
      const target = HENRY_ORB_STATES[signal.mode] || HENRY_ORB_STATES.idle;
      const raw = Math.max(0, Math.min(1, Number(signal.level) || 0));
      // Nível com ataque rápido e soltura mais lenta (cada sílaba vira um pulso visível).
      // Tela cheia (30/15 fps): mesmo ataque/soltura por SEGUNDO que a 60 fps (o fator vale por quadro de 1/60 s).
      const levelRate = raw > state.level ? 0.55 : 0.12;
      state.level += (raw - state.level) * (pacer ? 1 - Math.pow(1 - levelRate, delta * 60) : levelRate);
      const ease = orbEase(delta);
      for (const key of Object.keys(target)) state[key] += (target[key] - state[key]) * ease;
      const level = reduce ? 0 : state.level;

      time += reduce ? 0 : delta * (state.speed + level * state.levelSpeed);
      if (!reduce) {
        state.rotation += delta * state.spin;
        state.counter += delta * state.counterSpin;
      }
      const breath = reduce ? 0.01 * Math.sin(now / 1600) : state.breath * Math.sin((now / 1000) * state.breathRate * Math.PI * 2);
      const swell = state.swell + level * state.levelSwell + breath;
      // Vibração geral reduzida (dono, 2026-10-23, protótipo v14: "ficou muito embaraçado"): ondulação dos fios × 0,4
      // (VIB) em todos os estados, também com movimento reduzido; leque mais fechado (× 3, era × 6).
      const amp = (reduce ? 0.18 : state.amp + level * state.levelAmp) * VIB;
      const sphere = reduce ? 0 : Math.min(1, state.sphere * (0.25 + level * 1.1));
      const fan = state.fan * (0.4 + level);
      // Nunca passa da borda do canvas: o pico máximo possível (inchaço × leque × ondulação) cabe em ~93% da metade.
      const peak = (1 + swell) * (1 + 0.02 * (1 + fan * 3) + 0.25 * amp * 1.35);
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
      // Tela cheia: os fios vão para a camada do halo (createGlowLayer); sem ela, direto no canvas.
      const fiberContext = glowLayer ? glowLayer.begin() : context;
      if (fiberContext !== context) {
        const fiberGradient = fiberContext.createLinearGradient(0, center - radius * 1.2, 0, center + radius * 1.3);
        for (const [offset, color] of orbStops(state.warm)) fiberGradient.addColorStop(offset, color);
        fiberContext.strokeStyle = fiberGradient;
      }
      const quality = pacer ? pacer.quality() : FULLSCREEN_QUALITY[0];
      const kept = quality.dropEvery ? count - Math.floor(count / quality.dropEvery) : count;
      const fiberAlpha = alpha * (count / Math.max(1, kept));
      const fiberPoints = Math.max(24, Math.round(points * quality.points));

      for (let index = 0; index < seeds.length; index += 1) {
        if (quality.dropEvery && index % quality.dropEvery === quality.dropEvery - 1) continue;
        const seed = seeds[index];
        const spin = state.rotation * seed.k + state.counter * seed.dir * seed.k;
        // Embaraçado só na faixa do anel (dono, 2026-10-23, protótipos v12/v14): achatamento máx. 20% para os fios não
        // cruzarem o meio, onde ficam as ondas vocais.
        const squash = 1 - sphere * 0.2 * (1 - Math.abs(Math.cos(seed.tilt)));
        const turn = seed.turn * sphere;
        const cosT = Math.cos(turn);
        const sinT = Math.sin(turn);
        const spread = 1 + seed.offset * (1 + fan * 3);
        const path = new Path2D();
        for (let step = 0; step <= fiberPoints; step += 1) {
          const theta = (step / fiberPoints) * Math.PI * 2;
          const noise =
            0.06 * Math.sin(3 * theta + time * 0.9 + seed.a) +
            0.045 * Math.sin(5 * theta - time * 1.3 * seed.k + seed.b) +
            0.03 * Math.sin(9 * theta + time * 2.1 + seed.c) +
            0.018 * Math.sin(15 * theta - time * 2.9 * seed.k + seed.a * 0.5) +
            state.travel * (0.35 + level) * 0.07 * VIB * Math.sin(4 * theta - time * 5.5 + seed.dir * 0.4); // onda que percorre o anel
          const r = radius * (spread + noise * amp * seed.k);
          const ex = r * Math.cos(theta + spin);
          const ey = r * Math.sin(theta + spin) * squash;
          const x = center + ex * cosT - ey * sinT;
          const y = center + ex * sinT + ey * cosT;
          if (step === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        }
        path.closePath();
        if (glow && !glowLayer) {
          // Halo sem a camada (canvas fora da tela indisponível): o mesmo fio, largo e quase transparente.
          context.globalAlpha = fiberAlpha * 0.18 * state.dim;
          context.lineWidth = lineWidth * dpr * 5;
          context.stroke(path);
        }
        fiberContext.globalAlpha = Math.min(1, fiberAlpha * (1 + level * 0.6) * state.dim);
        fiberContext.lineWidth = lineWidth * dpr;
        fiberContext.stroke(path);
      }
      if (glowLayer) glowLayer.composite(context, level);

      // Ondas vocais no meio do anel (falando; dono, 2026-10-23, protótipo v12): 5 ondas finas horizontais que seguem a voz
      // REAL (level do getSignal), afinando nas pontas. Movimento reduzido: paradas e baixas.
      if (state.voice > 0.02 && !signal.noVoice) { // noVoice: mensagem do bom dia no meio do anel
        const span = radius * 0.62;
        const WAVES = 5;
        const N = 64;
        const waveTime = reduce ? 0 : time;
        // Ícone pequeno (celular 52–88 px, ícone do canto): traço proporcional para as ondas não virarem um borrão.
        const waveWidth = dpr * Math.max(0.45, Math.min(1, size / 320));
        context.lineCap = "round";
        for (let w = 0; w < WAVES; w += 1) {
          const off = w - (WAVES - 1) / 2;
          const path = new Path2D();
          for (let i = 0; i <= N; i += 1) {
            const u = (i / N) * 2 - 1;
            const env = Math.pow(Math.cos((u * Math.PI) / 2), 2);
            const a = radius * (0.04 + level * 0.32) * (1 - Math.abs(off) * 0.17) * env;
            const y = center + a * (Math.sin(u * (7 + w * 1.3) + waveTime * (6 + w) + w * 1.7) * 0.7 + Math.sin(u * 13 - waveTime * 9 + w) * 0.3);
            const x = center + u * span;
            if (i) path.lineTo(x, y);
            else path.moveTo(x, y);
          }
          context.strokeStyle = w === 2 ? "#FFF6DD" : w % 2 ? "#F3DCA6" : "#4FC3E0";
          context.globalAlpha = state.voice * 0.18;
          context.lineWidth = 5 * waveWidth;
          context.stroke(path);
          context.globalAlpha = state.voice * (w === 2 ? 0.95 : 0.6);
          context.lineWidth = (w === 2 ? 1.6 : 1) * waveWidth;
          context.stroke(path);
        }
        context.lineCap = "butt";
      }

      // Pulso de chegada (Pulso do CRM, protótipo v21 — dono, 2026-10-23): quando um card "entra" no Henry, UM arco no ponto
      // de entrada fica mais forte nas cores do PRÓPRIO Henry (o mesmo gradiente dos fios, modo aditivo — sem a cor do card)
      // e se alarga de 0,08π a 0,4π até sumir em 1,4 s, com o anel inchando no ponto de entrada (orbHitArc). Um fio a cada
      // dois, halo (traço 5, a·g·0,25) + núcleo (traço 1,5, a·g), g = exp(−3u²). signal.hits = [{ ang, born }].
      const hits = Array.isArray(signal.hits) ? signal.hits : [];
      if (hits.length && !reduce) {
        const glowArc = (middle, half, arcAlpha, color, bump = 0) => {
          if (arcAlpha < 0.01) return;
          const SEGMENTS = 18;
          context.strokeStyle = color;
          for (let index = 0; index < seeds.length; index += 2) {
            const seed = seeds[index];
            const spin = state.rotation * seed.k + state.counter * seed.dir * seed.k;
            const spread = 1 + seed.offset * (1 + fan * 3);
            let px = 0;
            let py = 0;
            for (let step = 0; step <= SEGMENTS; step += 1) {
              const u = (step / SEGMENTS) * 2 - 1;
              const phi = middle + u * half;
              const theta = phi - spin;
              const noise =
                0.06 * Math.sin(3 * theta + time * 0.9 + seed.a) +
                0.045 * Math.sin(5 * theta - time * 1.3 * seed.k + seed.b) +
                0.03 * Math.sin(9 * theta + time * 2.1 + seed.c) +
                0.018 * Math.sin(15 * theta - time * 2.9 * seed.k + seed.a * 0.5);
              const g = Math.exp(-u * u * 3);
              const r = radius * (spread + noise * amp * seed.k) * (1 + bump * g);
              const x = center + r * Math.cos(phi);
              const y = center + r * Math.sin(phi);
              if (step) {
                context.beginPath();
                context.moveTo(px, py);
                context.lineTo(x, y);
                context.globalAlpha = arcAlpha * g * 0.25;
                context.lineWidth = 5 * dpr;
                context.stroke();
                context.globalAlpha = Math.min(1, arcAlpha * g);
                context.lineWidth = 1.5 * dpr;
                context.stroke();
              }
              px = x;
              py = y;
            }
          }
        };
        for (const hit of hits) {
          const age = (now - hit.born) / HENRY_ORB_HIT_MS;
          if (!(age >= 0 && age < 1)) continue;
          const arc = orbHitArc(age);
          glowArc(hit.ang, arc.half, arc.alpha, gradient, arc.bump); // cores do próprio Henry, modo aditivo
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

      drawBrain(now, reduce ? 0 : delta);
      context.globalAlpha = 1;
    };

    const loop = (now) => {
      frame = window.requestAnimationFrame(loop);
      if (!pacer) {
        draw(now);
        return;
      }
      const signal = signalRef.current?.() || { mode: "idle", level: 0 };
      // Atividade (não cai para o ritmo ocioso): fala/escuta/pensa, música, cards do Pulso na tela, pulso de chegada e
      // ondas vocais ainda apagando.
      const hitActive = Array.isArray(signal.hits) && signal.hits.some((hit) => now - hit.born < HENRY_ORB_HIT_MS);
      if (pacer.due(now, signal.mode !== "idle" || signal.music === true || signal.pulseBusy === true || hitActive || state.voice > 0.02)) draw(now, signal);
    };
    const start = () => {
      if (frame || sleep || isPageHidden()) return;
      last = performance.now();
      pacer?.reset(last);
      frame = window.requestAnimationFrame(loop);
    };
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (isPageHidden() ? stop() : start());
    const onInteraction = () => pacer?.touch(performance.now());
    const INTERACTIONS = ["pointermove", "pointerdown", "keydown", "wheel"];

    draw(performance.now()); // sempre há um quadro desenhado (inclusive dormindo)
    start();
    const stopWatching = onPageVisibilityChange(onVisibility);
    if (pacer) for (const name of INTERACTIONS) window.addEventListener(name, onInteraction, { passive: true });
    return () => {
      stop();
      stopWatching();
      window.clearTimeout(prebuild);
      if (pacer) for (const name of INTERACTIONS) window.removeEventListener(name, onInteraction);
    };
  }, [size, fibers, points, alpha, lineWidth, glow, sleep]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={{ width: size, height: size, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", pointerEvents: "none" }} />;
}
