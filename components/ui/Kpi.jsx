import { cx } from "./cx";

// Indicador (KPI) do visual novo (protótipo aprovado pelo dono, 2026-10-22): card com rótulo de 12px, número de 26px
// forte e, se houver, uma nota curta embaixo. Só apresentação — o número vem pronto da tela (nunca calcule aqui).
// `tone` colore só o número (success/warning/danger/accent); a cor nunca é o único sinal (o rótulo diz o que é).
const TONES = {
  default: "text-ink",
  accent: "text-accent-text",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted"
};

export default function Kpi({ label, value, hint = null, tone = "default", icon: Icon = null, className = "", children }) {
  return (
    <div data-reveal="" className={cx("min-w-0 rounded-card border border-line bg-white p-3 sm:p-4", className)}>
      <p className="flex items-center justify-between gap-2 text-xs font-semibold text-muted">
        <span className="min-w-0">{label}</span>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} aria-hidden="true" /> : null}
      </p>
      <p className={cx("mt-1 text-xl font-extrabold sm:mt-1.5 sm:text-[26px] leading-tight tracking-[-0.02em] tabular-nums", TONES[tone] || TONES.default)}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-4 text-faint">{hint}</p> : null}
      {children}
    </div>
  );
}

// Grade de indicadores: colunas automáticas (mín. 150px), como no protótipo.
export function KpiGrid({ label = "Indicadores", className = "", children }) {
  return (
    <section aria-label={label} className={cx("grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]", className)}>
      {children}
    </section>
  );
}
