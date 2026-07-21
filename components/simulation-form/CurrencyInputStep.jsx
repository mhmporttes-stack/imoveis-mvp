import { formatCurrencyFromDigits } from "@/lib/simulation-registration-schema";

export default function CurrencyInputStep({ error, onChange, step, value }) {
  const inputId = `simulation-${step.id}`;

  return (
    <div>
      <label className="sr-only" htmlFor={inputId}>{step.title}</label>
      <input
        className="admin-input h-16 rounded-2xl text-lg shadow-[0_10px_28px_rgba(13,59,102,0.04)] focus:border-brand focus:ring-4 focus:ring-brand/10"
        id={inputId}
        inputMode="decimal"
        onChange={(event) => onChange(formatCurrencyFromDigits(event.target.value))}
        placeholder={step.placeholder}
        type="text"
        value={value || ""}
      />
      {step.help ? <p className="mt-3 text-sm leading-6 text-muted">{step.help}</p> : null}
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
