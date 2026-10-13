import AdminSectionNav from "@/components/AdminSectionNav";
import AdsBoard from "@/components/ads/AdsBoard";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { getAdsBoard } from "@/lib/meta-ads-board";

export const dynamic = "force-dynamic";

// Área ANÚNCIOS (pedido do dono, 2026-10-13): só administrador geral,
// somente leitura dos anúncios da Meta (nada é alterado na Meta por aqui).
export default async function AdminAdsPage() {
  await requireGeneralAdminPage();

  let data = null;
  let error = "";
  try {
    data = await getAdsBoard({ period: "7d" });
  } catch (loadError) {
    console.error("Falha ao carregar a área Anúncios.", loadError);
    error = loadError?.message || "Não foi possível carregar os anúncios.";
  }

  return (
    <main className="min-h-screen bg-mist pb-14 md:pt-14">
      <AdminSectionNav active="ads" />
      <AdsBoard initialData={data} initialError={error} />
    </main>
  );
}
