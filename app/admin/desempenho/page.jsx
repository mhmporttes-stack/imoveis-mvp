import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import Footer from "@/components/Footer";
import PerformanceOverviewDashboard from "@/components/PerformanceOverviewDashboard";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { canLoadPerformanceOverview, formatPerformanceOverviewError, getPerformanceOverview } from "@/lib/performance-overview";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const auth = await requireBrokerManagementPage();

  let overview = null;
  let error = "";

  if (canLoadPerformanceOverview()) {
    try {
      overview = await getPerformanceOverview({ period: "today" }, auth);
    } catch (overviewError) {
      error = formatPerformanceOverviewError(overviewError);
    }
  } else {
    error = "Configure o Supabase para carregar o painel de desempenho.";
  }

  return (
    <main className="min-h-screen bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Desempenho</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Painel gerencial e operacional: produção da equipe, funil comercial e pontos de atenção.
          </p>
        </div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="performance" />
      <PerformanceOverviewDashboard initialOverview={overview} initialError={error} />
      <Footer />
    </main>
  );
}
