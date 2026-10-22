"use client";

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
// - quando a dourada bate no topo, uma bolinha dourada com brilho ("pop") e "N anos a menos" ENTRE as duas linhas
//   (x no meio entre o fim da dourada e o fim do gráfico; y no meio entre o topo e a linha vermelha naquele x);
// - as linhas se desenham conforme a folha rola (pathLength=1 + CSS animation-timeline do próprio gráfico) e TERMINAM quando
//   o gráfico entra inteiro na tela (fica no fim da folha: não dá para rolar mais); navegador sem esse recurso: por tempo.
//   prefers-reduced-motion: tudo pronto, sem animação.
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

export default function StrategyBalanceChart({ comparison, showStrategy }) {
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
  const semYAt = (x) => {
    for (let k = 1; k < qSem.length; k += 1) {
      if (qSem[k][0] >= x) {
        const [x0, y0] = qSem[k - 1];
        const [x1, y1] = qSem[k];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
      }
    }
    return TOP;
  };
  const gapText = withStrategy ? yearsLessText(sem.months, com.months) : "";
  const midX = withStrategy ? (comEnd[0] + W) / 2 : 0;
  const midY = withStrategy ? (TOP + semYAt(midX)) / 2 + 4 : 0;
  const endLabel = sem.months % 12 === 0 ? formatRoundedYears(sem.months) : formatDuration(sem.months);

  const summary = withStrategy
    ? `Projeção. Valor financiado: ${formatBRL(start)}. Sem amortização, seria todo quitado em ${formatDuration(sem.months)}. Com amortização, seria quitado em ${formatDuration(com.months)}${gapText ? `: ${gapText}` : ""}${comparison.economiaJuros > 0 ? `, com ${formatBRL(comparison.economiaJuros)} a menos de juros` : ""}.`
    : `Projeção. Valor financiado: ${formatBRL(start)}. Sem amortização, seria todo quitado em ${formatDuration(sem.months)}.`;

  return (
    <figure className={styles.stChart}>
      <figcaption className={styles.stLabel}>Projeção de quitação</figcaption>
      <p className={styles.stSrOnly}>{summary}</p>
      <div className={styles.stPlotWrap} aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} focusable="false" className={styles.stPlotSvg}>
          <line x1="0" y1={TOP} x2={W} y2={TOP} className={styles.stGridTop} />
          <line x1="0" y1={(TOP + BASE) / 2} x2={W} y2={(TOP + BASE) / 2} className={styles.stGrid} />
          <line x1="0" y1={BASE} x2={W} y2={BASE} className={styles.stAxis} />
          {withStrategy ? <path d={area} className={styles.stBand} /> : null}
          <path d={semLine} pathLength="1" className={`${styles.stPathSem} ${styles.stDraw}`} />
          {withStrategy ? <path d={comLine} pathLength="1" className={`${styles.stPathCom} ${styles.stDraw} ${styles.stDrawCom}`} /> : null}
          {withStrategy ? <circle cx={f1(comEnd[0])} cy={TOP} r="6" className={styles.stDot} /> : null}
        </svg>
        {gapText ? (
          <p className={styles.stGap} style={{ left: pct(midX / W), top: pct(midY / H) }}>{gapText}</p>
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
