import { renderSummaryImage } from "@/lib/simulation-presentation-image.mjs";
import { wantsDownload } from "@/lib/simulation-presentation-image-core.mjs";
import { presentationDto } from "../../_fixtures/apresentacao";

// Imagem PNG de DESENVOLVIMENTO (dados fictícios, sem banco): /dev/vitrine/apresentacao/imagem?v=<variante>
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const variant = String(request.nextUrl.searchParams.get("v") || "completo");
  return renderSummaryImage(presentationDto(variant), { download: wantsDownload(request.nextUrl.searchParams) });
}
