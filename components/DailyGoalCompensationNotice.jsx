import { Clock, MessageCircleWarning, ShieldCheck, TimerReset, TriangleAlert, Unlock } from "lucide-react";

// Faixa compacta (selos ícone + texto) sobre a compensação da janela da Meta Diária por restrição
// VALIDADA do WhatsApp (PRO-14). Só apresentação: o texto/estado vem de lib/daily-goal-compensation-view-core.mjs
// (via goal.compensation). Sem restrição validada o servidor manda null e nada aparece.
const ICONS = { window: Clock, credit: TimerReset, until: ShieldCheck, impacted: TriangleAlert, manual: MessageCircleWarning, prospecting: Unlock };
const TONES = {
  info: "border-line bg-white text-muted",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900"
};

export default function DailyGoalCompensationNotice({ notice, only = null }) {
  const items = (notice?.items || []).filter((item) => !only || only.includes(item.key));
  if (!items.length) return null;
  return (
    <ul role="status" aria-label="Compensação por restrição validada" className="flex flex-wrap gap-2 rounded-2xl border border-line bg-mist/40 px-3 py-2.5">
      {items.map((item) => {
        const Icon = ICONS[item.key] || Clock;
        return (
          <li key={item.key} className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-extrabold leading-tight ${TONES[item.tone] || TONES.info}`}>
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{item.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
