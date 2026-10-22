import { cx } from "./cx";

// Selo de status/rótulo. `tone` é semântico (sistema-visual.md §3): a cor
// diz o significado, e o texto sempre acompanha — cor nunca é o único sinal.
// Visual novo (dono, 2026-10-22): pílula (999px), 11px forte.
const TONES = {
  neutral: "bg-neutral-soft text-neutral",
  info: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  brand: "bg-accent text-on-accent"
};

const DOTS = {
  neutral: "bg-neutral",
  info: "bg-accent",
  success: "bg-success-strong",
  warning: "bg-warning-strong",
  danger: "bg-danger-strong",
  brand: "bg-on-accent"
};

export default function Badge({ tone = "neutral", dot = false, icon: Icon = null, className = "", children, ...props }) {
  return (
    <span
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold leading-5",
        TONES[tone] || TONES.neutral,
        className
      )}
      {...props}
    >
      {dot ? <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", DOTS[tone] || DOTS.neutral)} aria-hidden="true" /> : null}
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

// Contador numérico (não lidas, pendências). Some quando é zero.
// Visual novo (dono, 2026-10-22): verde #1FB37A com número escuro (.mm-count em app/globals.css).
export function CountBadge({ count = 0, max = 99, tone = "success", className = "", label }) {
  if (!count || count <= 0) return null;
  const toneClass = tone === "danger" ? "bg-danger-strong text-white" : tone === "brand" ? "bg-accent text-on-accent" : "mm-count";
  return (
    <span
      className={cx("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold tabular-nums", toneClass, className)}
      aria-label={label || `${count}`}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
