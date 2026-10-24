"use client";

import { useEffect, useRef, useState } from "react";
import { morningSceneDate } from "@/lib/henry-morning-core.mjs";
import { HENRY_WAKE, orbStops, wakeHead, wakePathLength, wakeSmooth } from "./henry-orb-states.mjs";
import styles from "./HenryOpeningScene.module.css";

// Cena de abertura do "bom dia" (HENRY-1; "Bom dia novo", protótipo v22 aprovado pelo dono em 2026-10-23 — substitui a
// abertura futurística anterior). Por cima da tela cheia do Henry, no mesmo centro e raio do anel:
//   0–1,3 s um feixe embaraçado (30 fios + cabeça de luz) sai do meio da lateral esquerda e sobe em curva até o meio do
//   topo · 1,3–3,4 s 3 voltas em torno do centro, acelerando · 3,4–4,4 s giro muito rápido fechando no raio do anel, com o
//   centro brilhando · 4,4 s BOOM de plasma (clarão, núcleo, filamentos e poeira — v32): o anel de verdade acorda com um pulso de fala curto
//   (onBoom) e aparece "BOM DIA, MATHEUS" + data no meio dele (tamanho pelo raio), saindo em ~3,4 s · 8,6 s onDone.
// Antes do boom o fundo cobre o anel (ele ainda "não acordou"); depois o fundo some e o anel real aparece. O som de
// abertura (playHenryOpeningSound) é agendado por quem abre a cena para tocar aos 3,8 s. Toque/clique/Esc pula.
// prefers-reduced-motion: sem feixe nem boom — só a mensagem no anel, parada, por ~2,6 s.

export const OPENING_MS = HENRY_WAKE.end * 1000;
export const OPENING_STILL_MS = 2600;
export const OPENING_SOUND_AT_S = 3.8;

// "Whoosh" + tom de ativação curtinho, gerado na hora (sem arquivo). Volume baixo; quem chama respeita o mudo.
// delay (s) agenda no relógio do WebAudio (o contexto foi destravado no clique); devolve uma função que cancela.
export function playHenryOpeningSound(context, delay = 0) {
  if (!context || context.state === "closed") return () => {};
  const sources = [];
  try {
    const now = context.currentTime + 0.02 + Math.max(0, delay);
    const length = Math.floor(context.sampleRate * 1.1);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(260, now);
    band.frequency.exponentialRampToValueAtTime(2600, now + 0.75);
    const whoosh = context.createGain();
    whoosh.gain.setValueAtTime(0.0001, now);
    whoosh.gain.exponentialRampToValueAtTime(0.03, now + 0.45);
    whoosh.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);
    noise.connect(band).connect(whoosh).connect(context.destination);
    noise.start(now);
    noise.stop(now + 1.1);
    sources.push(noise);
    [392, 587.33, 783.99].forEach((frequency, index) => {
      const start = now + 0.55 + index * 0.07;
      const osc = context.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, start);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.022 - index * 0.005, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.5);
      osc.connect(gain).connect(context.destination);
      osc.start(start);
      osc.stop(start + 1.6);
      sources.push(osc);
    });
  } catch {
    // som é enfeite: sem WebAudio, a cena segue muda
  }
  return () => {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // já parou
      }
    }
  };
}

// Mesmos fios do anel (sementes do HenryOrb) para o feixe embaraçado: até 16 fios × 200 pontos (fluidez, v28).
const WAKE_POINTS = 200;
// Núcleo do boom de plasma (v32): [escala, alpha, cor, onde o gradiente some (× base)] — violeta por fora, branco por dentro.
const PLASMA_LAYERS = [
  [2.6, 0.38, "120,90,255", 0.82],
  [1.8, 0.55, "79,195,224", 0.95],
  [1.1, 0.95, "225,250,255", 1.15]
];
const WAKE_SEEDS = Array.from({ length: 16 }, (_, index) => {
  const i = (index * 7) % 52;
  return { a: i * 2.399963 + 0.3, b: i * 1.618 + 1.1, k: 0.65 + (((i * 37) % 100) / 100) * 0.7 };
});

function useWakeCanvas(canvasRef, { enabled, geometryRef, onBoom }) {
  const boomRef = useRef(onBoom);
  boomRef.current = onBoom;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let W = 0;
    let H = 0;
    const resize = () => {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const started = performance.now();
    let last = started;
    let boomed = false;
    const parts = [];
    const tendrils = [];
    let frame = 0;
    const stops = orbStops(0);
    const lut = { key: "", length: null }; // distância ao longo do caminho (wakePathLength), refeita só se a tela mudar
    const draw = (now) => {
      const time = (now - started) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { cx, cy, R } = geometryRef.current(W, H);
      ctx.clearRect(0, 0, W, H);
      if (time < HENRY_WAKE.boom + 0.05) {
        const big = Math.max(R * 1.6, cy - 70); // raio da 1ª volta: perto do topo da tela
        const head = wakeHead({ cx, cy, R, big });
        const tau = Math.max(0, time - HENRY_WAKE.in);
        const close = wakeSmooth(HENRY_WAKE.laps * 0.6, HENRY_WAKE.laps + HENRY_WAKE.fast, tau); // a cauda cresce até fechar o círculo
        // Linha bem comprida (v25): a cauda vale de 1,5 a 3 voltas, gira e passa por cima dela mesma — como o raio vai
        // fechando, as voltas de trás ficam por fora e a linha se cruza.
        const span = Math.PI * (3 + 3 * close);
        const trail = Math.min(time, 2.6, time < HENRY_WAKE.in ? 1.3 : Math.max(0.05, span / Math.max(0.5, head.omega(tau))));
        const gradient = ctx.createLinearGradient(0, cy - big, 0, cy + big);
        for (const [offset, color] of stops) gradient.addColorStop(offset, color);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = gradient;
        const tangle = 26 - 18 * close; // embaraçado e largo no começo, fino como o anel no fim
        const alpha = Math.min(1, time / 0.3) * (0.55 + 0.4 * close); // bem visível, se sobressaindo
        // Fluidez (dono, 2026-10-23/24, protótipos v26/v28): a trajetória (centro + normal) é calculada UMA vez por quadro
        // em Float32Array e cada fio só soma o próprio deslocamento; corpo de cada fio num traço só (pontos densos).
        // Final da linha (v28/v29): sem corte reto — a partir de 60% do comprimento a cauda some aos poucos (alpha e
        // espessura até zero), em 16 trechos encostados, e os fios se juntam enquanto somem. Sem a faixa larga de brilho
        // (o dono via como uma "marca"). Computador 16 fios × 200 pontos; celular (< 820 px) 14 × 160. v29: fios presos ao
        // caminho (Q) e curvas pelos pontos médios; v30: Q pela distância percorrida; v31: ponta de cometa (headIn) e
        // pontas arredondadas.
        const phone = W < 820;
        const strands = phone ? 14 : 16;
        const points = phone ? 160 : WAKE_POINTS;
        const n = Math.max(2, Math.min(points, Math.ceil(points * Math.min(1, time / Math.max(trail, 0.001)))));
        const PX = new Float32Array(n + 1);
        const PY = new Float32Array(n + 1);
        const NX = new Float32Array(n + 1);
        const NY = new Float32Array(n + 1);
        const U = new Float32Array(n + 1);
        // Q = posição AO LONGO DO CAMINHO (v29): o embaraçado fica preso ao trajeto e anda junto com ele — antes dependia
        // da fração da cauda, que muda de tamanho a cada quadro, e os fios "nadavam". v30: Q = distância percorrida em px
        // / 90 (tabela calculada uma vez por tamanho de tela), mesma escala na subida e no giro — sem "nó" no topo.
        const Q = new Float32Array(n + 1);
        const lutKey = `${W}x${H}x${R}x${big}`;
        if (lut.key !== lutKey) {
          lut.key = lutKey;
          lut.length = wakePathLength(head);
        }
        const pathPos = (tt) => lut.length(tt) / 90;
        for (let k = 0; k <= n; k += 1) {
          const u = k / points;
          const tt = Math.max(0, time - u * trail);
          const [hx, hy] = head.at(tt);
          PX[k] = hx;
          PY[k] = hy;
          U[k] = u;
          Q[k] = pathPos(tt);
        }
        for (let k = 0; k <= n; k += 1) {
          const k0 = Math.max(0, k - 1);
          const k1 = Math.min(n, k + 1);
          const dx = PX[k0] - PX[k1];
          const dy = PY[k0] - PY[k1];
          const l = Math.hypot(dx, dy) || 1;
          NX[k] = -dy / l;
          NY[k] = dx / l;
        }
        const tailStart = Math.floor(n * 0.6);
        const fade = (k) => (k <= tailStart ? 1 : Math.max(0, 1 - (k - tailStart) / Math.max(1, n - tailStart)));
        const width = 1.1 + close * 0.4;
        // Ponta (dono, 2026-10-24, v31: "linhas cortadas, retas" na frente): os fios convergem suavemente para a cabeça de
        // luz, como um cometa, e as pontas são arredondadas — nenhum fio termina solto com corte reto.
        const headIn = (k) => wakeSmooth(0, 1, Math.min(1, k / Math.max(1, n * 0.14)));
        const X = new Float32Array(n + 1);
        const Y = new Float32Array(n + 1);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let index = 0; index < strands; index += 1) {
          const seed = WAKE_SEEDS[index];
          const f1 = 5 + seed.k * 6;
          const w1 = 3 + seed.k * 2;
          for (let k = 0; k <= n; k += 1) {
            const u = U[k];
            const q = Q[k];
            // fios cruzando entre si (embaraçado), presos ao caminho; ondulam devagar no tempo; na cauda se juntam e somem
            const o = tangle * (Math.sin(q * f1 * 0.35 + time * w1 * 0.35 + seed.a) * 0.65 + Math.sin(q * 1.9 - time * 1.3 + seed.b) * 0.35) * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, u * 1.2 + 0.1))) * (0.35 + 0.65 * fade(k)) * headIn(k);
            X[k] = PX[k] + NX[k] * o;
            Y[k] = PY[k] + NY[k] * o;
          }
          // Curvas pelos pontos médios (v29), sem quinas mesmo no giro rápido; cada trecho começa onde o anterior termina.
          const curve = (path, a0, a1) => {
            path.moveTo(a0 === 0 ? X[0] : (X[a0 - 1] + X[a0]) / 2, a0 === 0 ? Y[0] : (Y[a0 - 1] + Y[a0]) / 2);
            for (let k = a0; k < a1; k += 1) path.quadraticCurveTo(X[k], Y[k], (X[k] + X[k + 1]) / 2, (Y[k] + Y[k + 1]) / 2);
          };
          let path = new Path2D(); // corpo até onde começa a cauda, num traço só
          curve(path, 0, tailStart);
          ctx.globalAlpha = alpha;
          ctx.lineWidth = width;
          ctx.stroke(path);
          const length = n - tailStart; // cauda: 16 trechos encostados (v29), cada um mais fino e mais apagado
          for (let c = 0; c < 16; c += 1) {
            const s0 = tailStart + Math.floor((length * c) / 16);
            const s1 = tailStart + Math.floor((length * (c + 1)) / 16);
            if (s1 <= s0) continue;
            path = new Path2D();
            curve(path, s0, s1);
            const f = fade((s0 + s1) / 2);
            ctx.globalAlpha = alpha * f * f;
            ctx.lineWidth = width * (0.4 + 0.6 * f);
            ctx.stroke(path);
          }
        }
        ctx.lineCap = "butt";
        ctx.lineJoin = "miter";
        if (time < HENRY_WAKE.boom) {
          const [hx, hy] = head.at(time); // cabeça do feixe: ponto de luz que puxa os fios
          const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 26);
          glow.addColorStop(0, "rgba(255,246,221,0.9)");
          glow.addColorStop(1, "rgba(79,195,224,0)");
          ctx.globalAlpha = 1;
          ctx.fillStyle = glow;
          ctx.fillRect(hx - 26, hy - 26, 52, 52);
        }
        const pre = wakeSmooth(HENRY_WAKE.boom - 0.8, HENRY_WAKE.boom, time); // centro brilhando antes do boom
        if (pre > 0.01) {
          const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.4);
          glow.addColorStop(0, `rgba(225,250,255,${0.5 * pre})`); // branco-ciano com um toque violeta de plasma (v32)
          glow.addColorStop(0.5, `rgba(120,110,255,${0.12 * pre})`);
          glow.addColorStop(1, "rgba(79,195,224,0)");
          ctx.globalAlpha = 1;
          ctx.fillStyle = glow;
          ctx.fillRect(cx - R * 1.5, cy - R * 1.5, R * 3, R * 3);
        }
        ctx.restore();
      }
      // BOOM de plasma (dono, 2026-10-24, protótipo v32: "não acho legal aqueles anéis dourados… um boom como se fosse de
      // plasma"): sem anéis nem faíscas retas. Clarão curto, núcleo de plasma de borda viva (3 camadas que ondulam,
      // tremeluzem, incham e se dissolvem), 13 filamentos elétricos tortuosos saindo do centro (piscando e ramificando) e
      // 70 pontos de poeira luminosa girando. Cores do Henry (branco → ciano → azul) com um toque violeta.
      if (time >= HENRY_WAKE.boom && !boomed) {
        boomed = true;
        for (let i = 0; i < 13; i += 1) {
          tendrils.push({
            a: (i / 13) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
            len: R * (1.1 + Math.random() * 1.4),
            s: Math.random() * 100,
            born: Math.random() * 0.12,
            life: 0.8 + Math.random() * 0.5,
            fork: Math.random() < 0.6 ? 0.45 + Math.random() * 0.25 : 0,
            fa: (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.4)
          });
        }
        for (let i = 0; i < 70; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          const r = R * (0.3 + Math.random() * 0.7);
          parts.push({ a: angle, r, v: 120 + Math.random() * 420, spin: (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 1.6), life: 0.7 + Math.random() * 0.9, age: 0, size: 1 + Math.random() * 2.2, violet: Math.random() < 0.3 });
        }
        boomRef.current?.();
      }
      if (boomed) {
        const bt = time - HENRY_WAKE.boom;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        if (bt < 0.35) {
          const f0 = Math.pow(1 - bt / 0.35, 2); // clarão inicial curto (luz, sem anel)
          const flash = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.55);
          flash.addColorStop(0, `rgba(235,250,255,${0.75 * f0})`);
          flash.addColorStop(0.3, `rgba(110,120,255,${0.22 * f0})`);
          flash.addColorStop(1, "rgba(79,195,224,0)");
          ctx.globalAlpha = 1;
          ctx.fillStyle = flash;
          ctx.fillRect(0, 0, W, H);
        }
        if (bt < 1.6) {
          // núcleo de plasma: 3 camadas de borda ondulante, crescendo e se dissolvendo; as de fora somem antes da borda
          const k = bt / 1.6;
          const f = Math.pow(1 - k, 1.6);
          const grow = 1 - Math.pow(1 - Math.min(1, bt / 0.5), 3);
          PLASMA_LAYERS.forEach(([scale, layerAlpha, rgb, edge], li) => {
            const base = R * (0.35 + scale * grow);
            ctx.beginPath();
            for (let j = 0; j <= 96; j += 1) {
              const th = (j / 96) * Math.PI * 2;
              const wobble = 0.1 * Math.sin(5 * th + bt * 9 + li) + 0.06 * Math.sin(9 * th - bt * 14 + li * 2) + 0.035 * Math.sin(15 * th + bt * 23);
              const rr = base * (1 + wobble * (0.6 + 0.6 * k));
              if (j === 0) ctx.moveTo(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr);
              else ctx.lineTo(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr);
            }
            ctx.closePath();
            const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * edge);
            const flicker = 0.85 + 0.15 * Math.sin(bt * 47 + li * 3); // tremeluz
            fill.addColorStop(0, `rgba(255,255,255,${layerAlpha * f * flicker})`);
            fill.addColorStop(0.45, `rgba(${rgb},${layerAlpha * 0.8 * f * flicker})`);
            fill.addColorStop(1, `rgba(${rgb},0)`);
            ctx.globalAlpha = 1;
            ctx.fillStyle = fill;
            ctx.fill();
          });
        }
        // filamentos elétricos: curvas suaves que tremem, nunca retas
        const strand = (a0, r0, length, seed, amp) => {
          const M = 22;
          const xs = [];
          const ys = [];
          for (let j = 0; j <= M; j += 1) {
            const u = j / M;
            const rr = r0 + length * u;
            const off = amp * u * (Math.sin(u * 9 + seed + bt * 30) * 0.6 + Math.sin(u * 23 - bt * 45 + seed * 1.7) * 0.4);
            const th = a0 + off / Math.max(rr, 1);
            xs.push(cx + Math.cos(th) * rr);
            ys.push(cy + Math.sin(th) * rr);
          }
          const path = new Path2D();
          path.moveTo(xs[0], ys[0]);
          for (let j = 1; j < M; j += 1) path.quadraticCurveTo(xs[j], ys[j], (xs[j] + xs[j + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
          path.lineTo(xs[M], ys[M]);
          return path;
        };
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const td of tendrils) {
          const lt = bt - td.born;
          if (lt < 0 || lt > td.life) continue;
          const k = lt / td.life;
          const reach = 1 - Math.pow(1 - Math.min(1, k * 2.2), 2);
          const fadeT = Math.pow(1 - k, 1.4);
          const flick = 0.55 + 0.45 * Math.abs(Math.sin(bt * 38 + td.s));
          const paths = [strand(td.a, R * 0.2, td.len * reach, td.s, 34)];
          if (td.fork && reach > td.fork) paths.push(strand(td.a + td.fa * 0.35, R * 0.2 + td.len * td.fork, td.len * (reach - td.fork) * 0.8, td.s + 5, 20));
          for (const path of paths) {
            ctx.strokeStyle = "rgba(120,110,255,1)";
            ctx.globalAlpha = 0.22 * fadeT * flick;
            ctx.lineWidth = 14;
            ctx.stroke(path);
            ctx.strokeStyle = "rgba(79,195,224,1)";
            ctx.globalAlpha = 0.5 * fadeT * flick;
            ctx.lineWidth = 4.5;
            ctx.stroke(path);
            ctx.strokeStyle = "rgba(235,252,255,1)";
            ctx.globalAlpha = fadeT * flick;
            ctx.lineWidth = 1.6;
            ctx.stroke(path);
          }
        }
        // poeira de plasma: pontos de luz que se afastam girando e se apagam
        for (let i = parts.length - 1; i >= 0; i -= 1) {
          const p = parts[i];
          p.age += dt;
          if (p.age >= p.life) {
            parts.splice(i, 1);
            continue;
          }
          p.v *= 0.965;
          p.r += p.v * dt;
          p.a += (p.spin * dt * 60) / Math.max(60, p.r);
          const x = cx + Math.cos(p.a) * p.r;
          const y = cy + Math.sin(p.a) * p.r;
          const life = 1 - p.age / p.life;
          const rad = p.size * 3.5;
          const dot = ctx.createRadialGradient(x, y, 0, x, y, rad);
          dot.addColorStop(0, p.violet ? `rgba(200,180,255,${life})` : `rgba(225,250,255,${life})`);
          dot.addColorStop(1, "rgba(79,195,224,0)");
          ctx.globalAlpha = 1;
          ctx.fillStyle = dot;
          ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
        ctx.restore();
      }
      if (time < HENRY_WAKE.end) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [canvasRef, enabled, geometryRef]);
}

export default function HenryOpeningScene({ name = "Matheus", mobile = false, orbSize = 520, onBoom, onDone, now = null }) {
  const canvasRef = useRef(null);
  const doneRef = useRef(false);
  const [still, setStill] = useState(false);
  const [ready, setReady] = useState(false);
  const [awake, setAwake] = useState(false);
  const [date, setDate] = useState("");
  // Mesmo centro e raio do anel da tela cheia (HenryVoiceView: celular 14vh acima do meio; anel ≈ 0,32 × tamanho).
  const geometryRef = useRef(() => ({ cx: 0, cy: 0, R: 0 }));
  geometryRef.current = (W, H) => ({ cx: W / 2, cy: H / 2 - (mobile ? H * 0.14 : 0), R: orbSize * 0.32 });
  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setDate(morningSceneDate(now ? new Date(now) : new Date()));
    setReady(true);
  }, [now]);

  const finish = useRef(() => {});
  finish.current = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone?.();
  };
  useEffect(() => {
    if (!ready) return undefined;
    if (still) setAwake(true);
    const timer = window.setTimeout(() => finish.current(), still ? OPENING_STILL_MS : OPENING_MS);
    // Esc pula a cena (captura: não deixa o mesmo Esc minimizar a tela cheia do Henry).
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [ready, still]);

  useWakeCanvas(canvasRef, {
    enabled: ready && !still,
    geometryRef,
    onBoom: () => {
      setAwake(true);
      onBoom?.();
    }
  });
  const R = orbSize * 0.32;

  return (
    <div
      className={`${styles.scene} ${awake ? styles.awake : ""} ${still ? styles.still : ""} ${mobile ? styles.mobile : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        finish.current();
      }}
      role="presentation"
      data-henry-opening
    >
      <div className={styles.cover} aria-hidden="true" />
      {!still ? <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" /> : null}
      <div className={`${styles.message} ${awake ? styles.on : ""}`} aria-live="polite">
        <p className={styles.hello} style={{ fontSize: Math.max(14, Math.round(R * 0.13)) }} /* cabe dentro do anel (o 0,15 do protótipo encostava nos fios) */>
          Bom dia, {name || "Matheus"}
        </p>
        <p className={styles.date} style={{ fontSize: Math.max(9, Math.round(R * 0.065)) }}>
          {date}
        </p>
      </div>
      <p className={styles.skip}>Toque ou Esc para pular</p>
    </div>
  );
}
