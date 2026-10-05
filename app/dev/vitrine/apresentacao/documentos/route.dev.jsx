import { renderDocumentsImage } from "@/lib/simulation-presentation-image.mjs";
import { wantsDownload } from "@/lib/simulation-presentation-image-core.mjs";
import { presentationDto } from "../../_fixtures/apresentacao";

// Imagem PNG de DESENVOLVIMENTO (dados fictícios, sem banco): /dev/vitrine/apresentacao/documentos?v=<variante>
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const variant = String(request.nextUrl.searchParams.get("v") || "completo");
  return renderDocumentsImage(presentationDto(variant), { download: wantsDownload(request.nextUrl.searchParams) });
}
