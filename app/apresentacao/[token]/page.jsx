import { cache } from "react";
import { notFound } from "next/navigation";
import PresentationPlayer from "@/components/presentation/PresentationPlayer";
import { PRESENTATION_UPDATING_REASON, resolvePublicPresentation } from "@/lib/simulation-presentation";
import { isClientAppointmentsReady } from "@/lib/client-appointments";
import { buildShareMetadata, shareFirstName } from "@/lib/simulation-presentation-share.mjs";
import { PRESENTATION_VIEWPORT } from "@/lib/presentation-viewport.mjs";

// Página PÚBLICA da apresentação interativa (aberta como /s/<token> via proxy.js). Sem login; o token é o acesso.
// Só o DTO em allowlist chega ao navegador. Token inexistente/revogado/inválido → o mesmo 404 genérico; simulação
// automática aguardando conferência (SIM-AUTO) → aviso "sendo atualizada" (sem dado nenhum).
// generateMetadata e a página usam a mesma leitura (uma consulta por requisição).
const getPublicPresentation = cache(resolvePublicPresentation);
export const dynamic = "force-dynamic";
// Prévia de compartilhamento (PRES-18): título e imagem com SÓ o primeiro nome; token inválido/revogado → prévia
// genérica sem nome e sem imagem (a página responde 404). Mesma resolução do token da página.
export async function generateMetadata({ params }) {
  const { token } = await params;
  const { dto } = await getPublicPresentation(token);
  if (!dto) return { title: "Sua simulação", robots: { index: false, follow: false, nocache: true, noarchive: true }, referrer: "no-referrer" };
  return buildShareMetadata({ token, firstName: shareFirstName(dto) });
}
// maximumScale: 1 só aqui: sem zoom automático de foco no iPhone; pinça manual segue liberada no iOS (lib/presentation-viewport.mjs).
export const viewport = { ...PRESENTATION_VIEWPORT };

export default async function PresentationPage({ params }) {
  const { token } = await params;
  const { dto, reason } = await getPublicPresentation(token);
  // Simulação voltou a ser automática e aguarda a conferência (SIM-AUTO): aviso amigável no lugar do 404 cru.
  // Nenhum dado da simulação nem do cliente sai aqui; nada é registrado como abertura.
  if (!dto && reason === PRESENTATION_UPDATING_REASON) return <PresentationUpdating />;
  if (!dto) notFound();
  // "Agendar atendimento" (PRES-22): mesma condição do "Receber lista de documentos" + tabela de agendamentos já criada.
  const canSchedule = dto.podeReceberLista === true && (await isClientAppointmentsReady());
  return <PresentationPlayer scenes={dto.scenes} branch={dto.branch} token={token} canReceiveList={dto.podeReceberLista === true} canSchedule={canSchedule} attendantName={dto.atendentePrimeiroNome || ""} strategy={dto.estrategia || null} />;
}

function PresentationUpdating() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-mist px-6 py-12">
      <div className="max-w-sm text-center">
        <img src="/assets/matheus-machado-symbol.png" alt="Matheus Machado Corretor de Imóveis" width={56} height={56} className="mx-auto h-14 w-14" />
        <h1 className="mt-6 text-xl font-black text-navy">Sua simulação está sendo atualizada</h1>
        <p className="mt-3 text-base text-ink">Esta apresentação está sendo atualizada pelo seu corretor. Tente abrir o link de novo daqui a pouco.</p>
      </div>
    </main>
  );
}
