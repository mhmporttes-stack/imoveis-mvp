import { getPublicPresentation } from "@/lib/simulation-presentation";
import { wantsDownload } from "@/lib/simulation-presentation-image-core.mjs";
import { renderDocumentsImage } from "@/lib/simulation-presentation-image.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Imagem PNG da LISTA DE DOCUMENTOS (botão "Baixar imagem da lista de documentos", /s/<token>/documentos via proxy.js).
// Mesma regra de acesso da página (token público; inexistente/revogado → 404). O conteúdo é a lista BASE fixa
// (lib/simulation-presentation-documents.mjs): não usa nenhum dado do cliente além do primeiro nome no nome do arquivo.
const NOT_FOUND_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };

export async function GET(request, { params }) {
  const { token } = await params;
  const dto = await getPublicPresentation(token);
  if (!dto) return new Response("Não encontrado.", { status: 404, headers: { ...NOT_FOUND_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  try {
    return await renderDocumentsImage(dto, { download: wantsDownload(request.nextUrl.searchParams) });
  } catch (error) {
    console.error("Falha ao gerar a imagem da lista de documentos:", error?.message || error);
    return new Response("Indisponível no momento.", { status: 503, headers: { ...NOT_FOUND_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  }
}
