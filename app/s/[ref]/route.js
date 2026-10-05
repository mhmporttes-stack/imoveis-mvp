import { cleanRef, safeDecode } from "@/lib/short-links.mjs";
import { resolveShortRef } from "@/lib/short-ref-resolver";
import { SHARE_DESCRIPTION, SHARE_IMAGE, SHARE_IMAGE_ALT, SHARE_TITLE } from "@/lib/simulacao-share.mjs";
import { sharePreviewResponse } from "@/lib/share-preview-html.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Link curto da simulação individual: /s/{codigo} → /simulacao?ref={ref de atribuição}. O código é o short_ref do
// usuário ("mhm", 1, 2…); um ref longo antigo também é aceito. Responde 200 com a prévia (Open Graph) para os crawlers e
// leva a pessoa ao destino na hora; atribuição, roleta e rastreio continuam na página de simulação (?ref= como sempre).
export async function GET(request, { params }) {
  const { ref } = await params;
  const target = request.nextUrl.clone();
  target.pathname = "/simulacao";
  const resolved = await resolveShortRef(cleanRef(safeDecode(String(ref || ""))), "simulation");
  if (resolved) target.searchParams.set("ref", resolved);
  return sharePreviewResponse(request, target, { title: SHARE_TITLE, description: SHARE_DESCRIPTION, image: SHARE_IMAGE, imageAlt: SHARE_IMAGE_ALT });
}
