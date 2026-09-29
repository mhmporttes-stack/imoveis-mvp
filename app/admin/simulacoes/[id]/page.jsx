import { notFound } from "next/navigation";
import SimulationGenerator from "@/components/SimulationGenerator";
import { requireAdminPage } from "@/lib/admin-auth";
import { listProperties } from "@/lib/properties";
import { getSimulation } from "@/lib/simulations";

export const dynamic = "force-dynamic";

export default async function EditSimulationPage({ params }) {
  const auth = await requireAdminPage();
  const { id } = await params;

  const [properties, simulation] = await Promise.all([
    listProperties(),
    getSimulation(id, auth)
  ]);

  if (!simulation) notFound();

  return (
    <main className="bg-mist py-14">
      <SimulationGenerator properties={properties} initialSimulation={simulation} />
    </main>
  );
}
