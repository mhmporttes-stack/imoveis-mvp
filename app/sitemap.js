import { listPublicProperties, staticProperties } from "@/lib/public-properties";
import { propertyUrl, SITE_URL } from "@/lib/public-seo";

// sitemap.xml (dono, 2026-10-15): só páginas públicas de venda — home, simulação, captação (a canônica,
// /venda-seu-imovel) e as fichas publicadas. Painel, APIs, vitrine, links curtos, apresentações e Minha Jornada
// nunca entram. Os 3 imóveis de exemplo (reserva de lib/public-properties.js quando o banco falha) também não.
export const revalidate = 3600;

export default async function sitemap() {
  const properties = await listPublicProperties();
  const exampleIds = new Set(staticProperties.map((property) => property.id));
  const fichas = properties
    .filter((property) => property?.id && !exampleIds.has(property.id))
    .map((property) => ({
      url: propertyUrl(property),
      ...(property.updatedAt ? { lastModified: new Date(property.updatedAt) } : {}),
      changeFrequency: "weekly",
      priority: 0.8
    }));
  return [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/simulacao`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/venda-seu-imovel`, changeFrequency: "monthly", priority: 0.6 },
    ...fichas
  ];
}
