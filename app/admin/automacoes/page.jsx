import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import AutomationRulesManager from "@/components/AutomationRulesManager";
import LeadDistributionDashboard from "@/components/LeadDistributionDashboard";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { listAdminProfiles } from "@/lib/admin-profiles";
import { listAutomationRules } from "@/lib/crm-automations";
import { listLeadDistributionDashboard } from "@/lib/lead-distribution";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AutomationsPage({ searchParams }) {
  await requireGeneralAdminPage("/admin/simulacoes");
  const tab = (await searchParams)?.tab === "roulette" ? "roulette" : "rules";
  const [rules, users, distribution] = await Promise.all([
    tab === "rules" ? listAutomationRules() : Promise.resolve([]),
    tab === "rules" ? listAdminProfiles() : Promise.resolve([]),
    tab === "roulette" ? listLeadDistributionDashboard() : Promise.resolve(null)
  ]);

  return (
    <main className="min-h-screen bg-mist py-14">
      <Header />
      <AdminSectionNav active="automations" />
      <AutomationSubmenu active={tab} />
      {tab === "rules" ? <AutomationRulesManager initialRules={rules} users={users.filter((user) => user.status === "active")} /> : <LeadDistributionDashboard initialData={distribution} />}
    </main>
  );
}

function AutomationSubmenu({ active }) {
  return <nav className="container-page mb-5 grid grid-cols-2 rounded-2xl border border-line bg-white p-1 shadow-soft">
    <Link className={`rounded-xl px-5 py-3 text-center text-sm font-black ${active === "rules" ? "bg-navy text-white" : "text-navy"}`} href="/admin/automacoes">Regras</Link>
    <Link className={`rounded-xl px-5 py-3 text-center text-sm font-black ${active === "roulette" ? "bg-navy text-white" : "text-navy"}`} href="/admin/automacoes?tab=roulette">Roleta</Link>
  </nav>;
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
