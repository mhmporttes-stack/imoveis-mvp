import { useRef } from "react";
import { formatWholeReaisInput, wholeReaisCaretPosition } from "@/lib/whole-reais-input.mjs";

// Valor em reais inteiros com ",00" fixo (dono, 2026-10-24): "7500" → "R$ 7.500,00". Regra da máscara em
// lib/whole-reais-input.mjs; o cursor fica sempre antes da vírgula para o próximo dígito entrar nos reais.
export default function CurrencyInputStep({ error, onChange, step, value }) {
  const inputId = `simulation-${step.id}`;
  const inputRef = useRef(null);

  function keepCaretBeforeComma() {
    const input = inputRef.current;
    if (!input || document.activeElement !== input) return;
    const position = wholeReaisCaretPosition(input.value);
    try {
      input.setSelectionRange(position, position);
    } catch {
      // Alguns teclados não aceitam seleção em campo "tel"; o valor continua certo, só o cursor não é reposicionado.
    }
  }

  function handleChange(event) {
    onChange(formatWholeReaisInput(event.target.value));
    window.requestAnimationFrame(keepCaretBeforeComma);
  }

  return (
    <div>
      <label className="sr-only" htmlFor={inputId}>{step.title}</label>
      <input
        className="admin-input h-16 rounded-2xl text-lg shadow-[0_10px_28px_rgba(13,59,102,0.04)] focus:border-brand focus:ring-4 focus:ring-brand/10"
        id={inputId}
        inputMode="numeric"
        onChange={handleChange}
        onClick={keepCaretBeforeComma}
        onFocus={() => window.requestAnimationFrame(keepCaretBeforeComma)}
        pattern="[0-9]*"
        placeholder={step.placeholder}
        ref={inputRef}
        type="tel"
        value={value || ""}
      />
      {step.help ? <p className="mt-3 text-sm leading-6 text-muted">{step.help}</p> : null}
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
