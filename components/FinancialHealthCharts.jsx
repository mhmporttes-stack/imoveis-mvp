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

export function formatCompactMoney(value) {
  const v = Number(value || 0);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const num = (n, d = 1) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d }).format(n);
  if (abs >= 1_000_000) return `${sign}R$ ${num(abs / 1_000_000)} mi`;
  if (abs >= 1_000) return `${sign}R$ ${num(abs / 1_000, abs >= 10_000 ? 0 : 1)} mil`;
  return `${sign}R$ ${num(abs, 0)}`;
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

export function BrokerResultChart({ rows = [] }) {
  const [active, setActive] = useState("");
  const max = Math.max(...rows.map((r) => r.agencyResult), 0);

  if (!rows.length || max <= 0) {
    return <EmptyChart text="Nenhuma comissão recebida no período selecionado." />;
  }

  return (
    <ul className="space-y-3" aria-label="Resultado da imobiliária por corretor">
      {rows.map((row) => {
        const width = Math.max(2, Math.round((row.agencyResult / max) * 100));
        const open = active === row.key;
        return (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => setActive(open ? "" : row.key)}
              onMouseEnter={() => setActive(row.key)}
              onMouseLeave={() => setActive("")}
              onFocus={() => setActive(row.key)}
              onBlur={() => setActive("")}
              aria-expanded={open}
              className="block w-full text-left"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-black text-navy">{row.name}</span>
                <span className="shrink-0 text-sm font-black text-navy">{formatMoney(row.agencyResult)}</span>
              </span>
              <span className="mt-1.5 block h-3 overflow-hidden rounded-full bg-blue-50">
                <span className="block h-full rounded-full bg-gradient-to-r from-brand to-navy transition-all" style={{ width: `${width}%` }} />
              </span>
            </button>
            {open && (
              <p className="mt-1.5 rounded-xl border border-line bg-mist px-3 py-2 text-xs leading-5 text-muted" role="status">
                Comissão bruta recebida <strong className="text-navy">{formatMoney(row.grossReceived)}</strong> · repasses{" "}
                <strong className="text-navy">{formatMoney(row.repasses)}</strong> · nota e despesas da venda <strong className="text-navy">{formatMoney(row.otherCosts)}</strong> · {row.salesCount} {row.salesCount === 1 ? "venda" : "vendas"}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
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
