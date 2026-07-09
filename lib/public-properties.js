export const publicProperties = [
  {
    id: "residencial-aurora",
    name: "Residencial Aurora",
    builder: "Construtora Horizonte",
    location: "Marilia, Centro",
    type: "apartamento",
    price: "R$ 389.000",
    terms: "Financiamento bancario, uso de FGTS e fluxo facilitado durante a obra.",
    discounts: "Subsidios conforme renda e campanha de lancamento por tempo limitado.",
    installmentEntry: "Entrada em ate 36 parcelas",
    delivery: "2o semestre de 2027",
    area: "52 a 78 m2",
    bedrooms: "2 e 3 quartos",
    photos: [],
    pdfName: "",
    pdfData: "",
    builderUrl: "https://example.com",
    whatsapp: "5514999999999",
    instagram: "@matheusmachado",
    internalNotes: "",
    salesText: "Empreendimento moderno, bem localizado e com condicoes facilitadas para comprar em Marilia."
  },
  {
    id: "jardins-do-sol",
    name: "Jardins do Sol",
    builder: "Incorporadora Prime",
    location: "Marilia, Fragata",
    type: "condominio",
    price: "R$ 520.000",
    terms: "Fluxo direto com a construtora e possibilidade de financiamento na entrega.",
    discounts: "Condicoes especiais para as primeiras unidades.",
    installmentEntry: "Entrada parcelada durante a obra",
    delivery: "2028",
    area: "88 a 112 m2",
    bedrooms: "3 quartos",
    photos: [],
    pdfName: "",
    pdfData: "",
    builderUrl: "https://example.com",
    whatsapp: "5514999999999",
    instagram: "@matheusmachado",
    internalNotes: "",
    salesText: "Condominio residencial com lazer completo, plantas amplas e localizacao estrategica."
  },
  {
    id: "terras-de-marilia",
    name: "Terras de Marilia",
    builder: "Urbaniza Brasil",
    location: "Marilia, Zona Leste",
    type: "loteamento",
    price: "R$ 145.000",
    terms: "Pagamento direto, parcelas acessiveis e lotes com infraestrutura planejada.",
    discounts: "Campanha para pagamento a vista ou entrada reforcada.",
    installmentEntry: "Entrada facilitada",
    delivery: "Pronto para construir",
    area: "250 a 420 m2",
    bedrooms: "",
    photos: [],
    pdfName: "",
    pdfData: "",
    builderUrl: "https://example.com",
    whatsapp: "5514999999999",
    instagram: "@matheusmachado",
    internalNotes: "",
    salesText: "Lotes urbanizados para construir ou investir em uma regiao de crescimento em Marilia."
  }
];

export function listPublicProperties() {
  return publicProperties;
}

export function getPublicProperty(id) {
  return publicProperties.find((property) => property.id === id) || null;
}

