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
import RedoAutoSimulationButton from "@/components/RedoAutoSimulationButton";
import SimulationScenarios from "@/components/SimulationScenarios";
import { AUTO_SIMULATION_REVIEW_ENABLED } from "@/lib/simulation-auto-review-core.mjs";
import { AUTO_PRESENTATION_LOCKED_MESSAGE, isAutoPresentationLocked, isAutomaticSimulationSource } from "@/lib/simulation-status-lock-core.mjs";
import { simulationFieldSuggestions, todayInSaoPaulo } from "@/lib/financiamento-estimativa-core.mjs";

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
      {/* "Refazer simulação automática" (dono, 2026-10-19): recalcula com o cadastro atual; volta a exigir a conferência. */}
      {simulation.registrationId ? (
        <section className="container-page mb-8 space-y-4">
          <RedoAutoSimulationButton registrationId={simulation.registrationId} variant="link" />
          {/* "Comparar simulações" (dono, 2026-10-19): componente separado, fácil de reposicionar no redesenho. */}
          <SimulationScenarios registrationId={simulation.registrationId} />
        </section>
      ) : null}
      {/* Apresentação interativa (o PDF da simulação saiu do CRM). */}
      {/* Modo básico (automação desativada): sem apresentação interativa; o lançamento dos valores segue. */}
      {/* Simulação automática ainda não conferida (dono, 2026-10-19): só uma linha discreta perto do link; a conferência é
          por tipo (👍/👎 abaixo do imóvel novo e do usado, na Etapa B) e o link só libera com todos conferidos. */}
      {AUTO_SIMULATION_REVIEW_ENABLED && isAutoPresentationLocked(simulation.createdBy) ? (
        <p className="container-page mb-2 text-xs font-semibold text-muted" data-auto-review-line="">{AUTO_PRESENTATION_LOCKED_MESSAGE}</p>
      ) : null}
      {isBasicMode(auth.profile) ? null : <SimulationPresentationPanel simulationId={simulation.id} />}
      <SimulationGenerator properties={withoutPropertyPdf(redactPropertiesForAuth(properties, auth))}
        initialSimulation={simulation}
        fieldSuggestions={simulation.registration ? simulationFieldSuggestions({ registration: simulation.registration, simulation, automatic: isAutomaticSimulationSource(simulation.createdBy), referenceDate: todayInSaoPaulo() }) : null}
        clientSheetHref={simulation.registrationId ? `/admin/simulacoes?clientId=${encodeURIComponent(simulation.registrationId)}` : ""}
      />
    </main>
  );
}
