import AdminSectionNav from "@/components/AdminSectionNav";
import DailyReportDashboard from "@/components/DailyReportDashboard";
import { isGeneralAdminAuth, isManagerProfile, listAdminProfiles } from "@/lib/admin-profiles";
import { canLoadDailyReport, formatDailyReportError, getDailyReport } from "@/lib/daily-report";
import { requirePerformancePage } from "@/lib/admin-auth";

export const metadata = {
  title: "Relatório diário | Matheus Machado"
};

export const dynamic = "force-dynamic";

export default async function DailyReportPage() {
  const auth = await requirePerformancePage();

  let report = null;
  let error = "";
  let adminProfiles = [];
  const isGeneralAdmin = isGeneralAdminAuth(auth);
  const isManager = isManagerProfile(auth.profile);

  if (canLoadDailyReport()) {
    try {
      report = await getDailyReport({ period: "today" }, auth);
    } catch (reportError) {
      error = formatDailyReportError(reportError);
    }
  } else {
    error = "Configure o Supabase para carregar o relatório diário.";
  }

  if (isGeneralAdmin || isManager) {
    try {
      const profiles = await listAdminProfiles();
      adminProfiles = isManager
        ? profiles.filter((profile) => (auth.profile.managedUserIds || [auth.profile.id]).includes(profile.id))
        : profiles;
    } catch {
      adminProfiles = [];
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] pt-12">
      <AdminSectionNav active="daily-report" />
      <DailyReportDashboard
        adminProfiles={adminProfiles}
        canFilterBrokers={isGeneralAdmin || isManager}
        initialReport={report}
        initialError={error}
      />
    </main>
  );
}
