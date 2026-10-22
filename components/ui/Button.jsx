import Link from "next/link";
import { forwardRef } from "react";
import { cx } from "./cx";

// Botão base do sistema visual (sistema-visual.md §4). Use `href` para
// navegação (vira <Link>) e `onClick` para ação (vira <button>). Nunca
// <div onClick>. `loading` mostra o spinner no próprio botão e bloqueia
// clique duplo.
// Visual novo (dono, 2026-10-22): principal no azul de destaque (#1B7FB0 no claro, ciano #4FC3E0 com texto
// azul-noite no escuro), secundário na superfície com borda, controles com raio 12px (rounded-control) e texto forte.
const VARIANTS = {
  primary: "bg-accent-strong font-extrabold text-on-accent hover:brightness-110 active:brightness-95 disabled:bg-faint disabled:brightness-100",
  secondary: "border border-line bg-white font-bold text-ink hover:border-accent-line hover:bg-accent-soft disabled:text-faint",
  ghost: "font-bold text-ink hover:bg-navy/[0.06] disabled:text-faint",
  danger: "bg-danger-strong text-white hover:bg-danger disabled:bg-faint",
  "danger-ghost": "text-danger hover:bg-danger-soft disabled:text-faint"
};

const SIZES = {
  sm: "min-h-9 gap-1.5 rounded-control px-3 text-[13px]",
  md: "min-h-touch gap-2 rounded-control px-4 text-sm",
  lg: "min-h-12 gap-2 rounded-control px-5 text-[15px]",
  icon: "h-touch w-touch min-h-touch min-w-touch rounded-control"
};

export function buttonClasses({ variant = "primary", size = "md", block = false, className = "" } = {}) {
  return cx(
    "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold [&>svg]:shrink-0",
    "transition-[background-color,border-color,color,transform,filter] duration-150 ease-out-ui",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-mist",
    "active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100",
    VARIANTS[variant] || VARIANTS.primary,
    SIZES[size] || SIZES.md,
    block && "w-full",
    className
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const Button = forwardRef(function Button(
  { variant, size, block, className, href, loading = false, disabled, children, type = "button", ...props },
  ref
) {
  const classes = buttonClasses({ variant, size, block, className });
  const content = (
    <>
      {loading ? <Spinner /> : null}
      {children}
    </>
  );

  if (href) {
    return (
      <Link ref={ref} href={href} className={classes} aria-disabled={disabled || undefined} {...props}>
        {content}
      </Link>
    );
  }

  return (
    <button ref={ref} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {content}
    </button>
  );
});

export default Button;
