import AdminSectionNav from "@/components/AdminSectionNav";
import AttendanceAuditDashboard from "@/components/AttendanceAuditDashboard";
import { requireBrokerManagementPage } from "@/lib/admin-auth";
import { listVisibleTeamProfiles } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";

export default async function AttendanceAuditPage() {
  const auth = await requireBrokerManagementPage();
  const profiles = await listVisibleTeamProfiles(auth);
  const brokers = profiles.map((profile) => ({ id: profile.id, name: profile.name || profile.email || "Usuário" })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <main className="min-h-screen bg-mist py-14">
      <AdminSectionNav active="audit" />
      <AttendanceAuditDashboard brokers={brokers} />
    </main>
  );
}
