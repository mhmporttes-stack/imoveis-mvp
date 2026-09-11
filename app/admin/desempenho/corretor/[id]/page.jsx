import Link from "next/link";
import { notFound } from "next/navigation";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import BrokerPerformanceDetail from "@/components/BrokerPerformanceDetail";
import Footer from "@/components/Footer";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { getAdminProfileById } from "@/lib/admin-profiles";
import { isAdminPermissionError } from "@/lib/admin-access";
import { canLoadPerformanceOverview, formatPerformanceOverviewError, getBrokerPerformanceOverview } from "@/lib/performance-overview";

export const dynamic = "force-dynamic";

export default async function BrokerPerformancePage({ params }) {
  const auth = await requireBrokerManagementPage();
  const { id } = await params;

  const profile = await getAdminProfileById(id);
  if (!profile) notFound();

  let overview = null;
  let error = "";

  if (canLoadPerformanceOverview()) {
    try {
      overview = await getBrokerPerformanceOverview(id, { period: "today" }, auth);
    } catch (overviewError) {
      if (isAdminPermissionError(overviewError)) notFound();
      error = formatPerformanceOverviewError(overviewError);
    }
  } else {
    error = "Configure o Supabase para carregar o painel de desempenho.";
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] pt-12">
      <section className="container-page mb-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/admin/desempenho" className="text-sm font-black uppercase tracking-[0.18em] text-brand">
              ← Voltar para Desempenho
            </Link>
            <h1 className="mt-3 text-4xl font-extrabold text-navy md:text-6xl">{profile.name || "Corretor"}</h1>
            <p className="mt-3 max-w-3xl text-lg text-slate">
              Indicadores operacionais individuais por período.
            </p>
          </div>
          <AdminLogoutButton />
        </div>
      </section>

      <AdminSectionNav active="performance" />
      <BrokerPerformanceDetail brokerId={id} brokerName={profile.name || "Corretor"} initialOverview={overview} initialError={error} />
      <Footer />
    </main>
  );
}
