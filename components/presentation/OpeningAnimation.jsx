"use client";

import styles from "./opening.module.css";

// ANIMAÇÃO DE ABERTURA da apresentação (cena 1): uma chave metálica entra, encaixa na fechadura e gira; a casa se
// desenha por traços; a porta abre revelando luz quente; as janelas acendem; partículas de luz sobem. Tudo em SVG + CSS
// (só transform, opacity e stroke-dashoffset; nenhum filtro, canvas, vídeo, áudio ou biblioteca).
// Interface estável (o player não conhece o miolo):
//   durationMs     duração total (padrão 4200 ms; todos os tempos internos são frações dela)
//   reducedMotion  true = estado final estático (casa acesa, sem chave, sem movimento)
// Decorativa (aria-hidden): o texto da cena é que informa. A cena dura mais que a animação e tocar adianta.
export const OPENING_ANIMATION_DEFAULT_MS = 4200;
const BASE = 4200; // os tempos abaixo (em ms) foram desenhados para esta duração

// Traços da casa: [id, d, largura, início(ms), duração(ms)]
const STROKES = [
  ["ground", "M26 262 H374", 1.6, 150, 800],
  ["walls", "M104 262 V154 M296 262 V154", 2.6, 450, 700],
  ["roof", "M76 157 L200 68 L324 157", 3, 800, 800],
  ["roof2", "M98 157 L200 82 L302 157", 1.2, 1050, 600],
  ["chimney", "M264 118 V84 H286 V132", 2.4, 1250, 450],
  ["door", "M175 262 V187 H225 V262", 2.4, 1350, 500],
  ["winL", "M112 180 H152 V222 H112 Z M132 180 V222 M112 201 H152 M108 225 H156", 2, 1200, 600],
  ["winR", "M248 180 H288 V222 H248 Z M268 180 V222 M248 201 H288 M244 225 H292", 2, 1300, 600],
  ["porch", "M160 267 H240 M150 272 H250", 1.4, 1500, 450]
];

const ms = (value, total) => `${Math.round((value * total) / BASE)}ms`;
const at = (start, duration, total) => ({ animationDelay: ms(start, total), animationDuration: ms(duration, total) });

// Partículas de luz: [x, y, raio, início(ms), subida(px), duração(ms)]
const SPARKS = [
  [192, 238, 2.2, 2800, 96, 1300],
  [206, 244, 1.6, 2950, 118, 1250],
  [186, 226, 1.4, 3100, 84, 1100],
  [214, 236, 2, 3000, 130, 1200],
  [199, 250, 1.3, 3250, 104, 950],
  [178, 232, 1.5, 3150, 76, 1050],
  [222, 228, 1.2, 3350, 90, 850]
];

export default function OpeningAnimation({ durationMs = OPENING_ANIMATION_DEFAULT_MS, reducedMotion = false }) {
  const total = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : OPENING_ANIMATION_DEFAULT_MS;
  return (
    <div
      className={`${styles.stage} ${reducedMotion ? styles.static : ""}`}
      aria-hidden="true"
      data-opening-animation=""
      style={{ "--open-dur": `${total}ms` }}
    >
      <svg className={styles.svg} viewBox="0 0 400 320" focusable="false" role="presentation">
        <defs>
          <radialGradient id="oaCool" cx="50%" cy="52%" r="50%">
            <stop offset="0" stopColor="#1769d1" stopOpacity="0.34" />
            <stop offset="0.6" stopColor="#1769d1" stopOpacity="0.1" />
            <stop offset="1" stopColor="#1769d1" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="oaWarm" cx="50%" cy="60%" r="50%">
            <stop offset="0" stopColor="#ffe6b3" stopOpacity="0.5" />
            <stop offset="0.55" stopColor="#ffd89a" stopOpacity="0.14" />
            <stop offset="1" stopColor="#ffd89a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="oaLight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff6e0" />
            <stop offset="1" stopColor="#ffd995" />
          </linearGradient>
          <linearGradient id="oaFloor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe3aa" stopOpacity="0.7" />
            <stop offset="1" stopColor="#ffe3aa" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="oaDoor" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2a6dba" />
            <stop offset="1" stopColor="#0e3b69" />
          </linearGradient>
          <linearGradient id="oaBody" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9cc3f5" stopOpacity="0.2" />
            <stop offset="1" stopColor="#9cc3f5" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="oaGround" gradientUnits="userSpaceOnUse" x1="26" y1="0" x2="374" y2="0">
            <stop offset="0" stopColor="#cfe3fa" stopOpacity="0" />
            <stop offset="0.25" stopColor="#cfe3fa" stopOpacity="0.9" />
            <stop offset="0.75" stopColor="#cfe3fa" stopOpacity="0.9" />
            <stop offset="1" stopColor="#cfe3fa" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="oaMetal" gradientUnits="userSpaceOnUse" x1="0" y1="-14" x2="0" y2="14">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.38" stopColor="#d3e4fa" />
            <stop offset="0.58" stopColor="#85afe3" />
            <stop offset="1" stopColor="#e8f1fd" />
          </linearGradient>
          <linearGradient id="oaShine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id="oaKeyClip">
            <path d="M0 0 L5 -4 H46 V4 H40 V10 H34 V4 H27 V8 H21 V4 H5 Z" />
            <rect x="44" y="-6" width="5" height="12" rx="1" />
            <path clipRule="evenodd" d="M48 0 a13 13 0 1 0 26 0 a13 13 0 1 0 -26 0 Z M54.8 0 a6.2 6.2 0 1 0 12.4 0 a6.2 6.2 0 1 0 -12.4 0 Z" />
          </clipPath>
        </defs>

        {/* atmosfera: halo azul + anel fino que se desenha atrás da casa */}
        <ellipse className={styles.coolHalo} cx="200" cy="176" rx="196" ry="150" fill="url(#oaCool)" style={at(0, 900, total)} />
        <circle className={`${styles.draw} ${styles.ring}`} cx="200" cy="172" r="142" pathLength="1" style={at(100, 1500, total)} />

        {/* calor da casa acesa */}
        <ellipse className={styles.warmHalo} cx="200" cy="232" rx="150" ry="104" fill="url(#oaWarm)" style={at(2500, 1100, total)} />
        <path className={styles.floorLight} d="M176 262 H224 L262 304 H138 Z" fill="url(#oaFloor)" style={at(2550, 900, total)} />

        {/* corpo da casa */}
        <g className={styles.body} style={at(1000, 900, total)}>
          <path d="M104 262 V157 L200 82 L296 157 V262 Z" fill="url(#oaBody)" />
        </g>

        {/* luz atrás da porta e nas janelas (acendem em sequência) */}
        <rect className={styles.doorLight} x="178" y="190" width="44" height="72" fill="url(#oaLight)" style={at(2560, 520, total)} />
        <rect className={styles.winLit} x="114" y="182" width="36" height="38" fill="url(#oaLight)" style={at(2950, 420, total)} />
        <rect className={styles.winLit} x="250" y="182" width="36" height="38" fill="url(#oaLight)" style={at(3200, 420, total)} />
        <circle className={styles.winLit} cx="200" cy="124" r="11" fill="url(#oaLight)" style={at(3450, 420, total)} />

        {/* folha da porta (com a fechadura): entra, espera a chave, gira e abre */}
        <g className={styles.leaf} style={{ "--leaf-in": ms(1500, total), "--leaf-in-d": ms(450, total), "--leaf-open": ms(2600, total), "--leaf-open-d": ms(750, total) }}>
          <rect x="178" y="190" width="44" height="72" fill="url(#oaDoor)" />
          <rect x="183" y="196" width="34" height="26" fill="none" stroke="#9cc3f5" strokeOpacity="0.35" strokeWidth="1" />
          <rect x="183" y="228" width="34" height="28" fill="none" stroke="#9cc3f5" strokeOpacity="0.35" strokeWidth="1" />
          <circle cx="213" cy="232" r="8.5" fill="#0a2748" stroke="#cfe3fa" strokeWidth="1.4" />
          <circle cx="213" cy="230.6" r="2.2" fill="#e8f1fd" />
          <path d="M212 231 H214 L214.8 237 H211.2 Z" fill="#e8f1fd" />
        </g>

        {/* traços da casa */}
        <g className={styles.lines} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {STROKES.map(([id, d, width, start, dur]) => (
            <path key={id} className={`${styles.draw} ${id === "ground" ? styles.ground : ""}`} stroke={id === "ground" ? "url(#oaGround)" : undefined} d={d} pathLength="1" strokeWidth={width} style={at(start, dur, total)} />
          ))}
          <circle className={styles.draw} cx="200" cy="124" r="13" pathLength="1" strokeWidth="2" style={at(1550, 450, total)} />
        </g>

        {/* "clique" da fechadura */}
        <circle className={styles.ripple} cx="213" cy="232" r="9" style={at(2380, 700, total)} />

        {/* a chave: cinematográfica (entra grande, brilha, desce à fechadura, encaixa e gira) */}
        <g className={styles.key} style={at(150, 2800, total)}>
          <path d="M0 0 L5 -4 H46 V4 H40 V10 H34 V4 H27 V8 H21 V4 H5 Z" fill="url(#oaMetal)" />
          <rect x="44" y="-6" width="5" height="12" rx="1" fill="url(#oaMetal)" />
          <path fillRule="evenodd" d="M48 0 a13 13 0 1 0 26 0 a13 13 0 1 0 -26 0 Z M54.8 0 a6.2 6.2 0 1 0 12.4 0 a6.2 6.2 0 1 0 -12.4 0 Z" fill="url(#oaMetal)" />
          <g clipPath="url(#oaKeyClip)">
            <rect className={styles.shine} x="-8" y="-16" width="14" height="32" fill="url(#oaShine)" style={at(780, 760, total)} />
          </g>
        </g>

        {/* partículas de luz */}
        <g className={styles.sparks}>
          {SPARKS.map(([x, y, r, start, rise, dur], index) => (
            <circle key={index} className={styles.spark} cx={x} cy={y} r={r} style={{ ...at(start, dur, total), "--rise": `${-rise}px` }} />
          ))}
        </g>
      </svg>
    </div>
  );
}
