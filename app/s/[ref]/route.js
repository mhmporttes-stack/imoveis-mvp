import { NextResponse } from "next/server";
import { cleanRef, safeDecode } from "@/lib/short-links.mjs";

export const dynamic = "force-dynamic";

// Link curto da simulação individual: /s/{ref} → /simulacao?ref={ref}. Todo o resto (atribuição, roleta, rastreio)
// continua na página de simulação, que lê o ?ref= como sempre.
export async function GET(request, { params }) {
  const { ref } = await params;
  const url = request.nextUrl.clone();
  url.pathname = "/simulacao";
  const clean = cleanRef(safeDecode(String(ref || "")));
  if (clean) url.searchParams.set("ref", clean);
  return NextResponse.redirect(url, 307);
}
