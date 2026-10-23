"use client";

import { useEffect, useRef, useState } from "react";
import { morningSceneDate } from "@/lib/henry-morning-core.mjs";
import { HENRY_WAKE, orbStops, wakeHead, wakeSmooth } from "./henry-orb-states.mjs";
import styles from "./HenryOpeningScene.module.css";

// Cena de abertura do "bom dia" (HENRY-1; "Bom dia novo", protótipo v22 aprovado pelo dono em 2026-10-23 — substitui a
// abertura futurística anterior). Por cima da tela cheia do Henry, no mesmo centro e raio do anel:
//   0–1,3 s um feixe embaraçado (30 fios + cabeça de luz) sai do meio da lateral esquerda e sobe em curva até o meio do
//   topo · 1,3–3,4 s 3 voltas em torno do centro, acelerando · 3,4–4,4 s giro muito rápido fechando no raio do anel, com o
//   centro brilhando · 4,4 s BOOM (clarão, onda de choque, faíscas): o anel de verdade acorda com um pulso de fala curto
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

// Mesmos fios do anel (sementes do HenryOrb) para o feixe embaraçado: 18 fios × 200 pontos (fluidez, v26).
const WAKE_POINTS = 200;
const WAKE_SEEDS = Array.from({ length: 18 }, (_, index) => {
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
    let frame = 0;
    const stops = orbStops(0);
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
        // Fluidez (dono, 2026-10-23, protótipo v26): a trajetória (centro + normal) é calculada UMA vez por quadro em
        // Float32Array e cada fio só soma o próprio deslocamento; curvas pelos pontos médios (quadraticCurveTo), sem quinas;
        // o brilho largo é um traço só do feixe inteiro, não um por fio. 18 fios × 200 pontos.
        const n = Math.max(2, Math.min(WAKE_POINTS, Math.ceil(WAKE_POINTS * Math.min(1, time / Math.max(trail, 0.001)))));
        const PX = new Float32Array(n + 1);
        const PY = new Float32Array(n + 1);
        const NX = new Float32Array(n + 1);
        const NY = new Float32Array(n + 1);
        const U = new Float32Array(n + 1);
        for (let k = 0; k <= n; k += 1) {
          const u = k / WAKE_POINTS;
          const [hx, hy] = head.at(Math.max(0, time - u * trail));
          PX[k] = hx;
          PY[k] = hy;
          U[k] = u;
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
        const smoothPath = (offAt) => {
          const path = new Path2D();
          let px = PX[0] + NX[0] * offAt(0);
          let py = PY[0] + NY[0] * offAt(0);
          path.moveTo(px, py);
          for (let k = 1; k <= n; k += 1) {
            const o = offAt(k);
            const x = PX[k] + NX[k] * o;
            const y = PY[k] + NY[k] * o;
            path.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
            px = x;
            py = y;
          }
          path.lineTo(px, py);
          return path;
        };
        ctx.globalAlpha = alpha * 0.16; // brilho largo: um traço só, no centro do feixe
        ctx.lineWidth = tangle * 1.4 + 4;
        ctx.lineCap = "butt";
        ctx.lineJoin = "round";
        ctx.stroke(smoothPath(() => 0));
        ctx.lineWidth = 1.1 + close * 0.4;
        ctx.globalAlpha = alpha;
        for (const seed of WAKE_SEEDS) {
          const f1 = 5 + seed.k * 6;
          const w1 = 3 + seed.k * 2;
          // fios cruzando entre si (embaraçado): cada um ondula com frequência e fase próprias
          ctx.stroke(
            smoothPath((k) => {
              const u = U[k];
              return tangle * (Math.sin(u * f1 + time * w1 + seed.a) * 0.65 + Math.sin(u * 13 - time * 4 + seed.b) * 0.35) * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, u * 1.2 + 0.1)));
            })
          );
        }
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
          glow.addColorStop(0, `rgba(255,246,221,${0.5 * pre})`);
          glow.addColorStop(1, "rgba(79,195,224,0)");
          ctx.globalAlpha = 1;
          ctx.fillStyle = glow;
          ctx.fillRect(cx - R * 1.5, cy - R * 1.5, R * 3, R * 3);
        }
        ctx.restore();
      }
      if (time >= HENRY_WAKE.boom && !boomed) {
        boomed = true;
        for (let i = 0; i < 90; i += 1) {
          const a = Math.random() * Math.PI * 2;
          const v = 300 + Math.random() * 900;
          parts.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.6, age: 0, gold: Math.random() < 0.4 });
        }
        boomRef.current?.();
      }
      if (boomed) {
        const bt = time - HENRY_WAKE.boom;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        if (bt < 0.6) {
          const f = 1 - bt / 0.6;
          const flash = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.6);
          flash.addColorStop(0, `rgba(255,255,255,${0.85 * f})`);
          flash.addColorStop(0.25, `rgba(243,220,166,${0.35 * f})`);
          flash.addColorStop(1, "rgba(79,195,224,0)");
          ctx.fillStyle = flash;
          ctx.fillRect(0, 0, W, H);
        }
        if (bt < 1.1) {
          const k = bt / 1.1;
          const r = R + (Math.hypot(W, H) * 0.6 - R) * (1 - Math.pow(1 - k, 3));
          ctx.strokeStyle = "#F3DCA6";
          ctx.globalAlpha = (1 - k) * 0.9;
          ctx.lineWidth = 2 + 6 * (1 - k);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = "#4FC3E0";
          ctx.globalAlpha = (1 - k) * 0.5;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
          ctx.stroke();
        }
        for (let i = parts.length - 1; i >= 0; i -= 1) {
          const p = parts[i];
          p.age += dt;
          if (p.age >= p.life) {
            parts.splice(i, 1);
            continue;
          }
          const px = p.x;
          const py = p.y;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.96;
          p.vy *= 0.96;
          ctx.strokeStyle = p.gold ? "#F3DCA6" : "#BFF1FF";
          ctx.globalAlpha = 1 - p.age / p.life;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
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
