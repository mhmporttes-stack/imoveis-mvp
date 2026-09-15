"use client";

import { Calculator, ChevronRight, Zap } from "lucide-react";

// Estrutura pensada para crescer sem reconstrução: cada jornada é só uma
// entrada aqui (id/ícone/título/subtítulo). Hoje só "quick_service" e
// "simulation" têm uma tela implementada em LinkJourneyGate — acrescentar
// uma nova jornada no futuro (ex.: "Quero receber valores") é adicionar um
// item nesta lista + o componente correspondente, sem mexer no restante do
// fluxo de link/campanha/roleta.
export const JOURNEYS = [
  {
    id: "quick_service",
    icon: Zap,
    title: "Atendimento rápido",
    subtitle: "Deixe seu contato e fale com um especialista."
  },
  {
    id: "simulation",
    icon: Calculator,
    title: "Simulação",
    subtitle: "Descubra seu potencial de financiamento."
  }
];

export default function JourneyChoice({ onSelect }) {
  return (
    <article className="mx-auto w-full max-w-3xl rounded-[32px] border border-line bg-white p-6 shadow-soft sm:p-8 lg:p-10">
      <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Financiamento imobiliário</p>
      <h1 className="mt-3 text-[clamp(1.9rem,4.5vw,3rem)] font-black leading-[1.05] text-navy">
        Como podemos te ajudar?
      </h1>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {JOURNEYS.map((journey) => (
          <button
            key={journey.id}
            className="group flex flex-col items-start gap-3 rounded-3xl border border-line bg-mist/40 p-6 text-left transition duration-200 hover:-translate-y-0.5 hover:border-brand hover:bg-white hover:shadow-[0_18px_45px_rgba(13,59,102,0.1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            onClick={() => onSelect(journey.id)}
            type="button"
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-brand transition group-hover:bg-brand group-hover:text-white">
              <journey.icon className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="text-xl font-black text-navy">{journey.title}</span>
            <span className="text-sm font-semibold leading-6 text-muted">{journey.subtitle}</span>
            <span className="mt-1 inline-flex items-center gap-1 text-sm font-black text-brand">
              Continuar
              <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
    </article>
  );
}
