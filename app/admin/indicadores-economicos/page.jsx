import AdminSectionNav from "@/components/AdminSectionNav";
import EconomicIndicatorsDashboard from "@/components/economic/EconomicIndicatorsDashboard";
import { requireAdminPage } from "@/lib/admin-auth";
import { ECON_SCHEMA_MESSAGE, getEconomicOverview, isMissingEconSchema } from "@/lib/economic-indicators";

export const dynamic = "force-dynamic";

export const metadata = { title: "Indicadores Econômicos" };

// Indicadores Econômicos (dono, 2026-10-29 — ECON-1): todos os perfis do painel. Lê só o banco (carga rápida); a coleta
// das fontes oficiais é do cron diário (/api/cron/economic-indicators).
export default async function EconomicIndicatorsPage() {
  await requireAdminPage();
  let initial = null;
  let initialError = "";
  try {
    initial = await getEconomicOverview();
  } catch (error) {
    initialError = isMissingEconSchema(error) ? ECON_SCHEMA_MESSAGE : "Não foi possível carregar os indicadores agora.";
    if (!isMissingEconSchema(error)) console.error("Indicadores Econômicos: falha ao carregar a página:", error?.message || error);
  }
  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="economic-indicators" />
      <EconomicIndicatorsDashboard initial={initial} initialError={initialError} />
    </main>
  );
}
