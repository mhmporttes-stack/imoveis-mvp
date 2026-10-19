import SimulationSuccess from "@/components/simulation-form/SimulationSuccess";
import { estimateFinancing } from "@/lib/financiamento-estimativa-core.mjs";

// Vitrine DEV da tela final do /simulacao com a estimativa automática (SIM-AUTO). Só no `next dev`; dados FICTÍCIOS.
//   ?renda=2300&fgts=sim&filhos=nao&nasc=2000-01-01&tipo=informal  ·  ?renda=15000 (fora do MCMV: tela de sempre)
export const dynamic = "force-dynamic";

export default async function EstimateVitrine({ searchParams }) {
  const params = await searchParams;
  const estimate = estimateFinancing({
    primaryMonthlyIncome: Number(params?.renda || 2300),
    primaryIncomeType: params?.tipo === "informal" ? "self_employed_unregistered" : "registered_employment",
    hasOverThreeYearsRegisteredWork: params?.fgts !== "nao",
    hasChildrenUnder18: params?.filhos === "sim",
    oldestBirthDate: params?.nasc || "2000-01-01",
    hasResidentialProperty: false,
    availablePurchaseResource: 0
  }, "2026-10-19");
  return (
    <main className="min-h-screen bg-mist px-4 py-8">
      <SimulationSuccess estimate={estimate} />
    </main>
  );
}
