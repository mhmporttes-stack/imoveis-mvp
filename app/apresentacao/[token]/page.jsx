import { cache } from "react";
import { notFound } from "next/navigation";
import PresentationPlayer from "@/components/presentation/PresentationPlayer";
import { getPublicPresentation as loadPublicPresentation } from "@/lib/simulation-presentation";
import { buildShareMetadata, shareFirstName } from "@/lib/simulation-presentation-share.mjs";

// Página PÚBLICA da apresentação interativa (aberta como /s/<token> via proxy.js). Sem login; o token é o acesso.
// Só o DTO em allowlist chega ao navegador. Token inexistente/revogado/inválido → o mesmo 404 genérico.
// generateMetadata e a página usam a mesma leitura (uma consulta por requisição).
const getPublicPresentation = cache(loadPublicPresentation);
export const dynamic = "force-dynamic";
// Prévia de compartilhamento (PRES-18): título e imagem com SÓ o primeiro nome; token inválido/revogado → prévia
// genérica sem nome e sem imagem (a página responde 404). Mesma resolução do token da página.
export async function generateMetadata({ params }) {
  const { token } = await params;
  const dto = await getPublicPresentation(token);
  if (!dto) return { title: "Sua simulação", robots: { index: false, follow: false, nocache: true, noarchive: true }, referrer: "no-referrer" };
  return buildShareMetadata({ token, firstName: shareFirstName(dto) });
}
export const viewport = { width: "device-width", initialScale: 1, maximumScale: 5, userScalable: true, viewportFit: "cover", themeColor: "#071B31" };

export default async function PresentationPage({ params }) {
  const { token } = await params;
  const dto = await getPublicPresentation(token);
  if (!dto) notFound();
  return <PresentationPlayer scenes={dto.scenes} branch={dto.branch} token={token} canReceiveList={dto.podeReceberLista === true} />;
}
