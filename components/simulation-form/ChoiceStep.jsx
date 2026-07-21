import { Check, CheckCircle2, User, Users } from "lucide-react";

const iconMap = {
  user: User,
  users: Users
};

export default function ChoiceStep({ error, onChange, options = [], value }) {
  return (
    <div className="grid gap-3">
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = iconMap[option.icon] || CheckCircle2;

        return (
          <button
            aria-pressed={selected}
            className={`group relative flex min-h-[92px] w-full items-center gap-4 rounded-[22px] border p-5 text-left transition duration-300 focus:outline-none focus:ring-4 focus:ring-brand/20 ${
              selected
                ? "border-brand bg-brand text-white shadow-[0_20px_45px_rgba(13,59,102,0.20)]"
                : "border-blue-100 bg-white text-navy shadow-[0_12px_28px_rgba(13,59,102,0.05)] hover:-translate-y-0.5 hover:border-brand hover:bg-blue-50/70 hover:shadow-soft"
            }`}
            key={String(option.value)}
            onClick={() => onChange(option.value)}
            type="button"
          >
            <span
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition duration-300 ${
                selected ? "bg-white/15 text-white" : "bg-blue-50 text-brand group-hover:bg-white"
              }`}
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="block min-w-0 pr-8 text-[1.02rem] font-black leading-tight">{option.label}</span>
            <Check
              className={`absolute right-5 top-5 h-5 w-5 transition duration-300 ${selected ? "opacity-100" : "opacity-0"}`}
              aria-hidden="true"
            />
          </button>
        );
      })}
      {error ? <p className="sm:col-span-2 text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
