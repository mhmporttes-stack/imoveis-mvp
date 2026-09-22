import AdminLogoutButton from "@/components/AdminLogoutButton";
import AdminSectionNav from "@/components/AdminSectionNav";
import OpportunitiesCenter from "@/components/OpportunitiesCenter";
import { requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";
import { getOpportunitiesPageData } from "@/lib/opportunities";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const auth = await requireAdminPage();
  const initialData = await getOpportunitiesPageData(auth, { page: 1 });
  const canSeeTeam = isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);

  return (
    <main className="min-h-screen bg-mist py-14">
      <Header />
      <AdminSectionNav active="opportunities" />
      <OpportunitiesCenter initialData={initialData} canSeeTeam={canSeeTeam} />
    </main>
  );
}

function Header() {
  return (
    <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área restrita</p>
        <h1 className="mt-3 text-5xl font-black text-navy">Central de Oportunidades</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">Priorize os clientes com maior potencial de avanço hoje.</p>
      </div>
      <AdminLogoutButton />
    </section>
  );
}
