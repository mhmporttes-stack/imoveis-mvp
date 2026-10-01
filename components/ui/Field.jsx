"use client";

import { cloneElement, isValidElement, useId } from "react";
import { cx } from "./cx";

// Classe base de input/select/textarea. Fonte ≥16px no celular (evita o zoom
// automático do iOS); 14px a partir de sm.
export const inputClasses = cx(
  "block w-full min-h-touch rounded-control border border-line bg-white px-3 text-base text-ink sm:text-sm",
  "placeholder:text-faint transition-[border-color,box-shadow] duration-150 ease-out-ui",
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
  "disabled:cursor-not-allowed disabled:bg-neutral-soft disabled:text-faint",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20"
);

// Rótulo sempre visível + ajuda + erro ligados ao controle por aria-*.
export default function Field({ label, hint = "", error = "", required = false, className = "", children }) {
  const id = useId();
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id || id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        required: required || children.props.required
      })
    : children;

  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={isValidElement(children) ? children.props.id || id : undefined} className="block text-sm font-medium text-ink">
        {label}
        {required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}
      </label>
      {control}
      {hint && !error ? <p id={hintId} className="text-xs text-muted">{hint}</p> : null}
      {error ? <p id={errorId} className="text-xs font-medium text-danger">{error}</p> : null}
    </div>
  );
}
