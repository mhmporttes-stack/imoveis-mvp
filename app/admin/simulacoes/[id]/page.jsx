import { notFound } from "next/navigation";
import SimulationGenerator from "@/components/SimulationGenerator";
import SimulationPresentationPanel from "@/components/presentation/SimulationPresentationPanel";
import { requireAdminPage } from "@/lib/admin-auth";
import { listProperties } from "@/lib/properties";
import { redactPropertiesForAuth } from "@/lib/property-visibility";
import { withoutPropertyPdf } from "@/lib/property-visibility-core.mjs";
import { getSimulation } from "@/lib/simulations";
import { isBasicMode } from "@/lib/whatsapp-access-core.mjs";
import AutoSimulationReview from "@/components/AutoSimulationReview";
import RedoAutoSimulationButton from "@/components/RedoAutoSimulationButton";
import SimulationScenarios from "@/components/SimulationScenarios";
import { AUTO_SIMULATION_REVIEW_ENABLED } from "@/lib/simulation-auto-review-core.mjs";
import { isAutomaticSimulationSource } from "@/lib/simulation-status-lock-core.mjs";
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

  // Redesenho da aba (designer-crm, aprovado pelo dono em 2026-10-19): a página monta os blocos e o Gerador os posiciona
  // (conferência no topo, Refazer junto dela, "Comparar simulações" como aba e o link da apresentação na coluna de envio).
  const automatic = isAutomaticSimulationSource(simulation.createdBy);
  return (
    <main className="bg-mist pb-10 pt-4 md:pt-6">
      <SimulationGenerator properties={withoutPropertyPdf(redactPropertiesForAuth(properties, auth))}
        initialSimulation={simulation}
        fieldSuggestions={simulation.registration ? simulationFieldSuggestions({ registration: simulation.registration, simulation, automatic, referenceDate: todayInSaoPaulo() }) : null}
        clientSheetHref={simulation.registrationId ? `/admin/simulacoes?clientId=${encodeURIComponent(simulation.registrationId)}` : ""}
        /* Simulação automática do site ainda não conferida (SIM-AUTO, dono 2026-10-19): conferência obrigatória em destaque
           na própria aba da simulação; o link da apresentação fica bloqueado até o OK ou a correção salva. */
        reviewSlot={AUTO_SIMULATION_REVIEW_ENABLED && isAutomaticSimulationSource(simulation.createdBy) ? <AutoSimulationReview simulationId={simulation.id} inEditor prominent /> : null}
        /* "Refazer simulação automática" (dono, 2026-10-19): recalcula com o cadastro atual; volta a exigir a conferência. */
        redoSlot={simulation.registrationId ? <RedoAutoSimulationButton registrationId={simulation.registrationId} size="md" /> : null}
        /* "Comparar simulações" (dono, 2026-10-19): aba ao lado de "Simulação". */
        scenariosSlot={simulation.registrationId ? <SimulationScenarios registrationId={simulation.registrationId} /> : null}
        /* Apresentação interativa (o PDF da simulação saiu do CRM). Modo básico (automação desativada): sem apresentação
           interativa; o lançamento dos valores segue. */
        presentationSlot={isBasicMode(auth.profile) ? null : <SimulationPresentationPanel simulationId={simulation.id} />}
      />
    </main>
  );
}
