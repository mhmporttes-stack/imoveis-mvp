import AdminSectionNav from "@/components/AdminSectionNav";
import MarketplaceAdmin from "@/components/marketplace/MarketplaceAdmin";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { getPublisherStatus, listMarketplaceListings } from "@/lib/marketplace-listings";
import { listProperties } from "@/lib/properties";

export const dynamic = "force-dynamic";

// Publicador do Facebook Marketplace (MKT-1, dono, 2026-10-20): só o admin geral. A extensão do Chrome publica
// sozinha apenas os anúncios aprovados aqui.
export default async function AdminMarketplacePage() {
  await requireGeneralAdminPage();
  const [list, publisher, properties] = await Promise.all([listMarketplaceListings(), getPublisherStatus(), listProperties()]);
  const propertyOptions = properties.map((property) => ({ id: property.id, name: property.name, isDevelopment: property.isDevelopment }));

  return (
    <main className="bg-mist py-14">
      <AdminSectionNav active="marketplace" />
      <MarketplaceAdmin initialListings={list.listings} ready={list.ready} initialPublisher={publisher} properties={propertyOptions} />
    </main>
  );
}
