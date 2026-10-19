"use client";

import { useEffect, useRef, useState } from "react";
import { formatBRL } from "@/lib/simulation-presentation-format.mjs";
import { formatDuration } from "@/lib/payment-strategy-core.mjs";
import styles from "./presentation.module.css";

// Gráfico "Saldo devedor ao longo do tempo" da folha da Estratégia (PRES-24). SÓ APRESENTAÇÃO: lê as séries de saldo que o
// motor (`compareStrategy`, lib/payment-strategy-core.mjs) já calculou — nenhum número é recalculado aqui.
// - Sem amortização = vermelho tracejado; com amortização = verde; a faixa entre as duas = juros que você deixa de pagar
//   (os juros de cada mês incidem sobre o saldo: menos saldo carregado = menos juros).
// - Uma amostra por ano (com amortização: a cada 2 anos se passar de 6 anos, o ciclo do FGTS) e o mês de quitação, ligada por curva monotônica (Fritsch–Carlson): suaviza os degraus dos aportes
//   anuais/bienais sem inventar subida, sem passar abaixo de zero e passando exatamente pelos saldos amostrados.
// - Quitação anotada ACIMA do gráfico, com uma guia vertical até o ponto: nunca cobre as curvas, em qualquer prazo.
// - Linhas/áreas num SVG esticado (preserveAspectRatio="none" + traço que não escala) e textos/marcadores em HTML por %:
//   o texto fica legível (≥ 12px) em 320 px e nada passa da largura da folha (incidente de overflow de 2026-10-18).
// - Desenha da esquerda para a direita quando entra na tela; sem animação com prefers-reduced-motion.

const VB = 1000; // quadro do SVG (0..1000 nos dois eixos)

function samples(balances, every = 12) {
  const last = balances.length - 1;
  const points = [];
  for (let k = 0; k <= last; k += every) points.push([k, balances[k]]);
  if (points[points.length - 1][0] !== last) points.push([last, balances[last]]);
  return points;
}

// Curva monotônica (Fritsch–Carlson) → segmentos cúbicos [x0, y0, c1x, c1y, c2x, c2y, x1, y1] no espaço dos dados.
function monotoneSegments(points) {
  const n = points.length;
  if (n < 2) return [];
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx.push(points[i + 1][0] - points[i][0]);
    slope.push((points[i + 1][1] - points[i][1]) / (dx[i] || 1));
  }
  const tangent = [slope[0]];
  for (let i = 1; i < n - 1; i += 1) tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  tangent.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) { tangent[i] = 0; tangent[i + 1] = 0; continue; }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); tangent[i] = t * a * slope[i]; tangent[i + 1] = t * b * slope[i]; }
  }
  return points.slice(0, -1).map(([x0, y0], i) => {
    const [x1, y1] = points[i + 1];
    const third = dx[i] / 3;
    return [x0, y0, x0 + third, y0 + tangent[i] * third, x1 - third, y1 - tangent[i + 1] * third, x1, y1];
  });
}

const r1 = (value) => Math.round(value * 10) / 10;

function curve(segments, sx, sy, { reverse = false, move = true } = {}) {
  const list = reverse ? [...segments].reverse().map(([a, b, c, d, e, f, g, h]) => [g, h, e, f, c, d, a, b]) : segments;
  if (!list.length) return "";
  const start = `${move ? "M" : "L"}${r1(sx(list[0][0]))} ${r1(sy(list[0][1]))}`;
  return start + list.map(([, , c1x, c1y, c2x, c2y, x1, y1]) => ` C${r1(sx(c1x))} ${r1(sy(c1y))} ${r1(sx(c2x))} ${r1(sy(c2y))} ${r1(sx(x1))} ${r1(sy(y1))}`).join("");
}

// Escala "redonda" do eixo do saldo: passo 1/2/2,5/5 × 10ⁿ, ~4 faixas.
function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 2.5, 5, 10].map((f) => f * power).find((step) => step >= raw) || 10 * power;
}

function compactBRL(value) {
  if (value <= 0) return "R$ 0";
  if (value >= 1e6) return `R$ ${(value / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (value >= 1e3) return `R$ ${(value / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(value)}`;
}

// "12 anos e 1 mês" quebra só entre "12 anos" e "e 1 mês", nunca no meio de cada parte
function splitDuration(months) {
  return formatDuration(months).split(" e ").map((part, index) => <span key={index}>{index ? ` e ${part}` : part}</span>);
}

const pct = (value) => `${r1(value * 100)}%`;

export default function StrategyBalanceChart({ comparison, showStrategy }) {
  // abertura da folha: linhas desenham e os marcadores entram depois; depois disso, trocar opção mostra o marcador na hora
  // o desenho só começa quando o gráfico aparece na tela (ele fica abaixo das opções: abrir a folha não basta)
  const plotRef = useRef(null);
  const [seen, setSeen] = useState(false);
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const node = plotRef.current;
    if (!node || typeof IntersectionObserver === "undefined") { setSeen(true); return undefined; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setSeen(true); observer.disconnect(); }
    }, { threshold: 0.4 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!seen) return undefined;
    const timer = setTimeout(() => setIntro(false), 1600);
    return () => clearTimeout(timer);
  }, [seen]);
  if (!comparison) return null;
  const { sem, com } = comparison;
  const start = sem.balances[0] || 0;
  const span = Math.max(1, sem.months);
  const step = niceStep(start / 4);
  const yMax = Math.max(step, Math.ceil(start / step) * step);
  const sx = (month) => (month / span) * VB;
  const sy = (balance) => VB - (balance / yMax) * VB;
  const withStrategy = Boolean(showStrategy) && com.months < sem.months;

  const semSeg = monotoneSegments(samples(sem.balances));
  const comSeg = withStrategy ? monotoneSegments(samples(com.balances, com.months > 72 ? 24 : 12)) : [];
  const semPath = curve(semSeg, sx, sy);
  const comPath = curve(comSeg, sx, sy);
  // faixa da economia: desce pela curva sem amortização, volta pela linha do zero até a quitação e sobe pela curva com amortização
  const bandPath = withStrategy ? `${semPath} L${r1(sx(com.months))} ${VB}${curve(comSeg, sx, sy, { reverse: true, move: false })} Z` : "";
  const comArea = withStrategy ? `${comPath} L${r1(sx(0))} ${VB} Z` : "";

  const yTicks = [];
  for (let value = 0; value <= yMax + 0.5; value += step) yTicks.push(value);

  const totalYears = sem.months / 12;
  const yearStep = totalYears <= 6 ? 1 : totalYears <= 12 ? 2 : totalYears <= 24 ? 4 : 5;
  const xTicks = [];
  for (let year = yearStep; year < totalYears; year += yearStep) {
    const x = (year * 12) / span;
    // não encostar em "hoje" nem no rótulo final ("35 anos")
    if (x < 0.16 || x > 0.74) continue;
    xTicks.push({ year, x, minor: yearStep === 5 && year % 10 !== 0 });
  }
  const endLabel = sem.months % 12 === 0 ? `${totalYears} ${totalYears === 1 ? "ano" : "anos"}` : formatDuration(sem.months);
  const payoffX = sx(com.months) / VB;

  const summary = withStrategy
    ? `Saldo devedor começa em ${formatBRL(start)}. Sem amortização, zera em ${formatDuration(sem.months)}. Com amortização, o financiamento é quitado em ${formatDuration(com.months)}${comparison.economiaJuros > 0 ? `, com ${formatBRL(comparison.economiaJuros)} a menos de juros` : ""}.`
    : `Saldo devedor começa em ${formatBRL(start)} e, sem amortização, zera em ${formatDuration(sem.months)}.`;

  return (
    <figure className={styles.stChart}>
      <figcaption className={styles.stLabel}>Saldo devedor ao longo do tempo</figcaption>
      <p className={styles.stSrOnly}>{summary}</p>
      <div ref={plotRef} className={`${styles.stPlotWrap} ${intro ? styles.stIntro : ""} ${seen ? "" : styles.stWaiting}`} aria-hidden="true">
        <div className={styles.stAnnot}>
          {withStrategy ? (
            <span className={`${styles.stPayoff} ${payoffX > 0.5 ? styles.stPayoffEnd : ""}`} style={{ "--x": pct(payoffX) }}>
              <small>Quitado em</small>
              <strong>{splitDuration(com.months)}</strong>
            </span>
          ) : (
            <span className={`${styles.stPayoff} ${styles.stPayoffEnd} ${styles.stPayoffSem}`} style={{ "--x": "100%" }}>
              <small>Sem amortização, quitado em</small>
              <strong>{splitDuration(sem.months)}</strong>
            </span>
          )}
        </div>
        <div className={styles.stYAxis}>
          <b className={styles.stYSizer}>{compactBRL(yMax)}</b>
          {yTicks.map((value) => (
            <span key={value} style={{ top: pct(1 - value / yMax) }}>{compactBRL(value)}</span>
          ))}
        </div>
        <div className={styles.stPlot}>
          <svg viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="none" focusable="false" className={styles.stPlotSvg}>
            <defs>
              <linearGradient id="stBandFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#067647" stopOpacity="0.26" />
                <stop offset="1" stopColor="#067647" stopOpacity="0.08" />
              </linearGradient>
              <linearGradient id="stComFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#0b3a6e" stopOpacity="0.1" />
                <stop offset="1" stopColor="#0b3a6e" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="stSemFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#b42318" stopOpacity="0.1" />
                <stop offset="1" stopColor="#b42318" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            {yTicks.map((value) => (
              <line key={value} x1="0" x2={VB} y1={r1(sy(value))} y2={r1(sy(value))} className={value === 0 ? styles.stAxis : styles.stGrid} />
            ))}
            <g className={styles.stDraw}>
              {withStrategy ? (
                <>
                  <path d={comArea} fill="url(#stComFill)" />
                  <path d={bandPath} fill="url(#stBandFill)" />
                </>
              ) : (
                <path d={`${semPath} L0 ${VB} Z`} fill="url(#stSemFill)" />
              )}
              <path d={semPath} className={styles.stPathSem} />
              {withStrategy ? <path d={comPath} className={styles.stPathCom} /> : null}
            </g>
          </svg>
          <i className={`${styles.stDot} ${styles.stDotEnd}`} style={{ left: "100%", top: "100%" }} />
          {withStrategy ? (
            <>
              <i className={styles.stLeader} style={{ left: pct(payoffX) }} />
              <i className={`${styles.stDot} ${styles.stDotPayoff}`} style={{ left: pct(payoffX), top: "100%" }} />
            </>
          ) : <i className={`${styles.stLeader} ${styles.stLeaderSem}`} style={{ left: "100%" }} />}
        </div>
        <div className={styles.stXAxis}>
          <span className={styles.stXStart} style={{ left: 0 }}>hoje</span>
          {xTicks.map(({ year, x, minor }) => (
            <span key={year} className={minor ? styles.stXMinor : ""} style={{ left: pct(x) }}>{year}</span>
          ))}
          <span className={styles.stXEnd} style={{ right: 0 }}>{endLabel}</span>
        </div>
      </div>
      <ul className={styles.stLegend}>
        <li><i className={styles.stKeySem} aria-hidden="true" />Sem amortização</li>
        {withStrategy ? <li><i className={styles.stKeyCom} aria-hidden="true" />Com amortização</li> : null}
        {withStrategy && comparison.economiaJuros > 0 ? <li><i className={styles.stKeyBand} aria-hidden="true" />Diferença = juros que você deixa de pagar</li> : null}
      </ul>
    </figure>
  );
}
