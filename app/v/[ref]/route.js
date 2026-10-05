import { NextResponse } from "next/server";
import { cleanRef, safeDecode } from "@/lib/short-links.mjs";
import { resolveShortRef } from "@/lib/short-ref-resolver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Link curto da captação do corretor: /v/{codigo} → /captacao?ref={ref de captação} (código = short_ref do usuário).
export async function GET(request, { params }) {
  const { ref } = await params;
  const url = request.nextUrl.clone();
  url.pathname = "/captacao";
  const resolved = await resolveShortRef(cleanRef(safeDecode(String(ref || ""))), "captacao");
  if (resolved) url.searchParams.set("ref", resolved);
  return NextResponse.redirect(url, 307);
}
