"use client";

import { useMemo, useState } from "react";

// Gráficos dos Indicadores Econômicos — SVG puro (sem dependência nova), no mesmo espírito de
// components/FinancialHealthCharts.jsx. Cores só da identidade azul; nenhuma cor sugere "bom" ou "ruim".
export const SERIES_COLORS = ["#0D3B66", "#1769D1", "#7FA6D6", "#5B6B82"];

const W = 720;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 30, left: 52 };

function niceRange(min, max) {
  if (min === max) return [min - 1, max + 1];
  const span = max - min;
  return [min - span * 0.08, max + span * 0.08];
}

// series = [{ code, name, unitLabel, color, points: [{ date: "yyyy-mm-dd", value, label }] }]
export function LineChart({ series = [], formatValue = (v) => String(v), formatDate = (d) => d, emptyText = "Sem dados no período." }) {
  const [hover, setHover] = useState(null);
  const all = series.flatMap((s) => s.points);
  const dates = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort(), [series]);
  if (!all.length) return <p className="py-10 text-center text-sm text-muted">{emptyText}</p>;
  const values = all.map((p) => p.value);
  const [min, max] = niceRange(Math.min(...values), Math.max(...values));
  const t0 = new Date(dates[0]).getTime();
  const t1 = new Date(dates[dates.length - 1]).getTime() || t0 + 1;
  const x = (date) => PAD.left + ((new Date(date).getTime() - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (value) => PAD.top + (1 - (value - min) / (max - min)) * (H - PAD.top - PAD.bottom);
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const xTicks = dates.length > 1 ? [0, 0.25, 0.5, 0.75, 1].map((f) => dates[Math.round(f * (dates.length - 1))]) : dates;

  function onMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    let best = dates[0];
    for (const date of dates) if (Math.abs(x(date) - px) < Math.abs(x(best) - px)) best = date;
    setHover(best);
  }

  const hoverItems = hover ? series.map((s) => ({ s, p: nearestPoint(s.points, hover) })).filter((item) => item.p) : [];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none select-none" role="img" aria-label={`Gráfico de linha: ${series.map((s) => s.name).join(", ")}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#E5EAF1" />
            <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#667085">{formatValue(tick, true)}</text>
          </g>
        ))}
        {min < 0 && max > 0 ? <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="#98A2B3" strokeDasharray="3 3" /> : null}
        {xTicks.map((date, i) => (
          <text key={`${date}-${i}`} x={x(date)} y={H - 8} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"} fontSize="11" fill="#667085">{formatDate(date)}</text>
        ))}
        {series.map((s) => (
          <path key={s.code} d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
        ))}
        {hover ? <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="#98A2B3" /> : null}
        {hoverItems.map(({ s, p }) => <circle key={s.code} cx={x(p.date)} cy={y(p.value)} r="3.5" fill="#fff" stroke={s.color} strokeWidth="2" />)}
      </svg>
      {hoverItems.length ? (
        <div className="pointer-events-none absolute right-2 top-2 rounded-chip border border-line bg-white/95 px-3 py-2 text-xs shadow-float" role="status">
          {hoverItems.map(({ s, p }) => (
            <p key={s.code} className="flex items-center gap-2 whitespace-nowrap">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              <b className="text-ink">{s.name}</b>
              <span className="text-muted">{p.label || formatDate(p.date)}</span>
              <b className="text-ink">{formatValue(p.value, false, s.code)}</b>
            </p>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <span key={s.code} className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: s.color }} />{s.name}{s.unitLabel ? ` (${s.unitLabel})` : ""}</span>
        ))}
      </div>
    </div>
  );
}

function nearestPoint(points, date) {
  let best = null;
  for (const p of points) {
    if (p.date > date) break;
    best = p;
  }
  return best;
}

// Barras horizontais (comparativo entre instituições). items = [{ key, label, value, text }]
export function BarChart({ items = [], emptyText = "Sem dados." }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  const max = Math.max(...items.map((item) => item.value), 0.0001);
  return (
    <ul className="grid gap-1.5" aria-label="Comparativo">
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs sm:grid-cols-[minmax(0,14rem)_1fr_auto]">
          <span className="truncate font-semibold text-ink-2" title={item.label}>{item.label}</span>
          <span className="h-3 rounded-full bg-accent-soft">
            <span className="block h-3 rounded-full bg-accent" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </span>
          <b className="whitespace-nowrap text-ink">{item.text}</b>
        </li>
      ))}
    </ul>
  );
}
