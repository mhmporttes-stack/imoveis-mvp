import { Suspense } from "react";
import LinkJourneyGate from "@/components/simulation-form/LinkJourneyGate";

export const metadata = {
  title: "Simulação de financiamento | Matheus Machado",
  description: "Responda algumas perguntas para avaliar possibilidades de financiamento imobiliário."
};

export default function SimulationPage() {
  return <SimulationPageContent />;
}

// O cabeçalho fixo "Simulação de financiamento" foi para dentro de
// LinkJourneyGate (só aparece quando o visitante escolhe essa jornada) — a
// tela de escolha e o Atendimento Rápido têm seu próprio título contextual,
// então um cabeçalho fixo aqui ficaria repetido/errado nessas duas etapas.
export function SimulationPageContent({ brokerRef = "" }) {
  return (
    <main className="bg-mist py-12 sm:py-16">
      <section className="container-page">
        <Suspense fallback={<SimulationFormFallback />}>
          <LinkJourneyGate brokerRefOverride={brokerRef} />
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
