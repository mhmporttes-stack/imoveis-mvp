import { formatPhone } from "@/lib/simulation-registration-schema";

export default function PhoneInputStep({ error, onChange, step, value }) {
  const inputId = `simulation-${step.id}`;

  return (
    <div>
      <label className="sr-only" htmlFor={inputId}>{step.title}</label>
      <input
        autoComplete={step.autoComplete}
        className="admin-input h-16 rounded-2xl text-lg shadow-[0_10px_28px_rgba(13,59,102,0.04)] focus:border-brand focus:ring-4 focus:ring-brand/10"
        id={inputId}
        inputMode="numeric"
        onChange={(event) => onChange(formatPhone(event.target.value))}
        placeholder={step.placeholder}
        type="tel"
        value={value || ""}
      />
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
