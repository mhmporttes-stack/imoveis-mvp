import { notFound } from "next/navigation";
import EmpreendimentoPresentation from "@/components/EmpreendimentoPresentation";
import { requireAdminPage } from "@/lib/admin-auth";
import { listProperties } from "@/lib/properties";
import { redactPropertiesForAuth } from "@/lib/property-visibility";
import { getSimulation } from "@/lib/simulations";

export const dynamic = "force-dynamic";

export default async function EmpreendimentosPresentationPage({ params }) {
  const auth = await requireAdminPage();
  const { id } = await params;
  const [properties, simulation] = await Promise.all([listProperties(), getSimulation(id, auth)]);

  if (!simulation) notFound();

  return (
    <main className="min-h-screen bg-mist py-10 sm:py-14">
      <EmpreendimentoPresentation simulation={simulation} properties={redactPropertiesForAuth(properties.filter((property) => property.isDevelopment), auth)} />
    </main>
  );
}
