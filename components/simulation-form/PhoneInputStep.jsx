import { formatPhone } from "@/lib/simulation-registration-schema";

export default function PhoneInputStep({ error, onChange, step, value }) {
  const inputId = `simulation-${step.id}`;

  return (
    <div>
      <label className="sr-only" htmlFor={inputId}>{step.title}</label>
      <div className="flex h-16 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_10px_28px_rgba(13,59,102,0.04)] transition duration-300 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
        <span className="flex items-center border-r border-line bg-[#F3F8FF] px-4 text-lg font-black text-brand">+55</span>
        <input
          autoComplete={step.autoComplete}
          className="min-w-0 flex-1 bg-transparent px-4 text-lg font-bold text-navy outline-none placeholder:text-muted/60"
          id={inputId}
          inputMode="numeric"
          name="phone"
          onChange={(event) => onChange(formatPhone(event.target.value))}
          placeholder={step.placeholder}
          type="tel"
          value={value || ""}
        />
      </div>
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
