import AdminSectionNav from "@/components/AdminSectionNav";
import DailyReportDashboard from "@/components/DailyReportDashboard";
import Footer from "@/components/Footer";
import { canLoadDailyReport, formatDailyReportError, getDailyReport } from "@/lib/daily-report";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata = {
  title: "Relatório diário | Matheus Machado"
};

export const dynamic = "force-dynamic";

export default async function DailyReportPage() {
  const auth = await requireAdminPage();

  let report = null;
  let error = "";

  if (canLoadDailyReport()) {
    try {
      report = await getDailyReport({ period: "today" }, auth);
    } catch (reportError) {
      error = formatDailyReportError(reportError);
    }
  } else {
    error = "Configure o Supabase para carregar o relatório diário.";
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] pt-12">
      <section className="container-page mb-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Área restrita</p>
            <h1 className="mt-3 text-4xl font-extrabold text-navy md:text-6xl">Relatório Diário</h1>
            <p className="mt-3 max-w-3xl text-lg text-slate">
              Acompanhe o desempenho comercial por período, status dos clientes e conversões do funil.
            </p>
          </div>
        </div>
      </section>

      <AdminSectionNav active="daily-report" />
      <DailyReportDashboard initialReport={report} initialError={error} />
      <Footer />
    </main>
  );
}
