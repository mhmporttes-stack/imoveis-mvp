import { getPublicPresentation } from "@/lib/simulation-presentation";
import { renderShareImage, shareFirstName } from "@/lib/simulation-presentation-share.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Imagem de prévia (1200x630) do link /s/<token>, aberta pelos crawlers do WhatsApp/Instagram/Facebook. Mesma resolução
// do token que a página (`getPublicPresentation`): inválido/revogado → 404 sem corpo informativo. Só o primeiro nome
// do cliente (PRES-18). Não registra evento de visualização (as métricas só vêm do navegador, via /api/s/<token>/evento).
const NOT_FOUND_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer", "Content-Type": "text/plain; charset=utf-8" };

export async function GET(_request, { params }) {
  const { token } = await params;
  const dto = await getPublicPresentation(token);
  if (!dto) return new Response("Não encontrado.", { status: 404, headers: NOT_FOUND_HEADERS });
  try {
    return await renderShareImage(shareFirstName(dto));
  } catch (error) {
    console.error("Falha ao gerar a imagem de prévia da apresentação:", error?.message || error);
    return new Response("Indisponível no momento.", { status: 503, headers: NOT_FOUND_HEADERS });
  }
}
