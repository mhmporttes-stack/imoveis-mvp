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
      <PerformanceOverviewDashboard initialOverview={overview} initialError={error} />
      <Footer />
    </main>
  );
}
