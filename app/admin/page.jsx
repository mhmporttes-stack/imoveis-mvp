import Link from "next/link";
import AdminPropertyList from "@/components/AdminPropertyList";
import { listProperties } from "@/lib/properties";

export const dynamic = "force-dynamic";

export default function AdminPage() {
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
