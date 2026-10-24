import { useRef } from "react";
import { FichaError } from "@/components/simulation-form/FichaFields";
import styles from "@/components/simulation-form/SimulationForm.module.css";
import { formatWholeReaisInput, wholeReaisCaretPosition } from "@/lib/whole-reais-input.mjs";

// Valor em reais inteiros com ",00" fixo (dono, 2026-10-24): "7500" → "R$ 7.500,00". Regra da máscara em
// lib/whole-reais-input.mjs; o cursor fica sempre antes da vírgula para o próximo dígito entrar nos reais.
// Visual da ficha escura (2026-10-24): número grande, "por mês" fixo à direita nas rendas.
export default function CurrencyInputStep({ error, errorId, hint, label, onChange, onEnter, step, suffix, value }) {
  const inputId = `simulation-${step.id}`;
  const hintId = hint ? `${inputId}-hint` : "";
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
    <div className={error ? styles.invalid : undefined}>
      <label className={label ? styles.label : "sr-only"} htmlFor={inputId}>{label || step.title}</label>
      <div className={styles.field}>
        <input
          aria-describedby={[hintId, error ? errorId : ""].filter(Boolean).join(" ") || undefined}
          aria-invalid={error ? "true" : undefined}
          enterKeyHint="next"
          id={inputId}
          inputMode="numeric"
          onChange={handleChange}
          onClick={keepCaretBeforeComma}
          onFocus={() => window.requestAnimationFrame(keepCaretBeforeComma)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onEnter?.(); } }}
          pattern="[0-9]*"
          placeholder={step.placeholder}
          ref={inputRef}
          type="tel"
          value={value || ""}
        />
        {suffix ? <span aria-hidden="true" className={styles.affixEnd}>{suffix}</span> : null}
      </div>
      {hint && !error ? <p className={styles.hint} id={hintId}>{hint}</p> : null}
      <FichaError id={errorId} message={error} />
    </div>
  );
}
