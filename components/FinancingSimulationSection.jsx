"use client";

import { ArrowRight, Clock3, Home } from "lucide-react";
import { SIMULATION_FORM_URLS } from "@/lib/simulation-links";

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
              className="text-[clamp(1.25rem,2.15vw,1.9rem)] font-black leading-[1.08] text-navy xl:whitespace-nowrap"
            >
              Faça uma simulação rápida e descubra seu{" "}
              <span className="text-brand">poder de compra</span>
            </h3>
            <p className="mt-3 max-w-[980px] text-[clamp(0.98rem,1.05vw,1.06rem)] leading-7 text-muted xl:whitespace-nowrap">
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

      <div className="mt-7 border-t border-line pt-6">
        <a
          aria-label="Fazer simulação de financiamento"
          className="group inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-gradient-to-r from-navy to-brand px-8 text-sm font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-brand/20 transition duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/25 focus:outline-none focus:ring-4 focus:ring-brand/25"
          href={SIMULATION_FORM_URLS.main}
        >
          FAZER SIMULAÇÃO
          <ArrowRight className="h-5 w-5 transition duration-300 group-hover:translate-x-1" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
