import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Link curto da simulação do Matheus: /s → /simulacao (lib/short-links.mjs).
export function GET(request) {
  const url = request.nextUrl.clone();
  url.pathname = "/simulacao";
  return NextResponse.redirect(url, 307);
}
