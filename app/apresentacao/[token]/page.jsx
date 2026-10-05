import { notFound } from "next/navigation";
import PresentationPlayer from "@/components/presentation/PresentationPlayer";
import { getPublicPresentation } from "@/lib/simulation-presentation";

// Página PÚBLICA da apresentação interativa (aberta como /s/<token> via proxy.js). Sem login; o token é o acesso.
// Só o DTO em allowlist chega ao navegador. Token inexistente/revogado/inválido → o mesmo 404 genérico.
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sua simulação",
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  referrer: "no-referrer"
};
export const viewport = { width: "device-width", initialScale: 1, maximumScale: 5, userScalable: true, viewportFit: "cover", themeColor: "#071B31" };

export default async function PresentationPage({ params }) {
  const { token } = await params;
  const dto = await getPublicPresentation(token);
  if (!dto) notFound();
  return <PresentationPlayer scenes={dto.scenes} branch={dto.branch} token={token} />;
}
