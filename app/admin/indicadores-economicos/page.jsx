import AdminSectionNav from "@/components/AdminSectionNav";
import EconomicIndicatorsDashboard from "@/components/economic/EconomicIndicatorsDashboard";
import { isGeneralAdmin, requireAdminPage } from "@/lib/admin-auth";
import { ECON_SCHEMA_MESSAGE, getEconomicOverview, getMcmvSettings, isMissingEconSchema } from "@/lib/economic-indicators";

export const dynamic = "force-dynamic";

export const metadata = { title: "Indicadores Econômicos" };

// Indicadores Econômicos (dono, 2026-10-29 — ECON-1): todos os perfis do painel. Lê só o banco (carga rápida); a coleta
// das fontes oficiais é do cron diário (/api/cron/economic-indicators). O cadastro do MCMV do Radar (ECON-2) só aparece
// para o administrador geral.
export default async function EconomicIndicatorsPage() {
  const auth = await requireAdminPage();
  const canEditMcmv = isGeneralAdmin(auth);
  let initial = null;
  let initialError = "";
  let mcmv = null;
  const [overview, mcmvResult] = await Promise.allSettled([getEconomicOverview(), canEditMcmv ? getMcmvSettings() : Promise.resolve(null)]);
  if (overview.status === "fulfilled") {
    initial = overview.value;
  } else {
    const error = overview.reason;
    initialError = isMissingEconSchema(error) ? ECON_SCHEMA_MESSAGE : "Não foi possível carregar os indicadores agora.";
    if (!isMissingEconSchema(error)) console.error("Indicadores Econômicos: falha ao carregar a página:", error?.message || error);
  }
  if (mcmvResult.status === "fulfilled") mcmv = mcmvResult.value;
  else console.error("Indicadores Econômicos: falha ao ler o cadastro do MCMV:", mcmvResult.reason?.message || mcmvResult.reason);
  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="economic-indicators" />
      <EconomicIndicatorsDashboard initial={initial} initialError={initialError} mcmv={mcmv} canEditMcmv={canEditMcmv && mcmvResult.status === "fulfilled"} />
    </main>
  );
}
