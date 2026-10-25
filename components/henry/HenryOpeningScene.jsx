"use client";

import { useEffect, useRef, useState } from "react";
import { morningSceneDate } from "@/lib/henry-morning-core.mjs";
import { HENRY_WAKE, orbStops, wakeHead, wakePathLength, wakeSmooth } from "./henry-orb-states.mjs";
import styles from "./HenryOpeningScene.module.css";

// Cena de abertura do "bom dia" (HENRY-1; "Bom dia novo", protótipo v22 aprovado pelo dono em 2026-10-23 — substitui a
// abertura futurística anterior). Por cima da tela cheia do Henry, no mesmo centro e raio do anel:
//   0–1,3 s um feixe embaraçado (30 fios + cabeça de luz) sai do meio da lateral esquerda e sobe em curva até o meio do
//   topo · 1,3–3,4 s 3 voltas em torno do centro, acelerando · 3,4–4,4 s giro muito rápido fechando no raio do anel, com o
//   centro brilhando · 4,4 s BOOM "Pó de luz" (dono, 2026-10-25, "Boom 3" do protótipo): ~640 pontos de luz (420 no celular)
//   sobre a circunferência do anel se espalham devagar (1,2 s), voltam (até 2,5 s) e somem; o anel de verdade vai
//   aparecendo por baixo a partir de 1,5 s depois do boom; aos 2,2 s ele acorda com um pulso de fala curto (onBoom) e
//   aparece "BOM DIA, MATHEUS" + data no meio dele (tamanho pelo raio), saindo antes do fim · 8,6 s onDone.
// Antes disso o fundo cobre o anel (ele ainda "não acordou"); o fundo vai sumindo e o anel real aparece. O som de
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
// Pó de luz (boom): tempos depois do boom, em segundos. O anel real começa a aparecer em DUST_REVEAL_S (o fundo some), o
// pulso/mensagem vêm em DUST_AWAKE_S e a poeira some até DUST_END_S.
export const DUST_REVEAL_S = 1.5;
export const DUST_AWAKE_S = 2.2;
const DUST_END_S = 2.8;
const DUST_COLORS = ["#FFFFFF", "#BFF1FF", "#4FC3E0", "#1E9BFF"]; // topo branco → laterais ciano → base azul, como os fios
const easeOut = (x) => 1 - (1 - Math.max(0, Math.min(1, x))) ** 3;
const easeInOut = (x) => {
  const y = Math.max(0, Math.min(1, x));
  return y < 0.5 ? 4 * y * y * y : 1 - (-2 * y + 2) ** 3 / 2;
};

const WAKE_SEEDS = Array.from({ length: 16 }, (_, index) => {
  const i = (index * 7) % 52;
  return { a: i * 2.399963 + 0.3, b: i * 1.618 + 1.1, k: 0.65 + (((i * 37) % 100) / 100) * 0.7 };
});

function useWakeCanvas(canvasRef, { enabled, geometryRef, onReveal, onBoom }) {
  const boomRef = useRef(onBoom);
  boomRef.current = onBoom;
  const revealRef = useRef(onReveal);
  revealRef.current = onReveal;
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
    let revealed = false;
    let awoke = false;
    let dust = null;
    let frame = 0;
    const stops = orbStops(0);
    const lut = { key: "", length: null }; // distância ao longo do caminho (wakePathLength), refeita só se a tela mudar
    const draw = (now) => {
      const time = (now - started) / 1000;
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
          glow.addColorStop(0, `rgba(225,250,255,${0.15 * pre})`); // Pó de luz: brilho discreto (30% do clarão antigo)
          glow.addColorStop(0.5, `rgba(120,110,255,${0.036 * pre})`);
          glow.addColorStop(1, "rgba(79,195,224,0)");
          ctx.globalAlpha = 1;
          ctx.fillStyle = glow;
          ctx.fillRect(cx - R * 1.5, cy - R * 1.5, R * 3, R * 3);
        }
        ctx.restore();
      }
      const bt = time - HENRY_WAKE.boom;
      if (bt >= 0 && bt < DUST_END_S) {
        if (!dust) {
          // pontos sobre a circunferência do anel (±3,5% do raio), cada um com a direção e a distância em que se espalha
          dust = [];
          const count = W < 820 ? 420 : 640;
          for (let i = 0; i < count; i += 1) {
            const th = Math.random() * Math.PI * 2;
            const dir = th + (Math.random() - 0.5) * 1.4;
            const dist = R * (0.18 + Math.random() * 0.5);
            dust.push({
              th,
              rr: R * (1 + (Math.random() - 0.5) * 0.07),
              dx: Math.cos(dir) * dist,
              dy: Math.sin(dir) * dist,
              sz: 0.7 + Math.random() * 0.9,
              ph: Math.random() * 6.28,
              c: Math.min(3, Math.floor(((Math.sin(th) + 1) / 2) * 3.2 + Math.random() * 0.8))
            });
          }
        }
        // espalha devagar (0–1,2 s) e volta (1,2–2,5 s) girando um tico; some entre 1,9 e 2,7 s
        const f = bt < 1.2 ? easeOut(bt / 1.2) : 1 - easeInOut((bt - 1.2) / 1.3);
        const fade = 1 - wakeSmooth(1.9, 2.7, bt);
        const rot = 0.18 * bt;
        const paths = DUST_COLORS.map(() => new Path2D());
        for (const d of dust) {
          const a = d.th + rot;
          const wob = 4 * f * Math.sin(bt * 1.7 + d.ph);
          const x = cx + Math.cos(a) * d.rr + d.dx * f + wob;
          const y = cy + Math.sin(a) * d.rr + d.dy * f + wob * 0.6;
          paths[d.c].moveTo(x + d.sz, y);
          paths[d.c].arc(x, y, d.sz, 0, Math.PI * 2);
        }
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.85 * fade;
        paths.forEach((path, index) => {
          ctx.fillStyle = DUST_COLORS[index];
          ctx.fill(path);
        });
        ctx.restore();
      }
      if (bt >= DUST_REVEAL_S && !revealed) {
        revealed = true;
        revealRef.current?.();
      }
      if (bt >= DUST_AWAKE_S && !awoke) {
        awoke = true;
        boomRef.current?.();
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
  const [reveal, setReveal] = useState(false);
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
    onReveal: () => setReveal(true),
    onBoom: () => {
      setAwake(true);
      onBoom?.();
    }
  });
  const R = orbSize * 0.32;

  return (
    <div
      className={`${styles.scene} ${awake ? styles.awake : ""} ${reveal ? styles.reveal : ""} ${still ? styles.still : ""} ${mobile ? styles.mobile : ""}`}
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
