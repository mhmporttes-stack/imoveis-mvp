import { buildPublicPresentation } from "@/lib/simulation-presentation-core.mjs";

// Dados 100% FICTÍCIOS da vitrine da Apresentação interativa (só `next dev`; nunca vão para produção).
//   v = completo (formal + casado + com filhos + 2 imóveis + juros 5,4 + subsídio novo ≠ usado) | informal (informal + solteiro + sem
//       filhos + 1 imóvel) | minimo (sem cadastro e sem imóvel) | | sem-juros-sem-subsidio | igual (novo = usado,
//       com subsídio igual: sem cena de diferença) | sem-imovel | sem-justificativa | longo (nome de imóvel muito longo)
export const DEFAULT_REASON = "Este imóvel foi selecionado buscando reduzir ao máximo o desembolso inicial da compra e proporcionar o melhor aproveitamento das condições disponíveis.";

// Foto fictícia e neutra (gradiente com formas simples), nada de imóvel ou cliente real.
export const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9CC3F5"/><stop offset="0.62" stop-color="#DCE9F9"/><stop offset="1" stop-color="#7FA6D6"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/><rect x="170" y="420" width="740" height="560" fill="#F3F7FC"/><rect x="170" y="420" width="740" height="40" fill="#4C7BB5"/><rect x="250" y="520" width="150" height="150" fill="#9CC3F5"/><rect x="460" y="520" width="150" height="150" fill="#9CC3F5"/><rect x="670" y="520" width="150" height="150" fill="#9CC3F5"/><rect x="480" y="760" width="120" height="220" fill="#4C7BB5"/></svg>`
)}`;

// fotos reais de exemplo do próprio repositório (paisagem e retrato), só para a revisão visual
const REAL_PHOTOS = ["/assets/hero-marilia.png", "/assets/hero-premium-casal.png"];

export function presentationSimulation(variant = "completo") {
  const base = {
    id: "dev",
    clientName: "Mariana Souza Lima",
    simulationDate: "2026-10-03",
    interestRateAnnual: 5.4,
    // cadastro FICTÍCIO: só alimenta a personalização da lista de documentos (o valor cru nunca sai do servidor)
    registration: { simulationType: "individual", oldestBirthDate: "1990-05-10", primaryIncomeType: "registered_employment", primaryMaritalStatus: "married", hasChildrenUnder18: true },
    simulationModels: {
      novo: { financingValue: "190.000,00", subsidyValue: "42.000,00", firstInstallment: "1.085,40", lastInstallment: "812,15" },
      usado: { financingValue: "190.000,00", subsidyValue: "0", firstInstallment: "1.085,40", lastInstallment: "812,15" }
    },
    properties: [
      {
        customName: "Residencial Vila Aurora",
        imageUrl: "https://dev.invalid/foto.jpg",
        benefits: [{ text: "2 dormitórios com varanda" }, { text: "Condomínio com lazer completo" }, { text: "Próximo a escolas e comércio" }, { text: "Entrada parcelada" }],
        recommendationReason: "Boa localização para a rotina da família e parcelas que cabem dentro do orçamento informado na simulação."
      },
      {
        customName: "Condomínio Parque das Flores",
        imageUrl: "https://dev.invalid/foto2.jpg",
        benefits: [{ text: "3 dormitórios com suíte" }, { text: "Vaga coberta" }, { text: "Portaria 24 horas" }],
        recommendationReason: DEFAULT_REASON
      }
    ]
  };
  if (variant === "sem-juros-sem-subsidio") {
    base.interestRateAnnual = null;
    base.simulationModels = {
      novo: { financingValue: "232.000,00", subsidyValue: "0", firstInstallment: "1.320,00", lastInstallment: "980,55" },
      usado: { financingValue: "232.000,00", subsidyValue: "0", firstInstallment: "1.320,00", lastInstallment: "980,55" }
    };
  }
  if (variant === "minimo") {
    // sem juros, sem subsídio algum e sem imóvel (a apresentação mais enxuta possível)
    base.interestRateAnnual = null;
    base.simulationModels = {
      novo: { financingValue: "158.500,00", subsidyValue: "0", firstInstallment: "", lastInstallment: "" },
      usado: { financingValue: "158.500,00", subsidyValue: "0", firstInstallment: "", lastInstallment: "" }
    };
    base.properties = [];
  }
  if (variant === "informal") {
    base.registration = { simulationType: "individual", oldestBirthDate: "1988-02-01", primaryIncomeType: "self_employed_unregistered", primaryMaritalStatus: "single", hasChildrenUnder18: false };
    base.properties = base.properties.slice(0, 1);
  }
  if (variant === "minimo") base.registration = undefined;
  if (variant === "igual") base.simulationModels.usado = { ...base.simulationModels.novo };
  if (variant === "sem-imovel") base.properties = [];
  if (variant === "sem-justificativa") base.properties[0].recommendationReason = DEFAULT_REASON;
  if (variant === "longo") base.properties[0].customName = "Residencial Vila Aurora Jardins do Parque Exclusivo Empreendimento Modelo Muito Longo";
  return base;
}

export function presentationDto(variant) {
  return buildPublicPresentation({ simulation: presentationSimulation(variant), defaultReason: DEFAULT_REASON });
}

export function presentationScenes(variant) {
  return presentationDto(variant).scenes;
}

/** Ramo de imóveis sugeridos, com a foto fictícia no lugar da URL de teste. */
export function presentationBranch(variant) {
  // sem-foto: o imóvel não tem imagem (vê o fallback elegante)
  return presentationDto(variant).branch.map((scene, index) => ({ ...scene, imageUrl: variant === "sem-foto" ? "" : variant === "foto-real" ? REAL_PHOTOS[index % 2] : PHOTO }));
}
