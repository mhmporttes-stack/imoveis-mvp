"use client";
import { installMockFetch } from "../_lib/mock-fetch";
import SimulationGenerator from "@/components/SimulationGenerator";
import SimulationPresentationPanel from "@/components/presentation/SimulationPresentationPanel";
import AutoSimulationReview from "@/components/AutoSimulationReview";

const props = [1, 2, 3, 4, 5].map((i) => ({ id: `p${i}`, name: ["Residencial Jardim Aurora", "Vila das Flores", "Parque Esperança", "Casa térrea Bairro Novo", "Recanto do Sol"][i - 1], type: "casa", region: "Zona Norte", location: "Marília/SP", price: `R$ ${200 + i * 5}.000`, builder: "Construtora Exemplo", area: "48 m²", bedrooms: "2", delivery: "Pronto", images: ["/assets/hero-marilia.png"] }));

const sim = {
  id: "sim-ficticia", createdBy: "Simulação automática do site", clientName: "Ana Paula Ficticia", simulationDate: "2026-10-19",
  simulationType: "novo", interestRateAnnual: 4.75, downPaymentValue: 5000, fgtsValue: 8000, showExpandedPower: false, publicNote: "", internalNote: "",
  simulationModels: {
    novo: { financingValue: "190.000,00", subsidyValue: "42.000,00", firstInstallment: "980,00", lastInstallment: "410,00", termMonths: "420", sac: {} },
    usado: { financingValue: "190.000,00", subsidyValue: "", firstInstallment: "980,00", lastInstallment: "410,00", termMonths: "420", sac: {} }
  },
  registration: { id: "reg1", fullName: "Ana Paula Ficticia", phone: "14999990000", primaryIncomeType: "registered_employment", primaryMonthlyIncome: 3200, oldestBirthDate: "1996-05-10", serviceStartedAt: "2026-10-18", propertyPreferences: { bedrooms: "2", region: "Zona Norte" } },
  properties: [0, 1].map((i) => ({ propertyId: `p${i + 1}`, customName: props[i].name, customPrice: props[i].price, customLocation: "Zona Norte", customType: "Casa", customArea: "48 m²", customBedrooms: "2", customBuilder: "Construtora Exemplo", customDelivery: "Pronto", recommendationReason: "Este imóvel foi selecionado buscando reduzir ao máximo o desembolso inicial da compra.", imageUrl: "/assets/hero-marilia.png", benefits: [{ text: "Imóvel novo", isCustom: false, displayOrder: 0 }, { text: "Subsídio do Minha Casa Minha Vida", isCustom: false, displayOrder: 1 }] }))
};

installMockFetch([{ method: "GET", match: /apresentacao/, response: { schemaReady: true, ready: true, clientName: "Ana Paula Ficticia", simulationDate: "2026-10-19", approvalReady: true, approvalEnabled: false, presentation: null } }]);

export default function Client({ auto }) {
  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8"><span className="text-sm font-black text-brand">← Voltar para clientes</span></section>
      {auto ? <section className="container-page mb-8"><AutoSimulationReview simulationId={sim.id} inEditor prominent /></section> : null}
      <SimulationPresentationPanel simulationId={sim.id} />
      <SimulationGenerator properties={props} initialSimulation={auto ? sim : { ...sim, createdBy: "corretor" }} />
    </main>
  );
}
