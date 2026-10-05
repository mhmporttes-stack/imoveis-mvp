import { NextResponse } from "next/server";
import { cleanRef, safeDecode } from "@/lib/short-links.mjs";

export const dynamic = "force-dynamic";

// Link curto da captação do corretor: /v/{ref} → /captacao?ref={ref}.
export async function GET(request, { params }) {
  const { ref } = await params;
  const url = request.nextUrl.clone();
  url.pathname = "/captacao";
  const clean = cleanRef(safeDecode(String(ref || "")));
  if (clean) url.searchParams.set("ref", clean);
  return NextResponse.redirect(url, 307);
}
