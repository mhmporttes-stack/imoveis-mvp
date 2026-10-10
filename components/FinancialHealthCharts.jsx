"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Gráficos da aba Saúde — SVG/CSS puro (sem dependência nova), responsivos e
// legíveis em 360px. Identidade azul/branco. Realizado = traço cheio; projetado = tracejado.

const COLORS = {
  realized: "#0D3B66",
  projected: "#1769D1",
  previous: "#9FB7D6",
  grid: "#E5EAF1",
  text: "#667085"
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatMoney(value) {
  return BRL.format(Number(value || 0));
}

// Rótulo de eixo sem "R$" (o tooltip traz o valor completo): economiza largura no celular.
function formatAxis(value) {
  const v = Number(value || 0);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const num = (n, d = 1) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d }).format(n);
  if (abs >= 1_000_000) return `${sign}${num(abs / 1_000_000)} mi`;
  if (abs >= 1_000) return `${sign}${num(abs / 1_000, abs >= 10_000 ? 0 : 1)} mil`;
  return `${sign}${num(abs, 0)}`;
}

// ---------- Resultado da imobiliária por corretor: colunas verticais ----------

const COLUMN_PLOT_HEIGHT = 240; // px da área de plotagem (0 → escala máxima)
const COLUMN_TOP_ROOM = 30; // folga acima da escala para o valor em R$ da maior coluna
const COLUMN_SLOT_MIN = 84; // largura mínima por corretor: abaixo disso rola na horizontal

// Escala: parte de R$ 0 e vai até o próximo milhar acima do maior resultado
// (3.825 → 4.000; 4.120 → 5.000; múltiplo exato de mil mantém). Sem resultado: 1.000.
export function niceThousandMax(maxValue) {
  const v = Number(maxValue || 0);
  if (!(v > 0)) return 1000;
  return Math.max(1000, Math.ceil(v / 1000) * 1000);
}

function useCountUpOnView(signature, { duration = 1100 } = {}) {
  const ref = useRef(null);
  const [progress, setProgress] = useState(0);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return undefined; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setSeen(true); observer.disconnect(); }
    }, { threshold: 0.35 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!seen) return undefined;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { setProgress(1); return undefined; }
    let frame = 0;
    const start = performance.now();
    setProgress(0);
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setProgress(1 - Math.pow(1 - t, 3)); // easeOutCubic: suave, sem exagero
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seen, signature, duration]);

  return [ref, progress];
}

export function BrokerResultChart({ rows = [] }) {
  const [active, setActive] = useState("");
  const maxValue = Math.max(...rows.map((r) => r.agencyResult), 0);
  const scaleMax = niceThousandMax(maxValue);
  const signature = rows.map((r) => `${r.key}:${r.agencyResult}`).join("|");
  const [ref, progress] = useCountUpOnView(signature);

  if (!rows.length) return <div ref={ref}><EmptyChart text="Nenhum corretor encontrado para o período selecionado." /></div>;

  const ticks = [0, 0.5, 1].map((f) => scaleMax * f);
  const activeRow = rows.find((r) => r.key === active);

  return (
    <div ref={ref}>
      <div className="flex" aria-label="Resultado da imobiliária por corretor, em reais">
        {/* eixo Y fixo (não rola junto com as colunas) */}
        <div className="relative shrink-0 pr-2" style={{ width: 66, height: COLUMN_PLOT_HEIGHT + COLUMN_TOP_ROOM }} aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-[11px] font-bold text-muted" style={{ top: COLUMN_TOP_ROOM + COLUMN_PLOT_HEIGHT - (tick / scaleMax) * COLUMN_PLOT_HEIGHT }}>
              {formatAxisMoney(tick)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain pb-1" tabIndex={0} role="group" aria-label="Colunas por corretor (role para o lado se houver muitos)">
          <div className="relative flex" style={{ minWidth: rows.length * COLUMN_SLOT_MIN }}>
            {/* linhas de grade */}
            <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: COLUMN_PLOT_HEIGHT + COLUMN_TOP_ROOM }} aria-hidden="true">
              {ticks.map((tick) => (
                <div key={tick} className="absolute inset-x-0 border-t" style={{ top: COLUMN_TOP_ROOM + COLUMN_PLOT_HEIGHT - (tick / scaleMax) * COLUMN_PLOT_HEIGHT, borderColor: tick === 0 ? "#B8C4D6" : COLORS.grid }} />
              ))}
            </div>

            {rows.map((row) => {
              const finalHeight = (row.agencyResult / scaleMax) * COLUMN_PLOT_HEIGHT;
              const height = finalHeight * progress;
              const shown = row.agencyResult * progress;
              const open = active === row.key;
              return (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => setActive(open ? "" : row.key)}
                  onMouseEnter={() => setActive(row.key)}
                  onMouseLeave={() => setActive("")}
                  onFocus={() => setActive(row.key)}
                  onBlur={() => setActive("")}
                  aria-label={`${row.name}: ${formatMoney(row.agencyResult)}`}
                  className="relative z-10 flex min-w-0 flex-1 flex-col items-center focus:outline-none"
                  style={{ minWidth: COLUMN_SLOT_MIN }}
                >
                  <div className="relative w-full" style={{ height: COLUMN_PLOT_HEIGHT + COLUMN_TOP_ROOM }}>
                    {/* valor em R$ — FORA, acima da coluna, centralizado nela */}
                    <span
                      className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[13px] font-black tabular-nums ${row.agencyResult > 0 ? "text-navy" : "text-muted"}`}
                      style={{ bottom: height + 6 }}
                    >
                      {formatMoney(shown)}
                    </span>
                    {/* coluna: só existe altura se houver resultado (R$ 0 não ganha altura) */}
                    {finalHeight > 0 && (
                      <div
                        className={`absolute bottom-0 left-1/2 w-11 -translate-x-1/2 overflow-hidden rounded-t-xl bg-gradient-to-t from-navy to-brand shadow-[0_4px_10px_-6px_rgba(13,59,102,0.55)] transition-[filter] ${open ? "brightness-110" : ""}`}
                        style={{ height }}
                      >
                        {/* "$" branco dentro da coluna, perto do topo interno; some se a coluna for baixa demais */}
                        {height >= 30 && (
                          <span className="absolute left-0 right-0 top-1.5 text-center text-base font-black leading-none text-white" aria-hidden="true">$</span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="mt-2 line-clamp-2 min-h-[2.25rem] w-full break-words px-1 text-center text-xs font-black leading-[1.15rem] text-navy" title={row.name}>{row.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-2 min-h-[2.5rem] rounded-xl border border-line bg-mist px-3 py-2 text-xs leading-5 text-muted" role="status">
        {activeRow ? (
          <>
            <strong className="text-navy">{activeRow.name}</strong> · comissão bruta recebida <strong className="text-navy">{formatMoney(activeRow.grossReceived)}</strong> · repasses{" "}
            <strong className="text-navy">{formatMoney(activeRow.repasses)}</strong> · nota e despesas da venda <strong className="text-navy">{formatMoney(activeRow.otherCosts)}</strong> · {activeRow.salesCount} {activeRow.salesCount === 1 ? "venda" : "vendas"}
          </>
        ) : "Toque ou passe o mouse em uma coluna para ver o detalhe. Se houver muitos corretores, role o gráfico para o lado."}
      </p>
    </div>
  );
}

function formatAxisMoney(value) {
  const v = Number(value || 0);
  if (v === 0) return "R$ 0";
  const n = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v / 1000);
  return `R$ ${n} mil`;
}

const SERIES_OPTIONS = [
  { key: "result", label: "Resultado" },
  { key: "revenue", label: "Receita" },
  { key: "expenses", label: "Despesas" }
];

export function EvolutionChart({ evolution, previousLabel, currentLabel }) {
  const [metric, setMetric] = useState("result");
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  // Largura real do container: o viewBox acompanha, então a fonte fica em tamanho
  // legível (11px reais) mesmo em 360px — nada de SVG "encolhido".
  const [W, setW] = useState(640);
  const H = W < 480 ? 230 : 270;
  const pad = { left: 50, right: 12, top: 14, bottom: 28 };

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const update = () => setW(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [evolution]);

  const model = useMemo(() => {
    if (!evolution) return null;
    const prev = evolution.previous[metric] || [];
    const real = evolution.realized[metric] || [];
    const proj = evolution.projected ? evolution.projected[metric] : null;
    const days = Math.max(evolution.days, prev.filter((v) => v !== null).length);
    const all = [...prev, ...real, ...(proj || [])].filter((v) => v !== null && v !== undefined);
    if (!all.length) return { empty: true };
    let min = Math.min(0, ...all);
    let max = Math.max(0, ...all);
    if (max === min) max = min + 1;
    const span = max - min;
    min -= span * 0.04;
    max += span * 0.08;
    const x = (day) => pad.left + ((day - 1) / Math.max(1, days - 1)) * (W - pad.left - pad.right);
    const y = (v) => pad.top + (1 - (v - min) / (max - min)) * (H - pad.top - pad.bottom);
    const path = (arr) => {
      let d = "";
      let started = false;
      arr.forEach((v, i) => {
        if (v === null || v === undefined) { started = false; return; }
        d += `${started ? "L" : "M"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`;
        started = true;
      });
      return d;
    };
    const ticks = [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
    return { prev, real, proj, days, x, y, path, ticks, min, max };
  }, [evolution, metric, W, H]);

  if (!evolution) return <EmptyChart text="Sem dados para o gráfico." />;

  function handleMove(event) {
    if (!model || model.empty || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const day = Math.round(1 + ((px - pad.left) / (W - pad.left - pad.right)) * (model.days - 1));
    setHover(Math.min(model.days, Math.max(1, day)));
  }

  const dayLabels = model && !model.empty ? Array.from({ length: model.days }, (_, i) => i + 1).filter((d) => d === 1 || d % 5 === 0 || (d === model.days && model.days % 5 >= 3)) : [];

  return (
    <div>
      <div className="mb-3 inline-flex rounded-full border border-line bg-white p-1" role="tablist" aria-label="Série exibida (valores em R$)">
        {SERIES_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={metric === option.key}
            onClick={() => setMetric(option.key)}
            className={`min-h-9 rounded-full px-3.5 text-xs font-black sm:text-sm ${metric === option.key ? "bg-navy text-white" : "text-navy"}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {model?.empty ? <EmptyChart text="Sem movimentação para exibir neste mês." /> : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-pan-y select-none"
            role="img"
            aria-label={`Evolução acumulada de ${SERIES_OPTIONS.find((o) => o.key === metric).label.toLowerCase()}: ${previousLabel}, ${currentLabel} e projeção`}
            onPointerMove={handleMove}
            onPointerDown={handleMove}
            onPointerLeave={() => setHover(null)}
          >
            {model.ticks.map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={W - pad.right} y1={model.y(tick)} y2={model.y(tick)} stroke={COLORS.grid} strokeWidth="1" />
                <text x={pad.left - 8} y={model.y(tick) + 4} textAnchor="end" fontSize="11" fill={COLORS.text}>{formatAxis(tick)}</text>
              </g>
            ))}
            {model.min < 0 && <line x1={pad.left} x2={W - pad.right} y1={model.y(0)} y2={model.y(0)} stroke="#B8C4D6" strokeWidth="1.2" />}
            {dayLabels.map((d) => (
              <text key={d} x={model.x(d)} y={H - 8} textAnchor="middle" fontSize="11" fill={COLORS.text}>{d}</text>
            ))}
            <path d={model.path(model.prev)} fill="none" stroke={COLORS.previous} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {model.proj && <path d={model.path(model.proj)} fill="none" stroke={COLORS.projected} strokeWidth="2.4" strokeDasharray="6 5" strokeLinejoin="round" strokeLinecap="round" />}
            <path d={model.path(model.real)} fill="none" stroke={COLORS.realized} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />
            {hover && (
              <line x1={model.x(hover)} x2={model.x(hover)} y1={pad.top} y2={H - pad.bottom} stroke={COLORS.previous} strokeWidth="1" strokeDasharray="3 3" />
            )}
            {hover && model.real[hover - 1] !== null && model.real[hover - 1] !== undefined && (
              <circle cx={model.x(hover)} cy={model.y(model.real[hover - 1])} r="4.5" fill={COLORS.realized} stroke="#fff" strokeWidth="2" />
            )}
          </svg>

          {hover && (
            <div
              className="pointer-events-none absolute top-1 rounded-xl border border-line bg-white px-3 py-2 text-xs shadow-sm"
              style={{ left: `${Math.min(62, Math.max(2, (model.x(hover) / W) * 100 - 8))}%` }}
              role="status"
            >
              <p className="font-black text-navy">Dia {hover}</p>
              <TooltipRow color={COLORS.previous} label={previousLabel} value={model.prev[hover - 1]} />
              <TooltipRow color={COLORS.realized} label={`${currentLabel} (realizado)`} value={model.real[hover - 1]} />
              {model.proj && <TooltipRow color={COLORS.projected} label="Projeção (previsto)" value={model.proj[hover - 1]} dashed />}
            </div>
          )}
        </div>
      )}

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-bold text-muted">
        <LegendItem color={COLORS.previous} label={`${previousLabel} (realizado)`} />
        <LegendItem color={COLORS.realized} label={`${currentLabel} (realizado)`} />
        {evolution.projected && <LegendItem color={COLORS.projected} label="Projeção (previsto)" dashed />}
      </ul>
      <p className="mt-2 text-xs leading-5 text-muted">Valores acumulados dia a dia. A linha tracejada é projeção a partir de recebimentos e despesas já previstos — não é dinheiro realizado.</p>
    </div>
  );
}

function TooltipRow({ color, label, value, dashed = false }) {
  return (
    <p className="mt-1 flex items-center gap-2 text-muted">
      <span className="inline-block h-0 w-4 shrink-0 border-t-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      <span>{label}:</span>
      <strong className="text-navy">{value === null || value === undefined ? "—" : formatMoney(value)}</strong>
    </p>
  );
}

function LegendItem({ color, label, dashed = false }) {
  return (
    <li className="flex items-center gap-2">
      <span className="inline-block h-0 w-5 border-t-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      {label}
    </li>
  );
}

function EmptyChart({ text }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-mist px-4 py-8 text-center text-sm font-bold text-muted">{text}</div>
  );
}
