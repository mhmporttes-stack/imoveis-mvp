import { notFound, redirect } from "next/navigation";
import { isBasicMode } from "@/lib/whatsapp-access-core.mjs";
import PresentationPlayer from "@/components/presentation/PresentationPlayer";
import { requireAdminPage } from "@/lib/admin-auth";
import { getSimulation } from "@/lib/simulations";
import { buildSimulationPresentationDto } from "@/lib/simulation-presentation";

// Prévia da apresentação ANTES de enviar o link: mesma renderização da página pública, mas só para quem pode ver a
// simulação (mesmo escopo do PDF: getSimulation(id, auth)) e SEM registrar métrica (sem token, sem eventos).
export const dynamic = "force-dynamic";
export const metadata = { title: "Prévia da apresentação", robots: { index: false, follow: false } };

export default async function PresentationPreviewPage({ params }) {
  const auth = await requireAdminPage();
  const { id } = await params;
  if (isBasicMode(auth.profile)) redirect(`/admin/simulacoes/${encodeURIComponent(id)}`);
  const simulation = await getSimulation(id, auth);
  if (!simulation) notFound();
  const dto = await buildSimulationPresentationDto(simulation);
  if (!dto) notFound();
  return <PresentationPlayer scenes={dto.scenes} branch={dto.branch} token="" preview canReceiveList={dto.podeReceberLista === true} />;
}
