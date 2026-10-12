import AdminSectionNav from "@/components/AdminSectionNav";
import PerformanceOverviewDashboard from "@/components/PerformanceOverviewDashboard";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { canLoadPerformanceOverview, formatPerformanceOverviewError, getPerformanceOverview } from "@/lib/performance-overview";
import { newRenderId } from "@/lib/render-id.mjs";

export const dynamic = "force-dynamic";
// Voltar para esta tela na hora (desempenho, 2026-10-12): o navegador reaproveita a tela por até 5 min em vez de esperar o
// servidor refazer tudo; ao reaproveitar, os números se atualizam em segundo plano (renderId + useRevalidateOnReuse).
// Sair da conta / "Alterar conta" chamam router.refresh(), que descarta o reaproveitamento.
export const unstable_dynamicStaleTime = 300;

export default async function PerformancePage() {
  const auth = await requireBrokerManagementPage();

  let overview = null;
  let error = "";

  if (canLoadPerformanceOverview()) {
    try {
      overview = await getPerformanceOverview({ period: "month" }, auth);
    } catch (overviewError) {
      error = formatPerformanceOverviewError(overviewError);
    }
  } else {
    error = "Configure o Supabase para carregar o painel de desempenho.";
  }

  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="performance" />
      <PerformanceOverviewDashboard initialOverview={overview} initialError={error} renderId={newRenderId()} />
    </main>
  );
}
