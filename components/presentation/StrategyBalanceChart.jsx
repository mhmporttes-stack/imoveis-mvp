"use client";

import { useEffect, useRef, useState } from "react";
import { formatBRL } from "@/lib/simulation-presentation-format.mjs";
import { formatDuration, formatRoundedYears, yearsLessText } from "@/lib/payment-strategy-core.mjs";
import styles from "./presentation.module.css";

// Gráfico "Quanto do financiamento você já quitou" da folha da Estratégia (PRES-24). SÓ APRESENTAÇÃO: lê as séries de saldo
// que o motor (`compareStrategy`, lib/payment-strategy-core.mjs) já calculou — o valor quitado é só (financiado − saldo devedor)
// do mesmo mês; nenhum número de amortização/juros é recalculado aqui.
// - Ajustes do dono (2026-10-19): as duas linhas iguais (mesma espessura, sólidas, mesma curva), só a cor muda — vermelho
//   sem amortização, verde com amortização; o gráfico SOBE de R$ 0 (hoje) até o total financiado (quitado); no fim de cada
//   linha, os anos; dentro da faixa verde entre as linhas, "N anos a menos".
// - A faixa verde = saldo que você deixa de carregar (os juros de cada mês incidem sobre o saldo: menos saldo = menos juros).
// - Uma amostra por ano (com amortização: a cada 2 anos se passar de 6 anos, o ciclo do FGTS) e o mês de quitação, ligada por
//   curva monotônica (Fritsch–Carlson): suaviza os degraus dos aportes sem inventar descida e passa pelos valores amostrados.
// - Linhas/áreas num SVG esticado (preserveAspectRatio="none" + traço que não escala) e textos/marcadores em HTML por %:
//   texto legível (≥ 12px) em 320 px e nada passa da largura da folha (incidente de overflow de 2026-10-18). O texto
//   "a menos" só entra dentro da faixa se couber sem encostar nas linhas (medido no tamanho real do gráfico); senão vai
//   logo abaixo do gráfico.
// - Cena (dono, 2026-10-19, 2ª rodada): primeiro a linha VERMELHA sobe inteira (2,4 s) e a bolinha dela pulsa; depois a
//   VERDE sobe (2,4 s) e pulsa; por fim entram a faixa verde e "N anos a menos". A cena começa quando o gráfico aparece na
//   tela e SE REPETE do zero a cada mudança do resultado (opção ligada/desligada, valor, mês), esperando ~400 ms sem nova
//   mudança para não reiniciar a cada dígito. prefers-reduced-motion: tudo pronto, sem cena.
// - Pontas e diferença só em anos inteiros, arredondados (formatRoundedYears/yearsLessText, lib/payment-strategy-core.mjs).

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

// eixo do valor: "R$ 0" embaixo e "190 mil" nos demais (sem repetir "R$": sobra largura para o gráfico em 320 px)
function compactBRL(value) {
  if (value <= 0) return "R$ 0";
  if (value >= 1e6) return `${(value / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (value >= 1e3) return `${(value / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `${Math.round(value)}`;
}

const pct = (value) => `${r1(value * 100)}%`;

const DRAW_SECONDS = 2.4; // cada linha sobe em 2,4 s (dono, 2026-10-19): vermelha de 0 a 2,4 s, verde de 2,4 a 4,8 s
const RESTART_MS = 400; // espera sem nova mudança antes de repetir a cena (não reinicia a cada dígito digitado)

// fração quitada (0..1) num mês, a partir do saldo calculado pelo motor
function paidFraction(balances, start, month) {
  const index = Math.max(0, Math.min(balances.length - 1, Math.round(month)));
  return start > 0 ? Math.min(1, Math.max(0, (start - balances[index]) / start)) : 0;
}

// Onde cabe o texto "N anos a menos" DENTRO da faixa verde, sem encostar em nenhuma linha. Mede no tamanho real do gráfico
// (px): tenta a maior fonte e o menor número de linhas primeiro; devolve null se não couber (o texto vai para baixo do gráfico).
function placeGap({ width, height, font, span, start, sem, com, text }) {
  if (!width || !height) return null;
  // largura real do texto na fonte da página (canvas); sem canvas, estimativa conservadora por caractere
  const context = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  const textWidth = (line, size) => {
    if (!context) return line.length * size * 0.6;
    context.font = `850 ${size}px ${font || "sans-serif"}`;
    return context.measureText(line).width;
  };
  const columns = 96;
  const colW = width / columns;
  const low = [];
  const high = [];
  for (let c = 0; c < columns; c += 1) {
    const month = ((c + 0.5) / columns) * span;
    low.push(paidFraction(sem.balances, start, month) * height);
    high.push(month < com.months ? paidFraction(com.balances, start, month) * height : height);
  }
  // borda nas pontas da coluna (a curva entre as amostras pode variar um pouco dentro da coluna)
  const lowAt = (c) => Math.max(low[c], low[Math.min(columns - 1, c + 1)]);
  const highAt = (c) => Math.min(high[c], high[Math.max(0, c - 1)]);
  const years = text.replace(/ a menos$/, "");
  const layouts = [[text], [years, "a menos"]];
  const margin = 6;
  // 1º dentro da faixa verde (entre as linhas); 2º no espaço livre acima da linha verde (antes da quitação), ao lado da
  // faixa — quando a faixa é estreita demais para o texto caber sem encostar nas linhas
  const zones = [
    { inside: true, floorAt: lowAt, ceilingAt: highAt },
    { inside: false, floorAt: (c) => (((c + 1) / columns) * span < com.months ? Math.max(high[c], high[Math.min(columns - 1, c + 1)]) : height), ceilingAt: () => height },
  ];
  for (const zone of zones) {
    for (const size of [24, 22, 20, 18, 16, 15]) {
      for (const lines of layouts) {
        const boxW = Math.max(...lines.map((line) => textWidth(line, size))) + 8;
        const boxH = lines.length * size * 1.08 + 4;
        const needCols = Math.ceil(boxW / colW);
        let best = null;
        for (let left = 0; left + needCols <= columns; left += 1) {
          let floor = 0;
          let ceiling = height;
          for (let c = left; c < left + needCols; c += 1) { floor = Math.max(floor, zone.floorAt(c)); ceiling = Math.min(ceiling, zone.ceilingAt(c)); }
          const slack = ceiling - floor - 2 * margin - boxH;
          // dentro: a maior folga; fora: o mais perto da faixa (mais à direita)
          if (slack >= 0 && (!best || (zone.inside ? slack > best.slack : left > best.left))) best = { slack, left, floor, ceiling };
        }
        if (best) {
          const middle = zone.inside ? (best.floor + best.ceiling) / 2 : best.floor + margin + boxH / 2; // de baixo
          return {
            inside: zone.inside,
            lines,
            size,
            left: (best.left * colW + (needCols * colW - boxW) / (zone.inside ? 2 : 1)) / width,
            width: boxW / width,
            top: 1 - (middle + boxH / 2) / height,
          };
        }
      }
    }
  }
  return null;
}

export default function StrategyBalanceChart({ comparison, showStrategy }) {
  // abertura da folha: as linhas desenham e os marcadores entram no ritmo delas; depois disso, trocar opção mostra tudo na hora
  // o desenho só começa quando o gráfico aparece na tela (ele fica abaixo das opções: abrir a folha não basta)
  const plotRef = useRef(null);
  const areaRef = useRef(null);
  const [seen, setSeen] = useState(false);
  // cena: `run` remonta a parte animada (as animações CSS recomeçam do zero); `armed` = pode tocar (falso durante a espera)
  const [scene, setScene] = useState({ run: 0, armed: true });
  const [box, setBox] = useState({ width: 0, height: 0, font: "" });
  const signature = comparison
    ? [comparison.sem.months, comparison.com.months, Boolean(showStrategy), comparison.sem.balances[0], comparison.economiaJuros].join("|")
    : "";
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return undefined;
    lastSignature.current = signature;
    // resultado mudou: esconde as linhas (cena parada no início) e só toca depois de ~400 ms sem outra mudança
    setScene((prev) => ({ run: prev.run + 1, armed: false }));
    const timer = setTimeout(() => setScene((prev) => ({ ...prev, armed: true })), RESTART_MS);
    return () => clearTimeout(timer);
  }, [signature]);
  useEffect(() => {
    if (seen) return undefined;
    const node = plotRef.current;
    if (!node || typeof IntersectionObserver === "undefined") { setSeen(true); return undefined; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setSeen(true); observer.disconnect(); }
    }, { threshold: 0.4 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen, scene.run]);
  useEffect(() => {
    const node = areaRef.current;
    if (!node) return undefined;
    const measure = () => {
      const font = typeof getComputedStyle === "function" ? getComputedStyle(node).fontFamily : "";
      setBox((prev) => (prev.width === node.clientWidth && prev.height === node.clientHeight && prev.font === font ? prev : { width: node.clientWidth, height: node.clientHeight, font }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [comparison, scene.run]);
  if (!comparison) return null;
  const { sem, com } = comparison;
  const start = sem.balances[0] || 0;
  const span = Math.max(1, sem.months);
  const yMax = Math.max(1, start); // topo do gráfico = financiamento inteiro quitado
  const step = niceStep(yMax / 4);
  const sx = (month) => (month / span) * VB;
  const sy = (paid) => VB - (paid / yMax) * VB;
  const withStrategy = Boolean(showStrategy) && com.months < sem.months;
  const toPaid = ([month, balance]) => [month, start - balance];

  const semSeg = monotoneSegments(samples(sem.balances).map(toPaid));
  const comSeg = withStrategy ? monotoneSegments(samples(com.balances, com.months > 72 ? 24 : 12).map(toPaid)) : [];
  const semPath = curve(semSeg, sx, sy);
  const comPath = curve(comSeg, sx, sy);
  // faixa verde: sobe pela curva sem amortização até o topo, volta pelo topo até a quitação e desce pela curva com amortização
  const bandPath = withStrategy ? `${semPath} L${r1(sx(com.months))} 0${curve(comSeg, sx, sy, { reverse: true, move: false })} Z` : "";
  const semArea = `${semPath} L${VB} ${VB} Z`;

  // eixo do valor quitado: R$ 0, passos redondos e o topo = valor financiado (sem rótulo colado no topo)
  const yTicks = [];
  for (let value = 0; value < yMax * 0.82; value += step) yTicks.push(value);
  yTicks.push(yMax);

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
  const gapText = withStrategy ? yearsLessText(sem.months, com.months) : "";
  const gap = gapText ? placeGap({ ...box, span, start, sem, com, text: gapText }) : null;
  // relógio da cena: vermelha termina em 2,4 s, verde em 4,8 s; faixa e "a menos" logo depois
  const at = (seconds) => ({ "--d": `${r1(seconds * 10) / 10}s` });
  const SEM_END = DRAW_SECONDS;
  const COM_END = 2 * DRAW_SECONDS;

  const summary = withStrategy
    ? `Valor financiado: ${formatBRL(start)}. Sem amortização, fica todo quitado em ${formatDuration(sem.months)}. Com amortização, quitado em ${formatDuration(com.months)}${gapText ? `: ${gapText}` : ""}${comparison.economiaJuros > 0 ? `, com ${formatBRL(comparison.economiaJuros)} a menos de juros` : ""}.`
    : `Valor financiado: ${formatBRL(start)}. Sem amortização, fica todo quitado em ${formatDuration(sem.months)}.`;

  return (
    <figure className={styles.stChart}>
      <figcaption className={styles.stLabel}>Quanto do financiamento você já quitou</figcaption>
      <p className={styles.stSrOnly}>{summary}</p>
      <div
        key={scene.run}
        ref={plotRef}
        data-scene={scene.run}
        className={`${styles.stPlotWrap} ${styles.stIntro} ${seen && scene.armed ? "" : styles.stWaiting}`}
        aria-hidden="true"
      >
        <div className={styles.stAnnot}>
          {withStrategy ? (
            <span className={`${styles.stPayoff} ${styles.stPayoffCom}`} style={{ "--x": pct(payoffX), ...at(COM_END) }}>{formatRoundedYears(com.months)}</span>
          ) : null}
          <span className={`${styles.stPayoff} ${styles.stPayoffEnd} ${styles.stPayoffSem}`} style={{ "--x": "100%", ...at(SEM_END) }}>{formatRoundedYears(sem.months)}</span>
        </div>
        <div className={styles.stYAxis}>
          <b className={styles.stYSizer}>{compactBRL(yMax)}</b>
          {yTicks.map((value) => (
            <span key={value} style={{ top: pct(1 - value / yMax) }}>{compactBRL(value)}</span>
          ))}
        </div>
        <div ref={areaRef} className={styles.stPlot}>
          <svg viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="none" focusable="false" className={styles.stPlotSvg}>
            <defs>
              <linearGradient id="stBandFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#067647" stopOpacity="0.28" />
                <stop offset="1" stopColor="#067647" stopOpacity="0.1" />
              </linearGradient>
              <linearGradient id="stSemFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#b42318" stopOpacity="0.08" />
                <stop offset="1" stopColor="#b42318" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            {yTicks.map((value) => (
              <line key={value} x1="0" x2={VB} y1={r1(sy(value))} y2={r1(sy(value))} className={value === 0 ? styles.stAxis : styles.stGrid} />
            ))}
            {/* 1º a vermelha (com a área clara dela); 2º a verde; 3º a faixa verde entre as duas */}
            <g className={`${styles.stDraw} ${styles.stDrawSem}`}><path d={semArea} fill="url(#stSemFill)" /></g>
            {withStrategy ? <path d={bandPath} fill="url(#stBandFill)" className={styles.stBand} style={at(COM_END)} /> : null}
            <g className={`${styles.stDraw} ${styles.stDrawSem}`}><path d={semPath} className={styles.stPathSem} /></g>
            {withStrategy ? <g className={`${styles.stDraw} ${styles.stDrawCom}`} style={at(SEM_END)}><path d={comPath} className={styles.stPathCom} /></g> : null}
          </svg>
          {gap ? (
            <p
              className={`${styles.stGap} ${gap.inside ? "" : styles.stGapBeside}`}
              style={{ left: pct(gap.left), top: pct(gap.top), width: pct(gap.width), fontSize: `${gap.size}px`, ...at(COM_END + 0.3) }}
            >
              {gap.lines.map((line, index) => <span key={index} className={index === gap.lines.length - 1 && line === "a menos" ? styles.stGapSoft : ""}>{line}</span>)}
            </p>
          ) : null}
          <i className={`${styles.stDot} ${styles.stDotSem}`} style={{ left: "100%", top: "0%", ...at(SEM_END - 0.1) }} />
          {withStrategy ? <i className={`${styles.stDot} ${styles.stDotCom}`} style={{ left: pct(payoffX), top: "0%", ...at(COM_END - 0.1) }} /> : null}
        </div>
        <div className={styles.stXAxis}>
          <span className={styles.stXStart} style={{ left: 0 }}>hoje</span>
          {xTicks.map(({ year, x, minor }) => (
            <span key={year} className={minor ? styles.stXMinor : ""} style={{ left: pct(x) }}>{year}</span>
          ))}
          <span className={styles.stXEnd} style={{ right: 0 }}>{endLabel}</span>
        </div>
      </div>
      {gapText && !gap ? <p className={styles.stGapOut}>{gapText}</p> : null}
      <ul className={styles.stLegend}>
        <li><i className={styles.stKeySem} aria-hidden="true" />Sem amortização</li>
        {withStrategy ? <li><i className={styles.stKeyCom} aria-hidden="true" />Com amortização</li> : null}
        {withStrategy && comparison.economiaJuros > 0 ? <li><i className={styles.stKeyBand} aria-hidden="true" />Área verde = juros que você deixa de pagar</li> : null}
      </ul>
    </figure>
  );
}
