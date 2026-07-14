import { rowToProperty } from "./property-mapper";
import { getSupabasePublicClient } from "./supabase";
import { isMissingColumnError } from "./supabase-errors";

export const staticProperties = [
  {
    id: "residencial-aurora",
    name: "Residencial Aurora",
    builder: "Construtora Horizonte",
    location: "Marilia, Centro",
    region: "centro",
    status: "Lançamento",
    type: "apartamento",
    price: "R$ 389.000",
    terms: "Financiamento bancario, uso de FGTS e fluxo facilitado durante a obra.",
    discounts: "Subsidios conforme renda e campanha de lancamento por tempo limitado.",
    installmentEntry: "Entrada em ate 36 parcelas",
    delivery: "2o semestre de 2027",
    area: "52 a 78 m2",
    bedrooms: "2 e 3 quartos",
    features: ["2 e 3 quartos", "52 a 78 m2", "Aceita financiamento", "Entrada facilitada"],
    photos: [],
    pdfName: "",
    pdfData: "",
    builderUrl: "https://example.com",
    whatsapp: "5514999999999",
    instagram: "@matheusmachado",
    internalNotes: "",
    salesText: "Empreendimento moderno, bem localizado e com condicoes facilitadas para comprar em Marilia.",
    isPublished: true,
    isFeatured: true,
    displayOrder: 0
  },
  {
    id: "jardins-do-sol",
    name: "Jardins do Sol",
    builder: "Incorporadora Prime",
    location: "Marilia, Fragata",
    region: "oeste",
    status: "Em obras",
    type: "condominio",
    price: "R$ 520.000",
    terms: "Fluxo direto com a construtora e possibilidade de financiamento na entrega.",
    discounts: "Condicoes especiais para as primeiras unidades.",
    installmentEntry: "Entrada parcelada durante a obra",
    delivery: "2028",
    area: "88 a 112 m2",
    bedrooms: "3 quartos",
    features: ["3 quartos", "Lazer completo", "Portaria 24 horas", "Entrada facilitada"],
    photos: [],
    pdfName: "",
    pdfData: "",
    builderUrl: "https://example.com",
    whatsapp: "5514999999999",
    instagram: "@matheusmachado",
    internalNotes: "",
    salesText: "Condominio residencial com lazer completo, plantas amplas e localizacao estrategica.",
    isPublished: true,
    isFeatured: true,
    displayOrder: 1
  },
  {
    id: "terras-de-marilia",
    name: "Terras de Marilia",
    builder: "Urbaniza Brasil",
    location: "Marilia, Zona Leste",
    region: "leste",
    status: "Pronto para construir",
    type: "loteamento",
    price: "R$ 145.000",
    terms: "Pagamento direto, parcelas acessiveis e lotes com infraestrutura planejada.",
    discounts: "Campanha para pagamento a vista ou entrada reforcada.",
    installmentEntry: "Entrada facilitada",
    delivery: "Pronto para construir",
    area: "250 a 420 m2",
    bedrooms: "",
    features: ["250 a 420 m2", "Infraestrutura completa", "Pronto para construir", "Entrada facilitada"],
    photos: [],
    pdfName: "",
    pdfData: "",
    builderUrl: "https://example.com",
    whatsapp: "5514999999999",
    instagram: "@matheusmachado",
    internalNotes: "",
    salesText: "Lotes urbanizados para construir ou investir em uma regiao de crescimento em Marilia.",
    isPublished: true,
    isFeatured: true,
    displayOrder: 2
  }
];

export async function listPublicProperties() {
  const supabase = getSupabasePublicClient();
  if (!supabase) return staticProperties;

  let { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("is_published", true)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (isMissingColumnError(error, "display_order")) {
    const fallback = await supabase
      .from("properties")
      .select("*")
      .eq("is_published", true)
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error(error);
    return staticProperties;
  }

  return data.length ? data.map(rowToProperty) : staticProperties;
}

export async function getPublicProperty(id) {
  const supabase = getSupabasePublicClient();
  if (!supabase) return getStaticProperty(id);

  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("id", id)
    .eq("is_published", true)
    .maybeSingle();

  if (error) {
    console.error(error);
    return getStaticProperty(id);
  }

  return data ? rowToProperty(data) : getStaticProperty(id);
}

export function listStaticProperties() {
  return staticProperties;
}

export function getStaticProperty(id) {
  return staticProperties.find((property) => property.id === id) || null;
}
