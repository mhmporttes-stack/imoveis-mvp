import Link from "next/link";
import AdminPropertyList from "@/components/AdminPropertyList";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import { requireAdminPage } from "@/lib/admin-auth";
import { canManageProperties, listProperties } from "@/lib/properties";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminPage();

  if (!canManageProperties()) {
    return <AdminDisabled />;
  }

  const properties = await listProperties();

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área administrativa</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Painel de empreendimentos</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">Gerencie o portfólio, edite informações comerciais e publique páginas individuais.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/admin/novo" className="premium-button-primary">Novo empreendimento</Link>
          <AdminLogoutButton />
        </div>
      </section>
      <AdminPropertyList properties={properties} />
    </main>
  );
}

function AdminDisabled() {
  return (
    <main className="bg-mist py-14">
      <section className="container-page rounded-[28px] border border-line bg-white p-10 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Area administrativa</p>
        <h1 className="mt-3 text-5xl font-black text-navy">Painel temporariamente desativado</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          Configure o Supabase para gerenciar empreendimentos em producao ou use SQLite no ambiente local.
        </p>
        <Link href="/" className="mt-8 inline-flex premium-button-primary">Voltar para o site</Link>
      </section>
    </main>
  );
}
