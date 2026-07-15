"use client";

import { ArrowRight, Clock3, Home, User, Users } from "lucide-react";
import { SIMULATION_FORM_URLS } from "@/lib/simulation-links";

const simulationOptions = [
  {
    ariaLabel: "Abrir simulação de financiamento apenas em meu nome",
    description: "Faça uma simulação somente com os seus dados.",
    href: SIMULATION_FORM_URLS.single,
    icon: User,
    title: "Apenas em meu nome"
  },
  {
    ariaLabel: "Abrir simulação de financiamento com mais uma pessoa",
    description: "Faça a simulação utilizando os dados de duas pessoas.",
    href: SIMULATION_FORM_URLS.two,
    icon: Users,
    title: "Eu e mais uma pessoa"
  }
];

export default function FinancingSimulationSection() {
  return (
    <section
      aria-labelledby="financing-simulation-title"
      className="mb-6 rounded-[28px] border border-line bg-white p-5 shadow-soft md:p-7"
    >
      <div className="grid gap-6 xl:grid-cols-[1fr_auto] xl:items-start">
        <div className="flex gap-4 sm:gap-5">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#E9F2FF] text-brand sm:h-16 sm:w-16">
            <Home className="h-7 w-7 sm:h-8 sm:w-8" aria-hidden="true" />
          </span>

          <div className="min-w-0">
            <h3
              id="financing-simulation-title"
              className="text-[clamp(1.35rem,2.3vw,2rem)] font-black leading-[1.08] text-navy"
            >
              Faça uma simulação rápida e descubra seu{" "}
              <span className="text-brand">poder de compra</span>
            </h3>
            <p className="mt-3 max-w-[760px] text-[clamp(0.98rem,1.15vw,1.08rem)] leading-7 text-muted">
              É simples, leva menos de 2 minutos e ajuda você a entender as possibilidades de financiamento.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm xl:max-w-[280px]">
          <div className="flex items-center gap-2 font-black text-navy">
            <Clock3 className="h-4 w-4 text-brand" aria-hidden="true" />
            Rápido, simples e seguro
          </div>
          <p className="mt-1 leading-6 text-muted">Preencha seus dados de forma totalmente online.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {simulationOptions.map((option) => (
          <SimulationOptionCard key={option.title} {...option} />
        ))}
      </div>
    </section>
  );
}

function SimulationOptionCard({ ariaLabel, description, href, icon: Icon, title }) {
  return (
    <a
      aria-label={ariaLabel}
      className="group relative flex min-h-[124px] items-start gap-4 rounded-2xl border border-line bg-white p-5 shadow-[0_12px_30px_rgba(13,59,102,0.05)] transition duration-300 hover:-translate-y-0.5 hover:border-brand hover:bg-blue-50/70 hover:shadow-[0_18px_46px_rgba(13,59,102,0.11)] focus:outline-none focus:ring-4 focus:ring-brand/15"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#E9F2FF] text-brand transition duration-300 group-hover:bg-white">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>

      <span className="min-w-0 pr-9">
        <span className="block text-lg font-black leading-tight text-navy">{title}</span>
        <span className="mt-2 block max-w-[420px] text-sm leading-6 text-muted">{description}</span>
      </span>

      <ArrowRight
        className="absolute bottom-5 right-5 h-5 w-5 text-brand transition duration-300 group-hover:translate-x-1"
        aria-hidden="true"
      />
    </a>
  );
}
