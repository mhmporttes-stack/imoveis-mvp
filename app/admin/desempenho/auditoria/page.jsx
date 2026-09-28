import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import Footer from "@/components/Footer";
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
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Auditoria de Atendimento</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            Métricas objetivas do CRM + análise por IA das conversas reais do WhatsApp, por corretor e período.
          </p>
        </div>
        <AdminLogoutButton />
      </section>
      <AdminSectionNav active="audit" />
      <AttendanceAuditDashboard brokers={brokers} />
      <Footer />
    </main>
  );
}
