import { notFound } from "next/navigation";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import EmpreendimentoPresentation from "@/components/EmpreendimentoPresentation";
import { requireAdminPage } from "@/lib/admin-auth";
import { listProperties } from "@/lib/properties";
import { getSimulation } from "@/lib/simulations";

export const dynamic = "force-dynamic";

export default async function EmpreendimentosPresentationPage({ params }) {
  const auth = await requireAdminPage();
  const { id } = await params;
  const [properties, simulation] = await Promise.all([listProperties(), getSimulation(id, auth)]);

  if (!simulation) notFound();

  return (
    <main className="min-h-screen bg-mist py-10 sm:py-14">
      <section className="container-page mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Apresentação</p>
          <h1 className="mt-2 text-4xl font-black text-navy">Empreendimentos para {simulation.clientName}</h1>
          <p className="mt-3 text-muted">Troque o empreendimento para atualizar os valores automaticamente.</p>
        </div>
        <AdminLogoutButton />
      </section>
      <EmpreendimentoPresentation simulation={simulation} properties={properties.filter((property) => property.isDevelopment && property.isPublished)} />
    </main>
  );
}
