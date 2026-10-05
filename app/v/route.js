import { CAPTACAO_SHARE } from "@/lib/simulacao-share.mjs";
import { sharePreviewResponse } from "@/lib/share-preview-html.mjs";

export const dynamic = "force-dynamic";

// Link curto da captação (venda seu imóvel): /v → /captacao, com prévia para os crawlers.
export function GET(request) {
  const target = request.nextUrl.clone();
  target.pathname = "/captacao";
  return sharePreviewResponse(request, target, CAPTACAO_SHARE);
}
