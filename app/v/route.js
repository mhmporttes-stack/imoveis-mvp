import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Link curto da captação (venda seu imóvel): /v → /captacao.
export function GET(request) {
  const url = request.nextUrl.clone();
  url.pathname = "/captacao";
  return NextResponse.redirect(url, 307);
}
