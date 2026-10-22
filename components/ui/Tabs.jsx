import { cx } from "./cx";

// Abas de tela como pílulas (visual novo, dono, 2026-10-22): fileira que rola de lado sem barra visível no celular;
// a ativa ganha borda e fundo do destaque. `options` = [{ value, label }]. Só apresentação: quem decide o que cada
// aba mostra continua sendo a tela (e o servidor, quando o filtro é dele).
export default function Tabs({ options = [], value, onChange, label, className = "", size = "md" }) {
  return (
    <div role="tablist" aria-label={label} className={cx("mm-noscroll -mx-1 flex gap-1.5 overflow-x-auto px-1 py-1", className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange?.(option.value)}
            className={tabClasses(selected, size)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// Mesmo desenho para quem já tem a própria fileira de botões (aria-pressed, links etc.).
export function tabClasses(selected, size = "md") {
  return cx(
    // Pílula de 36px com área de toque estendida a 44px pelo ::before.
    "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full border transition-colors duration-150 before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    size === "sm" ? "min-h-8 px-3 text-xs" : "min-h-9 px-3.5 text-[13px]",
    selected ? "border-accent bg-accent-soft font-extrabold text-ink" : "border-line bg-transparent font-semibold text-ink-2 hover:border-accent-line hover:text-ink"
  );
}
