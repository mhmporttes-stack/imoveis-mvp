import { cx } from "./cx";

// Liga/desliga acessível (role="switch"). O rótulo vem de `label` (visível ao
// leitor de tela) — o texto ao redor deve repetir o significado, nunca só a cor.
export default function Switch({ checked, onChange, label, disabled = false, className = "" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-150 ease-out-ui",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand" : "bg-line",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cx("absolute top-1 h-5 w-5 rounded-full bg-white transition-all duration-150 ease-out-ui", checked ? "left-6" : "left-1")}
      />
    </button>
  );
}
