import Link from "next/link";
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
  // Corretor removido ou link antigo apontando para um id que não existe
  // mais: leva de volta para a tela de Desempenho em vez do 404 padrão do
  // Next.js (fallback seguro, sem esconder o motivo real).
  if (!profile) {
    return (
      <BrokerPerformanceUnavailable reason="Este corretor não foi encontrado. Ele pode ter sido removido." />
    );
  }

  let overview = null;
  let error = "";

  if (canLoadPerformanceOverview()) {
    try {
      overview = await getBrokerPerformanceOverview(id, { period: "month" }, auth);
    } catch (overviewError) {
      if (isAdminPermissionError(overviewError)) {
        return (
          <BrokerPerformanceUnavailable reason="Você não tem permissão para visualizar o desempenho deste corretor." />
        );
      }
      error = formatPerformanceOverviewError(overviewError);
    }
  } else {
    error = "Configure o Supabase para carregar o painel de desempenho.";
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] pt-12">
      <section className="container-page mb-8">
        <Link href="/admin/desempenho" className="text-sm font-black uppercase tracking-[0.18em] text-brand">
          ← Voltar para Desempenho
        </Link>
      </section>

      <AdminSectionNav active="performance" />
      <BrokerPerformanceDetail brokerId={id} brokerName={profile.name || "Corretor"} initialOverview={overview} initialError={error} />
      <Footer />
    </main>
  );
}

function BrokerPerformanceUnavailable({ reason }) {
  return (
    <main className="min-h-screen bg-[#f4f7fb] pt-12">
      <section className="container-page mb-8">
        <Link href="/admin/desempenho" className="text-sm font-black uppercase tracking-[0.18em] text-brand">
          ← Voltar para Desempenho
        </Link>
        <div className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-6 text-sm font-bold text-red-700">
          {reason}
        </div>
      </section>
      <Footer />
    </main>
  );
}
