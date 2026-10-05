import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import SimulationGenerator from "@/components/SimulationGenerator";
import SimulationPresentationPanel from "@/components/presentation/SimulationPresentationPanel";
import { requireAdminPage } from "@/lib/admin-auth";
import { listProperties } from "@/lib/properties";
import { redactPropertiesForAuth } from "@/lib/property-visibility";
import { withoutPropertyPdf } from "@/lib/property-visibility-core.mjs";
import { getSimulation } from "@/lib/simulations";
import { isBasicMode } from "@/lib/whatsapp-access-core.mjs";

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
      <section className="container-page mb-8">
        <Link href="/admin/simulacoes" className="inline-flex items-center gap-2 text-sm font-black text-brand transition hover:text-navy">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para clientes
        </Link>
      </section>
      {/* Apresentação interativa: opção ADICIONAL ao PDF (que continua sendo gerado pelo gerador abaixo, sem mudança). */}
      {/* Modo básico (automação desativada): sem apresentação interativa; o lançamento dos valores segue. */}
      {isBasicMode(auth.profile) ? null : <SimulationPresentationPanel simulationId={simulation.id} />}
      <SimulationGenerator properties={withoutPropertyPdf(redactPropertiesForAuth(properties, auth))} initialSimulation={simulation} />
    </main>
  );
}
