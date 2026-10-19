// Aba da simulação (Gerador) — dados 100% FICTÍCIOS da vitrine (só `next dev`).
//   ?tela=simulacao&variante=  (vazio = automática não conferida) | manual | basico | nova | erro-prazo | comparar
const PHOTO_A = "/assets/hero-marilia.png";
const PHOTO_B = "/assets/hero-premium-casal.png";

export const properties = [
  ["p1", "Residencial Jardim Aurora", "R$ 205.000", PHOTO_A],
  ["p2", "Vila das Flores", "R$ 210.000", PHOTO_B],
  ["p3", "Parque Esperança", "R$ 215.000", PHOTO_A],
  ["p4", "Casa térrea Bairro Novo", "R$ 220.000", PHOTO_B],
  ["p5", "Recanto do Sol", "R$ 225.000", PHOTO_A]
].map(([id, name, price, image]) => ({ id, name, price, type: "casa", region: "Zona Norte", location: "Marília/SP", builder: "Construtora Exemplo", area: "48 m²", bedrooms: "2", delivery: "Pronto", images: [image], coverImage: image }));

const baseSimulation = {
  id: "sim-vitrine",
  registrationId: "reg-vitrine",
  clientName: "Ana Paula Fictícia",
  simulationDate: "2026-10-19",
  simulationType: "novo",
  interestRateAnnual: 4.75,
  downPaymentValue: 5000,
  fgtsValue: 8000,
  showExpandedPower: false,
  publicNote: "",
  simulationModels: {
    novo: { financingValue: "190.000,00", subsidyValue: "42.000,00", firstInstallment: "980,00", lastInstallment: "410,00", termMonths: "420", sac: {} },
    usado: { financingValue: "190.000,00", subsidyValue: "", firstInstallment: "980,00", lastInstallment: "410,00", termMonths: "420", sac: {} }
  },
  registration: {
    id: "reg-vitrine", fullName: "Ana Paula Fictícia", phone: "14999990000", simulationType: "individual",
    primaryIncomeType: "registered_employment", primaryMonthlyIncome: 3200, primaryMaritalStatus: "single",
    oldestBirthDate: "1996-05-10", serviceStartedAt: "2026-10-18",
    propertyPreferences: {}
  },
  properties: [0, 1].map((index) => ({
    propertyId: properties[index].id, customName: properties[index].name, customPrice: properties[index].price, customLocation: "Zona Norte",
    customType: "Casa", customArea: "48 m²", customBedrooms: "2", customBuilder: "Construtora Exemplo", customDelivery: "Pronto",
    recommendationReason: "Este imóvel foi selecionado buscando reduzir ao máximo o desembolso inicial da compra.",
    imageUrl: properties[index].coverImage,
    benefits: [{ text: "Imóvel novo", isCustom: false, displayOrder: 0 }, { text: "Subsídio do Minha Casa Minha Vida", isCustom: false, displayOrder: 1 }, { text: "Documentação gratuita", isCustom: false, displayOrder: 2 }, { text: "Entrada parcelada", isCustom: false, displayOrder: 3 }]
  }))
};

export function simulationFor(variante) {
  if (variante === "nova") return null;
  if (variante === "manual" || variante === "basico" || variante === "comparar") return { ...baseSimulation, createdBy: "corretor@exemplo.com", internalNote: "" };
  if (variante === "erro-prazo") {
    return {
      ...baseSimulation,
      createdBy: "corretor@exemplo.com",
      internalNote: "",
      simulationModels: { ...baseSimulation.simulationModels, novo: { ...baseSimulation.simulationModels.novo, termMonths: "" } }
    };
  }
  return {
    ...baseSimulation,
    createdBy: "Simulação automática do site",
    internalNote: "Renda para usar na Caixa — novo: R$ 2.850,00 / usado: R$ 3.200,00 (declarada R$ 3.200,00)"
  };
}

export function suggestionsFor(variante) {
  if (variante === "nova") return null;
  const automatic = !["manual", "basico", "comparar", "erro-prazo"].includes(variante);
  return {
    termMonths: { value: 420, source: "idade", label: "Prazo máximo pela idade do mais velho" },
    annualRate: automatic ? { value: 4.75, source: "simulacao_automatica", label: "Taxa da simulação automática" } : { value: 4.75, source: "ultima_usada", label: "Última taxa usada nesta simulação" }
  };
}

const scenarioData = (financing, subsidy, first, term, rate, incomeNovo, incomeUsado) => ({
  annualRate: rate,
  inputs: { incomeNovo, incomeUsado },
  novo: { power: financing + subsidy, price: { financing, subsidy, firstInstallment: first, termMonths: term }, sac: {} },
  usado: { power: financing, price: { financing, subsidy: 0, firstInstallment: first, termMonths: term }, sac: {} }
});

export const routes = [
  {
    match: /^\/api\/admin\/simulacoes\/[^/]+\/apresentacao/,
    response: { schemaReady: true, ready: true, clientName: "Ana Paula Fictícia", simulationDate: "2026-10-19", approvalReady: true, approvalEnabled: false, presentation: null }
  },
  {
    match: /^\/api\/admin\/clients\/[^/]+\/cenarios/,
    response: {
      schemaReady: true,
      current: { automatic: false, data: scenarioData(188500, 41200, 965, 384, 4.75, 2850, 3200) },
      items: [
        { id: "c1", origin: "site", checked: false, createdAt: "2026-10-19T17:20:00Z", createdByEmail: "", data: scenarioData(190000, 42000, 980, 420, 4.75, 2850, 3200) },
        { id: "c2", origin: "corretor", checked: true, createdAt: "2026-10-18T13:12:00Z", createdByEmail: "corretor@exemplo.com", data: scenarioData(172000, 45500, 890, 420, 4.5, 2600, 2600) }
      ]
    }
  },
  { method: "PUT", match: /^\/api\/simulations\//, response: (ctx) => ({ id: "sim-vitrine", registrationId: "reg-vitrine" }) },
  { method: "POST", match: /^\/api\/simulations/, response: { id: "sim-vitrine", registrationId: "reg-vitrine" } }
];
