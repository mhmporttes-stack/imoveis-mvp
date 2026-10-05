import { SHARE_DESCRIPTION, SHARE_IMAGE, SHARE_IMAGE_ALT, SHARE_TITLE } from "@/lib/simulacao-share.mjs";
import { sharePreviewResponse } from "@/lib/share-preview-html.mjs";

export const dynamic = "force-dynamic";

// Link curto da simulação do Matheus: /s → /simulacao. Responde 200 com a prévia (Open Graph) para os crawlers e leva
// a pessoa ao destino na hora (lib/share-preview-html.mjs).
export function GET(request) {
  const target = request.nextUrl.clone();
  target.pathname = "/simulacao";
  return sharePreviewResponse(request, target, { title: SHARE_TITLE, description: SHARE_DESCRIPTION, image: SHARE_IMAGE, imageAlt: SHARE_IMAGE_ALT });
}
