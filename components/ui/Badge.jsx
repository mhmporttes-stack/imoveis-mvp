import { cx } from "./cx";

// Selo de status/rótulo. `tone` é semântico (sistema-visual.md §3): a cor
// diz o significado, e o texto sempre acompanha — cor nunca é o único sinal.
const TONES = {
  neutral: "bg-neutral-soft text-neutral",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  brand: "bg-navy text-white"
};

const DOTS = {
  neutral: "bg-neutral",
  info: "bg-info-strong",
  success: "bg-success-strong",
  warning: "bg-warning-strong",
  danger: "bg-danger-strong",
  brand: "bg-white"
};

export default function Badge({ tone = "neutral", dot = false, icon: Icon = null, className = "", children, ...props }) {
  return (
    <span
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-chip px-2 py-0.5 text-xs font-medium leading-5",
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
export function CountBadge({ count = 0, max = 99, tone = "success", className = "", label }) {
  if (!count || count <= 0) return null;
  const toneClass = tone === "danger" ? "bg-danger-strong" : tone === "brand" ? "bg-brand" : "bg-success-strong";
  return (
    <span
      className={cx("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-2xs font-semibold tabular-nums text-white", toneClass, className)}
      aria-label={label || `${count}`}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
