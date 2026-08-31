import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { listCrmAutomationRules } from "@/lib/crm";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  await requireGeneralAdminPage("/admin/simulacoes");
  const rules = await listCrmAutomationRules();

  return (
    <main className="min-h-screen bg-mist py-14">
      <Header />
      <AdminSectionNav active="automations" />
      <section className="container-page rounded-[28px] border border-line bg-white p-8 shadow-soft">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">Regras configuráveis</p>
            <p className="mt-2 text-3xl font-black text-navy">{rules.length}</p>
          </div>
          <span className="rounded-full bg-mist px-4 py-2 text-sm font-black text-muted">Todas desativadas por padrão</span>
        </div>
      </section>
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
