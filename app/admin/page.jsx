import Link from "next/link";
import AdminPropertyList from "@/components/AdminPropertyList";
import { listProperties } from "@/lib/properties";
import { canUseLocalDatabase } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  if (!canUseLocalDatabase) {
    return <AdminDisabled />;
  }

  const properties = listProperties();

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Área administrativa</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Painel de empreendimentos</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">Gerencie o portfólio, edite informações comerciais e publique páginas individuais.</p>
        </div>
        <Link href="/admin/novo" className="premium-button-primary">Novo empreendimento</Link>
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
          Para manter o site online na Vercel, o cadastro local com SQLite fica ativo apenas em desenvolvimento.
        </p>
        <Link href="/" className="mt-8 inline-flex premium-button-primary">Voltar para o site</Link>
      </section>
    </main>
  );
}
