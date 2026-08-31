import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import AutomationRulesManager from "@/components/AutomationRulesManager";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { listAdminProfiles } from "@/lib/admin-profiles";
import { listAutomationRules } from "@/lib/crm-automations";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  await requireGeneralAdminPage("/admin/simulacoes");
  const [rules, users] = await Promise.all([listAutomationRules(), listAdminProfiles()]);

  return (
    <main className="min-h-screen bg-mist py-14">
      <Header />
      <AdminSectionNav active="automations" />
      <AutomationRulesManager initialRules={rules} users={users.filter((user) => user.status === "active")} />
    </main>
  );
}

function Header() {
  return (
    <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
        <h1 className="mt-3 text-5xl font-black text-navy">Automações</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">Regras internas configuráveis do CRM.</p>
      </div>
      <AdminLogoutButton />
    </section>
  );
}
