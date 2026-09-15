"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import JourneyChoice from "@/components/simulation-form/JourneyChoice";
import QuickAttendanceForm from "@/components/simulation-form/QuickAttendanceForm";
import SimulationForm from "@/components/simulation-form/SimulationForm";

// Etapa nova na FRENTE do fluxo público já existente (Gerador de Links —
// campanha/?c=, link pessoal/?ref=, roleta/equipe) — a URL, o destino
// (corretor ou roleta) e a tag/campanha continuam exatamente os mesmos de
// sempre; só a experiência dentro do link ganhou uma escolha antes do
// formulário. Troca de tela via estado local (sem navegação/reload), então
// nada é criado só por abrir uma etapa — o cliente só entra no CRM quando
// realmente confirma um dos dois formulários.
export default function LinkJourneyGate({ brokerRefOverride = "" }) {
  const [journey, setJourney] = useState("");

  if (journey === "quick_service") {
    return <QuickAttendanceForm brokerRefOverride={brokerRefOverride} onBack={() => setJourney("")} />;
  }

  if (journey === "simulation") {
    return (
      <div>
        <div className="mx-auto mb-9 max-w-4xl text-center">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-brand">Financiamento imobiliário</p>
          <h1 className="mt-4 text-[clamp(2.4rem,5vw,4.75rem)] font-black leading-[0.98] text-navy">
            Simulação de financiamento
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-[clamp(1rem,1.8vw,1.25rem)] leading-8 text-muted">
            Responda algumas perguntas para entendermos o seu perfil e avaliarmos as melhores possibilidades de financiamento.
          </p>
        </div>
        <div className="mx-auto mb-4 w-full max-w-3xl">
          <button
            className="inline-flex items-center gap-1.5 text-sm font-bold text-muted transition hover:text-brand"
            onClick={() => setJourney("")}
            type="button"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar
          </button>
        </div>
        <SimulationForm brokerRefOverride={brokerRefOverride} />
      </div>
    );
  }

  return <JourneyChoice onSelect={setJourney} />;
}
