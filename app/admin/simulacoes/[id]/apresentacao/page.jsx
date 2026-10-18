import { notFound, redirect } from "next/navigation";
import { isBasicMode } from "@/lib/whatsapp-access-core.mjs";
import PresentationPlayer from "@/components/presentation/PresentationPlayer";
import { requireAdminPage } from "@/lib/admin-auth";
import { getSimulation } from "@/lib/simulations";
import { buildSimulationPresentationDto, getActivePresentation } from "@/lib/simulation-presentation";
import { readPaymentStrategy } from "@/lib/payment-strategy";

// Prévia da apresentação ANTES de enviar o link: mesma renderização da página pública, mas só para quem pode ver a
// simulação (mesmo escopo do PDF: getSimulation(id, auth)) e SEM registrar métrica (sem token, sem eventos).
export const dynamic = "force-dynamic";
export const metadata = { title: "Prévia da apresentação", robots: { index: false, follow: false } };

// ?modo=aprovacao: prévia da apresentação de APROVAÇÃO (PRES-21) antes de ligar a chave; com a chave ligada a prévia já é a de aprovação.
export default async function PresentationPreviewPage({ params, searchParams }) {
  const auth = await requireAdminPage();
  const { id } = await params;
  if (isBasicMode(auth.profile)) redirect(`/admin/simulacoes/${encodeURIComponent(id)}`);
  const simulation = await getSimulation(id, auth);
  if (!simulation) notFound();
  const query = (await searchParams) || {};
  let approval = query.modo === "aprovacao";
  let presentationId = "";
  try {
    const active = (await getActivePresentation(simulation.id)).presentation;
    presentationId = active?.id || "";
    if (!approval) approval = Boolean(active?.approvalEnabledAt);
  } catch {
    // sem link (ou tabela ausente): prévia da simulação, sem estratégia gravada
  }
  const dto = await buildSimulationPresentationDto(simulation, { approval });
  if (!dto) notFound();
  // Estratégia de pagamento (PRES-24): o corretor mexe na prévia; abre com a última escolha gravada pelo cliente no link.
  let savedStrategy = null;
  if (dto.estrategia && presentationId) {
    try {
      savedStrategy = await readPaymentStrategy(presentationId);
    } catch (error) {
      console.error("[apresentacao] nao foi possivel ler a estrategia de pagamento:", error?.message || error);
    }
  }
  return (
    <PresentationPlayer
      scenes={dto.scenes}
      branch={dto.branch}
      token=""
      preview canReceiveList={dto.podeReceberLista === true}
      canSchedule={dto.podeReceberLista === true}
      strategy={dto.estrategia || null}
      strategyPdfEndpoint={`/api/admin/simulacoes/${encodeURIComponent(simulation.id)}/apresentacao/estrategia`}
      strategyInitialChoices={savedStrategy?.escolhas || null}
    />
  );
}
