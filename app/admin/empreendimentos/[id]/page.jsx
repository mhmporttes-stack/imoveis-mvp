import { notFound } from "next/navigation";
import PropertyForm from "@/components/PropertyForm";
import { canManageProperties, getProperty } from "@/lib/properties";

export const dynamic = "force-dynamic";

export default async function EditPropertyPage({ params }) {
  if (!canManageProperties()) {
    return (
      <main className="bg-mist py-14">
        <section className="container-page rounded-[28px] border border-line bg-white p-10 shadow-soft">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Edicao</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Edicao desativada em producao</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
            Configure o Supabase para editar empreendimentos em producao.
          </p>
        </section>
      </main>
    );
  }

  const { id } = await params;
  const property = await getProperty(id);
  if (!property) notFound();

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Edição</p>
        <h1 className="mt-3 text-5xl font-black text-navy">Editar empreendimento</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">Atualize dados, fotos, catálogo e condições comerciais.</p>
      </section>
      <PropertyForm property={property} />
    </main>
  );
}
