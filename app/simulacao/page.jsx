import { Suspense } from "react";
import SimulationForm from "@/components/simulation-form/SimulationForm";

export const metadata = {
  title: "Simulação de financiamento | Matheus Machado",
  description: "Responda algumas perguntas para avaliar possibilidades de financiamento imobiliário."
};

export default function SimulationPage() {
  return (
    <main className="bg-mist py-12 sm:py-16">
      <section className="container-page">
        <div className="mx-auto mb-9 max-w-4xl text-center">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-brand">Financiamento imobiliário</p>
          <h1 className="mt-4 text-[clamp(2.4rem,5vw,4.75rem)] font-black leading-[0.98] text-navy">
            Simulação de financiamento
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-[clamp(1rem,1.8vw,1.25rem)] leading-8 text-muted">
            Responda algumas perguntas para entendermos o seu perfil e avaliarmos as melhores possibilidades de financiamento.
          </p>
        </div>

        <Suspense fallback={<SimulationFormFallback />}>
          <SimulationForm />
        </Suspense>
      </section>
    </main>
  );
}

function SimulationFormFallback() {
  return (
    <article className="mx-auto w-full max-w-3xl rounded-[32px] border border-line bg-white p-8 shadow-soft">
      <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
        <div className="h-full w-1/3 rounded-full bg-brand" />
      </div>
      <div className="mt-8 h-8 w-2/3 rounded-full bg-slate-100" />
      <div className="mt-5 h-14 rounded-2xl bg-slate-100" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="h-28 rounded-2xl bg-slate-100" />
        <div className="h-28 rounded-2xl bg-slate-100" />
      </div>
    </article>
  );
}
