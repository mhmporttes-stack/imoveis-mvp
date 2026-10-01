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

// Sem pdf_data/internal_notes/created_by_user_id: a listagem pública só
// mostra cards (nunca o PDF, e os dois últimos nunca saem daqui mesmo,
// stripInternalFields adiante já os removeria). pdf_data é um campo de
// texto grande (o PDF do empreendimento embutido em base64) — trazê-lo em
// TODA carga da home/listagem pesava a resposta sem necessidade.
//
// photos_json->0 (não photos_json inteiro): PropertyCard (único consumidor
// da listagem) só exibe coverImage(property), que lê SEMPRE photos[0] —
// nenhum card de lista mostra a 2ª foto em diante. Confirmado via grep em
// components/PropertyCard.jsx. Isso também reduz a exposição a uma
// recorrência do incidente de 2026-09-28 (uma propriedade com 1,35MB de
// fotos em base64 na linha, já corrigido na origem): se acontecer de novo,
// só a ficha daquele imóvel paga o custo, não a home inteira. Mapeado de
// volta para `photos_json` (post-processamento abaixo, cada foto
// embrulhada num array de 1 item) para rowToProperty/normalizePhotos
// continuarem exatamente iguais — getPublicProperty (ficha, carrossel
// completo) não foi tocado, continua com select("*"). Achado da 2ª
// rodada da auditoria de performance 2026-10-01.
const PUBLIC_LIST_COLUMNS = "id, name, builder, location, region, status, type, price, terms, discounts, installment_entry, delivery, area, bedrooms, features_json, cover_photo:photos_json->0, pdf_name, builder_url, whatsapp, instagram, sales_text, is_published, is_featured, is_development, display_order, created_at, updated_at";

function withCoverPhotoOnly(row) {
  const { cover_photo, ...rest } = row;
  return { ...rest, photos_json: cover_photo != null ? [cover_photo] : [] };
}

export async function listPublicProperties() {
  const supabase = getSupabasePublicClient();
  if (!supabase) return staticProperties;

  let { data, error } = await supabase
    .from("properties")
    .select(PUBLIC_LIST_COLUMNS)
    .eq("is_published", true)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (isMissingColumnError(error, "display_order")) {
    const fallback = await supabase
      .from("properties")
      .select(PUBLIC_LIST_COLUMNS)
      .eq("is_published", true)
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error(error);
    return staticProperties;
  }

  return data.length ? data.map(withCoverPhotoOnly).map(rowToProperty).map(stripInternalFields) : staticProperties;
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

  return data ? stripInternalFields(rowToProperty(data)) : getStaticProperty(id);
}

// Defesa em profundidade: mesmo que internal_notes (anotação operacional
// do imóvel, ex.: origem da captação) ou o id de quem cadastrou acabem
// contendo algo sensível, esses campos NUNCA saem por aqui — esta é a
// única porta de entrada pra dado de imóvel usada pelo site público e
// pela API pública (/api/properties).
function stripInternalFields(property) {
  const { internalNotes, createdByUserId, ...publicSafe } = property;
  return publicSafe;
}

export function listStaticProperties() {
  return staticProperties;
}

export function getStaticProperty(id) {
  return staticProperties.find((property) => property.id === id) || null;
}
