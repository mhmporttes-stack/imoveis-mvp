"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/components/motion/usePrefersReducedMotion";
import { useTabHidden } from "./HenrySearchScene";
import styles from "./HenryMusicScene.module.css";

// Cena da MÚSICA do Henry (dono, 2026-10-23: "quando eu peço uma playlist… cena legal, como se ele encontrasse o Spotify,
// pesquisasse a playlist que pedi e apertasse play… mostre ele conectado com o ícone do Spotify, igual ele faz com os
// corretores"). Segue os eventos REAIS do stream (`music.stage`, lib/henry-voice-narration.mjs):
//   connect  → feixe do anel até o card do Spotify ("Conectando ao Spotify…");
//   search   → "Conectado ao Spotify" + campo de busca digitando o pedido + resultados aparecendo;
//   found/opening → o item encontrado em destaque (capa quando o Spotify devolve) — "Abrindo o Spotify…" se o app estava fechado;
//   playing  → o cursor do Henry aperta o play, equalizador e o anel pulsando no ritmo;
//   control  → pausar/próxima/volume (só o rótulo); error → texto curto (sem aparelho, sem conexão…).
// HenryNowPlaying: bloco compacto no canto da tela cheia enquanto o Spotify toca (dono, 2026-10-23: "num canto, não na
// tela toda") — card "Tocando agora" + ondas sonoras finas no estilo do anel (canvas 2D, ~30 fps, pausa com a aba oculta,
// cai de qualidade se o quadro atrasar; abaixa quando o Henry fala; some em ~1 s na pausa; reduced-motion = quadro parado).
// Marca: só a do Matheus Machado na tela; o Spotify aparece APENAS pelo ícone oficial (verde #1ED760, sem alteração),
// como identificação — origem do desenho: Simple Icons 13.21.0 ("spotify", fonte declarada: guia de marca do Spotify,
// developer.spotify.com/documentation/design). Paleta do Henry: navy #07111F, ciano #4FC3E0, azul #1E9BFF, dourado #E8B85C.

export const SPOTIFY_GREEN = "#1ED760";
const ACCENT = "#4FC3E0";
const GOLD = "#E8B85C";
const SPOTIFY_PATH =
  "M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z";

export function SpotifyIcon({ size = 20, color = SPOTIFY_GREEN, title = "Spotify" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={title} style={{ flexShrink: 0 }}>
      <path d={SPOTIFY_PATH} fill={color} />
    </svg>
  );
}

// Texto aparecendo letra a letra (campo de busca). reduced-motion = o texto inteiro de uma vez.
function useTyped(text, reduced) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (reduced || !text) {
      setCount(text.length);
      return undefined;
    }
    setCount(0);
    let index = 0;
    const id = window.setInterval(() => {
      index += 1;
      setCount(index);
      if (index >= text.length) window.clearInterval(id);
    }, 55);
    return () => window.clearInterval(id);
  }, [text, reduced]);
  return text.slice(0, count);
}

function Cover({ image, size = 52 }) {
  const [failed, setFailed] = useState(false);
  if (image && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" width={size} height={size} className={styles.cover} style={{ width: size, height: size }} onError={() => setFailed(true)} referrerPolicy="no-referrer" />;
  }
  return (
    <span className={`${styles.cover} ${styles.coverEmpty}`} style={{ width: size, height: size }}>
      <SpotifyIcon size={Math.round(size * 0.42)} color="#FFFFFF" title="" />
    </span>
  );
}

function Equalizer({ bars = 5, className = "" }) {
  return (
    <span className={`${styles.eq} ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => (
        <span key={index} style={{ animationDelay: `${(index * 137) % 520}ms` }} />
      ))}
    </span>
  );
}

const STAGE_TITLE = { connect: "Conectando ao Spotify…", error: "Spotify" };

function MusicCard({ music, reduced, mobile }) {
  const stage = music.stage;
  const query = music.query || "";
  const typed = useTyped(stage === "connect" ? "" : query, reduced);
  const showSearch = ["search", "found", "opening", "playing"].includes(stage) && Boolean(query);
  const hasItem = ["found", "opening", "playing"].includes(stage);
  const title = STAGE_TITLE[stage] || "Conectado ao Spotify";
  return (
    <div className={`${styles.card} ${mobile ? styles.cardMobile : ""}`} data-stage={stage} data-henry-music-card>
      <div className={styles.cardInner}>
        <span className={styles.sheen} />
        <div className={styles.head}>
          <span className={styles.iconWrap}>
            <SpotifyIcon size={22} />
          </span>
          <span className={styles.headText}>
            <span className={styles.headTitle}>{title}</span>
            {stage === "connect" ? <span className={styles.headSub}>ligando o Henry ao seu Spotify</span> : <span className={styles.headSub}>{stage === "error" ? "não deu certo agora" : "Henry conectado"}</span>}
          </span>
          {stage !== "connect" && stage !== "error" ? <span className={styles.live} aria-hidden="true" /> : null}
        </div>
        {showSearch ? (
          <div className={styles.search}>
            <svg viewBox="0 0 24 24" className={styles.searchIcon} aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className={styles.searchText}>
              {typed}
              {!reduced && typed.length < query.length ? <span className={styles.caret} /> : null}
            </span>
          </div>
        ) : null}
        {stage === "search" ? (
          <div className={styles.results} aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span key={index} className={styles.resultRow} style={{ animationDelay: `${420 + index * 260}ms` }}>
                <span className={styles.resultThumb} />
                <span className={styles.resultLines}>
                  <span style={{ width: `${78 - index * 14}%` }} />
                  <span style={{ width: `${48 - index * 8}%` }} />
                </span>
              </span>
            ))}
          </div>
        ) : null}
        {hasItem ? (
          <div className={styles.item}>
            <Cover image={music.image} />
            <span className={styles.itemText}>
              <span className={styles.itemName}>{music.name || query || "Encontrado"}</span>
              <span className={styles.itemSub}>{stage === "opening" ? "Abrindo o Spotify…" : stage === "playing" ? (music.artists && music.artists !== "playlist" ? music.artists : "Tocando agora") : music.artists && music.artists !== "playlist" ? music.artists : "Encontrado"}</span>
            </span>
            <span className={`${styles.play} ${stage === "playing" ? styles.playOn : ""}`} aria-hidden="true">
              {stage === "playing" ? <Equalizer bars={4} className={styles.playEq} /> : <svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5.5v13l10.5-6.5z" fill="#07111F" /></svg>}
              {stage === "playing" && !reduced ? <span className={styles.cursor} /> : null}
            </span>
          </div>
        ) : null}
        {stage === "control" ? <p className={styles.note}>{music.name ? `${music.name}${music.artists && music.artists !== "playlist" ? ` · ${music.artists}` : ""}` : "Comando enviado ao Spotify"}</p> : null}
        {stage === "error" ? <p className={styles.error}>{music.error || "O Spotify não respondeu agora."}</p> : null}
      </div>
    </div>
  );
}

// Anel do equalizador em volta do orb (no play): barras radiais pulsando no ritmo.
function RingEqualizer({ size, reduced }) {
  const bars = 48;
  const c = size / 2;
  const inner = size * 0.36;
  return (
    <svg className={styles.ringEq} width={size} height={size} aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => {
        const angle = (index / bars) * Math.PI * 2;
        const x1 = c + inner * Math.cos(angle);
        const y1 = c + inner * Math.sin(angle);
        const x2 = c + (inner + size * 0.035) * Math.cos(angle);
        const y2 = c + (inner + size * 0.035) * Math.sin(angle);
        return (
          <line
            key={index}
            x1={x1.toFixed(1)}
            y1={y1.toFixed(1)}
            x2={x2.toFixed(1)}
            y2={y2.toFixed(1)}
            stroke={index % 6 === 0 ? GOLD : ACCENT}
            strokeWidth="1.6"
            strokeLinecap="round"
            className={reduced ? "" : styles.ringBar}
            style={{ transformOrigin: `${x1.toFixed(1)}px ${y1.toFixed(1)}px`, animationDelay: `${(index * 173) % 640}ms`, opacity: 0.55 }}
          />
        );
      })}
    </svg>
  );
}

// Card do Spotify ligado ao anel por um feixe (mesmo desenho dos cards de corretor): à direita no computador, abaixo
// do anel no celular. Fica dentro do contêiner do orb (orbSize × orbSize).
export default function HenryMusicScene({ music = null, orbSize = 520, mobile = false }) {
  const hidden = useTabHidden();
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (!music?.stage) return null;
  const size = orbSize;
  const c = size / 2;
  const ring = size * 0.33;
  const end = mobile ? [c, c + ring + 34] : [c + size * 0.5 + 30, c];
  const start = mobile ? [c, c + ring] : [c + ring, c];
  const control = mobile ? [c + 22, (start[1] + end[1]) / 2] : [(start[0] + end[0]) / 2, c - 30];
  const d = `M${start[0].toFixed(1)} ${start[1].toFixed(1)} Q${control[0].toFixed(1)} ${control[1].toFixed(1)} ${end[0].toFixed(1)} ${end[1].toFixed(1)}`;
  const linked = music.stage !== "connect" && music.stage !== "error";
  return (
    <div className={`${styles.wrap} ${hidden ? styles.paused : ""}`} style={{ width: size, height: size }} data-henry-music aria-live="polite">
      {music.stage === "playing" ? <RingEqualizer size={size} reduced={reduced} /> : null}
      <svg className={styles.beams} width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}-beam`} gradientUnits="userSpaceOnUse" x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]}>
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.15" />
            <stop offset="60%" stopColor={ACCENT} stopOpacity="0.9" />
            <stop offset="100%" stopColor={GOLD} stopOpacity="1" />
          </linearGradient>
        </defs>
        <path d={d} fill="none" stroke={`url(#${uid}-beam)`} strokeWidth="6" opacity="0.16" strokeLinecap="round" />
        <path d={d} fill="none" stroke={`url(#${uid}-beam)`} strokeWidth="1.4" pathLength="1" className={styles.beamDraw} opacity={linked ? 0.95 : 0.55} />
        {!reduced ? <path d={d} fill="none" stroke={linked ? GOLD : ACCENT} strokeWidth="2" strokeDasharray="3 9" strokeLinecap="round" className={styles.beamFlow} opacity="0.8" /> : null}
        {!reduced && !hidden && linked
          ? [0, 0.55].map((begin) => (
              <circle key={begin} r="2.6" fill="#fff" opacity="0.95" style={{ filter: `drop-shadow(0 0 4px ${GOLD})` }}>
                <animateMotion dur="1.4s" begin={`${begin}s`} repeatCount="indefinite" path={d} />
              </circle>
            ))
          : null}
        <circle cx={end[0]} cy={end[1]} r="3.2" fill={linked ? GOLD : ACCENT} />
      </svg>
      <div className={`${styles.slot} ${mobile ? styles.slotMobile : ""}`} style={{ left: mobile ? end[0] : end[0] + 4, top: end[1] }}>
        <MusicCard music={music} reduced={reduced} mobile={mobile} />
      </div>
    </div>
  );
}

// ---------- Ondas sonoras + "Tocando agora" (canto da tela cheia) ----------
// Sem acesso ao áudio do Spotify: pulso simulado por um BPM (o `tempo` da faixa quando o Spotify libera; senão ~100) e
// ruído suave (somas de senos). Linhas finas aditivas, ciano → branco, uma dourada, opacidades diferentes (profundidade).
const WAVE_LINES = [
  { alpha: 0.18, amp: 1, freq: 1.3, speed: 0.55, phase: 0.2, width: 1.6, color: "79,195,224" },
  { alpha: 0.32, amp: 0.8, freq: 1.9, speed: 0.8, phase: 1.4, width: 1.1, color: "120,215,240" },
  { alpha: 0.5, amp: 0.62, freq: 2.4, speed: 1.05, phase: 2.6, width: 0.9, color: "200,240,255" },
  { alpha: 0.42, amp: 0.7, freq: 1.6, speed: 0.7, phase: 3.9, width: 0.85, color: "232,184,92" },
  { alpha: 0.26, amp: 0.9, freq: 2.9, speed: 1.3, phase: 5.1, width: 0.8, color: "30,155,255" },
  { alpha: 0.6, amp: 0.45, freq: 3.4, speed: 1.6, phase: 0.9, width: 0.7, color: "255,255,255" }
];

function SoundWaves({ width, height, playing, ducking, tempo, reduced }) {
  const canvasRef = useRef(null);
  const live = useRef({ playing, ducking, tempo });
  live.current = { playing, ducking, tempo };
  const hidden = useTabHidden();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mid = height / 2;
    let quality = 1; // 1 = todas as linhas e pontos; cai para 0,5 se o quadro atrasar
    let gain = 0;
    let duck = 1;
    let slowFrames = 0;
    const paint = (t) => {
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";
      const bpm = Number(live.current.tempo) >= 40 ? Number(live.current.tempo) : 100;
      const beat = (t * bpm) / 60;
      const pulse = Math.pow(Math.max(0, Math.cos((beat % 1) * Math.PI * 2)), 6); // batida curta
      const energy = 0.55 + 0.25 * Math.sin(t * 0.37) + 0.2 * Math.sin(t * 0.91 + 1.3); // "música" mudando devagar
      const lines = quality < 1 ? WAVE_LINES.filter((_, index) => index % 2 === 0) : WAVE_LINES;
      const step = quality < 1 ? 12 : 6;
      for (const line of lines) {
        const amplitude = height * 0.36 * line.amp * gain * duck * (0.45 + 0.4 * energy + 0.35 * pulse);
        context.beginPath();
        for (let x = 0; x <= width; x += step) {
          const u = x / width;
          const envelope = Math.sin(Math.PI * u); // as pontas assentam (bloco compacto, sem corte seco)
          const y = mid + amplitude * envelope * (Math.sin(u * Math.PI * 2 * line.freq + t * line.speed * 2 + line.phase) * 0.7 + Math.sin(u * Math.PI * 2 * line.freq * 2.3 - t * line.speed * 1.4 + line.phase * 2) * 0.3);
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        // Pontas somem (sem a linha reta brilhante nas bordas do bloco).
        const alpha = (line.alpha * Math.max(0.35, duck)).toFixed(3);
        const fade = context.createLinearGradient(0, 0, width, 0);
        fade.addColorStop(0, `rgba(${line.color},0)`);
        fade.addColorStop(0.2, `rgba(${line.color},${alpha})`);
        fade.addColorStop(0.8, `rgba(${line.color},${alpha})`);
        fade.addColorStop(1, `rgba(${line.color},0)`);
        context.strokeStyle = fade;
        context.lineWidth = line.width;
        context.stroke();
      }
      context.globalCompositeOperation = "source-over";
    };
    if (reduced) {
      gain = live.current.playing ? 0.45 : 0;
      paint(1.7);
      return undefined;
    }
    if (hidden) return undefined;
    let raf = 0;
    let lastDraw = 0;
    let lastTime = performance.now();
    let t = 0;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (now - lastDraw < 33) return; // ~30 fps bastam para ondas suaves (e poupam CPU)
      const delta = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      lastDraw = now;
      // Quadro atrasado (> 60 ms) várias vezes seguidas → metade das linhas e dos pontos.
      if (delta > 0.06) slowFrames += 1;
      else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 8) quality = 0.5;
      t += delta;
      const target = live.current.playing ? 1 : 0;
      gain += (target - gain) * Math.min(1, delta * (target ? 2.2 : 4.5)); // pausa: assenta em ~1 s
      const duckTarget = live.current.ducking ? 0.3 : 1;
      duck += (duckTarget - duck) * Math.min(1, delta * 3);
      paint(t);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [width, height, reduced, hidden]);
  return <canvas ref={canvasRef} className={styles.waves} style={{ width, height }} aria-hidden="true" />;
}

// nowPlaying = { isPlaying, name, artists, image, tempo } do /api/admin/henry/spotify/player. ducking = o Henry falando.
// Pausou → as ondas assentam e o bloco some em ~1 s.
export function HenryNowPlaying({ nowPlaying = null, ducking = false, mobile = false }) {
  const reduced = usePrefersReducedMotion();
  const playing = Boolean(nowPlaying?.isPlaying && nowPlaying?.name);
  const [shown, setShown] = useState(playing ? nowPlaying : null);
  useEffect(() => {
    if (playing) {
      setShown(nowPlaying);
      return undefined;
    }
    const id = window.setTimeout(() => setShown(null), 1100);
    return () => window.clearTimeout(id);
  }, [playing, nowPlaying]);
  if (!shown) return null;
  const width = mobile ? 300 : 400;
  const height = mobile ? 44 : 96;
  return (
    <div className={`${styles.now} ${mobile ? styles.nowMobile : ""} ${playing ? "" : styles.nowOut}`} style={{ width }} data-henry-now-playing>
      <SoundWaves width={width} height={height} playing={playing} ducking={ducking} tempo={shown.tempo} reduced={reduced} />
      <div className={styles.nowCard}>
        <Cover image={shown.image} size={mobile ? 38 : 44} />
        <span className={styles.itemText}>
          <span className={styles.nowLabel}>
            {playing && !reduced ? <Equalizer bars={3} className={styles.nowEq} /> : null}
            Tocando agora
          </span>
          <span className={styles.itemName}>{shown.name}</span>
          {shown.artists ? <span className={styles.itemSub}>{shown.artists}</span> : null}
        </span>
        <SpotifyIcon size={20} />
      </div>
    </div>
  );
}
