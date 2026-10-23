"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { morningSceneDate } from "@/lib/henry-morning-core.mjs";
import styles from "./HenryOpeningScene.module.css";

// Cena de abertura do "bom dia" (HENRY-1, dono 2026-10-23: botão ▶ "caso a automação não funcione… uma cena espetacular,
// algo futurístico"). ~5 s antes de o Henry falar, por cima da tela cheia dele; ao terminar (ou tocar/clicar/Esc) chama
// onDone e a tela cheia normal aparece por baixo. Linha do tempo:
//   0,0 s linha de luz dourada liga a tela · 0,5 s grade em perspectiva/horizonte · 0,9 s anéis de HUD e varredura ·
//   0,8–3,3 s partículas convergem e formam o anel · 1,3 s "Bom dia, Matheus" + data + "Iniciando seu dia…" digitando ·
//   1,75 s símbolo oficial (só o "M" atual) acende, glitch aos 2,9 s · 3,7 s anel colapsa no orbe (onda de choque) ·
//   4,3–5,0 s a cena some. Canvas 2D leve (grade + partículas; dpr ≤ 1,5) + SVG/CSS. Números do dia (telemetry) só
// quando a tela já os tiver — nunca inventados. prefers-reduced-motion: quadro parado com fade (~2,6 s).

export const OPENING_MS = 5000;
export const OPENING_STILL_MS = 2600;
const SYMBOL = "/assets/matheus-machado-symbol.png";
const GOLD = [232, 184, 92];
const GOLD_SOFT = [243, 220, 166];
const CYAN = [79, 195, 224];

// "Whoosh" + tom de ativação curtinho, gerado na hora (sem arquivo). Volume baixo; quem chama respeita o mudo.
export function playHenryOpeningSound(context) {
  if (!context || context.state === "closed") return;
  try {
    const now = context.currentTime + 0.02;
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
    });
  } catch {
    // som é enfeite: sem WebAudio, a cena segue muda
  }
}

const easeInOut = (value) => (value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2);
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const rgba = (color, alpha) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
// Envelope: sobe entre a→b, desce entre c→d.
const envelope = (time, a, b, c, d) => clamp01((time - a) / (b - a)) * (1 - clamp01((time - c) / (d - c)));

function useTyping(lines, startMs, speedMs, enabled) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    setCount(0);
    const total = lines.reduce((sum, line) => sum + line.length, 0);
    let current = 0;
    let timer = window.setTimeout(function step() {
      current += 1;
      setCount(current);
      if (current < total) timer = window.setTimeout(step, speedMs);
    }, startMs);
    return () => window.clearTimeout(timer);
  }, [enabled, lines, speedMs, startMs]);
  let left = count;
  return lines.map((line) => {
    const shown = line.slice(0, Math.max(0, left));
    left -= line.length;
    return shown;
  });
}

function useCounter(value, enabled) {
  const [shown, setShown] = useState(enabled ? 0 : value);
  useEffect(() => {
    if (!enabled) return undefined;
    let frame = 0;
    const started = performance.now() + 1800;
    const tick = (now) => {
      const progress = clamp01((now - started) / 1100);
      setShown(Math.round(value * easeInOut(progress)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, value]);
  return shown;
}

function TelemetryRow({ label, value, animate }) {
  const shown = useCounter(value, animate);
  return (
    <span className={styles.check} style={{ animationDelay: "1700ms" }}>
      {label}
      <strong>{shown.toLocaleString("pt-BR")}</strong>
    </span>
  );
}

function HudRings() {
  // Quatro anéis concêntricos (viewBox 200): fino dourado, tracejado ciano, régua de marcas e arcos internos.
  return (
    <>
      <svg viewBox="0 0 200 200" className={`${styles.ring} ${styles.spinC}`} aria-hidden="true">
        <circle cx="100" cy="100" r="98" fill="none" stroke="rgba(232,184,92,0.55)" strokeWidth="0.35" />
        <circle cx="100" cy="100" r="94" fill="none" stroke="rgba(232,184,92,0.75)" strokeWidth="1.1" strokeDasharray="0.4 2.6" />
      </svg>
      <svg viewBox="0 0 200 200" className={`${styles.ring} ${styles.spinB}`} aria-hidden="true">
        <circle cx="100" cy="100" r="86" fill="none" stroke="rgba(79,195,224,0.6)" strokeWidth="0.5" strokeDasharray="38 8 6 8" />
        <path d="M100 10 l2.4 4 h-4.8z" fill="rgba(79,195,224,0.9)" />
      </svg>
      <svg viewBox="0 0 200 200" className={`${styles.ring} ${styles.spinA}`} aria-hidden="true">
        <circle cx="100" cy="100" r="76" fill="none" stroke="rgba(243,220,166,0.5)" strokeWidth="0.3" />
        <circle cx="100" cy="100" r="76" fill="none" stroke="rgba(232,184,92,0.95)" strokeWidth="1.6" strokeDasharray="60 418" strokeLinecap="round" />
        <circle cx="100" cy="100" r="76" fill="none" stroke="rgba(232,184,92,0.6)" strokeWidth="1.6" strokeDasharray="22 456" strokeDashoffset="-240" strokeLinecap="round" />
      </svg>
      <svg viewBox="0 0 200 200" className={`${styles.ring} ${styles.spinD}`} aria-hidden="true">
        <circle cx="100" cy="100" r="64" fill="none" stroke="rgba(79,195,224,0.45)" strokeWidth="0.6" strokeDasharray="2 5" />
        <circle cx="100" cy="100" r="58" fill="none" stroke="rgba(79,195,224,0.85)" strokeWidth="0.9" strokeDasharray="30 334" strokeLinecap="round" />
      </svg>
    </>
  );
}

function useOpeningCanvas(canvasRef, { enabled, mobile }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let width = 0;
    let height = 0;
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const count = mobile ? 80 : 150;
    const particles = Array.from({ length: count }, (_, index) => {
      const pick = index % 7;
      return {
        angle: (index / count) * Math.PI * 2 + Math.sin(index * 12.9898) * 0.4,
        far: 0.62 + ((index * 37) % 100) / 100 * 0.5,
        near: 0.9 + ((index * 53) % 100) / 100 * 0.2,
        delay: 0.75 + ((index * 61) % 100) / 100 * 1.0,
        duration: 1.25 + ((index * 29) % 100) / 100 * 0.6,
        spin: (index % 2 ? 1 : -1) * (0.6 + ((index * 17) % 10) / 10),
        color: pick < 4 ? GOLD : pick < 6 ? GOLD_SOFT : CYAN,
        size: 0.8 + ((index * 23) % 10) / 10
      };
    });

    let frame = 0;
    const started = performance.now();
    const position = (particle, time, cx, cy, radius, far) => {
      const progress = easeInOut(clamp01((time - particle.delay) / particle.duration));
      const orbit = Math.max(0, time - particle.delay - particle.duration) * 0.55 * Math.sign(particle.spin);
      const collapse = easeInOut(clamp01((time - 3.65) / 0.55));
      let distance = far * particle.far + (radius * particle.near - far * particle.far) * progress;
      distance += (radius * 0.18 - distance) * collapse;
      const angle = particle.angle + particle.spin * (1 - progress) * 1.4 + orbit + collapse * 2.2 * Math.sign(particle.spin);
      return [cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance];
    };

    const draw = (now) => {
      const time = (now - started) / 1000;
      const cx = width / 2;
      const cy = mobile ? height * 0.5 - window.innerHeight * 0.14 : height * 0.5; // mesmo centro do orbe da tela cheia
      const ring = mobile ? Math.min(width * 0.84, height * 0.46) : Math.max(220, Math.min(Math.min(width, height) * 0.62, 560, height * 0.95 - 300));
      const radius = ring * 0.36;
      const far = Math.hypot(width, height) * 0.62;
      context.clearRect(0, 0, width, height);

      // Horizonte digital: grade em perspectiva que corre na direção de quem olha.
      const gridAlpha = envelope(time, 0.45, 1.3, 3.7, 4.4) * 0.55;
      if (gridAlpha > 0.01) {
        const horizon = height * (mobile ? 0.76 : 0.64);
        const floor = height - horizon;
        context.lineWidth = 1;
        const lines = mobile ? 12 : 22;
        for (let index = -lines; index <= lines; index += 1) {
          const bottomX = cx + (index / lines) * width * 1.6;
          const gradient = context.createLinearGradient(0, horizon, 0, height);
          gradient.addColorStop(0, rgba(CYAN, 0));
          gradient.addColorStop(1, rgba(CYAN, gridAlpha * 0.55));
          context.strokeStyle = gradient;
          context.beginPath();
          context.moveTo(cx, horizon);
          context.lineTo(bottomX, height);
          context.stroke();
        }
        const scroll = (time * 0.9) % 1;
        for (let index = 0; index < 14; index += 1) {
          const depth = (index + 1 - scroll) / 14; // 0 = perto, 1 = horizonte
          const y = horizon + floor * Math.pow(1 - depth, 2.4);
          context.strokeStyle = rgba(index % 4 === 0 ? GOLD : CYAN, gridAlpha * (1 - depth) * 0.75);
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(width, y);
          context.stroke();
        }
        const glow = context.createLinearGradient(0, 0, width, 0);
        glow.addColorStop(0, rgba(GOLD, 0));
        glow.addColorStop(0.5, rgba(GOLD_SOFT, gridAlpha * 1.2));
        glow.addColorStop(1, rgba(GOLD, 0));
        context.fillStyle = glow;
        context.fillRect(0, horizon - 1, width, 2);
      }

      // Partículas convergindo para o anel do Henry (rastro curto, brilho aditivo).
      context.globalCompositeOperation = "lighter";
      for (const particle of particles) {
        if (time < particle.delay - 0.05) continue;
        const fade = (1 - clamp01((time - 4.0) / 0.4)) * clamp01((time - particle.delay) / 0.35);
        if (fade <= 0.01) continue;
        const [x, y] = position(particle, time, cx, cy, radius, far);
        const [px, py] = position(particle, Math.max(particle.delay, time - 0.07), cx, cy, radius, far);
        context.strokeStyle = rgba(particle.color, 0.55 * fade);
        context.lineWidth = particle.size;
        context.beginPath();
        context.moveTo(px, py);
        context.lineTo(x, y);
        context.stroke();
        context.fillStyle = rgba(particle.color, 0.9 * fade);
        context.fillRect(x - particle.size, y - particle.size, particle.size * 2, particle.size * 2);
      }
      // Núcleo: brilho que cresce quando o anel colapsa no orbe.
      const core = envelope(time, 1.6, 3.9, 4.05, 4.6);
      if (core > 0.01) {
        const bloom = context.createRadialGradient(cx, cy, 0, cx, cy, radius * (0.9 + core * 0.5));
        bloom.addColorStop(0, rgba(GOLD_SOFT, 0.22 * core));
        bloom.addColorStop(0.5, rgba(GOLD, 0.08 * core));
        bloom.addColorStop(1, rgba(GOLD, 0));
        context.fillStyle = bloom;
        context.fillRect(cx - radius * 2, cy - radius * 2, radius * 4, radius * 4);
      }
      context.globalCompositeOperation = "source-over";
      if (time < 5.2) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [canvasRef, enabled, mobile]);
}

const CHECKS = ["Tarefas e agenda", "Clientes novos", "Simulações enviadas", "Aniversariantes"];

export default function HenryOpeningScene({ name = "Matheus", mobile = false, telemetry = null, onDone, now = null }) {
  const canvasRef = useRef(null);
  const doneRef = useRef(false);
  const [still, setStill] = useState(false);
  const [ready, setReady] = useState(false);
  const [clock, setClock] = useState({ date: "", time: "" });
  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const at = now ? new Date(now) : new Date();
    setClock({
      date: morningSceneDate(at),
      time: new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(at)
    });
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

  useOpeningCanvas(canvasRef, { enabled: ready && !still, mobile });
  const fullLines = useMemo(() => [`Bom dia, ${name || "Matheus"}`, clock.date, "Iniciando seu dia…"], [name, clock.date]);
  const typed = useTyping(fullLines, 1300, 22, ready && !still && Boolean(clock.date));
  const lines = still ? fullLines : typed;
  const numbers = Array.isArray(telemetry) ? telemetry.filter((item) => item?.label && Number.isFinite(item.value)) : [];

  return (
    <div
      className={`${styles.scene} ${mobile ? styles.mobile : ""} ${still ? styles.still : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        finish.current();
      }}
      role="presentation"
      data-henry-opening
    >
      {!still ? <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" /> : null}
      <div className={styles.bootLine} aria-hidden="true" />
      <div className={styles.lines} aria-hidden="true" />
      <div className={styles.scan} aria-hidden="true" />
      <div className={styles.hud} aria-hidden="true">
        <HudRings />
        <div className={styles.symbol}>
          {/* eslint-disable-next-line @next/next/no-img-element -- símbolo oficial atual (CLAUDE.md regra 10) */}
          <img src={SYMBOL} alt="" draggable={false} />
        </div>
      </div>
      <div className={styles.shock} aria-hidden="true" />
      <div className={styles.frame} aria-hidden="true">
        <span className={`${styles.corner} ${styles.tl}`} />
        <span className={`${styles.corner} ${styles.tr}`} />
        <span className={`${styles.corner} ${styles.bl}`} />
        <span className={`${styles.corner} ${styles.br}`} />
        <span className={styles.labelTL}>
          <span className={styles.dotLive} />
          Henry · online
        </span>
        {clock.time ? <span className={styles.labelTR}>{clock.time} · São Paulo</span> : null}
        <div className={styles.checks}>
          <span className={styles.check} style={{ animationDelay: "1500ms" }}>
            <b>Pauta do dia</b>
          </span>
          {CHECKS.map((label, index) => (
            <span key={label} className={styles.check} style={{ animationDelay: `${1750 + index * 320}ms` }}>
              ▸ {label}
            </span>
          ))}
        </div>
        {numbers.length ? (
          <div className={styles.telemetry}>
            {numbers.slice(0, 4).map((item) => (
              <TelemetryRow key={item.label} label={item.label} value={item.value} animate={!still} />
            ))}
          </div>
        ) : null}
      </div>
      <div className={styles.copy} aria-live="polite">
        <p className={styles.hello}>{lines[0]}</p>
        <p className={styles.date}>{lines[1]}</p>
        <p className={styles.boot}>
          {lines[2]}
          {!still && clock.date && lines[1].length >= clock.date.length ? <span className={styles.caret} /> : null}
        </p>
      </div>
      <p className={styles.skip}>Toque ou Esc para pular</p>
    </div>
  );
}
