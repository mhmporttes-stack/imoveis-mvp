import { getPublicPresentation } from "@/lib/simulation-presentation";
import { imageResponseHeaders, wantsDownload } from "@/lib/simulation-presentation-image-core.mjs";
import { renderSummaryImage } from "@/lib/simulation-presentation-image.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Imagem PNG do resumo da simulação (botão "Baixar apresentação", aberta como /s/<token>/imagem via proxy.js).
// PÚBLICA pelo token, como a página: usa o MESMO DTO em allowlist (`getPublicPresentation`), então não há dado sensível
// nem número diferente do que a apresentação mostra. Token inexistente/revogado/inválido ou simulação sem valores → o
// mesmo 404 da página. Nunca em cache, nunca indexada. `?baixar=1` força o download (nome simulacao-<primeironome>.png).
const NOT_FOUND_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };

export async function GET(request, { params }) {
  const { token } = await params;
  const dto = await getPublicPresentation(token);
  if (!dto) return new Response("Não encontrado.", { status: 404, headers: { ...NOT_FOUND_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  try {
    return await renderSummaryImage(dto, { download: wantsDownload(request.nextUrl.searchParams) });
  } catch (error) {
    console.error("Falha ao gerar a imagem da apresentação:", error?.message || error);
    return new Response("Indisponível no momento.", { status: 503, headers: { ...NOT_FOUND_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  }
}
