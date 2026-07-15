import { notFound } from "next/navigation";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import SimulationGenerator from "@/components/SimulationGenerator";
import { requireAdminPage } from "@/lib/admin-auth";
import { listProperties } from "@/lib/properties";
import { getSimulation } from "@/lib/simulations";

export const dynamic = "force-dynamic";

export default async function EditSimulationPage({ params }) {
  await requireAdminPage();

  const [{ id }, properties] = await Promise.all([
    params,
    listProperties()
  ]);
  const simulation = await getSimulation(id);

  if (!simulation) notFound();

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Gerador de Simulações</p>
          <h1 className="mt-3 text-5xl font-black text-navy">Editar simulação</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">Revise dados, imóveis, benefícios e gere novamente a apresentação.</p>
        </div>
        <AdminLogoutButton />
      </section>
      <SimulationGenerator properties={properties} initialSimulation={simulation} />
    </main>
  );
}
