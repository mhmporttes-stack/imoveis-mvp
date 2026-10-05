import { cleanRef, safeDecode } from "@/lib/short-links.mjs";
import { resolveShortRef } from "@/lib/short-ref-resolver";
import { CAPTACAO_SHARE } from "@/lib/simulacao-share.mjs";
import { sharePreviewResponse } from "@/lib/share-preview-html.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Link curto da captação do corretor: /v/{codigo} → /captacao?ref={ref de captação} (código = short_ref do usuário).
export async function GET(request, { params }) {
  const { ref } = await params;
  const target = request.nextUrl.clone();
  target.pathname = "/captacao";
  const resolved = await resolveShortRef(cleanRef(safeDecode(String(ref || ""))), "captacao");
  if (resolved) target.searchParams.set("ref", resolved);
  return sharePreviewResponse(request, target, CAPTACAO_SHARE);
}
