import { NextResponse } from "next/server";
import { cleanRef, safeDecode } from "@/lib/short-links.mjs";
import { resolveShortRef } from "@/lib/short-ref-resolver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Link curto da simulação individual: /s/{codigo} → /simulacao?ref={ref de atribuição}. O código é o short_ref do
// usuário ("mhm", 1, 2…); um ref longo antigo também é aceito. Todo o resto (atribuição, roleta, rastreio) continua
// na página de simulação, que lê o ?ref= como sempre.
export async function GET(request, { params }) {
  const { ref } = await params;
  const url = request.nextUrl.clone();
  url.pathname = "/simulacao";
  const resolved = await resolveShortRef(cleanRef(safeDecode(String(ref || ""))), "simulation");
  if (resolved) url.searchParams.set("ref", resolved);
  return NextResponse.redirect(url, 307);
}
