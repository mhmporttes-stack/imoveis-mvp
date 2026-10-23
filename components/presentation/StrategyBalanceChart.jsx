"use client";

import { useEffect, useRef, useState } from "react";
import { formatBRL } from "@/lib/simulation-presentation-format.mjs";
import { formatDuration, formatRoundedYears, yearsLessText } from "@/lib/payment-strategy-core.mjs";
import styles from "./presentation.module.css";

// Gráfico "Projeção de quitação" da folha da Estratégia (PRES-24). SÓ APRESENTAÇÃO: lê as séries de saldo que o motor
// (`compareStrategy`, lib/payment-strategy-core.mjs) já calculou — o valor quitado é só (financiado − saldo devedor) do mesmo
// mês; nenhum número de amortização/juros é recalculado aqui.
// Visual aprovado pelo dono em 2026-10-22 (protótipo "ESTRATÉGIA COM AMORTIZAÇÃO", com o ajuste do mesmo dia):
// - de BAIXO PARA CIMA: quanto já foi QUITADO, de R$ 0 (hoje) até o topo (financiamento inteiro quitado);
// - SEM amortização em vermelho (#F0716A), COM amortização em dourado (#E8B85C) — sem verde;
// - curvas suaves: uma amostra a cada 24 meses + o mês de quitação, ligadas por Catmull-Rom → Bézier (sem degraus nem
//   tremido); área dourada entre as curvas = o tempo que você ganha;
// - ajuste do dono de 2026-10-22 (print do iPhone: "muito rápido", texto fora do centro, bolinha nas duas linhas):
//   o bloco sobe ao rolar (stReveal), mas o DESENHO é por TEMPO e só começa com o gráfico ≥ 60% visível
//   (IntersectionObserver, uma vez; sem ele, ao abrir a folha): dourada ~2,6 s e vermelha ~3,6 s (vai até os 35 anos),
//   começando juntas; a área dourada aparece depois da dourada; cada linha ganha uma bolinha quando chega ao topo (dourada e
//   vermelha) com efeito de pulo; "N anos a menos" aparece depois das duas bolinhas, CENTRALIZADO na área dourada:
//   x no meio do vão no topo (fim da dourada → fim da vermelha), y no meio entre o topo e a vermelha naquele x, com folga
//   ≥ 12 px de cada linha (medida nas linhas desenhadas); não cabendo, fonte menor e, por fim, o ponto mais próximo que
//   caiba dentro da área. prefers-reduced-motion: tudo pronto, sem animação.
// - Textos em HTML (≥ 12px) sobre o SVG, posicionados por % do mesmo quadro: nada passa da largura da folha (incidente de
//   overflow de 2026-10-18).

const W = 340; // quadro do SVG (protótipo)
const H = 170;
const TOP = 14; // linha do "quitado"
const BASE = 166; // linha do R$ 0
const SAMPLE_EVERY = 24; // meses

function samples(balances, every = SAMPLE_EVERY) {
  const last = balances.length - 1;
  const points = [];
  for (let k = 0; k <= last; k += every) points.push([k, balances[k]]);
  if (points[points.length - 1][0] !== last) points.push([last, balances[last]]);
  return points;
}

const f1 = (value) => value.toFixed(1);

// Catmull-Rom → Bézier (mesma conta do protótipo), sobre pontos já no quadro do SVG
function smooth(points) {
  return points.reduce((d, [x, y], k) => {
    if (!k) return `M${f1(x)},${f1(y)}`;
    const a = points[k - 2] || points[k - 1];
    const b = points[k - 1];
    const c = points[k + 1] || points[k];
    return `${d} C${f1(b[0] + (x - a[0]) / 6)},${f1(b[1] + (y - a[1]) / 6)} ${f1(x - (c[0] - b[0]) / 6)},${f1(y - (c[1] - b[1]) / 6)} ${f1(x)},${f1(y)}`;
  }, "");
}

const pct = (value) => `${Math.round(value * 1000) / 10}%`;

const GAP_FONTS = [13, 12, 11]; // px: "N anos a menos" diminui um pouco se não couber
const GAP_CLEAR = 12; // px de folga mínima de cada linha
// em uma linha (13 → 11 px) e, se nem assim couber, em duas ("N anos" / "a menos")
const GAP_LAYOUTS = [...GAP_FONTS.map((font) => ({ font, lines: 1 })), ...GAP_FONTS.map((font) => ({ font, lines: 2 }))];

function pathPoints(path, n = 80) {
  const length = path.getTotalLength();
  return Array.from({ length: n + 1 }, (_, k) => {
    const point = path.getPointAtLength((length * k) / n);
    return [point.x, point.y];
  });
}

// y da linha (pontos em ordem de x) no x pedido; fora do trecho → null
function yAt(points, x) {
  for (let k = 1; k < points.length; k += 1) {
    const [x0, y0] = points[k - 1];
    const [x1, y1] = points[k];
    if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1)) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
  }
  return null;
}

function clearance(points, cx, cy, hw, hh) {
  let min = Infinity;
  for (const [x, y] of points) min = Math.min(min, Math.hypot(Math.max(Math.abs(x - cx) - hw, 0), Math.max(Math.abs(y - cy) - hh, 0)));
  return min;
}

// Posição (unidades do SVG) e formato do "N anos a menos" dentro da área dourada (entre a dourada, o topo e a vermelha).
// `scale` = px por unidade do SVG; `oneW`/`twoW`/`lineH` = largura em uma linha, em duas e altura da linha, medidas com `font` px.
// 1º o ponto pedido (x no meio do vão no topo; y no meio entre o topo e a vermelha), na maior fonte em que caiba com a folga;
// 2º o ponto mais perto dele em que caiba; 3º (gráfico estreito demais para a folga) o ponto com MAIS espaço livre da área,
// ou seja, o centro dela — nunca encostado numa linha quando há lugar melhor.
function placeGap({ sem, com, comEndX, scale, oneW, twoW, lineH, font }) {
  const top = [];
  for (let x = comEndX; x <= W; x += 4) top.push([x, TOP]);
  const lines = [...sem, ...com, ...top];
  const clear = GAP_CLEAR / scale + 2; // + meia espessura do traço
  const specX = (comEndX + W) / 2;
  const specY = (TOP + (yAt(sem, specX) ?? BASE)) / 2;
  const box = ({ font: size, lines: rows }) => [
    ((rows === 2 ? twoW : oneW) * size) / font / scale / 2,
    (lineH * rows * size) / font / scale / 2
  ];
  const inside = (cx, cy, hw, hh) => {
    const red = yAt(sem, cx);
    const upper = cx >= comEndX ? TOP : yAt(com, cx);
    return cx - hw >= 0 && cx + hw <= W && cy - hh > TOP && red !== null && upper !== null && cy > upper && cy < red;
  };
  const room = (cx, cy, layout) => {
    const [hw, hh] = box(layout);
    return inside(cx, cy, hw, hh) ? clearance(lines, cx, cy, hw, hh) : -1;
  };
  for (const layout of GAP_LAYOUTS) if (room(specX, specY, layout) >= clear) return { x: specX, y: specY, ...layout };
  const roomiest = [];
  for (const layout of GAP_LAYOUTS) {
    let nearest = null;
    let best = null;
    for (let cx = 0; cx <= W; cx += 3) {
      for (let cy = TOP; cy <= BASE; cy += 3) {
        const free = room(cx, cy, layout);
        if (free < 0) continue;
        const distance = Math.hypot(cx - specX, cy - specY);
        if (free >= clear && (!nearest || distance < nearest.distance)) nearest = { x: cx, y: cy, ...layout, distance };
        if (!best || free > best.free) best = { x: cx, y: cy, ...layout, free };
      }
    }
    if (nearest) return nearest;
    if (best) roomiest.push(best);
  }
  // sem a folga inteira em nenhum formato: o 1º formato com ao menos 8 px livres; senão, o de mais espaço
  return roomiest.find((option) => option.free >= 8 / scale + 2)
    || roomiest.sort((a, b) => b.free - a.free)[0]
    || { x: specX, y: specY, ...GAP_LAYOUTS[GAP_LAYOUTS.length - 1] };
}

export default function StrategyBalanceChart({ comparison, showStrategy }) {
  const wrapRef = useRef(null);
  const semRef = useRef(null);
  const comRef = useRef(null);
  const gapRef = useRef(null);
  const [play, setPlay] = useState(false);
  const [gap, setGap] = useState(null);

  // o desenho começa (por tempo) quando o gráfico está ≥ 60% visível, uma vez; sem IntersectionObserver, ao abrir a folha
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || play) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setPlay(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.6)) {
        setPlay(true);
        observer.disconnect();
      }
    }, { threshold: [0.6] });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [play]);

  // "N anos a menos" centralizado na área dourada, com folga das linhas DESENHADAS; refaz ao mudar a largura ou os números
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !semRef.current || !comRef.current || !gapRef.current) {
      setGap(null);
      return undefined;
    }
    const measure = () => {
      const scale = wrap.clientWidth / W;
      const label = gapRef.current;
      if (!scale || !label) return;
      const font = parseFloat(getComputedStyle(label).fontSize) || GAP_FONTS[0];
      const sem = pathPoints(semRef.current);
      const com = pathPoints(comRef.current);
      const comEndX = com[com.length - 1][0];
      const [first, second] = label.children;
      const lineH = label.offsetHeight / (label.hasAttribute("data-two-lines") ? 2 : 1);
      const oneW = first.offsetWidth + second.offsetWidth + font * 0.3; // + o espaço entre as duas partes
      const twoW = Math.max(first.offsetWidth, second.offsetWidth);
      setGap(placeGap({ sem, com, comEndX, scale, oneW, twoW, lineH, font }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [comparison, showStrategy]);

  if (!comparison) return null;
  const { sem, com } = comparison;
  const start = sem.balances[0] || 0;
  const span = Math.max(1, sem.months);
  const withStrategy = Boolean(showStrategy) && com.months < sem.months;
  const toPaid = ([month, balance]) => [month, start - balance];
  const toXY = ([month, paid]) => [(month / span) * W, BASE - (start > 0 ? paid / start : 0) * (BASE - TOP)];

  const qSem = samples(sem.balances).map(toPaid).map(toXY);
  const qCom = withStrategy ? samples(com.balances).map(toPaid).map(toXY) : [];
  const semLine = smooth(qSem);
  const comLine = withStrategy ? smooth(qCom) : "";
  const semEnd = qSem[qSem.length - 1];
  const comEnd = withStrategy ? qCom[qCom.length - 1] : null;
  // área dourada: sobe pela dourada até o topo, segue o topo até o fim da vermelha e volta descendo pela vermelha
  const area = withStrategy ? `${comLine} L${f1(semEnd[0])},${TOP} ${smooth([...qSem].reverse()).replace(/^M[^ ]+/, "")} Z` : "";
  const gapText = withStrategy ? yearsLessText(sem.months, com.months) : "";
  // antes da medição (1º quadro): x no meio do vão no topo, y no meio entre o topo e a vermelha naquele x
  const midX = withStrategy ? (comEnd[0] + semEnd[0]) / 2 : 0;
  const midY = withStrategy ? (TOP + (yAt(qSem, midX) ?? BASE)) / 2 : 0;
  const gapAt = gap || { x: midX, y: midY, font: GAP_FONTS[0], lines: 1 };
  const gapLead = gapText.replace(/ a menos$/, "");
  const endLabel = sem.months % 12 === 0 ? formatRoundedYears(sem.months) : formatDuration(sem.months);

  const summary = withStrategy
    ? `Projeção. Valor financiado: ${formatBRL(start)}. Sem amortização, seria todo quitado em ${formatDuration(sem.months)}. Com amortização, seria quitado em ${formatDuration(com.months)}${gapText ? `: ${gapText}` : ""}${comparison.economiaJuros > 0 ? `, com ${formatBRL(comparison.economiaJuros)} a menos de juros` : ""}.`
    : `Projeção. Valor financiado: ${formatBRL(start)}. Sem amortização, seria todo quitado em ${formatDuration(sem.months)}.`;

  return (
    <figure className={styles.stChart}>
      <figcaption className={styles.stLabel}>Projeção de quitação</figcaption>
      <p className={styles.stSrOnly}>{summary}</p>
      <div ref={wrapRef} className={styles.stPlotWrap} aria-hidden="true" data-play={play ? "" : undefined}>
        <svg viewBox={`0 0 ${W} ${H}`} focusable="false" className={styles.stPlotSvg}>
          <line x1="0" y1={TOP} x2={W} y2={TOP} className={styles.stGridTop} />
          <line x1="0" y1={(TOP + BASE) / 2} x2={W} y2={(TOP + BASE) / 2} className={styles.stGrid} />
          <line x1="0" y1={BASE} x2={W} y2={BASE} className={styles.stAxis} />
          {withStrategy ? <path d={area} className={styles.stBand} /> : null}
          <path ref={semRef} d={semLine} pathLength="1" className={`${styles.stPathSem} ${styles.stDraw}`} />
          {withStrategy ? <path ref={comRef} d={comLine} pathLength="1" className={`${styles.stPathCom} ${styles.stDraw} ${styles.stDrawCom}`} /> : null}
          {withStrategy ? <circle cx={f1(comEnd[0])} cy={TOP} r="6" className={styles.stDot} /> : null}
          <circle cx={f1(semEnd[0])} cy={TOP} r="5.5" className={`${styles.stDot} ${styles.stDotSem}`} />
        </svg>
        {gapText ? (
          <p ref={gapRef} className={styles.stGap} data-two-lines={gapAt.lines === 2 ? "" : undefined} style={{ left: pct(gapAt.x / W), top: pct(gapAt.y / H), fontSize: `${gapAt.font}px` }}>
            <span>{gapLead}</span> <span>{gapText.slice(gapLead.length + 1)}</span>
          </p>
        ) : null}
      </div>
      <div className={styles.stXAxis}>
        <span>hoje</span>
        <span>{endLabel}</span>
      </div>
      <ul className={styles.stLegend}>
        <li><i className={styles.stKeySem} aria-hidden="true" />Sem amortização ({formatRoundedYears(sem.months)})</li>
        {withStrategy ? <li><i className={styles.stKeyCom} aria-hidden="true" />Com amortização</li> : null}
        {withStrategy ? <li><i className={styles.stKeyBand} aria-hidden="true" />Área dourada = tempo que você ganha</li> : null}
      </ul>
    </figure>
  );
}
